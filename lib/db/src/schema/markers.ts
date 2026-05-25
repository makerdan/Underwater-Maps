import { pgTable, text, real, timestamp, uuid } from "drizzle-orm/pg-core";
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
  userId: text("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMarkerSchema = createInsertSchema(markersTable).omit({
  id: true,
  createdAt: true,
  userId: true,
});
export type InsertMarker = z.infer<typeof insertMarkerSchema>;
export type Marker = typeof markersTable.$inferSelect;
