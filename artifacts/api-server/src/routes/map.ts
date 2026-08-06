import { Router, type IRouter } from "express";
import { and, eq, gte, lt, isNotNull, inArray } from "drizzle-orm";
import {
  db,
  bookingsTable,
  bookingAssignmentsTable,
  teamMembersTable,
  cleanerLocationsTable,
  homeownerPinsTable,
} from "@workspace/db";
import {
  GetMapConfigResponse,
  GetMapDataQueryParams,
  GetMapDataResponse,
  CreateMapPinBody,
  CreateMapPinResponse,
  DeleteMapPinParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { getCompanyForUser } from "../lib/company";
import { companyDayBounds } from "../lib/dayBounds";
import { geocodeAddress, GeocodeConfigError } from "../services/geocode";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// The Google Maps browser key. Served only to authenticated dispatchers so it
// never has to be baked into the client bundle; missing key is a soft state
// (configured: false) rather than an error, so the UI can show its own hint.
router.get(
  "/map/config",
  requireAuth,
  requireRole("owner", "dispatcher", "cleaner"),
  async (_req, res): Promise<void> => {
    const apiKey = process.env["GOOGLE_MAPS_API_KEY"] ?? "";
    res.json(
      GetMapConfigResponse.parse({
        apiKey,
        configured: apiKey.length > 0,
      }),
    );
  },
);

// Crew may watch the day unfold — jobs, coworkers and saved pins. Editing the
// saved pins below stays with dispatch.
router.get(
  "/map/data",
  requireAuth,
  requireRole("owner", "dispatcher", "cleaner"),
  async (req, res): Promise<void> => {
    const query = GetMapDataQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    const company = await getCompanyForUser(req.userId!);
    if (!company) {
      res.json(GetMapDataResponse.parse({ cleaners: [], jobs: [], pins: [] }));
      return;
    }

    const { start, end } = companyDayBounds(query.data.date, company.timezone);

    // Latest position per cleaner in this company (one row each — the phone
    // upserts rather than appends). Joined to the seat for the display name.
    const locationRows = await db
      .select({
        teamMemberId: cleanerLocationsTable.teamMemberId,
        name: teamMembersTable.name,
        lat: cleanerLocationsTable.lat,
        lng: cleanerLocationsTable.lng,
        accuracy: cleanerLocationsTable.accuracy,
        updatedAt: cleanerLocationsTable.updatedAt,
      })
      .from(cleanerLocationsTable)
      .innerJoin(
        teamMembersTable,
        eq(cleanerLocationsTable.teamMemberId, teamMembersTable.id),
      )
      .where(eq(cleanerLocationsTable.companyId, company.id));

    const cleaners = locationRows.map((r) => ({
      teamMemberId: r.teamMemberId,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      accuracy: r.accuracy ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));

    // Jobs on the requested day (company zone) that already have coordinates —
    // an un-geocoded booking simply has no pin yet.
    const jobRows = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.companyId, company.id),
          gte(bookingsTable.scheduledFor, start),
          lt(bookingsTable.scheduledFor, end),
          isNotNull(bookingsTable.lat),
          isNotNull(bookingsTable.lng),
        ),
      );

    const assigneesByBooking = await loadAssignees(jobRows.map((b) => b.id));

    const jobs = jobRows.map((b) => ({
      bookingId: b.id,
      customerName: b.customerName,
      customerAddress: b.customerAddress ?? null,
      lat: b.lat!,
      lng: b.lng!,
      scheduledFor: b.scheduledFor.toISOString(),
      status: b.status as "pending" | "confirmed" | "completed" | "canceled",
      assignees: assigneesByBooking.get(b.id) ?? [],
    }));

    const pinRows = await db
      .select()
      .from(homeownerPinsTable)
      .where(eq(homeownerPinsTable.companyId, company.id));

    const pins = pinRows.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address ?? null,
      lat: p.lat,
      lng: p.lng,
    }));

    res.json(GetMapDataResponse.parse({ cleaners, jobs, pins }));
  },
);

router.post(
  "/map/pins",
  requireAuth,
  requireRole("owner", "dispatcher"),
  async (req, res): Promise<void> => {
    const parsed = CreateMapPinBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const company = await getCompanyForUser(req.userId!);
    if (!company) {
      res.status(404).json({ error: "No company yet" });
      return;
    }

    let { lat, lng } = parsed.data;
    const address = parsed.data.address ?? null;

    // Coordinates win when supplied; otherwise resolve the address server-side
    // so the browser never sees the geocoding key.
    if ((lat == null || lng == null) && address) {
      try {
        const coords = await geocodeAddress(address);
        if (!coords) {
          res
            .status(400)
            .json({ error: "Couldn't find that address on the map." });
          return;
        }
        lat = coords.lat;
        lng = coords.lng;
      } catch (err) {
        if (err instanceof GeocodeConfigError) {
          logger.warn({ err }, "Pin geocoding unavailable");
          res.status(400).json({
            error:
              "Address lookup is unavailable — enter the location by hand.",
          });
          return;
        }
        throw err;
      }
    }

    if (lat == null || lng == null) {
      res
        .status(400)
        .json({ error: "A pin needs either coordinates or an address." });
      return;
    }

    const [pin] = await db
      .insert(homeownerPinsTable)
      .values({
        companyId: company.id,
        name: parsed.data.name,
        address,
        lat,
        lng,
      })
      .returning();

    res.status(201).json(
      CreateMapPinResponse.parse({
        id: pin!.id,
        name: pin!.name,
        address: pin!.address ?? null,
        lat: pin!.lat,
        lng: pin!.lng,
      }),
    );
  },
);

router.delete(
  "/map/pins/:id",
  requireAuth,
  requireRole("owner", "dispatcher"),
  async (req, res): Promise<void> => {
    const params = DeleteMapPinParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const company = await getCompanyForUser(req.userId!);
    if (!company) {
      res.status(404).json({ error: "No company yet" });
      return;
    }
    const deleted = await db
      .delete(homeownerPinsTable)
      .where(
        and(
          eq(homeownerPinsTable.id, params.data.id),
          eq(homeownerPinsTable.companyId, company.id),
        ),
      )
      .returning({ id: homeownerPinsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Pin not found" });
      return;
    }
    res.status(204).end();
  },
);

type Assignee = { teamMemberId: number; name: string };

/** Assignees for a set of bookings, keyed by booking id, in one query. */
async function loadAssignees(
  bookingIds: number[],
): Promise<Map<number, Assignee[]>> {
  const out = new Map<number, Assignee[]>();
  if (bookingIds.length === 0) return out;
  const rows = await db
    .select({
      bookingId: bookingAssignmentsTable.bookingId,
      teamMemberId: teamMembersTable.id,
      name: teamMembersTable.name,
    })
    .from(bookingAssignmentsTable)
    .innerJoin(
      teamMembersTable,
      eq(bookingAssignmentsTable.teamMemberId, teamMembersTable.id),
    )
    .where(inArray(bookingAssignmentsTable.bookingId, bookingIds))
    .orderBy(teamMembersTable.name);
  for (const row of rows) {
    const list = out.get(row.bookingId) ?? [];
    list.push({ teamMemberId: row.teamMemberId, name: row.name });
    out.set(row.bookingId, list);
  }
  return out;
}

export default router;
