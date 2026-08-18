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

  return parseAdminUserIds(process.env["ADMIN_USER_IDS"]).includes(userId);
}

/**
 * Parse ADMIN_USER_IDS into the list of non-empty admin IDs.
 *
 * Shared between isAdmin() and validateStartupEnv()'s lockout guard so
 * "presence" is judged by the exact same rules as authorization: a value
 * like "," or ",, " contains zero usable IDs and must count as absent,
 * otherwise startup succeeds with no admin able to approve anyone.
 */
export function parseAdminUserIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
