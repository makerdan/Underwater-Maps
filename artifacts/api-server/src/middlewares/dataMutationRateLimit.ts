/**
 * Shared per-user rate-limit middleware instances for data mutation routes.
 *
 * Two tiers:
 *  - dataMutationRateLimit  — 120 writes/min per user; applied to markers,
 *    catches, routes, folders, and catalog-save mutations.
 *  - settingsMutationRateLimit — 30 writes/min per user; tighter ceiling for
 *    PUT /settings (single-document write that fans out to the DB).
 *
 * Both use the existing `createRateLimit` Postgres-backed sliding window and
 * share rate-limit state with all other rate-limited routes (the key includes
 * the route name so buckets don't collide).
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
export const SETTINGS_MUTATION_MAX = 30;

/**
 * Per-user rate limit for general data mutation routes (markers, catches,
 * routes, folders, catalog-saves).  120 writes per minute per user.
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
