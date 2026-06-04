import { pgTable, text, timestamp, bigint, index } from "drizzle-orm/pg-core";

/**
 * Durable sliding-window rate-limit store.
 *
 * Each row is a single counted request event. The shared rate-limit
 * middleware (api-server: `middlewares/rateLimit.ts`) inserts one row per
 * request and counts the rows in `bucket_key` whose `created_at` falls inside
 * the configured window. The composite index on (bucket_key, created_at)
 * keeps both the insert and the windowed count cheap.
 *
 * `bucket_key` is opaque to the DB — the middleware encodes the route plus
 * either `u:<userId>` or `i:<ip>` so the same table serves every limiter
 * without per-route schema. Rows older than any active window can be
 * garbage-collected by a periodic job; reads already filter by `created_at`
 * so stale rows don't affect correctness, only table size.
 */
export const rateLimitEventsTable = pgTable(
  "rate_limit_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    bucketKey: text("bucket_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bucketCreatedIdx: index("rate_limit_events_bucket_created_idx").on(
      t.bucketKey,
      t.createdAt,
    ),
    createdAtIdx: index("rate_limit_events_created_at_idx").on(t.createdAt),
  }),
);

export type RateLimitEvent = typeof rateLimitEventsTable.$inferSelect;
