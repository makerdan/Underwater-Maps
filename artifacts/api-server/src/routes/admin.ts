import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateQuery } from "../middlewares/validateBody.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import {
  getBucketStatus,
  LIFECYCLE_TTLS,
  getLifecycleApplyStatus,
  getLargeDatasetsDiff,
} from "../lib/bucketMonitor.js";
import { queryRateLimitUsage } from "../middlewares/rateLimit.js";
import { AdminRateLimitUsageQuerySchema } from "./schemas.js";
import { getUpscaleCacheStats, UPSCALE_CREDITS_PER_CALL } from "./poe.js";
import {
  AdminBucketMonitorResponse,
  AdminLargeDatasetsDiffResponse,
} from "@workspace/api-zod";

const router = Router();

function isAdmin(userId: string): boolean {
  // BUCKET_MONITOR_ADMIN is a dev-only shortcut that bypasses per-user ID
  // checks. It must NEVER be set in a production deployment — validateStartupEnv()
  // will refuse to start the server if it detects this combination.
  const flag = process.env["BUCKET_MONITOR_ADMIN"] ?? "";
  if (flag === "1" || flag === "true") return true;

  const allowedIds = (process.env["ADMIN_USER_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return allowedIds.includes(userId);
}

/**
 * GET /admin/bucket-monitor
 *
 * Returns a JSON summary of all objects in the GCS dataset landing bucket,
 * broken down by status: pending, processing, done, failed.
 *
 * Also includes `lifecycle` metadata documenting the automatic-deletion TTLs
 * configured on the bucket:
 *   - processed-datasets/ objects are deleted after 30 days
 *   - failed-datasets/    objects are deleted after 14 days
 *
 * Access: auth-required; restricted to admin user IDs (ADMIN_USER_IDS env var,
 * comma-separated) or when BUCKET_MONITOR_ADMIN=1 is set.
 */
router.get(
  "/admin/bucket-monitor",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).clerkUserId;

    if (!isAdmin(userId)) {
      res.status(403).json({ error: "forbidden", details: "Admin access required" });
      return;
    }

    const summary = await getBucketStatus();
    const applyStatus = getLifecycleApplyStatus();
    res.json(
      validateResponse(
        AdminBucketMonitorResponse,
        {
          ...summary,
          lifecycle: {
            processedDatasetsTtlDays: LIFECYCLE_TTLS.processedDays,
            failedDatasetsTtlDays: LIFECYCLE_TTLS.failedDays,
            note: "GCS lifecycle rules automatically delete objects in processed-datasets/ after 30 days and failed-datasets/ after 14 days.",
            permissionDenied: applyStatus.permissionDenied ?? false,
            lastAppliedAt: applyStatus.appliedAt,
            lastApplyError: applyStatus.error,
          },
        },
        "GET /api/admin/bucket-monitor",
      ),
    );
  }),
);

/**
 * GET /admin/large-datasets-diff
 *
 * Compares every file in the Large_Datasets/ GCS prefix against its
 * corresponding processed-datasets/ copy and returns any files whose
 * content hash (md5Hash) has changed since they were last imported, as
 * well as any files that have never been imported at all.
 *
 * Access: auth-required; restricted to admin users (same rules as
 * /admin/bucket-monitor).
 */
router.get(
  "/admin/large-datasets-diff",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).clerkUserId;

    if (!isAdmin(userId)) {
      res.status(403).json({ error: "forbidden", details: "Admin access required" });
      return;
    }

    const diff = await getLargeDatasetsDiff();
    res.json(validateResponse(AdminLargeDatasetsDiffResponse, diff, "GET /api/admin/large-datasets-diff"));
  }),
);

const AdminRateLimitUsageRowSchema = z.object({
  bucket_key: z.string(),
  route: z.string(),
  mode: z.enum(["user", "ip"]),
  count: z.number(),
  max: z.number().nullable(),
  remaining: z.number().nullable(),
});

const AdminRateLimitUsageResponseSchema = z.object({
  windowMs: z.number(),
  generatedAt: z.string(),
  count: z.number(),
  rows: z.array(AdminRateLimitUsageRowSchema),
});

/**
 * GET /admin/rate-limit/usage
 *
 * Returns the top-N bucket_keys by event count within the active sliding
 * window. Useful for identifying top consumers and routes approaching their
 * quota without needing direct database access.
 *
 * Query params:
 *   windowMs  (number, default 60000) — window size in milliseconds.
 *   limit     (number, default 25)    — max rows to return.
 *
 * Response shape per entry:
 *   bucket_key  — raw key (e.g. "u:query:user_abc123")
 *   route       — logical route name extracted from the key
 *   mode        — "user" or "ip"
 *   count       — events observed in the window
 *   max         — configured request ceiling (null if route not yet registered)
 *   remaining   — requests still allowed (null if max is unknown)
 *
 * Access: auth-required; restricted to admin users (same rules as
 * /admin/bucket-monitor).
 */
router.get(
  "/admin/rate-limit/usage",
  requireAuth,
  validateQuery(AdminRateLimitUsageQuerySchema, "GET /api/admin/rate-limit/usage", { errorCode: "invalid_param" }),
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).clerkUserId;

    if (!isAdmin(userId)) {
      res.status(403).json({ error: "forbidden", details: "Admin access required" });
      return;
    }

    const { windowMs: windowMsParam, limit } = res.locals
      .parsedQuery as { windowMs?: number; limit?: number };
    const windowMs = windowMsParam ?? 60_000;
    const topN = limit ?? 25;

    const rows = await queryRateLimitUsage(windowMs, topN);

    res.json(validateResponse(AdminRateLimitUsageResponseSchema, {
      windowMs,
      generatedAt: new Date().toISOString(),
      count: rows.length,
      rows,
    }, "GET /api/admin/rate-limit/usage"));
  }),
);

const AdminUpscaleCacheStatsResponseSchema = z.object({
  hits: z.number(),
  misses: z.number(),
  hitRate: z.number(),
  creditsPerCall: z.number(),
  generatedAt: z.string(),
});

/**
 * GET /admin/upscale-cache-stats
 *
 * Returns in-process hit/miss counters for the server-side upscale cache,
 * plus a derived hit-rate and estimated Poe credits saved.
 *
 * Counters reset on server restart (not persisted — see task spec).
 *
 * Response shape:
 *   hits                 — total cache hits (memory + disk) since last restart
 *   misses               — total cache misses since last restart
 *   hitRate              — hits / (hits + misses), 0 when no requests yet
 *   estimatedCreditsSaved — hits × UPSCALE_CREDITS_PER_CALL constant
 *   creditsPerCall       — the constant used for the estimate
 *
 * Access: auth-required; restricted to admin users (same rules as
 * /admin/bucket-monitor).
 */
router.get(
  "/admin/upscale-cache-stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).clerkUserId;

    if (!isAdmin(userId)) {
      res.status(403).json({ error: "forbidden", details: "Admin access required" });
      return;
    }

    const stats = getUpscaleCacheStats();
    res.json(validateResponse(AdminUpscaleCacheStatsResponseSchema, {
      ...stats,
      creditsPerCall: UPSCALE_CREDITS_PER_CALL,
      generatedAt: new Date().toISOString(),
    }, "GET /api/admin/upscale-cache-stats"));
  }),
);

export default router;
