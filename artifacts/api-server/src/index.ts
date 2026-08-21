import app from "./app";
import { logger } from "./lib/logger";
import { pool, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { startBucketMonitor } from "./lib/bucketMonitor.js";
import { startOrphanedPhotosCleanupJob } from "./lib/orphanedPhotosCleanupJob.js";
import { startRateLimitPruneJob } from "./lib/rateLimitPruneJob.js";
import { checkRasterExtractorDeps } from "./lib/pdfContourRaster.js";
import {
  cleanupRecoveredUploads,
  loadUploadCalibration,
  recoverUploads,
  startUploadCleanup,
} from "./domains/upload/index.js";
import { recoverTerrainJobs } from "./domains/terrain/index.js";
import { seedCatalog } from "./domains/catalog-search/index.js";
import { startEnvironmentalRefresh } from "./domains/environmental/index.js";
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
let stopBucketMonitor: (() => Promise<void>) | null = null;
let stopWeatherCacheRefresher: (() => Promise<void>) | null = null;

// ---------------------------------------------------------------------------
// Graceful shutdown on SIGTERM
// ---------------------------------------------------------------------------
// Registered once at module load — uses `activeServer` which is set once the
// server successfully binds its assigned port.

// Idempotent guard: a second SIGTERM while shutdown is already in progress
// is a no-op so the handler does not run concurrently with itself.
let shuttingDown = false;

process.on("SIGTERM", () => {
  if (shuttingDown) {
    logger.debug("SIGTERM received while shutdown already in progress — ignoring");
    return;
  }
  shuttingDown = true;

  const server = activeServer;
  if (!server) {
    logger.warn("SIGTERM received but no active server — exiting immediately");
    void (async () => {
      try { stopUploadCleanupJob?.(); } catch { /* ignore */ }
      try { stopOrphanedPhotosCleanupJob?.(); } catch { /* ignore */ }
      try { stopRateLimitPruneJob?.(); } catch { /* ignore */ }
      try { await stopBucketMonitor?.(); } catch { /* ignore */ }
      try { await stopWeatherCacheRefresher?.(); } catch { /* ignore */ }
      try { await pool.end(); } catch { /* ignore */ }
      process.exit(0);
    })();
    return;
  }

  logger.info(
    { drainMs: SIGTERM_DRAIN_MS },
    "SIGTERM received — draining in-flight requests",
  );

  void (async () => {
    // 1. Stop all background job intervals so they cannot fire after the pool
    //    tears down.  Jobs with async stop handles are awaited so any in-flight
    //    cycle can finish before we proceed.
    try { stopUploadCleanupJob?.(); } catch { /* ignore */ }
    try { stopOrphanedPhotosCleanupJob?.(); } catch { /* ignore */ }
    try { stopRateLimitPruneJob?.(); } catch { /* ignore */ }
    try { await stopBucketMonitor?.(); } catch { /* ignore */ }
    try { await stopWeatherCacheRefresher?.(); } catch { /* ignore */ }

    // 2. Stop accepting new connections. Close idle keep-alive sockets
    //    immediately so the drain window doesn't stall on them.  Active
    //    (in-flight) connections are left open until their requests finish.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });

    logger.info("All connections closed — draining pool");

    // 3. Drain the connection pool so no background queries can be issued
    //    against a half-torn-down DB after this point.
    try {
      await pool.end();
    } catch (err) {
      logger.warn({ err }, "pool.end() failed during shutdown (non-critical)");
    }

    logger.info("Graceful shutdown complete — exiting");
    logger.flush(() => {
      process.exit(0);
    });
  })();

  // Hard-kill fallback: if the graceful sequence hasn't finished within the
  // drain window, force-close all remaining connections and exit.
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
    checkRasterExtractorDeps()
      .then((ok) => {
        if (ok) {
          logger.info("[startup] raster extractor Python deps: ok");
        } else {
          logger.error(
            "[startup] raster extractor Python deps: MISSING — " +
              "raster contour map uploads will fail. " +
              "Install: PYTHONUSERBASE=.pythonlibs pip install opencv-python-headless pytesseract Pillow numpy",
          );
        }
      })
      .catch((err: unknown) => {
        logger.error({ err }, "[startup] raster extractor dep check failed");
      });

    // Load per-extension upload duration history so ETA estimates are seeded
    // from the very first job after a restart (non-critical; errors are caught).
    void loadUploadCalibration().catch((calibErr: unknown) => {
      logger.warn({ err: calibErr }, "Calibration load failed (non-critical)");
    });

    // Reconstruct durable upload ownership before deleting orphaned temp files.
    // Cleanup is skipped if recovery could not query the DB: without a complete
    // ownership set, deleting by filename could destroy resumable uploads.
    void recoverUploads()
      .then(async (recovered) => {
        if (!recovered) {
          logger.warn("Upload chunk cleanup skipped because recovery did not complete");
          return;
        }
        await cleanupRecoveredUploads();
        try {
          stopUploadCleanupJob = startUploadCleanup();
        } catch (err) {
          logger.error({ err }, "[startup] startUploadCleanupJob failed");
        }
      })
      .catch((recoverErr: unknown) => {
        logger.warn({ err: recoverErr }, "Upload recovery/cleanup failed (non-critical)");
      });

    // Reset terrain bundle jobs left in "running" by the previous process and
    // re-dispatch all pending jobs (duplicate-dispatch protected in the route
    // module; non-critical, errors are caught).
    void recoverTerrainJobs().catch((bundleErr: unknown) => {
      logger.warn({ err: bundleErr }, "Terrain bundle job recovery failed (non-critical)");
    });

    // Seed the dataset discovery catalog on startup (idempotent).
    void seedCatalog().catch((seedErr: unknown) => {
      logger.warn({ err: seedErr }, "Catalog seed failed (non-critical)");
    });

    // Start the GCS bucket monitor — scans pending-datasets/ every 30 s and
    // processes any oversized dataset files uploaded via the presigned URL path.
    // The returned stop function is stored so the SIGTERM handler can await it.
    try {
      stopBucketMonitor = startBucketMonitor();
    } catch (err) {
      logger.error({ err }, "[startup] startBucketMonitor failed");
    }

    // Start the background weather cache refresher — re-fetches DB rows that are
    // >15 min old every 30 min so the 1-hour stale fallback window is never hit.
    // Also prunes rows older than 24 hours that no one is actively requesting.
    // The returned stop function is stored so the SIGTERM handler can await it.
    try {
      stopWeatherCacheRefresher = startEnvironmentalRefresh();
    } catch (err) {
      logger.error({ err }, "[startup] startWeatherCacheRefresher failed");
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

// ---------------------------------------------------------------------------
// Startup migration guard
// ---------------------------------------------------------------------------
// Check that the most recently added tables exist in the running database.
// If not, the migration has not been applied and the server would silently
// serve 404 / 500 errors on routes that touch those tables.  Fail loudly
// instead so the problem is immediately visible in logs.
// ---------------------------------------------------------------------------

try {
  await db.execute(sql`SELECT 1 FROM dataset_collections LIMIT 1`);
  logger.info("[startup] migration check: OK (dataset_collections table found)");
} catch (err) {
  logger.error(
    { err },
    "[startup] FATAL: migration check failed — table 'dataset_collections' does not exist. " +
      "Apply pending migrations with: pnpm --filter @workspace/db migrate",
  );
  logger.flush(() => {
    process.exit(1);
  });
  // Pause until flush + exit fire (flush callback is async).
  await new Promise<never>(() => {});
}

startServer(basePort);
