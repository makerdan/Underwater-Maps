/**
 * Shared per-user rate-limit middleware instances for data mutation routes.
 *
 * Four tiers:
 *  - dataMutationRateLimit     — 120 writes/min per user; applied to markers,
 *    catches, routes, folders, catalog-saves, GPS trails, and trolling-preset
 *    mutations.
 *  - settingsMutationRateLimit — 30 writes/min per user; tighter ceiling for
 *    PUT /settings (single-document write that fans out to the DB).
 *  - bulkDeleteMarkersRateLimit — 5 calls/min per user; much lower ceiling for
 *    DELETE /markers/mine so a single bulk-delete cannot exhaust the general
 *    quota or be weaponised for accidental mass data loss.
 *  - githubMutationRateLimit   — 10 writes/min per user; tight ceiling for
 *    PUT/DELETE /github/…/contents and POST /github/…/dispatches since all
 *    three operate through a single server-wide PAT that can affect every
 *    repository the PAT can access.
 *
 * All tiers use the existing `createRateLimit` Postgres-backed sliding window.
 * The key includes the route name so buckets never collide across tiers.
 *
 * Export route/window constants so tests can build the correct bucket key
 * without duplicating magic numbers.
 */
import { createRateLimit } from "./rateLimit.js";

export const DATA_MUTATION_ROUTE = "data-mutations";
export const DATA_MUTATION_WINDOW_MS = 60_000;
export const DATA_MUTATION_MAX = 120;

export const SETTINGS_MUTATION_ROUTE = "settings-mutations";
export const SETTINGS_MUTATION_WINDOW_MS = 60_000;
// Default 30/min per user. Overridable via env for e2e runs: the whole e2e
// suite shares one bypass user, and its many specs (plus the browser's own
// debounced auto-sync) can legitimately exceed 30 settings PUTs/min — a 429
// mid-spec then makes an unrelated test flake. Production never sets this.
const settingsMaxFromEnv = Number(process.env["SETTINGS_MUTATION_MAX"]);
export const SETTINGS_MUTATION_MAX =
  Number.isFinite(settingsMaxFromEnv) && settingsMaxFromEnv > 0
    ? Math.floor(settingsMaxFromEnv)
    : 30;

export const BULK_DELETE_MARKERS_ROUTE = "markers-bulk-delete";
export const BULK_DELETE_MARKERS_WINDOW_MS = 60_000;
export const BULK_DELETE_MARKERS_MAX = 5;

/**
 * Per-user rate limit for general data mutation routes (markers, catches,
 * routes, folders, catalog-saves, GPS trails, trolling-presets).
 * 120 writes per minute per user.
 * Must be placed after `requireAuth` so `clerkUserId` is already populated.
 */
export const dataMutationRateLimit = createRateLimit({
  route: DATA_MUTATION_ROUTE,
  windowMs: DATA_MUTATION_WINDOW_MS,
  max: DATA_MUTATION_MAX,
  mode: "user",
});

/**
 * Per-user rate limit for PUT /settings.  30 writes per minute per user.
 * Must be placed after `requireAuth`.
 */
export const settingsMutationRateLimit = createRateLimit({
  route: SETTINGS_MUTATION_ROUTE,
  windowMs: SETTINGS_MUTATION_WINDOW_MS,
  max: SETTINGS_MUTATION_MAX,
  mode: "user",
});

/**
 * Per-user rate limit for DELETE /markers/mine (bulk-delete-all).
 * 5 calls per minute per user — a much lower cap than the general mutation
 * tier so a single bulk-delete cannot exhaust the full quota and cannot be
 * called in a tight loop to repeatedly wipe a user's markers.
 * Must be placed after `requireAuth`.
 */
export const bulkDeleteMarkersRateLimit = createRateLimit({
  route: BULK_DELETE_MARKERS_ROUTE,
  windowMs: BULK_DELETE_MARKERS_WINDOW_MS,
  max: BULK_DELETE_MARKERS_MAX,
  mode: "user",
});

export const GITHUB_MUTATION_ROUTE = "github-mutations";
export const GITHUB_MUTATION_WINDOW_MS = 60_000;
/** 10 writes/min — tight because all three mutating GitHub routes share a single
 *  server-wide PAT that can modify every repository the PAT can access. */
export const GITHUB_MUTATION_MAX = 10;

/**
 * Per-user rate limit for the three mutating /api/github/* routes:
 *   PUT  /repos/:owner/:repo/contents/*path   (create/update file)
 *   DELETE /repos/:owner/:repo/contents/*path (delete file)
 *   POST /repos/:owner/:repo/actions/workflows/:wf/dispatches (trigger workflow)
 *
 * 10 writes per minute per user.  Must be placed after `requireAuth`.
 */
export const githubMutationRateLimit = createRateLimit({
  route: GITHUB_MUTATION_ROUTE,
  windowMs: GITHUB_MUTATION_WINDOW_MS,
  max: GITHUB_MUTATION_MAX,
  mode: "user",
});

export const GITHUB_READ_ROUTE = "github-reads";
export const GITHUB_READ_WINDOW_MS = 60_000;
// Default 60/min per user. Overridable via env for e2e runs: a spec that polls
// GitHub workflow run status in a tight loop can legitimately exceed 60/min
// through the shared e2e bypass user, causing a spurious 429 mid-test.
// Production never sets this.
const githubReadMaxFromEnv = Number(process.env["GITHUB_READ_MAX"]);
/** 60 reads/min — generous for interactive use but prevents tight-loop PAT exhaustion.
 *  GitHub's PAT-level quota is 5 000 req/hr; 60/min = 3 600/hr leaves room for
 *  automation running through the same PAT. */
export const GITHUB_READ_MAX =
  Number.isFinite(githubReadMaxFromEnv) && githubReadMaxFromEnv > 0
    ? Math.floor(githubReadMaxFromEnv)
    : 60;

/**
 * Per-user rate limit for the read-only /api/github/* routes:
 *   GET /repos
 *   GET /repos/:owner/:repo/contents/*path
 *   GET /repos/:owner/:repo/actions/runs
 *   GET /repos/:owner/:repo/actions/runs/:run_id
 *
 * 60 reads per minute per user.  Must be placed after `requireAuth`.
 */
export const githubReadRateLimit = createRateLimit({
  route: GITHUB_READ_ROUTE,
  windowMs: GITHUB_READ_WINDOW_MS,
  max: GITHUB_READ_MAX,
  mode: "user",
});
