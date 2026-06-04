import app from "./app";
import { logger } from "./lib/logger";
import { seedDatasetCatalog } from "./lib/catalogSeeder.js";
import { startBucketMonitor } from "./lib/bucketMonitor.js";
import { startWeatherCacheRefresher } from "./lib/weatherCacheRefresher.js";
import { recoverStaleUploadJobs, cleanupStaleChunks, cleanupAbandonedUploadJobs } from "./routes/datasets.js";
import type * as http from "http";

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
// HTTP server — with EADDRINUSE fallback
// ---------------------------------------------------------------------------

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const basePort = Number(rawPort);

if (Number.isNaN(basePort) || basePort <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Maximum number of additional ports to try after the base port is in use.
const MAX_PORT_RETRIES = 3;
// Drain window for SIGTERM: wait up to this many ms for in-flight requests to
// finish before force-closing all connections.
const SIGTERM_DRAIN_MS = 10_000;

let activeServer: http.Server | null = null;

// ---------------------------------------------------------------------------
// Graceful shutdown on SIGTERM
// ---------------------------------------------------------------------------
// Registered once at module load — uses `activeServer` which is updated each
// time tryBind succeeds (or retries on a different port).

process.on("SIGTERM", () => {
  const server = activeServer;
  if (!server) {
    logger.warn("SIGTERM received but no active server — exiting immediately");
    process.exit(0);
    return;
  }

  logger.info(
    { drainMs: SIGTERM_DRAIN_MS },
    "SIGTERM received — draining in-flight requests",
  );

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

  // Hard-kill fallback: if in-flight requests haven't drained within the
  // configured window, force-close all remaining connections and exit rather
  // than leaving the process stuck indefinitely.
  setTimeout(() => {
    logger.warn("Drain timeout exceeded — forcing exit");
    server.closeAllConnections();
    logger.flush(() => {
      process.exit(0);
    });
  }, SIGTERM_DRAIN_MS).unref();
});

// ---------------------------------------------------------------------------
// Port-binding with EADDRINUSE fallback
// ---------------------------------------------------------------------------

function tryBind(port: number, retriesLeft: number): void {
  const server = app.listen(port, "127.0.0.1");

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      if (retriesLeft > 0) {
        logger.warn(
          { port, nextPort: port + 1, retriesLeft },
          `Port ${port} in use — retrying on ${port + 1}`,
        );
        server.close();
        tryBind(port + 1, retriesLeft - 1);
      } else {
        logger.error(
          { basePort, attemptsExhausted: MAX_PORT_RETRIES + 1 },
          `All ${MAX_PORT_RETRIES + 1} port candidates in use — exiting`,
        );
        process.exit(1);
      }
    } else {
      logger.error({ err }, "Server listen error — exiting");
      process.exit(1);
    }
  });

  server.on("listening", () => {
    const addr = server.address();
    const actualPort =
      typeof addr === "object" && addr !== null ? addr.port : port;

    activeServer = server;

    // Bind explicitly to 127.0.0.1 (IPv4 loopback) rather than the default
    // 0.0.0.0. On dual-stack Linux systems Node.js may resolve the bare
    // hostname "localhost" to ::1 (IPv6) before 127.0.0.1, so a caller that
    // connects to http://localhost:PORT ends up on ::1 while the server is
    // only reachable on IPv4 — producing ECONNREFUSED ::1:PORT. Pinning the
    // listen address to 127.0.0.1 and using http://127.0.0.1:PORT on the
    // caller side eliminates the ambiguity entirely.
    logger.info({ port: actualPort }, "Server listening on 127.0.0.1");

    // Mark any upload jobs that were still queued/processing when the previous
    // process died — re-queues recoverable ones, marks the rest as error.
    void recoverStaleUploadJobs().catch((recoverErr: unknown) => {
      logger.warn({ err: recoverErr }, "Upload job recovery failed (non-critical)");
    });

    // Purge chunk files left behind by uploads that were in flight when the
    // previous process was killed (raw chunk slices only; assembled files for
    // recovered jobs are preserved and cleaned up by processUploadJob).
    void cleanupStaleChunks().catch((cleanErr: unknown) => {
      logger.warn({ err: cleanErr }, "Stale chunk cleanup failed (non-critical)");
    });

    // Delete upload_jobs rows stuck in "uploading" status beyond the configured
    // threshold (default 24 h).  These arise when a client starts a chunked
    // upload but never calls finalize (e.g. browser closed mid-transfer).
    void cleanupAbandonedUploadJobs().catch((abandonErr: unknown) => {
      logger.warn({ err: abandonErr }, "Abandoned upload job cleanup failed (non-critical)");
    });

    // Seed the dataset discovery catalog on startup (idempotent).
    void seedDatasetCatalog().catch((seedErr: unknown) => {
      logger.warn({ err: seedErr }, "Catalog seed failed (non-critical)");
    });

    // Start the GCS bucket monitor — scans pending-datasets/ every 30 s and
    // processes any oversized dataset files uploaded via the presigned URL path.
    try {
      startBucketMonitor();
    } catch (err) {
      logger.error({ err }, "[startup] startBucketMonitor failed");
    }

    // Start the background weather cache refresher — re-fetches DB rows that are
    // >15 min old every 30 min so the 1-hour stale fallback window is never hit.
    // Also prunes rows older than 24 hours that no one is actively requesting.
    try {
      startWeatherCacheRefresher();
    } catch (err) {
      logger.error({ err }, "[startup] startWeatherCacheRefresher failed");
    }
  });
}

tryBind(basePort, MAX_PORT_RETRIES);
