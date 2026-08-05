import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, bookingsTable, activityTable, type Booking } from "@workspace/db";
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
  if (!company.jobberConnected) {
    res.status(400).json({ error: "Connect Jobber before syncing bookings" });
    return;
  }

  // Simulated Jobber job creation until real Jobber API keys are configured
  const jobberJobId = `JOB-${Date.now().toString(36).toUpperCase()}`;
  const [booking] = await db
    .update(bookingsTable)
    .set({ jobberSynced: true, jobberJobId })
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

  await db.insert(activityTable).values({
    companyId: company.id,
    type: "jobber_synced",
    message: `Booking for ${booking.customerName} synced to Jobber (${jobberJobId}).`,
  });

  res.json(SyncBookingToJobberResponse.parse(serializeBooking(booking)));
});

export default router;
