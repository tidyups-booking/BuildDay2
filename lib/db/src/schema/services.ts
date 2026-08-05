import {
  pgTable,
  text,
  serial,
  integer,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const servicesTable = pgTable("services", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id),
  name: text("name").notNull(),
  description: text("description"),
  priceMin: doublePrecision("price_min").notNull(),
  priceMax: doublePrecision("price_max").notNull(),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({
  id: true,
});
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;
