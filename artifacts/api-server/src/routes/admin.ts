import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { getBucketStatus } from "../lib/bucketMonitor.js";

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
    res.json(summary);
  }),
);

export default router;
