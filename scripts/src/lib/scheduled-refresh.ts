/**
 * scheduled-refresh.ts — shared implementation behind every
 * scheduled-refresh-* wrapper under scripts/src/.
 *
 * Why a wrapper at all (vs. just letting the build script run on a cron)?
 *   1. We want a clear, greppable alert line in the deployment logs when
 *      the regenerated bundle actually differs from what is committed in
 *      the repo, so a human (or webhook) knows to roll the new bundle
 *      into the next release. The build scripts themselves only care
 *      about producing the bundle.
 *   2. Replit Scheduled Deployments do not have write access back to the
 *      git repo, so we cannot commit + push from inside the run. Instead
 *      we surface a structured alert (`[LAYER] CHANGED ...`) and, if a
 *      webhook env var is configured, POST a JSON payload to it. The
 *      on-call human (or a Slack/Discord incoming-webhook) then opens a
 *      PR with the new bundle.
 *   3. Any failure of the underlying build (network, upstream outage,
 *      bug) exits non-zero so the Scheduled Deployment is marked failed
 *      and shows up in the deployments dashboard rather than silently
 *      rotting.
 *
 * Each layer (Ray Roberts terrain, ShoreZone, ENC substrate, USSEABED
 * substrate, TX lake substrate, TX freshwater EFH) has a thin wrapper
 * that fills in this config and calls runScheduledRefresh().
 *
 * Exit codes:
 *   0 — ran successfully (whether or not the bundle changed)
 *   1 — build failed, or webhook delivery failed when one was configured
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Keys that hold a run-time timestamp (or other "when did we last fetch"
 * metadata) and therefore change on every build even when the upstream
 * source data is identical. We strip these recursively before hashing so
 * the diff actually reflects upstream changes instead of clock drift.
 *
 * Keep this list in sync with the metadata the build-* scripts embed.
 * Currently:
 *   - fetchedAt: ENC / USSEABED / TX lake / ShoreZone / Ray Roberts builders
 *   - lastUpdated: TX freshwater EFH builder
 */
const VOLATILE_KEYS: ReadonlySet<string> = new Set(["fetchedAt", "lastUpdated"]);

/**
 * Repository root, derived from this module's own location so the
 * "path" field in the alert payload stays relative to the workspace
 * root regardless of which wrapper invokes us.
 *
 * Layout: scripts/src/lib/scheduled-refresh.ts → 3 levels up = repo root.
 */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export interface ScheduledRefreshConfig {
  /**
   * Short uppercase label used in `[LAYER-LABEL] …` log lines and in the
   * alert payload's `tag` field. Keep it greppable and stable — log
   * archives and any downstream webhook consumers may key off it.
   */
  layerLabel: string;
  /** Absolute path to the build script's output bundle. */
  outPath: string;
  /**
   * Re-runs the full build pipeline for this layer. Must (re)write
   * `outPath` to disk and throw on any error so the scheduled run is
   * marked failed.
   */
  build: () => Promise<void>;
  /**
   * Name of the env var that, when set, will receive a POST of the
   * alert payload. Different layers use different webhook endpoints in
   * practice (or share one) so the var name is explicit per layer.
   */
  webhookEnvVar: string;
  /**
   * Human-readable instruction included in the alert payload. Defaults
   * to a generic "open a PR with the regenerated bundle" message; pass
   * a more specific one if the layer has extra steps.
   */
  action?: string;
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Recursively strip VOLATILE_KEYS and return a canonical JSON string
 * with sorted object keys. Two builds with identical upstream data must
 * produce byte-identical canonical output, so the hash diff only fires
 * on real content changes — not on the run-time timestamps the build
 * scripts embed.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = canonicalize(obj[key]);
    }
    return out;
  }
  return value;
}

/**
 * Hash of the bundle's canonical (sorted, volatile-keys-stripped) form.
 * Falls back to hashing the raw file bytes if the file isn't valid JSON —
 * a build that emits malformed JSON has bigger problems, but we still
 * want a stable hash for the alert payload rather than throwing.
 */
function readBundleHash(path: string): string | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return sha256(raw);
  }
  return sha256(JSON.stringify(canonicalize(parsed)));
}

function describeWebhook(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "configured webhook";
  }
}

async function postWebhook(
  envVar: string,
  layerLabel: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = process.env[envVar];
  if (!url) return;
  const target = describeWebhook(url);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Surface the cause without echoing the (secret) full URL or any
    // signed path/query tokens it might carry.
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Webhook POST to ${target} failed: ${cause}`);
  }
  if (!res.ok) {
    throw new Error(
      `Webhook POST to ${target} failed: ${res.status} ${res.statusText}`,
    );
  }
  console.log(
    `[${layerLabel}] webhook delivered to ${target} (${res.status})`,
  );
}

export async function runScheduledRefresh(
  cfg: ScheduledRefreshConfig,
): Promise<void> {
  const tag = `[${cfg.layerLabel}]`;
  const startedAt = new Date().toISOString();
  console.log(`${tag} scheduled refresh starting at ${startedAt}`);

  const prevHash = readBundleHash(cfg.outPath);
  console.log(`${tag} previous bundle hash: ${prevHash ?? "<none on disk>"}`);

  await cfg.build();

  const nextHash = readBundleHash(cfg.outPath);
  if (nextHash === null) {
    throw new Error(
      `Build completed but output file is missing: ${cfg.outPath}`,
    );
  }
  const size = statSync(cfg.outPath).size;
  const relPath = relative(REPO_ROOT, cfg.outPath);
  const finishedAt = new Date().toISOString();

  if (prevHash !== null && prevHash === nextHash) {
    console.log(
      `${tag} UNCHANGED — bundle hash matches committed file (${nextHash.slice(0, 12)}…); no action needed`,
    );
    console.log(`${tag} scheduled refresh finished at ${finishedAt}`);
    return;
  }

  const reason = prevHash === null ? "missing-on-disk" : "content-changed";
  const action =
    cfg.action ??
    "Open a PR committing the regenerated bundle so the next release picks up the new survey data.";
  const alert = {
    tag: `${cfg.layerLabel.toLowerCase()}-refresh`,
    reason,
    startedAt,
    finishedAt,
    path: relPath,
    sizeBytes: size,
    previousSha256: prevHash,
    nextSha256: nextHash,
    action,
  };

  console.log(
    `${tag} CHANGED — ${reason}; new hash ${nextHash.slice(0, 12)}… (${size} bytes)`,
  );
  console.log(`${tag} ${JSON.stringify(alert)}`);

  await postWebhook(cfg.webhookEnvVar, cfg.layerLabel, alert);

  console.log(`${tag} scheduled refresh finished at ${finishedAt}`);
}

/**
 * Convenience entrypoint for wrapper modules: calls runScheduledRefresh
 * and translates any thrown error into a non-zero exit so the scheduled
 * deployment shows red.
 */
export function runScheduledRefreshCli(cfg: ScheduledRefreshConfig): void {
  runScheduledRefresh(cfg).catch((err) => {
    console.error(`[${cfg.layerLabel}] FAILED:`, err);
    process.exit(1);
  });
}
