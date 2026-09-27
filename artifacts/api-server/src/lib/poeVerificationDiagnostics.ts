import {
  configurePoeVerificationDiagnosticsStore,
  POE_VERIFICATION_DIAGNOSTIC_MAX_ENTRIES,
  POE_VERIFICATION_DIAGNOSTIC_TTL_MS,
  type PoeVerificationDiagnosticsStore,
} from "@workspace/poe";
import { pool } from "@workspace/db";

const POE_DIAGNOSTICS_LOCK_KEY = 4698;

const store: PoeVerificationDiagnosticsStore = {
  async recordFailure({ route, code, occurredAt }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        POE_DIAGNOSTICS_LOCK_KEY,
      ]);
      await client.query(
        `INSERT INTO poe_verification_diagnostics
           (route, code, count, last_occurred_at)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (route, code) DO UPDATE
         SET count = poe_verification_diagnostics.count + 1,
             last_occurred_at = GREATEST(
               poe_verification_diagnostics.last_occurred_at,
               EXCLUDED.last_occurred_at
             )`,
        [route, code, new Date(occurredAt)],
      );
      await client.query(
        `DELETE FROM poe_verification_diagnostics
         WHERE last_occurred_at <= $1
            OR (route, code) NOT IN (
              SELECT route, code
              FROM poe_verification_diagnostics
              ORDER BY last_occurred_at DESC, route ASC, code ASC
              LIMIT $2
            )`,
        [
          new Date(occurredAt - POE_VERIFICATION_DIAGNOSTIC_TTL_MS),
          POE_VERIFICATION_DIAGNOSTIC_MAX_ENTRIES,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

  async read(now) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        POE_DIAGNOSTICS_LOCK_KEY,
      ]);
      await client.query(
        `DELETE FROM poe_verification_diagnostics
         WHERE last_occurred_at <= $1
            OR (route, code) NOT IN (
              SELECT route, code
              FROM poe_verification_diagnostics
              ORDER BY last_occurred_at DESC, route ASC, code ASC
              LIMIT $2
            )`,
        [
          new Date(now - POE_VERIFICATION_DIAGNOSTIC_TTL_MS),
          POE_VERIFICATION_DIAGNOSTIC_MAX_ENTRIES,
        ],
      );
      const result = await client.query<{
        route: "classify" | "help" | "models" | "query" | "unknown" | "upscale";
        code: "model_registry_unavailable" | "model_unavailable";
        count: number;
        last_occurred_at: Date;
      }>(
        `SELECT route, code, count, last_occurred_at
         FROM poe_verification_diagnostics
         WHERE last_occurred_at > $1
         ORDER BY last_occurred_at DESC, route ASC, code ASC
         LIMIT $2`,
        [
          new Date(now - POE_VERIFICATION_DIAGNOSTIC_TTL_MS),
          POE_VERIFICATION_DIAGNOSTIC_MAX_ENTRIES,
        ],
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({
        route: row.route,
        code: row.code,
        count: row.count,
        lastOccurredAt: row.last_occurred_at.getTime(),
      }));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};

configurePoeVerificationDiagnosticsStore(store);