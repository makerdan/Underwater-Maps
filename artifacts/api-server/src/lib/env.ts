/**
 * env.ts — startup validation for environment variables.
 *
 * Env vars are external input like any other: malformed values must either
 * fail loudly or fall back to a safe default with a logged warning — never
 * silently produce NaN-driven behaviour.
 */
import { logger } from "./logger.js";

export interface EnvIssue {
  name: string;
  value: string;
  problem: string;
  /** When true the caller must abort startup — the configuration is unsafe for production. */
  critical?: boolean;
}

/**
 * Parse a positive-integer env var with a bounded range.
 * Returns the fallback (and records a warning) when the value is absent,
 * non-numeric, non-integer, or out of [min, max].
 */
export function parsePositiveIntEnv(
  name: string,
  fallback: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const min = opts.min ?? 1;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  if (!/^\d+$/.test(raw.trim())) {
    logger.warn(
      { name, value: raw },
      `[env] ${name}='${raw}' is not a positive integer — falling back to ${fallback}`,
    );
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    logger.warn(
      { name, value: raw, min, max },
      `[env] ${name}='${raw}' is outside [${min}, ${max}] — falling back to ${fallback}`,
    );
    return fallback;
  }
  return parsed;
}

/** Clerk-style user IDs: `user_` followed by alphanumerics — but accept any
 * reasonable opaque token (no whitespace, no commas after splitting). */
const ADMIN_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Origins must be full http(s) origins with no path/query/trailing slash. */
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;

/**
 * Validate the format-sensitive env vars at startup. Returns the list of
 * issues found (empty when everything is well-formed) and logs a warning per
 * issue. Values are read at call time so tests can stub process.env.
 */
export function validateStartupEnv(): EnvIssue[] {
  const issues: EnvIssue[] = [];

  const adminIdsRaw = process.env["ADMIN_USER_IDS"];
  if (adminIdsRaw !== undefined && adminIdsRaw !== "") {
    for (const token of adminIdsRaw.split(",")) {
      const trimmed = token.trim();
      if (trimmed === "") {
        issues.push({
          name: "ADMIN_USER_IDS",
          value: adminIdsRaw,
          problem: "contains an empty entry (double comma or trailing comma)",
        });
      } else if (!ADMIN_ID_RE.test(trimmed)) {
        issues.push({
          name: "ADMIN_USER_IDS",
          value: adminIdsRaw,
          problem: `entry '${trimmed}' is not a valid user id token`,
        });
      }
    }
  }

  const originsRaw = process.env["ALLOWED_ORIGINS"];
  if (originsRaw !== undefined && originsRaw !== "") {
    for (const token of originsRaw.split(",")) {
      const trimmed = token.trim();
      if (trimmed === "") {
        issues.push({
          name: "ALLOWED_ORIGINS",
          value: originsRaw,
          problem: "contains an empty entry (double comma or trailing comma)",
        });
      } else if (!ORIGIN_RE.test(trimmed)) {
        issues.push({
          name: "ALLOWED_ORIGINS",
          value: originsRaw,
          problem: `entry '${trimmed}' is not a valid http(s) origin (no path or trailing slash allowed)`,
        });
      }
    }
  }

  // Numeric cache vars: validated via parsePositiveIntEnv at their point of use
  // in poe.ts (which logs its own fallback warning); here we only record that
  // the raw value is malformed so startup logs surface it early.
  for (const name of [
    "ZONE_CACHE_MAX_AGE_MS",
    "ZONE_CACHE_MAX_FILES",
    "UPSCALE_CACHE_TTL_MS",
    "UPSCALE_CACHE_MAX_BYTES",
  ]) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== "" && !/^\d+$/.test(raw.trim())) {
      issues.push({ name, value: raw, problem: "is not a positive integer" });
    }
  }

  // BUCKET_MONITOR_ADMIN=1 is a dev-only shortcut that grants every
  // authenticated user full admin access. Allowing this in production would
  // expose bucket-monitor, large-dataset diff, and rate-limit usage endpoints
  // to all users. Treat this combination as a critical startup failure.
  const bucketAdminFlag = process.env["BUCKET_MONITOR_ADMIN"] ?? "";
  const isProduction =
    process.env["NODE_ENV"] === "production" ||
    Boolean(process.env["REPLIT_DEPLOYMENT"]);
  if ((bucketAdminFlag === "1" || bucketAdminFlag === "true") && isProduction) {
    issues.push({
      name: "BUCKET_MONITOR_ADMIN",
      value: bucketAdminFlag,
      problem:
        "must not be set in production — it grants every authenticated user full admin access. Remove it or restrict access via ADMIN_USER_IDS instead.",
      critical: true,
    });
  }

  for (const issue of issues) {
    if (issue.critical) {
      logger.error(
        { name: issue.name, value: issue.value },
        `[env] CRITICAL: ${issue.name} ${issue.problem}`,
      );
    } else {
      logger.warn(
        { name: issue.name, value: issue.value },
        `[env] ${issue.name} ${issue.problem}`,
      );
    }
  }

  const criticalIssues = issues.filter((i) => i.critical);
  if (criticalIssues.length > 0) {
    throw new Error(
      `Server startup aborted due to ${criticalIssues.length} critical env configuration issue(s). ` +
        criticalIssues.map((i) => `${i.name}: ${i.problem}`).join("; "),
    );
  }

  return issues;
}
