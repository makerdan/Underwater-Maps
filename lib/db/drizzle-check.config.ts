/**
 * drizzle-check.config.ts — used ONLY by the schema-drift staleness check
 * (scripts/check-schema-drift.mjs at the repo root).
 *
 * Differences from drizzle.config.ts:
 *   - No DATABASE_URL requirement: `drizzle-kit generate` is a pure
 *     schema-vs-snapshot diff and never connects to a database.
 *   - Relative paths: drizzle-kit generate prefixes the snapshot path with
 *     "./", which breaks when `out` is absolute (ENOENT on
 *     ".//home/…/drizzle/meta/0000_snapshot.json"). Relative paths work
 *     because the check script always runs drizzle-kit with cwd=lib/db.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
