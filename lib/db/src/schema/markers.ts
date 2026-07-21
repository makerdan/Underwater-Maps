import { pgTable, text, real, timestamp, uuid, index, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const MARKER_TYPES = ["fish", "shipwreck", "coral", "vent", "custom", "depth_pole", "log", "vegetation", "sample", "bass", "trout", "pike", "walleye", "crayfish", "salmon", "tuna", "halibut", "shark", "swordfish", "rockfish", "cod", "mahi_mahi", "grouper", "snapper", "crab", "lobster", "shrimp", "krill", "jellyfish", "octopus", "squid", "sea_urchin", "starfish", "sea_turtle", "school_herring", "school_sardine", "school_mackerel", "school_tuna", "school_anchovy", "catfish", "crappie", "bluegill", "sunfish", "carp", "yellow_perch", "muskie", "largemouth_bass", "smallmouth_bass", "channel_catfish", "freshwater_shrimp", "freshwater_crab", "snapping_turtle", "bullfrog", "beaver_dam", "lily_pad", "cattail", "reed_bed", "submerged_grass", "spring", "school_perch", "school_bluegill", "school_bass", "school_crappie", "school_carp", "sand_bass", "lake_trout", "perch", "rainbow_trout", "silver_salmon", "chinook_salmon", "pink_salmon", "turbot", "black_rockfish", "yelloweye_rockfish", "dog_shark", "dungeness_crab", "prawn_shrimp", "school_salmon", "school_rockfish", "lingcod", "sole", "multiple_logs", "multiple_fish", "submerged_rock", "land", "red_light", "green_light", "red_buoy", "green_buoy", "rock", "clam", "clam_beach", "cool_rocks", "rock_beach", "anchorage", "hazard_rock", "marina", "boat_ramp", "fuel_dock", "diver_down", "no_anchor", "channel_marker", "daymark"] as const;
export type MarkerType = (typeof MARKER_TYPES)[number];

export const markersTable = pgTable("markers", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Nullable: null when marker was saved without an active dataset (dataset-free import). */
  datasetId: text("dataset_id"),
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
