import { pgTable, text, jsonb } from "drizzle-orm/pg-core";

export const userSettingsTable = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  settings: jsonb("settings").notNull().default({}),
});

export type UserSettings = typeof userSettingsTable.$inferSelect;
export type InsertUserSettings = typeof userSettingsTable.$inferInsert;
