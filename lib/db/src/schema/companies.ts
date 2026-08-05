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

export type JobberOauthState = {
  state: string;
  verifier: string;
  redirectUri: string;
  createdAt: string;
};

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
  // Jobber OAuth tokens — real OAuth with PKCE
  jobberConnected: boolean("jobber_connected").notNull().default(false),
  jobberAccountName: text("jobber_account_name"),
  jobberAccountId: text("jobber_account_id"),
  jobberAccessToken: text("jobber_access_token"),
  jobberRefreshToken: text("jobber_refresh_token"),
  jobberTokenExpiresAt: timestamp("jobber_token_expires_at", {
    withTimezone: true,
  }),
  jobberOauth: jsonb("jobber_oauth").$type<JobberOauthState | null>(),
  // Set when we learn the stored tokens are dead (refresh rejected, or Jobber
  // told us the app was disconnected) so the UI can prompt a reconnect instead
  // of offering a sync that is guaranteed to fail.
  jobberNeedsReauth: boolean("jobber_needs_reauth").notNull().default(false),
  // Quo integration — company brings their own Quo workspace key
  quoConnected: boolean("quo_connected").notNull().default(false),
  quoWorkspaceName: text("quo_workspace_name"),
  // Quo lines this company's receptionist watches. A line may only be claimed
  // by one company — enforced in the selection route, since Postgres cannot
  // express uniqueness across array elements without an exclusion constraint.
  quoNumberIds: text("quo_number_ids").array().notNull().default([]),
  // The company's own Quo workspace API key, AES-256-GCM encrypted. Quo has no
  // OAuth flow, so each company pastes a key generated in their Quo settings.
  // Never returned to the browser — only `quoKeyLast4` is.
  quoApiKeyEncrypted: text("quo_api_key_encrypted"),
  quoKeyLast4: text("quo_key_last4"),
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
