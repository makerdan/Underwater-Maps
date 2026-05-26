import app from "./app";
import { logger } from "./lib/logger";
import { seedDatasetCatalog } from "./lib/catalogSeeder.js";

// Process-level safety nets. Without these, a single uncaught exception or
// unhandled promise rejection in any route handler (e.g. an upstream NOAA /
// ERDDAP / Poe call rejecting after the response is already sent, or a bug
// in a rarely-exercised code path) crashes the entire Node process. During
// `pnpm run test:e2e` that turns one real failure into a cascade of
// `net::ERR_CONNECTION_REFUSED` errors across every subsequent spec, which
// makes triage extremely noisy. Logging loudly and keeping the process
// alive preserves the underlying signal while preventing the cascade.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection (kept alive)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception (kept alive)");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Seed the dataset discovery catalog on startup (idempotent).
  void seedDatasetCatalog().catch((seedErr: unknown) => {
    logger.warn({ err: seedErr }, "Catalog seed failed (non-critical)");
  });
});
