/**
 * dbPoolMock.ts — shared vi.mock factory for `@workspace/db`.
 *
 * Why this exists: the rate-limit prune tests once broke because a
 * hand-rolled `@workspace/db` mock only stubbed `pool.query` while
 * production code had moved to `pool.connect()` for advisory locks
 * (lib/rateLimitPruneJob.ts, lib/weatherCacheRefresher.ts). Any future
 * pool-API change can silently break hand-rolled mocks the same way.
 *
 * This factory stubs EVERY pool property that production code under `src/`
 * uses. The guard test `db-pool-mock-guard.test.ts` scans production
 * sources for `pool.<prop>` usages and fails with a clear message the
 * moment the factory is missing one.
 *
 * Usage (vi.mock factories are hoisted, so import the helper inside an
 * async factory — never at the top level of the test file):
 *
 *   vi.mock("@workspace/db", async () => {
 *     const { createDbPoolMock } = await import(
 *       "../../__tests__/helpers/dbPoolMock.js"
 *     );
 *     return createDbPoolMock();
 *   });
 *
 * With a stateful query impl (drives BOTH pool.query and the client
 * returned by pool.connect(), matching how production routes queries):
 *
 *   let impl = async () => ({ rows: [], rowCount: 0 });
 *   vi.mock("@workspace/db", async () => {
 *     const { createDbPoolMock } = await import(
 *       "./helpers/dbPoolMock.js"
 *     );
 *     return createDbPoolMock({ queryImpl: (sql, params) => impl(sql, params) });
 *   });
 */
import { vi } from "vitest";

export interface DbPoolMockOptions {
  /**
   * Implementation backing pool.query AND the query method of every client
   * checked out via pool.connect(). Defaults to an empty result set.
   */
  queryImpl?: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
  /** Replacement for the `db` (drizzle) export. Defaults to `{}`. */
  db?: unknown;
  /** Extra/override properties merged onto the pool object. */
  poolOverrides?: Record<string, unknown>;
}

/**
 * Build a full `@workspace/db` module mock: `{ db, pool }`.
 *
 * The pool stubs every property production code touches:
 *   query, connect (client with query/release), end,
 *   totalCount / idleCount / waitingCount (health route).
 */
export function createDbPoolMock(options: DbPoolMockOptions = {}): {
  db: unknown;
  pool: Record<string, unknown>;
} {
  const queryImpl =
    options.queryImpl ??
    (async () => ({ rows: [] as unknown[], rowCount: 0 }));

  const pool: Record<string, unknown> = {
    query: vi
      .fn()
      .mockImplementation((sql: string, params?: unknown[]) =>
        queryImpl(sql, params),
      ),
    // Background jobs (rateLimitPruneJob, weatherCacheRefresher) check out a
    // dedicated client for advisory locking; route its query through the
    // same impl so tests can observe both paths with one hook.
    connect: vi.fn().mockImplementation(async () => ({
      query: vi
        .fn()
        .mockImplementation((sql: string, params?: unknown[]) =>
          queryImpl(sql, params),
        ),
      release: vi.fn(),
    })),
    end: vi.fn().mockResolvedValue(undefined),
    // Health route reads these gauges (routes/health.ts).
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  };

  Object.defineProperties(
    pool,
    Object.getOwnPropertyDescriptors(options.poolOverrides ?? {}),
  );

  return { db: options.db ?? {}, pool };
}
