> **See also:** [`SCHEDULED-DATA-REFRESH.md`](./SCHEDULED-DATA-REFRESH.md)
> covers the same setup for every other survey-based data layer (ShoreZone,
> ENC substrate, USSEABED substrate, TX lake substrate, TX freshwater EFH)
> and shares the wrapper implementation in
> `scripts/src/lib/scheduled-refresh.ts`. Prefer that doc for new wire-up;
> this file is kept as the Ray-Roberts-specific reference.

# Scheduled refresh — Lake Ray Roberts terrain bundle

The Ray Roberts terrain build script (`scripts/src/build-lake-ray-roberts-terrain.ts`)
probes TWDB and USACE for newly published reservoir surveys every time it runs.
Both agencies (re)publish on a multi-year cadence and neither exposes a change
feed, so the only way to catch a new raster the moment it appears is to run the
build on a recurring schedule.

This document is the operational wire-up for that schedule.

## What runs

```
pnpm --filter @workspace/scripts run scheduled-refresh-lake-ray-roberts-terrain
```

That command:

1. Hashes the currently committed `lakeRayRobertsTerrain.gen.json` (if any).
2. Re-runs the full build pipeline.
3. Hashes the freshly generated bundle.
4. If the hashes differ, logs a clear, greppable alert
   (`[RAY-ROBERTS-TERRAIN] CHANGED …` followed by a JSON payload) and, when
   `RAY_ROBERTS_REFRESH_WEBHOOK_URL` is set, POSTs that payload to the webhook.
5. Exits non-zero on any build or webhook failure so the deployment is marked
   failed in the Deployments dashboard instead of silently rotting.

Scheduled Deployments do **not** have write access back to the git repo, which
is why this surfaces an alert instead of committing automatically. Acting on
the alert is a single PR: re-run the same command locally and commit the
regenerated `artifacts/api-server/src/lib/lakeRayRobertsTerrain.gen.json`.

## Replit Scheduled Deployment — one-time setup

1. Open the **Publishing** tool in the workspace.
2. Choose **Scheduled** as the deployment type.
3. Set the schedule to **weekly, Monday 04:00 UTC** (cron: `0 4 * * 1`).
   This is well below either upstream agency's publishing cadence and lands in
   quiet hours for the ArcGIS services we probe.
4. Set the build command to: `pnpm install --frozen-lockfile`
5. Set the run command to:
   `pnpm --filter @workspace/scripts run scheduled-refresh-lake-ray-roberts-terrain`
6. (Optional but recommended) Add a deployment secret named
   `RAY_ROBERTS_REFRESH_WEBHOOK_URL` pointing at a Slack / Discord / PagerDuty
   incoming webhook so changes page someone rather than relying on log scraping.
7. Click **Publish**. Subsequent runs happen automatically on the configured
   cadence.

## Finding the logs

* In the workspace, open **Deployments → Scheduled refresh — Ray Roberts
  terrain → Logs**. Each scheduled run is listed with its exit status and full
  stdout/stderr.
* Every line emitted by the wrapper is prefixed with `[RAY-ROBERTS-TERRAIN]`,
  so a quick `grep RAY-ROBERTS-TERRAIN` across log exports surfaces the full
  history.
* Failed runs surface in the Deployments dashboard with a red status, so a
  silent multi-week outage is not possible.

## CI fallback (if you ever move off Replit Scheduled Deployments)

The wrapper has no Replit-specific dependencies — any cron-capable CI (GitHub
Actions `schedule:`, GitLab scheduled pipelines, a bare cron host, etc.) can
invoke the same `pnpm` command on the same cadence. If the runner has push
access to the repo, you can additionally chain a git commit step after the
wrapper to automate the PR/commit instead of relying on the webhook.
