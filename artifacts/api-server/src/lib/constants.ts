/**
 * Shared API-server constants.
 *
 * Import from this module (not from individual route files) so tests and
 * documentation can reference the same values without pulling in route
 * dependencies.
 */

/**
 * Maximum allowed byte size of a stored `terrain_json` column before the
 * GET /user/datasets/:id/terrain route refuses to load the blob into memory.
 *
 * A pathologically large blob (e.g. a dense 1024×1024 grid at ~50 MB) would
 * spike Node.js heap twice — once for the DB result set and once for JSON
 * stringification — and could OOM the process under concurrent load.
 *
 * Routes that serve this column must check `pg_column_size(terrain_json)` and
 * return HTTP 413 when the value exceeds this constant.
 */
export const MAX_TERRAIN_JSON_BYTES = 40_000_000;
