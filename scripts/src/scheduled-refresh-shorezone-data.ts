/**
 * scheduled-refresh-shorezone-data.ts — Wrapper around
 * build-shorezone-data.ts intended to be invoked by a Replit Scheduled
 * Deployment (or any equivalent cron).
 *
 * Shared rationale, alert format, and wire-up live in
 * scripts/src/lib/scheduled-refresh.ts and
 * scripts/SCHEDULED-DATA-REFRESH.md.
 *
 * Locally:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-shorezone-data
 */

import { runScheduledRefreshCli } from "./lib/scheduled-refresh.js";
import { main as runBuild, OUT_PATH } from "./build-shorezone-data.js";

runScheduledRefreshCli({
  layerLabel: "SHOREZONE",
  outPath: OUT_PATH,
  build: runBuild,
  webhookEnvVar: "SHOREZONE_REFRESH_WEBHOOK_URL",
});
