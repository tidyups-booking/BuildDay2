import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type CustomQuestion = { question: string; answer: string };

export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().unique(),
  name: text("name").notNull(),
  greeting: text("greeting").notNull().default(""),
  collectFields: text("collect_fields").array().notNull().default([]),
  customQuestions: jsonb("custom_questions")
    .$type<CustomQuestion[]>()
    .notNull()
    .default([]),
  ringThroughNumber: text("ring_through_number"),
  phoneNumber: text("phone_number"),
  jobberConnected: boolean("jobber_connected").notNull().default(false),
  jobberAccountName: text("jobber_account_name"),
  receptionistConfigured: boolean("receptionist_configured")
    .notNull()
    .default(false),
  isLive: boolean("is_live").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
