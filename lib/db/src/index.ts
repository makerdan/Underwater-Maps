import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// ---------------------------------------------------------------------------
// Pool sizing and timeout configuration
//
// idleTimeoutMillis (default: 25 000 ms = 25 s) must be shorter than
// Postgres's server-side `idle_in_transaction_session_timeout` / TCP keepalive
// window (Postgres default: 10 min, Replit managed DB: ~5 min) so that the
// pool recycles connections before the server closes them from underneath us.
// A shorter client-side idle timeout avoids the silent "connection terminated
// unexpectedly" errors that surface when the server drops a parked client.
//
// connectionTimeoutMillis (default: 5 000 ms) is the maximum time the pool
// will wait to acquire a connection before throwing.  A finite limit prevents
// request handlers from hanging indefinitely when the pool is exhausted.
//
// max (default: 10) caps the total number of open connections.  Postgres has
// a hard server-side `max_connections` limit (usually 100); keeping this well
// below that leaves headroom for migrations, admin tools, and other services.
// ---------------------------------------------------------------------------
function parsePositiveInt(envVar: string, defaultValue: number): number {
  const raw = process.env[envVar];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `${envVar} must be a positive integer, got: ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

const DB_POOL_MAX = parsePositiveInt("DB_POOL_MAX", 10);
const DB_IDLE_TIMEOUT_MS = parsePositiveInt("DB_IDLE_TIMEOUT_MS", 25000);
const DB_CONNECTION_TIMEOUT_MS = parsePositiveInt("DB_CONNECTION_TIMEOUT_MS", 5000);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: DB_POOL_MAX,
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
});

// pg.Pool emits 'error' on behalf of idle clients when a backend error or
// network reset occurs while the connection is parked in the pool.  Without
// this listener, Node.js converts that EventEmitter 'error' event into an
// uncaught exception, triggering the process-level uncaughtException handler
// and calling process.exit(1).  This is the root cause of the API server
// crashing mid-e2e run (~25 min in): an idle DB connection times out or gets
// reset by the server, the pool emits 'error', and the process dies.
//
// Adding this listener keeps the process alive — the pool automatically
// replaces the failed idle client on the next acquire(), so no query-level
// code needs to change.
pool.on("error", (err) => {
  console.error("[db-pool] idle client error — server kept alive:", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
