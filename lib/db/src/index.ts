import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
