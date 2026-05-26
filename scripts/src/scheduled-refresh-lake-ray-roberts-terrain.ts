/**
 * scheduled-refresh-lake-ray-roberts-terrain.ts — Wrapper around
 * build-lake-ray-roberts-terrain.ts intended to be invoked by a Replit
 * Scheduled Deployment (or any equivalent cron) on a weekly cadence.
 *
 * Why a wrapper (vs. just the build script)?
 *   1. We want a clear, greppable alert line in the deployment logs when
 *      the regenerated bundle actually differs from what is committed in
 *      the repo, so a human (or webhook) knows to roll the new bundle
 *      into the next release. The build script itself is concerned only
 *      with producing the bundle.
 *   2. Replit Scheduled Deployments do not have write access back to the
 *      git repo, so we cannot commit + push from inside the run. Instead
 *      we surface a structured alert (`[RAY-ROBERTS-TERRAIN] CHANGED ...`)
 *      and, if `RAY_ROBERTS_REFRESH_WEBHOOK_URL` is configured, POST a
 *      JSON payload to it. The on-call human (or a Slack/Discord
 *      incoming-webhook) then opens a PR with the new bundle.
 *   3. Any failure of the underlying build (network, upstream outage,
 *      bug) exits non-zero so the Scheduled Deployment is marked failed
 *      and shows up in the deployments dashboard rather than silently
 *      rotting.
 *
 * Wire-up: see scripts/SCHEDULED-RAY-ROBERTS-REFRESH.md for the publish
 * steps. Locally you can invoke this with:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-lake-ray-roberts-terrain
 *
 * Exit codes:
 *   0 — ran successfully (whether or not the bundle changed)
 *   1 — build failed, or webhook delivery failed when one was configured
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import {
  main as runBuild,
  RAY_ROBERTS_TERRAIN_OUT_PATH,
} from "./build-lake-ray-roberts-terrain.js";

const ALERT_TAG = "[RAY-ROBERTS-TERRAIN]";
const REPO_ROOT = resolve(RAY_ROBERTS_TERRAIN_OUT_PATH, "../../../../..");

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function readBundleHash(path: string): string | null {
  if (!existsSync(path)) return null;
  return sha256(readFileSync(path));
}

function describeWebhook(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "configured webhook";
  }
}

async function postWebhook(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.RAY_ROBERTS_REFRESH_WEBHOOK_URL;
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
    // signed path/query tokens it might contain.
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Webhook POST to ${target} failed: ${cause}`);
  }
  if (!res.ok) {
    throw new Error(
      `Webhook POST to ${target} failed: ${res.status} ${res.statusText}`,
    );
  }
  console.log(`${ALERT_TAG} webhook delivered to ${target} (${res.status})`);
}

async function run(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`${ALERT_TAG} scheduled refresh starting at ${startedAt}`);

  const prevHash = readBundleHash(RAY_ROBERTS_TERRAIN_OUT_PATH);
  console.log(
    `${ALERT_TAG} previous bundle hash: ${prevHash ?? "<none on disk>"}`,
  );

  await runBuild();

  const nextHash = readBundleHash(RAY_ROBERTS_TERRAIN_OUT_PATH);
  if (nextHash === null) {
    throw new Error(
      `Build completed but output file is missing: ${RAY_ROBERTS_TERRAIN_OUT_PATH}`,
    );
  }
  const size = statSync(RAY_ROBERTS_TERRAIN_OUT_PATH).size;
  const relPath = relative(REPO_ROOT, RAY_ROBERTS_TERRAIN_OUT_PATH);
  const finishedAt = new Date().toISOString();

  if (prevHash !== null && prevHash === nextHash) {
    console.log(
      `${ALERT_TAG} UNCHANGED — bundle hash matches committed file (${nextHash.slice(0, 12)}…); no action needed`,
    );
    console.log(`${ALERT_TAG} scheduled refresh finished at ${finishedAt}`);
    return;
  }

  const reason = prevHash === null ? "missing-on-disk" : "content-changed";
  const alert = {
    tag: "ray-roberts-terrain-refresh",
    reason,
    startedAt,
    finishedAt,
    path: relPath,
    sizeBytes: size,
    previousSha256: prevHash,
    nextSha256: nextHash,
    action:
      "Open a PR committing the regenerated bundle so the next release picks up the new survey data.",
  };

  console.log(
    `${ALERT_TAG} CHANGED — ${reason}; new hash ${nextHash.slice(0, 12)}… (${size} bytes)`,
  );
  console.log(`${ALERT_TAG} ${JSON.stringify(alert)}`);

  await postWebhook(alert);

  console.log(`${ALERT_TAG} scheduled refresh finished at ${finishedAt}`);
}

run().catch((err) => {
  console.error(`${ALERT_TAG} FAILED:`, err);
  process.exit(1);
});
