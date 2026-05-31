import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Persistent cache for AOOS RAWS station observations.
 *
 * Keyed by `datasetId` (e.g. "raws_AKABC").  The `observation` column stores
 * the full RawsObservation JSON so the API can serve stale-but-useful data
 * during ERDDAP outages or server restarts.
 *
 * Rows are upserted on every successful ERDDAP fetch.  When ERDDAP is
 * unreachable the route reads from this table and marks the response
 * `stale: true` when the persisted data is older than 10 minutes.
 */
export const rawsObservationCacheTable = pgTable("raws_observation_cache", {
  datasetId: text("dataset_id").primaryKey(),
  observation: jsonb("observation").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export type RawsObservationCache = typeof rawsObservationCacheTable.$inferSelect;
