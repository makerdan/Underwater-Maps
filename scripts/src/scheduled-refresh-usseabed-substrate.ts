/**
 * scheduled-refresh-usseabed-substrate.ts — Wrapper around
 * build-usseabed-substrate.ts intended to be invoked by a Replit
 * Scheduled Deployment (or any equivalent cron).
 *
 * Shared rationale, alert format, and wire-up live in
 * scripts/src/lib/scheduled-refresh.ts and
 * scripts/SCHEDULED-DATA-REFRESH.md.
 *
 * Locally:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-usseabed-substrate
 */

import { runScheduledRefreshCli } from "./lib/scheduled-refresh.js";
import { main as runBuild, OUT_PATH } from "./build-usseabed-substrate.js";

runScheduledRefreshCli({
  layerLabel: "USSEABED-SUBSTRATE",
  outPath: OUT_PATH,
  build: runBuild,
  webhookEnvVar: "USSEABED_SUBSTRATE_REFRESH_WEBHOOK_URL",
});
