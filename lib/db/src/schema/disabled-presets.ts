import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const disabledPresetsTable = pgTable("disabled_presets", {
  id: text("id").primaryKey(),
  disabledAt: timestamp("disabled_at").notNull().defaultNow(),
});

export type DisabledPreset = typeof disabledPresetsTable.$inferSelect;
