import { pgTable, text, real, timestamp, uuid, jsonb, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface RouteWaypoint {
  lon: number;
  lat: number;
  depth: number;
}

export const routesTable = pgTable("routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  datasetId: text("dataset_id").notNull(),
  name: text("name").notNull(),
  waypoints: jsonb("waypoints").$type<RouteWaypoint[]>().notNull().default([]),
  waypointCount: integer("waypoint_count").notNull().default(0),
  totalDistanceM: real("total_distance_m").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("routes_user_id_idx").on(table.userId),
]);

export const insertRouteSchema = createInsertSchema(routesTable).omit({
  id: true,
  createdAt: true,
  userId: true,
});
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type Route = typeof routesTable.$inferSelect;
