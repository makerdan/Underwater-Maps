import { pgTable, text, real, integer, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// gps_trails — one row per recorded trail session
// ---------------------------------------------------------------------------
export const gpsTrailsTable = pgTable("gps_trails", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  datasetId: text("dataset_id").notNull(),
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
});

export const insertGpsTrailPointSchema = createInsertSchema(gpsTrailPointsTable).omit({
  id: true,
});
export type InsertGpsTrailPoint = z.infer<typeof insertGpsTrailPointSchema>;
export type GpsTrailPoint = typeof gpsTrailPointsTable.$inferSelect;
