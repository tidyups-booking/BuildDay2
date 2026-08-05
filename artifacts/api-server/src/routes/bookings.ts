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
  CreateBookingBody,
  CreateBookingResponse,
  UpdateBookingParams,
  UpdateBookingBody,
  UpdateBookingResponse,
  GetQuotePreviewParams,
  GetQuotePreviewResponse,
  SendQuoteParams,
  SendQuoteBody,
  SendQuoteResponse,
  SyncBookingToJobberParams,
  SyncBookingToJobberResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getCompanyForUser, companyQuoKey } from "../lib/company";
import { listPhoneNumbers, sendMessage, toE164 } from "../lib/quo";
import { buildQuoteMessage } from "../lib/quotes";
import type { Company } from "@workspace/db";
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
    // Nullable: only set once a quote has actually gone out. Forgetting this
    // breaks every booking response, not just the one that was quoted.
    quoteSentAt: b.quoteSentAt ? b.quoteSentAt.toISOString() : null,
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
  const d = parsed.data;
  if (d.status !== undefined) updates.status = d.status;
  if (d.customerName !== undefined) updates.customerName = d.customerName;
  if (d.customerPhone !== undefined) updates.customerPhone = d.customerPhone;
  if (d.customerAddress !== undefined) updates.customerAddress = d.customerAddress;
  if (d.service !== undefined) updates.service = d.service;
  if (d.quotedAmount !== undefined) updates.quotedAmount = d.quotedAmount;
  if (d.quoteNotes !== undefined) updates.quoteNotes = d.quoteNotes;
  if (d.scheduledFor !== undefined) {
    const when = new Date(d.scheduledFor);
    if (Number.isNaN(when.getTime())) {
      res.status(400).json({ error: "Invalid scheduledFor date" });
      return;
    }
    updates.scheduledFor = when;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
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

router.post("/bookings", async (req, res): Promise<void> => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "No company yet" });
    return;
  }
  const when = new Date(parsed.data.scheduledFor);
  if (Number.isNaN(when.getTime())) {
    res.status(400).json({ error: "Invalid scheduledFor date" });
    return;
  }

  const [booking] = await db
    .insert(bookingsTable)
    .values({
      companyId: company.id,
      // Hand-entered bookings have no originating call.
      callId: null,
      customerName: parsed.data.customerName,
      customerPhone: parsed.data.customerPhone,
      customerAddress: parsed.data.customerAddress ?? null,
      service: parsed.data.service,
      scheduledFor: when,
      status: parsed.data.status ?? "pending",
      quotedAmount: parsed.data.quotedAmount ?? null,
      quoteNotes: parsed.data.quoteNotes ?? null,
    })
    .returning();

  await db.insert(activityTable).values({
    companyId: company.id,
    type: "booking_created",
    message: `Booking added by hand for ${booking!.customerName} — ${booking!.service}.`,
  });

  res.status(201).json(CreateBookingResponse.parse(serializeBooking(booking!)));
});

/**
 * Works out which of the company's own Quo lines a quote should be sent from,
 * preferring the line the customer actually called so the thread stays in one
 * place. Returns a reason instead of throwing when sending isn't possible yet,
 * because the preview endpoint needs to explain the situation rather than fail.
 */
