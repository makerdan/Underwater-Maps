/**
 * scheduled-refresh-crater-lake-terrain.ts — Wrapper around
 * build-crater-lake-terrain.ts intended to be invoked by a Replit
 * Scheduled Deployment (or any equivalent cron) on a nightly cadence.
 *
 * The shared rationale, alert format, and wire-up live in
 * scripts/src/lib/scheduled-refresh.ts and
 * scripts/SCHEDULED-DATA-REFRESH.md. This module just supplies the
 * Crater-Lake-specific build entrypoint and output path.
 *
 * Locally:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-crater-lake-terrain
 */

import { runScheduledRefreshCli } from "./lib/scheduled-refresh.js";
import {
  main as runBuild,
  CRATER_LAKE_TERRAIN_OUT_PATH,
} from "./build-crater-lake-terrain.js";

runScheduledRefreshCli({
  layerLabel: "CRATER-LAKE-TERRAIN",
  outPath: CRATER_LAKE_TERRAIN_OUT_PATH,
  build: runBuild,
  webhookEnvVar: "CRATER_LAKE_REFRESH_WEBHOOK_URL",
});
