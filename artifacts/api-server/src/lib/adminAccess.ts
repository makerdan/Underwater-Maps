/**
 * Shared admin access-control check.
 *
 * BUCKET_MONITOR_ADMIN is a dev-only shortcut that bypasses per-user ID
 * checks. It must NEVER be set in a production deployment — validateStartupEnv()
 * will refuse to start the server if it detects this combination.
 */
export function isAdmin(userId: string): boolean {
  const flag = process.env["BUCKET_MONITOR_ADMIN"] ?? "";
  if (flag === "1" || flag === "true") return true;

  const allowedIds = (process.env["ADMIN_USER_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return allowedIds.includes(userId);
}
