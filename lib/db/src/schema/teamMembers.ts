import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const teamMembersTable = pgTable(
  "team_members",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(), // owner | dispatcher | cleaner
    status: text("status").notNull().default("invited"), // active | invited
    /**
     * The Clerk account that claimed this seat. Null until the invitee signs up
     * and their VERIFIED email is matched to this row. Unique across the table,
     * so one Clerk account can never occupy two seats — if the same address is
     * invited by two companies, the first claim wins and the other stays
     * pending.
     */
    clerkUserId: text("clerk_user_id").unique(),
    /**
     * Clerk backend invitation id (`inv_...`) for the sign-up email we sent, so
     * removing the member can also revoke the emailed link. Null when the email
     * failed to send — the seat still works, the invitee just has to sign up
     * manually with the invited address.
     */
    clerkInvitationId: text("clerk_invitation_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One seat per address per company, so two racing invites cannot leave a
    // ghost row that nobody can ever claim.
    uniqueIndex("team_members_company_email_idx").on(
      table.companyId,
      sql`lower(${table.email})`,
    ),
  ],
);

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit(
  { id: true, createdAt: true },
);
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;
