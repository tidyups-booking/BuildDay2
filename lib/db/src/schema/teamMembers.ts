import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(), // owner | dispatcher | cleaner
  status: text("status").notNull().default("invited"), // active | invited
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit(
  { id: true, createdAt: true },
);
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;
