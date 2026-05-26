/**
 * scheduled-refresh-lake-ray-roberts-terrain.ts — Wrapper around
 * build-lake-ray-roberts-terrain.ts intended to be invoked by a Replit
 * Scheduled Deployment (or any equivalent cron) on a weekly cadence.
 *
 * The shared rationale, alert format, and wire-up live in
 * scripts/src/lib/scheduled-refresh.ts and
 * scripts/SCHEDULED-DATA-REFRESH.md. This module just supplies the
 * Ray-Roberts-specific build entrypoint and output path.
 *
 * Locally:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-lake-ray-roberts-terrain
 */

import { runScheduledRefreshCli } from "./lib/scheduled-refresh.js";
import {
  main as runBuild,
  RAY_ROBERTS_TERRAIN_OUT_PATH,
} from "./build-lake-ray-roberts-terrain.js";

runScheduledRefreshCli({
  layerLabel: "RAY-ROBERTS-TERRAIN",
  outPath: RAY_ROBERTS_TERRAIN_OUT_PATH,
  build: runBuild,
  webhookEnvVar: "RAY_ROBERTS_REFRESH_WEBHOOK_URL",
});
