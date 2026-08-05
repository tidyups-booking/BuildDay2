import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  bookingsTable,
  callsTable,
  activityTable,
  type Booking,
} from "@workspace/db";
import {
  ListBookingsResponse,
  UpdateBookingParams,
  UpdateBookingBody,
  UpdateBookingResponse,
  SyncBookingToJobberParams,
  SyncBookingToJobberResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getCompanyForUser } from "../lib/company";
import {
  getValidAccessToken,
  createJobberClient,
  createJobberRequest,
  tryAttachRequestNote,
} from "../lib/jobber";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(requireAuth);

function serializeBooking(b: Booking) {
  return {
    ...b,
    scheduledFor: b.scheduledFor.toISOString(),
    createdAt: b.createdAt.toISOString(),
  };
}

router.get("/bookings", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.json(ListBookingsResponse.parse([]));
    return;
  }
  const bookings = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.companyId, company.id))
    .orderBy(desc(bookingsTable.createdAt));
  res.json(ListBookingsResponse.parse(bookings.map(serializeBooking)));
});

router.patch("/bookings/:id", async (req, res): Promise<void> => {
  const params = UpdateBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const updates: Partial<typeof bookingsTable.$inferInsert> = {};
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.scheduledFor !== undefined) {
    const d = new Date(parsed.data.scheduledFor);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: "Invalid scheduledFor date" });
      return;
    }
    updates.scheduledFor = d;
  }

  const [booking] = await db
    .update(bookingsTable)
    .set(updates)
    .where(
      and(
        eq(bookingsTable.id, params.data.id),
        eq(bookingsTable.companyId, company.id),
      ),
    )
    .returning();
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.json(UpdateBookingResponse.parse(serializeBooking(booking)));
});

router.post("/bookings/:id/sync-jobber", async (req, res): Promise<void> => {
  const params = SyncBookingToJobberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  if (company.jobberNeedsReauth) {
    res.status(409).json({
      error: "Jobber authorization has expired — reconnect Jobber to keep syncing.",
    });
    return;
  }
  if (!company.jobberConnected || !company.jobberRefreshToken) {
    res.status(400).json({ error: "Connect Jobber before syncing bookings" });
    return;
  }

  const [existing] = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.id, params.data.id),
        eq(bookingsTable.companyId, company.id),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  if (existing.jobberSynced) {
    res.json(SyncBookingToJobberResponse.parse(serializeBooking(existing)));
    return;
  }

  // Wizard answers extracted from the call, mapped into the Jobber request note
  let extractedAnswers: Array<{ field: string; value: string }> = [];
  if (existing.callId) {
    const [call] = await db
      .select()
      .from(callsTable)
      .where(eq(callsTable.id, existing.callId));
    extractedAnswers = (call?.extractedAnswers as typeof extractedAnswers) ?? [];
  }

  try {
    const accessToken = await getValidAccessToken(company);
    const client = await createJobberClient(accessToken, {
      name: existing.customerName,
      phone: existing.customerPhone,
    });
    const scheduled = existing.scheduledFor.toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "short",
    });
    const request = await createJobberRequest(accessToken, {
      clientId: client.id,
      title: `${existing.service} — ${existing.customerName} (requested ${scheduled})`,
      address: existing.customerAddress,
    });

    const noteLines = [
      `Booking captured by the Book My Cleaning AI receptionist.`,
      `Service: ${existing.service}`,
      `Requested time: ${scheduled}`,
      `Phone: ${existing.customerPhone}`,
      ...(existing.customerAddress ? [`Address: ${existing.customerAddress}`] : []),
      ...extractedAnswers.map((a) => `${a.field}: ${a.value}`),
    ];
    await tryAttachRequestNote(accessToken, request.id, noteLines.join("\n"));

    const [booking] = await db
      .update(bookingsTable)
      .set({
        jobberSynced: true,
        jobberJobId: request.id,
        jobberClientId: client.id,
        jobberWebUri: request.jobberWebUri,
      })
      .where(eq(bookingsTable.id, existing.id))
      .returning();

    await db.insert(activityTable).values({
      companyId: company.id,
      type: "jobber_synced",
      message: `Booking for ${booking!.customerName} synced to Jobber as a work request.`,
    });

    res.json(SyncBookingToJobberResponse.parse(serializeBooking(booking!)));
  } catch (err) {
    logger.error({ err }, "Jobber sync failed");
    res.status(502).json({
      error:
        err instanceof Error
          ? `Jobber sync failed: ${err.message}`
          : "Jobber sync failed",
    });
  }
});

export default router;
