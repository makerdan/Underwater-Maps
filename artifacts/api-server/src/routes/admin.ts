import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
  getBucketStatus,
  LIFECYCLE_TTLS,
  getLifecycleApplyStatus,
  getLargeDatasetsDiff,
} from "../lib/bucketMonitor.js";

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

export default router;
