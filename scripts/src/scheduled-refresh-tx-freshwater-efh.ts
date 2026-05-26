/**
 * scheduled-refresh-tx-freshwater-efh.ts — Wrapper around
 * build-tx-freshwater-efh.ts intended to be invoked by a Replit
 * Scheduled Deployment (or any equivalent cron).
 *
 * Shared rationale, alert format, and wire-up live in
 * scripts/src/lib/scheduled-refresh.ts and
 * scripts/SCHEDULED-DATA-REFRESH.md.
 *
 * Locally:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-tx-freshwater-efh
 */

import { runScheduledRefreshCli } from "./lib/scheduled-refresh.js";
import { main as runBuild, OUT_PATH } from "./build-tx-freshwater-efh.js";

runScheduledRefreshCli({
  layerLabel: "TX-FRESHWATER-EFH",
  outPath: OUT_PATH,
  build: runBuild,
  webhookEnvVar: "TX_FRESHWATER_EFH_REFRESH_WEBHOOK_URL",
});
