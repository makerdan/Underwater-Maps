/**
 * scheduled-refresh-enc-substrate.ts — Wrapper around
 * build-enc-substrate.ts intended to be invoked by a Replit Scheduled
 * Deployment (or any equivalent cron).
 *
 * Shared rationale, alert format, and wire-up live in
 * scripts/src/lib/scheduled-refresh.ts and
 * scripts/SCHEDULED-DATA-REFRESH.md.
 *
 * Locally:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-enc-substrate
 */

import { runScheduledRefreshCli } from "./lib/scheduled-refresh.js";
import { main as runBuild, OUT_PATH } from "./build-enc-substrate.js";

runScheduledRefreshCli({
  layerLabel: "ENC-SUBSTRATE",
  outPath: OUT_PATH,
  build: runBuild,
  webhookEnvVar: "ENC_SUBSTRATE_REFRESH_WEBHOOK_URL",
});
