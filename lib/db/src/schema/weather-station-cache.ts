import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Persistent cache for NOAA weather station results.
 *
 * Keyed by "lat,lon,radius" (same format as the in-memory cache key).
 * The `result` column stores the full WeatherStationsResult JSON so the API
 * can serve stale-but-valid data during NOAA outages or server restarts.
 *
 * Rows are upserted on every successful NOAA fetch and read as a fallback
 * when NOAA returns an error and the row is less than 1 hour old.
 */
export const weatherStationCacheTable = pgTable("weather_station_cache", {
  cacheKey: text("cache_key").primaryKey(),
  result: jsonb("result").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export type WeatherStationCache = typeof weatherStationCacheTable.$inferSelect;