async function resolveQuoteSender(
  company: Company,
  booking: Booking,
): Promise<{ from: string } | { blockedReason: string }> {
  const apiKey = companyQuoKey(company);
  if (!apiKey) {
    return { blockedReason: "Connect your Quo account to text quotes." };
  }
  if (company.quoNumberIds.length === 0) {
    return {
      blockedReason:
        "Choose which Quo number your receptionist uses before texting quotes.",
    };
  }

  let preferredId: string | null = null;
  if (booking.callId != null) {
    const [call] = await db
      .select({ lineId: callsTable.quoPhoneNumberId })
      .from(callsTable)
      .where(
        and(
          eq(callsTable.id, booking.callId),
          eq(callsTable.companyId, company.id),
        ),
      );
    if (call?.lineId && company.quoNumberIds.includes(call.lineId)) {
      preferredId = call.lineId;
    }
  }
  const wantedId = preferredId ?? company.quoNumberIds[0]!;

  let numbers;
  try {
    numbers = await listPhoneNumbers(apiKey);
  } catch (err) {
    logger.warn({ err }, "Could not list Quo numbers for a quote");
    return {
      blockedReason: "Couldn't reach Quo to find your number. Try again shortly.",
    };
  }

  const match =
    numbers.find((n) => n.id === wantedId) ??
    numbers.find((n) => company.quoNumberIds.includes(n.id));
  if (!match) {
    return {
      blockedReason:
        "That Quo number is no longer in your workspace. Reconnect Quo to fix it.",
    };
  }
  return { from: match.number };
}

async function loadBooking(
  companyId: number,
  bookingId: number,
): Promise<Booking | undefined> {
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.id, bookingId),
        eq(bookingsTable.companyId, companyId),
      ),
    );
  return booking;
}

router.get("/bookings/:id/quote-preview", async (req, res): Promise<void> => {
  const params = GetQuotePreviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const booking = await loadBooking(company.id, params.data.id);
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const sender = await resolveQuoteSender(company, booking);
  const reachable = toE164(booking.customerPhone) !== null;

  res.json(
    GetQuotePreviewResponse.parse({
      // Always regenerated from the current price and time so edits show up,
      // even if an earlier version was already sent.
      message: buildQuoteMessage(company, booking),
      canSend: "from" in sender && reachable,
      blockedReason:
        "blockedReason" in sender
          ? sender.blockedReason
          : reachable
            ? null
            : "This customer's phone number isn't a number we can text.",
      fromNumber: "from" in sender ? sender.from : null,
    }),
  );
});

router.post("/bookings/:id/send-quote", async (req, res): Promise<void> => {
  const params = SendQuoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SendQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompanyForUser(req.userId!);
  if (!company) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const booking = await loadBooking(company.id, params.data.id);
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const to = toE164(booking.customerPhone);
  if (!to) {
    res.status(400).json({
      error: "This customer's phone number isn't a number we can text.",
    });
    return;
  }
  const sender = await resolveQuoteSender(company, booking);
  if ("blockedReason" in sender) {
    res.status(409).json({ error: sender.blockedReason });
    return;
  }
  const apiKey = companyQuoKey(company);
  if (!apiKey) {
    res.status(409).json({ error: "Connect your Quo account to text quotes." });
    return;
  }

  try {
    await sendMessage(apiKey, {
      from: sender.from,
      to,
      content: parsed.data.message,
    });
  } catch (err) {
    logger.error({ err }, "Quote text failed to send");
    res.status(502).json({
      error:
        err instanceof Error
          ? `Couldn't send the quote: ${err.message}`
          : "Couldn't send the quote",
    });
    return;
  }

  // Past this point the customer HAS the text. If bookkeeping fails we must not
  // report a plain failure — the dispatcher would resend and the customer would
  // get the quote twice.
  let updated;
  try {
    [updated] = await db
      .update(bookingsTable)
      .set({ quoteMessage: parsed.data.message, quoteSentAt: new Date() })
      .where(
        and(
          eq(bookingsTable.id, booking.id),
          eq(bookingsTable.companyId, company.id),
        ),
      )
      .returning();

    await db.insert(activityTable).values({
      companyId: company.id,
      type: "quote_sent",
      message: `Quote texted to ${booking.customerName} at ${booking.customerPhone}.`,
    });
  } catch (err) {
    logger.error(
      { err, bookingId: booking.id, companyId: company.id },
      "Quote text was delivered but recording it failed",
    );
    res.status(500).json({
      error:
        "The quote was texted to the customer, but we couldn't save it against " +
        "this booking. Don't resend — they already have it.",
    });
    return;
  }

  res.json(SendQuoteResponse.parse(serializeBooking(updated!)));
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
