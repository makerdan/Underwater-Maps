import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
  getBucketStatus,
  LIFECYCLE_TTLS,
  getLifecycleApplyStatus,
  getLargeDatasetsDiff,
} from "../lib/bucketMonitor.js";
import { queryRateLimitUsage } from "../middlewares/rateLimit.js";

const router = Router();

function isAdmin(userId: string): boolean {
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
    res.json({
      ...summary,
      lifecycle: {
        processedDatasetsTtlDays: LIFECYCLE_TTLS.processedDays,
        failedDatasetsTtlDays: LIFECYCLE_TTLS.failedDays,
        note: "GCS lifecycle rules automatically delete objects in processed-datasets/ after 30 days and failed-datasets/ after 14 days.",
        permissionDenied: applyStatus.permissionDenied ?? false,
        lastAppliedAt: applyStatus.appliedAt,
        lastApplyError: applyStatus.error,
      },
    });
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
    res.json(diff);
  }),
);

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
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).clerkUserId;

    if (!isAdmin(userId)) {
      res.status(403).json({ error: "forbidden", details: "Admin access required" });
      return;
    }

    const rawWindowMs = Number(req.query["windowMs"]);
    const rawLimit = Number(req.query["limit"]);
    const windowMs = Number.isFinite(rawWindowMs) && rawWindowMs > 0 ? rawWindowMs : 60_000;
    const topN = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 25;

    const rows = await queryRateLimitUsage(windowMs, topN);

    res.json({
      windowMs,
      generatedAt: new Date().toISOString(),
      count: rows.length,
      rows,
    });
  }),
);

export default router;
