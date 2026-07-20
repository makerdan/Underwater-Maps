/**
 * scheduled-refresh-lake-tahoe-terrain.ts — Wrapper around
 * build-lake-tahoe-terrain.ts intended to be invoked by a Replit
 * Scheduled Deployment (or any equivalent cron) on a nightly cadence.
 *
 * The shared rationale, alert format, and wire-up live in
 * scripts/src/lib/scheduled-refresh.ts and
 * scripts/SCHEDULED-DATA-REFRESH.md. This module just supplies the
 * Lake-Tahoe-specific build entrypoint and output path.
 *
 * Locally:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-lake-tahoe-terrain
 */

import { runScheduledRefreshCli } from "./lib/scheduled-refresh.js";
import {
  main as runBuild,
  LAKE_TAHOE_TERRAIN_OUT_PATH,
} from "./build-lake-tahoe-terrain.js";

runScheduledRefreshCli({
  layerLabel: "LAKE-TAHOE-TERRAIN",
  outPath: LAKE_TAHOE_TERRAIN_OUT_PATH,
  build: runBuild,
  webhookEnvVar: "LAKE_TAHOE_REFRESH_WEBHOOK_URL",
});
