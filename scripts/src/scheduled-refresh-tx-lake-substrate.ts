/**
 * scheduled-refresh-tx-lake-substrate.ts — Wrapper around
 * build-tx-lake-substrate.ts intended to be invoked by a Replit
 * Scheduled Deployment (or any equivalent cron).
 *
 * Shared rationale, alert format, and wire-up live in
 * scripts/src/lib/scheduled-refresh.ts and
 * scripts/SCHEDULED-DATA-REFRESH.md.
 *
 * Locally:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-tx-lake-substrate
 */

import { runScheduledRefreshCli } from "./lib/scheduled-refresh.js";
import { main as runBuild, OUT_PATH } from "./build-tx-lake-substrate.js";

runScheduledRefreshCli({
  layerLabel: "TX-LAKE-SUBSTRATE",
  outPath: OUT_PATH,
  build: runBuild,
  webhookEnvVar: "TX_LAKE_SUBSTRATE_REFRESH_WEBHOOK_URL",
});
