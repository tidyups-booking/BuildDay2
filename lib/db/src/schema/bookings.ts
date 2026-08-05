import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";
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
  quotedAmount: doublePrecision("quoted_amount"),
  quoteNotes: text("quote_notes"),
  // The exact text last sent to the customer, and when. Kept so the dispatcher
  // can see what was promised rather than guessing from the amount alone.
  quoteMessage: text("quote_message"),
  quoteSentAt: timestamp("quote_sent_at", { withTimezone: true }),
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
