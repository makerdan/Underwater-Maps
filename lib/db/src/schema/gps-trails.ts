import { pgTable, text, real, integer, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customDatasetsTable } from "./custom-datasets.js";

// ---------------------------------------------------------------------------
// gps_trails — one row per recorded trail session
// ---------------------------------------------------------------------------
export const gpsTrailsTable = pgTable("gps_trails", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  // References the custom_datasets row this trail was recorded against.
  // Nullable so rows survive a dataset deletion (onDelete: 'set null').
  datasetId: uuid("dataset_id").references(() => customDatasetsTable.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  colour: text("colour").notNull().default("#ff6600"),
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at").notNull(),
  pointCount: integer("point_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("gps_trails_user_id_idx").on(table.userId),
]);

export const insertGpsTrailSchema = createInsertSchema(gpsTrailsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertGpsTrail = z.infer<typeof insertGpsTrailSchema>;
export type GpsTrail = typeof gpsTrailsTable.$inferSelect;

// ---------------------------------------------------------------------------
// gps_trail_points — one row per GPS sample within a trail
// ---------------------------------------------------------------------------
export const gpsTrailPointsTable = pgTable("gps_trail_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  trailId: uuid("trail_id")
    .notNull()
    .references(() => gpsTrailsTable.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  lon: real("lon").notNull(),
  lat: real("lat").notNull(),
  accuracy: real("accuracy").notNull().default(0),
  recordedAt: timestamp("recorded_at").notNull(),
}, (table) => [
  uniqueIndex("gps_trail_points_trail_seq_uniq").on(table.trailId, table.seq),
]);

export const insertGpsTrailPointSchema = createInsertSchema(gpsTrailPointsTable).omit({
  id: true,
});
export type InsertGpsTrailPoint = z.infer<typeof insertGpsTrailPointSchema>;
export type GpsTrailPoint = typeof gpsTrailPointsTable.$inferSelect;
