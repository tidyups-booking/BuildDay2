import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
} from "drizzle-orm/pg-core";
import type { QuoteTotals } from "@workspace/pricing";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";


export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id),
  // Unique so concurrent transcript/summary webhooks for the same call cannot
  // create duplicate bookings.
  callId: integer("call_id").unique(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerAddress: text("customer_address"),
  service: text("service").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"), // pending | confirmed | completed | canceled
  // Quoting lives here rather than in Jobber, so companies that skip Jobber
  // can still price a job and text the customer.
  //
  // A job is priced as hours x crew rate, plus a fuel surcharge, less any
  // promo discount. Those inputs are stored rather than just their result, so
  // reopening a quote shows the dispatcher the same choices they made — and the
  // estimate's line items can be rebuilt from them exactly.
  quoteHours: doublePrecision("quote_hours"),
  // Which crew option was picked, e.g. "2 cleaners". Free text because it is
  // shown to the customer and companies word it differently.
  quoteCrewLabel: text("quote_crew_label"),
  quoteHourlyRate: doublePrecision("quote_hourly_rate"),
  // Null means "use the company default"; 0 means "waived for this job".
  quoteFuelSurcharge: doublePrecision("quote_fuel_surcharge"),
  quoteDiscountAmount: doublePrecision("quote_discount_amount"),
  // Where the customer heard about the company — names the discount line on
  // the estimate, e.g. "Discount $10 Google Ad Promo".
  quoteReferralSource: text("quote_referral_source"),
  // Fallback for a job priced without the calculator: a flat subtotal, before
  // the company's tax and fees. The customer-facing total is always derived,
  // never stored, so changing a tax rate cannot leave an old quote disagreeing
  // with itself.
  quotedAmount: doublePrecision("quoted_amount"),
  // Overrides the company default when a particular job needs more up front.
  quoteDeposit: doublePrecision("quote_deposit"),
  quoteNotes: text("quote_notes"),
  // What the customer was actually promised, frozen at the moment the text
  // went out. Everything else about a quote is derived from current settings,
  // but a sent price is a commitment: changing the company's tax rate next
  // month must not rewrite history and leave the dashboard disagreeing with
  // the message in the customer's phone.
  quoteSentTotals: jsonb("quote_sent_totals").$type<QuoteTotals>(),
  // The exact text last sent to the customer, and when. Kept so the dispatcher
  // can see what was promised rather than guessing from the amount alone.
  quoteMessage: text("quote_message"),
  quoteSentAt: timestamp("quote_sent_at", { withTimezone: true }),
  // The customer's key to their own quote page. Unguessable rather than
  // sequential: the page is necessarily public — someone reading a text on
  // their phone is not going to sign in — so the token IS the authorisation.
  // Unique so a collision fails loudly instead of handing one customer another
  // customer's quote.
  quoteToken: text("quote_token").unique(),
  // Set when the customer taps Approve on that page.
  quoteApprovedAt: timestamp("quote_approved_at", { withTimezone: true }),
  jobberSynced: boolean("jobber_synced").notNull().default(false),
  jobberJobId: text("jobber_job_id"),
  jobberClientId: text("jobber_client_id"),
  jobberWebUri: text("jobber_web_uri"),
  jobberSyncError: text("jobber_sync_error"),
  jobberSyncErrorAt: timestamp("jobber_sync_error_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
