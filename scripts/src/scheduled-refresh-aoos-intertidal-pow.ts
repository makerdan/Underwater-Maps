/**
 * scheduled-refresh-aoos-intertidal-pow.ts — Wrapper around
 * build-aoos-intertidal-pow.ts intended to be invoked by a Replit Scheduled
 * Deployment (or any equivalent cron).
 *
 * Shared rationale, alert format, and wire-up live in
 * scripts/src/lib/scheduled-refresh.ts and
 * scripts/SCHEDULED-DATA-REFRESH.md.
 *
 * Locally:
 *   pnpm --filter @workspace/scripts run scheduled-refresh-aoos-intertidal-pow
 */

import { runScheduledRefreshCli } from "./lib/scheduled-refresh.js";
import { main as runBuild, OUT_PATH } from "./build-aoos-intertidal-pow.js";

runScheduledRefreshCli({
  layerLabel: "AOOS-INTERTIDAL-POW",
  outPath: OUT_PATH,
  build: runBuild,
  webhookEnvVar: "AOOS_INTERTIDAL_POW_REFRESH_WEBHOOK_URL",
  action:
    "Open a PR committing the regenerated aoosIntertidalPow.gen.json so the next " +
    "deployment picks up fresh AOOS intertidal-habitat polygons for Prince of Wales Island.",
});
