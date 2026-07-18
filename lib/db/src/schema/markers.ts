import { pgTable, text, real, timestamp, uuid, index, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const MARKER_TYPES = ["fish", "shipwreck", "coral", "vent", "custom", "depth_pole"] as const;
export type MarkerType = (typeof MARKER_TYPES)[number];

export const markersTable = pgTable("markers", {
  id: uuid("id").primaryKey().defaultRandom(),
  datasetId: text("dataset_id").notNull(),
  lon: real("lon").notNull(),
  lat: real("lat").notNull(),
  depth: real("depth").notNull(),
  type: text("type").notNull().default("custom"),
  label: text("label").notNull(),
  notes: text("notes"),
  userId: text("user_id").notNull(),
  /** Per-user sequential catch number assigned by quick-drop ("Catch N"). */
  catchSeq: integer("catch_seq"),
  /** Frozen conditions snapshot captured at quick-drop time. */
  conditions: jsonb("conditions").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("markers_user_id_idx").on(table.userId),
]);

/**
 * catch_counters — one row per user holding the last catch sequence number
 * allocated by quick-drop. Monotonically increasing; never decremented on
 * marker deletion so numbers are never reused.
 */
export const catchCountersTable = pgTable("catch_counters", {
  userId: text("user_id").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});

export const insertMarkerSchema = createInsertSchema(markersTable).omit({
  id: true,
  createdAt: true,
  userId: true,
});
export type InsertMarker = z.infer<typeof insertMarkerSchema>;
export type Marker = typeof markersTable.$inferSelect;
