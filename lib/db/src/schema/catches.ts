import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { markersTable } from "./markers.js";

/**
 * catch_entries — a user's catch journal, one row per logged catch on a
 * marker ("spot"). A single marker can hold many catch entries; each entry
 * carries an emoji/symbol, optional free-text notes, and photo object paths
 * (normalized "/objects/…" paths in private object storage).
 */
export const catchEntriesTable = pgTable("catch_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  markerId: uuid("marker_id")
    .notNull()
    .references(() => markersTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  symbolName: text("symbol_name").notNull().default(""),
  notes: text("notes"),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("catch_entries_marker_id_idx").on(table.markerId),
  index("catch_entries_user_id_idx").on(table.userId),
]);

export type CatchEntryRow = typeof catchEntriesTable.$inferSelect;
export type InsertCatchEntry = typeof catchEntriesTable.$inferInsert;
