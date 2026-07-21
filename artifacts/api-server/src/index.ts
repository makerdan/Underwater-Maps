import app from "./app";
import { logger } from "./lib/logger";
import { seedDatasetCatalog } from "./lib/catalogSeeder.js";
import { startBucketMonitor } from "./lib/bucketMonitor.js";
import { startWeatherCacheRefresher } from "./lib/weatherCacheRefresher.js";
import { startUploadCleanupJob } from "./lib/uploadCleanupJob.js";
import { startOrphanedPhotosCleanupJob } from "./lib/orphanedPhotosCleanupJob.js";
import { startRateLimitPruneJob } from "./lib/rateLimitPruneJob.js";
import { recoverStaleUploadJobs, cleanupStaleChunks, loadCalibrationFromDb } from "./routes/datasets.js";
import { recoverStaleTerrainBundleJobs } from "./routes/terrain-bundles.js";
import { checkRasterExtractorDeps } from "./lib/pdfContourRaster.js";
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

// Drain window for SIGTERM: wait up to this many ms for in-flight requests to
// finish before force-closing all connections.
const SIGTERM_DRAIN_MS = 10_000;

let activeServer: http.Server | null = null;
let stopUploadCleanupJob: (() => void) | null = null;
let stopOrphanedPhotosCleanupJob: (() => void) | null = null;
let stopRateLimitPruneJob: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Graceful shutdown on SIGTERM
// ---------------------------------------------------------------------------
// Registered once at module load — uses `activeServer` which is set once the
// server successfully binds its assigned port.

process.on("SIGTERM", () => {
  const server = activeServer;
  if (!server) {
    logger.warn("SIGTERM received but no active server — exiting immediately");
    stopUploadCleanupJob?.();
    stopOrphanedPhotosCleanupJob?.();
    stopRateLimitPruneJob?.();
    process.exit(0);
    return;
  }

  logger.info(
    { drainMs: SIGTERM_DRAIN_MS },
    "SIGTERM received — draining in-flight requests",
  );

  // Stop the periodic cleanup jobs so their intervals cannot fire after
  // shutdown begins.  Must happen before server.close() to avoid a race
  // where an interval fires after the DB connection pool starts tearing down.
  stopUploadCleanupJob?.();
  stopOrphanedPhotosCleanupJob?.();
  stopRateLimitPruneJob?.();

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
// Port-binding — fail fast on EADDRINUSE
// ---------------------------------------------------------------------------
// The platform assigns each artifact a unique PORT. Silently rebinding to a
// neighboring port on EADDRINUSE could collide with another artifact's
// assigned port, so a bind failure is fatal: log clearly and exit.

function startServer(port: number): void {
  const server = app.listen(port, "127.0.0.1");

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(
        { port },
        `Port ${port} is already in use — refusing to rebind to another port. ` +
          `Free the port or fix the PORT assignment, then restart. Exiting.`,
      );
    } else {
      logger.error({ err }, "Server listen error — exiting");
    }
    logger.flush(() => {
      process.exit(1);
    });
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

    // Verify Python packages for raster contour extraction are available.
    // Non-fatal: logs a clear error with install instructions if missing so
    // the issue is immediately visible in server logs rather than surfacing
    // only when a user attempts a raster upload.
    void checkRasterExtractorDeps().then((ok) => {
      if (ok) {
        logger.info("[startup] raster extractor Python deps: ok");
      } else {
        logger.error(
          "[startup] raster extractor Python deps: MISSING — " +
            "raster contour map uploads will fail. " +
            "Install: PYTHONUSERBASE=.pythonlibs pip install opencv-python-headless pytesseract Pillow numpy",
        );
      }
    });

    // Load per-extension upload duration history so ETA estimates are seeded
    // from the very first job after a restart (non-critical; errors are caught).
    void loadCalibrationFromDb().catch((calibErr: unknown) => {
      logger.warn({ err: calibErr }, "Calibration load failed (non-critical)");
    });

    // Mark any upload jobs that were still queued/processing when the previous
    // process died — re-queues recoverable ones, marks the rest as error.
    void recoverStaleUploadJobs().catch((recoverErr: unknown) => {
      logger.warn({ err: recoverErr }, "Upload job recovery failed (non-critical)");
    });

    // Reset terrain bundle jobs left in "running" by the previous process and
    // re-dispatch all pending jobs (duplicate-dispatch protected in the route
    // module; non-critical, errors are caught).
    void recoverStaleTerrainBundleJobs().catch((bundleErr: unknown) => {
      logger.warn({ err: bundleErr }, "Terrain bundle job recovery failed (non-critical)");
    });

    // Purge chunk files left behind by uploads that were in flight when the
    // previous process was killed (raw chunk slices only; assembled files for
    // recovered jobs are preserved and cleaned up by processUploadJob).
    void cleanupStaleChunks().catch((cleanErr: unknown) => {
      logger.warn({ err: cleanErr }, "Stale chunk cleanup failed (non-critical)");
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

    // Start the background abandoned-upload cleanup job — deletes upload_jobs
    // rows stuck in "uploading" status beyond ABANDONED_UPLOAD_THRESHOLD_MS
    // (default 24 h). Runs immediately and then every UPLOAD_CLEANUP_INTERVAL_MS
    // (default 12 h) so abandoned rows are purged even on long-lived servers.
    // The returned stop function is stored so the SIGTERM handler can clear
    // the interval explicitly before the process begins draining connections.
    try {
      stopUploadCleanupJob = startUploadCleanupJob();
    } catch (err) {
      logger.error({ err }, "[startup] startUploadCleanupJob failed");
    }

    // Start the background orphaned-photos cleanup job — lists all objects
    // under the private uploads/ prefix older than ORPHANED_PHOTO_AGE_MS
    // (default 24 h) and deletes any not referenced by a catch entry.
    // Runs immediately and repeats every PHOTO_CLEANUP_INTERVAL_MS (default 6 h).
    try {
      stopOrphanedPhotosCleanupJob = startOrphanedPhotosCleanupJob();
    } catch (err) {
      logger.error({ err }, "[startup] startOrphanedPhotosCleanupJob failed");
    }

    // Start the rate-limit prune job — deletes rate_limit_events rows older
    // than 5 minutes from the Postgres store on a fixed 5-minute interval.
    // The inline CTE in consume() handles active-key pruning; this job covers
    // keys with infrequent traffic so the table never grows unbounded.
    try {
      stopRateLimitPruneJob = startRateLimitPruneJob();
    } catch (err) {
      logger.error({ err }, "[startup] startRateLimitPruneJob failed");
    }
  });
}

startServer(basePort);
