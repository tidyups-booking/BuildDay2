import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  callsTable,
  bookingsTable,
  servicesTable,
  activityTable,
  type Call,
} from "@workspace/db";
import {
  ListCallsQueryParams,
  ListCallsResponse,
  GetCallParams,
  GetCallResponse,
  SimulateTestCallResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getCompanyForUser } from "../lib/company";
import { buildSimulatedCall } from "../lib/simulateCall";

const router: IRouter = Router();

router.use(requireAuth);

function serializeCall(c: Call) {
  return {
    id: c.id,
    callerName: c.callerName,
    callerPhone: c.callerPhone,
    status: c.status,
    serviceRequested: c.serviceRequested,
    preferredTime: c.preferredTime,
    startedAt: c.startedAt.toISOString(),
    durationSeconds: c.durationSeconds,
    isTest: c.isTest,
    bookingId: c.bookingId,
  };
}

function serializeCallDetail(c: Call) {
  return {
    ...serializeCall(c),
    transcript: c.transcript,
    extractedAnswers: c.extractedAnswers,
  };
}

router.get("/calls", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.json(ListCallsResponse.parse([]));
    return;
  }
  const query = ListCallsQueryParams.safeParse(req.query);
  const status = query.success ? query.data.status : undefined;

  const where = status
    ? and(eq(callsTable.companyId, company.id), eq(callsTable.status, status))
    : eq(callsTable.companyId, company.id);

  const calls = await db
    .select()
    .from(callsTable)
    .where(where)
    .orderBy(desc(callsTable.startedAt));

  res.json(ListCallsResponse.parse(calls.map(serializeCall)));
});

router.get("/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const [call] = await db
    .select()
    .from(callsTable)
    .where(
      and(
        eq(callsTable.id, params.data.id),
        eq(callsTable.companyId, company.id),
      ),
    );
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(GetCallResponse.parse(serializeCallDetail(call)));
});

router.post("/calls/simulate", async (req, res): Promise<void> => {
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }

  const services = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.companyId, company.id));

  const sim = buildSimulatedCall(company, services);
  const callerPhone = `(555) ${100 + Math.floor(Math.random() * 900)}-${1000 + Math.floor(Math.random() * 9000)}`;

  // Create the booking that the AI extracted from the call
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 3 + Math.floor(Math.random() * 5));
  scheduledFor.setHours(10, 0, 0, 0);

  const [booking] = await db
    .insert(bookingsTable)
    .values({
      companyId: company.id,
      customerName: sim.ctx.callerName,
      customerPhone: callerPhone,
      customerAddress: sim.ctx.address,
      service: sim.service ? sim.service.name : "Deep Clean",
      scheduledFor,
      status: "pending",
    })
    .returning();

  const [call] = await db
    .insert(callsTable)
    .values({
      companyId: company.id,
      callerName: sim.ctx.callerName,
      callerPhone,
      status: "booked",
      serviceRequested: sim.service ? sim.service.name : "Deep Clean",
      preferredTime: sim.ctx.preferredTime,
      startedAt: new Date(),
      durationSeconds: sim.durationSeconds,
      isTest: true,
      transcript: sim.transcript,
      extractedAnswers: sim.extractedAnswers,
      bookingId: booking!.id,
    })
    .returning();

  await db
    .update(bookingsTable)
    .set({ callId: call!.id })
    .where(eq(bookingsTable.id, booking!.id));

  await db.insert(activityTable).values([
    {
      companyId: company.id,
      type: "test_call",
      message: `Test call answered — ${sim.ctx.callerName} asked about ${call!.serviceRequested}.`,
    },
    {
      companyId: company.id,
      type: "booking_created",
      message: `Booking created for ${sim.ctx.callerName} (${call!.serviceRequested}).`,
    },
  ]);

  res.status(201).json(SimulateTestCallResponse.parse(serializeCallDetail(call!)));
});

export default router;
