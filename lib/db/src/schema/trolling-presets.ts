import { pgTable, text, real, timestamp, uuid, jsonb, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { trollingPresetFoldersTable } from "./trolling-preset-folders.js";

export interface TrollingPresetWaypoint {
  lat: number;
  lon: number;
}

export const trollingPresetsTable = pgTable("trolling_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  headingDeg: real("heading_deg").notNull(),
  speedKnots: real("speed_knots").notNull(),
  startLat: real("start_lat"),
  startLon: real("start_lon"),
  waypoints: jsonb("waypoints").$type<TrollingPresetWaypoint[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  folderId: uuid("folder_id").references(() => trollingPresetFoldersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("trolling_presets_user_id_idx").on(table.userId),
  index("trolling_presets_folder_id_idx").on(table.folderId),
]);

export const insertTrollingPresetSchema = createInsertSchema(trollingPresetsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertTrollingPreset = z.infer<typeof insertTrollingPresetSchema>;
export type TrollingPreset = typeof trollingPresetsTable.$inferSelect;
