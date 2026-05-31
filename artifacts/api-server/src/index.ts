import app from "./app";
import { logger } from "./lib/logger";
import { seedDatasetCatalog } from "./lib/catalogSeeder.js";
import { startBucketMonitor } from "./lib/bucketMonitor.js";

// ---------------------------------------------------------------------------
// Process-level safety nets
// ---------------------------------------------------------------------------

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection (kept alive)");
  // Keep the process alive for unhandled rejections so that a single failing
  // async call in a route handler (e.g. an upstream NOAA / ERDDAP fetch that
  // rejects after the response was already sent) doesn't crash the server and
  // cascade into ECONNREFUSED across every subsequent E2E spec.
});

process.on("uncaughtException", (err) => {
  // An uncaught synchronous exception means the process is in an unknown
  // state. Log loudly, flush pino's buffer so the line is not dropped, then
  // exit with code 1 so the process supervisor (Replit workflow, systemd,
  // etc.) can restart cleanly rather than leaving a zombie alive.
  logger.error({ err }, "Uncaught exception — exiting");
  logger.flush(() => {
    process.exit(1);
  });
});

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

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

// Bind explicitly to 127.0.0.1 (IPv4 loopback) rather than the default
// 0.0.0.0. On dual-stack Linux systems Node.js may resolve the bare
// hostname "localhost" to ::1 (IPv6) before 127.0.0.1, so a caller that
// connects to http://localhost:PORT ends up on ::1 while the server is
// only reachable on IPv4 — producing ECONNREFUSED ::1:PORT. Pinning the
// listen address to 127.0.0.1 and using http://127.0.0.1:PORT on the
// caller side eliminates the ambiguity entirely.
const server = app.listen(port, "127.0.0.1", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening on 127.0.0.1");

  // Seed the dataset discovery catalog on startup (idempotent).
  void seedDatasetCatalog().catch((seedErr: unknown) => {
    logger.warn({ err: seedErr }, "Catalog seed failed (non-critical)");
  });

  // Start the GCS bucket monitor — scans pending-datasets/ every 30 s and
  // processes any oversized dataset files uploaded via the presigned URL path.
  startBucketMonitor();
});

// ---------------------------------------------------------------------------
// Graceful shutdown on SIGTERM
// ---------------------------------------------------------------------------

process.on("SIGTERM", () => {
  logger.info("SIGTERM received — draining in-flight requests (up to 5 s)");

  // Stop accepting new connections. Close idle keep-alive sockets immediately
  // so the drain window doesn't stall waiting for them to time out naturally.
  // Active (in-flight) connections are intentionally left open until their
  // requests finish — closeAllConnections() must NOT be called here, as it
  // hard-drops requests that are still being processed.
  server.close(() => {
    logger.info("All connections closed — exiting cleanly");
    logger.flush(() => {
      process.exit(0);
    });
  });
  server.closeIdleConnections();

  // Hard-kill fallback: if in-flight requests haven't drained within 5 s,
  // force-close all remaining connections and exit rather than leaving the
  // process stuck indefinitely.
  setTimeout(() => {
    logger.warn("Drain timeout exceeded — forcing exit");
    server.closeAllConnections();
    logger.flush(() => {
      process.exit(0);
    });
  }, 5_000).unref();
});
