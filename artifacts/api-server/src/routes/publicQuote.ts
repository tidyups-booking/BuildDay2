import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  bookingsTable,
  companiesTable,
  servicesTable,
  activityTable,
  type Booking,
  type Company,
} from "@workspace/db";
import { GetPublicQuoteParams, ApprovePublicQuoteParams } from "@workspace/api-zod";
import { computeQuoteTotals, formatAppointment } from "../lib/quotes";
import { publicBaseUrl } from "../lib/publicUrl";
import { logger } from "../lib/logger";

/**
 * The customer's own view of their quote.
 *
 * Deliberately NOT behind requireAuth: the customer is tapping a link in a text
 * message and will never have an account. The token in the URL is the
 * authorisation, so it must be unguessable and the response must carry only
 * what belongs on that customer's estimate — never a company-wide listing and
 * never anything keyed by a guessable booking id.
 */
const router: IRouter = Router();

/** 128 bits of randomness, URL-safe. Long enough that guessing is hopeless. */
export function newQuoteToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Bookings created before share links existed — or priced but never sent —
 * have no token yet. Mint one on first need rather than backfilling every row,
 * and reuse it forever after so a link already in a customer's phone keeps
 * working.
 */
export async function ensureQuoteToken(booking: Booking): Promise<string> {
  if (booking.quoteToken) return booking.quoteToken;
  const token = newQuoteToken();
  await db
    .update(bookingsTable)
    .set({ quoteToken: token })
    .where(eq(bookingsTable.id, booking.id));
  booking.quoteToken = token;
  return token;
}

export function quoteUrl(token: string): string {
  return `${publicBaseUrl()}/quote/${token}`;
}

/** Date only, in the company's timezone — "August 4, 2026". */
function formatDay(when: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone,
    }).format(when);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(when);
  }
}

async function buildPublicQuote(company: Company, booking: Booking) {
  // The company writes a description per service ("Kitchen: thorough cleaning
  // of appliances..."), which is the summary the customer expects to read.
  const [service] = await db
    .select()
    .from(servicesTable)
    .where(
      and(
        eq(servicesTable.companyId, company.id),
        eq(servicesTable.name, booking.service),
      ),
    )
    .limit(1);

  // Prefer the frozen copy: this is the page the customer was sent to, so it
  // must show the price they were promised even if the company's rates have
  // moved since.
  const totals = booking.quoteSentTotals ?? computeQuoteTotals(company, booking);

  return {
    companyName: company.name,
    customerName: booking.customerName,
    customerAddress: booking.customerAddress,
    service: booking.service,
    serviceDescription: service?.description ?? null,
    scheduledForLabel: formatAppointment(booking.scheduledFor, company.timezone),
    totals,
    notes: booking.quoteNotes,
    sentAtLabel: booking.quoteSentAt
      ? formatDay(booking.quoteSentAt, company.timezone)
      : null,
    approved: booking.quoteApprovedAt != null,
    approvedAtLabel: booking.quoteApprovedAt
      ? formatDay(booking.quoteApprovedAt, company.timezone)
      : null,
  };
}

async function loadByToken(token: string) {
  const [row] = await db
    .select({ booking: bookingsTable, company: companiesTable })
    .from(bookingsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, bookingsTable.companyId))
    .where(eq(bookingsTable.quoteToken, token))
    .limit(1);
  return row;
}

router.get("/quote/:token", async (req, res): Promise<void> => {
  const params = GetPublicQuoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "That quote link isn't valid." });
    return;
  }
  const row = await loadByToken(params.data.token);
  if (!row) {
    // Same response for a malformed token and a real one that no longer
    // exists, so the endpoint can't be used to probe which tokens are live.
    res.status(404).json({ error: "That quote link isn't valid." });
    return;
  }
  res.json(await buildPublicQuote(row.company, row.booking));
});

router.post("/quote/:token/approve", async (req, res): Promise<void> => {
  const params = ApprovePublicQuoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "That quote link isn't valid." });
    return;
  }
  const row = await loadByToken(params.data.token);
  if (!row) {
    res.status(404).json({ error: "That quote link isn't valid." });
    return;
  }
  const { booking, company } = row;

  // Approving twice is not an error — customers double-tap, and phones
  // prefetch links. The `quote_approved_at IS NULL` guard makes the winner
  // decidable in the database rather than in a read-then-write race, so two
  // simultaneous taps can't both move the timestamp or both post to the
  // dispatcher's feed.
  const [claimed] = await db
    .update(bookingsTable)
    .set({
      quoteApprovedAt: new Date(),
      // An approved quote is a confirmed job as far as the dispatcher board is
      // concerned — but never drag a finished or cancelled job back.
      ...(booking.status === "pending" ? { status: "confirmed" } : {}),
    })
    .where(
      and(
        eq(bookingsTable.id, booking.id),
        eq(bookingsTable.companyId, company.id),
        isNull(bookingsTable.quoteApprovedAt),
      ),
    )
    .returning();

  if (!claimed) {
    // Already approved — show them the same confirmed page, not an error.
    const fresh = await loadByToken(params.data.token);
    res.json(await buildPublicQuote(company, fresh?.booking ?? booking));
    return;
  }

  try {
    await db.insert(activityTable).values({
      companyId: company.id,
      type: "quote_approved",
      message: `${booking.customerName} approved their quote.`,
    });
  } catch (err) {
    // The approval itself is recorded; a missing feed entry must not make the
    // customer think their tap failed.
    logger.error(
      { err, bookingId: booking.id },
      "Quote approved but the activity entry failed",
    );
  }

  res.json(await buildPublicQuote(company, claimed));
});

export default router;
