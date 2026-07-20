/**
 * Shared per-user rate-limit middleware instances for data mutation routes.
 *
 * Three tiers:
 *  - dataMutationRateLimit     — 120 writes/min per user; applied to markers,
 *    catches, routes, folders, catalog-saves, GPS trails, and trolling-preset
 *    mutations.
 *  - settingsMutationRateLimit — 30 writes/min per user; tighter ceiling for
 *    PUT /settings (single-document write that fans out to the DB).
 *  - bulkDeleteMarkersRateLimit — 5 calls/min per user; much lower ceiling for
 *    DELETE /markers/mine so a single bulk-delete cannot exhaust the general
 *    quota or be weaponised for accidental mass data loss.
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
export const SETTINGS_MUTATION_MAX = 30;

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
