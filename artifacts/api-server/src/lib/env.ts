/**
 * env.ts — startup validation for environment variables.
 *
 * Env vars are external input like any other: malformed values must either
 * fail loudly or fall back to a safe default with a logged warning — never
 * silently produce NaN-driven behaviour.
 */
import { logger } from "./logger.js";
import { parseAdminUserIds } from "./adminAccess.js";

// Re-export from the zero-dependency production.ts so that callers can
// import isProduction() from either env.ts or production.ts — both work.
// env.ts itself must NOT import isProduction() here because env.ts is
// imported by logger.ts (via logger.ts → production.ts), and a circular
// dependency (logger.ts → env.ts → logger.ts) would break module init order.
export { isProduction } from "./production.js";

export interface EnvIssue {
  name: string;
  /** Length of the original raw value — safe to log/persist. */
  valueLength: number;
  /** Short prefix of the raw value (at most 3 chars + "…") — safe to log/persist. */
  valuePreview: string;
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
      { name, valueLength: raw.length, valuePreview: raw.slice(0, 3) + "…" },
      `[env] ${name} is not a positive integer (length ${raw.length}) — falling back to ${fallback}`,
    );
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    logger.warn(
      { name, valueLength: raw.length, min, max },
      `[env] ${name} value is outside [${min}, ${max}] — falling back to ${fallback}`,
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

  /** Build a safe-field object for a raw value without retaining the raw string. */
  function safeFields(raw: string): { valueLength: number; valuePreview: string } {
    return { valueLength: raw.length, valuePreview: raw.slice(0, 3) + "…" };
  }

  const adminIdsRaw = process.env["ADMIN_USER_IDS"];
  if (adminIdsRaw !== undefined && adminIdsRaw !== "") {
    adminIdsRaw.split(",").forEach((token, idx) => {
      const trimmed = token.trim();
      if (trimmed === "") {
        issues.push({
          name: "ADMIN_USER_IDS",
          ...safeFields(adminIdsRaw),
          problem: `entry at position ${idx + 1} is empty (double comma or trailing comma)`,
        });
      } else if (!ADMIN_ID_RE.test(trimmed)) {
        issues.push({
          name: "ADMIN_USER_IDS",
          ...safeFields(adminIdsRaw),
          problem: `entry at position ${idx + 1} is not a valid user id token`,
        });
      }
    });
  }

  const originsRaw = process.env["ALLOWED_ORIGINS"];
  if (originsRaw !== undefined && originsRaw !== "") {
    originsRaw.split(",").forEach((token, idx) => {
      const trimmed = token.trim();
      if (trimmed === "") {
        issues.push({
          name: "ALLOWED_ORIGINS",
          ...safeFields(originsRaw),
          problem: `entry at position ${idx + 1} is empty (double comma or trailing comma)`,
        });
      } else if (!ORIGIN_RE.test(trimmed)) {
        issues.push({
          name: "ALLOWED_ORIGINS",
          ...safeFields(originsRaw),
          problem: `entry at position ${idx + 1} is not a valid http(s) origin (no path or trailing slash allowed)`,
        });
      }
    });
  }

  // OpenAI model name overrides: must be non-empty strings when set.
  for (const name of ["OPENAI_CLASSIFY_MODEL", "OPENAI_HELP_MODEL", "OPENAI_QUERY_MODEL"]) {
    const raw = process.env[name];
    if (raw !== undefined && raw.trim() === "") {
      issues.push({ name, ...safeFields(raw), problem: "must be a non-empty model name string" });
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
      issues.push({ name, ...safeFields(raw), problem: "is not a positive integer" });
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
      ...safeFields(bucketAdminFlag),
      problem:
        "must not be set in production — it grants every authenticated user full admin access. Remove it or restrict access via ADMIN_USER_IDS instead.",
      critical: true,
    });
  }

  // If no admin access pathway is configured in production, every user (including
  // the owner) will land as pending with no way to approve anyone — a permanent
  // lockout. This check is skipped in non-production (test/dev) environments.
  const bucketAdminActive = bucketAdminFlag === "1" || bucketAdminFlag === "true";
  // Presence must be judged by the same parsing rules isAdmin() uses:
  // delimiter-only values like "," or ",, " contain zero usable IDs and
  // would still cause a permanent lockout if accepted here.
  const adminIdsPresent = parseAdminUserIds(adminIdsRaw).length > 0;
  if (isProduction && !adminIdsPresent && !bucketAdminActive) {
    issues.push({
      name: "ADMIN_USER_IDS",
      valueLength: 0,
      valuePreview: "…",
      problem:
        "is not set (or contains no usable IDs). Without ADMIN_USER_IDS every new user will land as pending with no admin able to approve them — a permanent lockout. Set ADMIN_USER_IDS to a comma-separated list of Clerk user IDs.",
      critical: true,
    });
  }

  for (const issue of issues) {
    const safeMeta = { name: issue.name, valueLength: issue.valueLength, valuePreview: issue.valuePreview };
    if (issue.critical) {
      logger.error(
        safeMeta,
        `[env] CRITICAL: ${issue.name} ${issue.problem}`,
      );
    } else {
      logger.warn(
        safeMeta,
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
