# Scheduled refresh — survey-based data layers

Several BathyScan data layers are baked into the repo as committed `.gen.json`
bundles produced by the `build-*` scripts under `scripts/src/`. Every one of
these layers comes from a slow-moving government / agency source that has **no
change feed** — TWDB and USACE reservoir surveys, NOAA ENC charts, USGS
USSEABED, TPWD habitat layers, Alaska ShoreZone. The only way to notice when
new source data is published is to re-run the build on a recurring schedule
and diff the output.

This document is the operational wire-up for those schedules.

## Layers covered

| Layer | Build script | Wrapper / pnpm command | Webhook env var |
| --- | --- | --- | --- |
| Lake Ray Roberts terrain | `build-lake-ray-roberts-terrain.ts` | `scheduled-refresh-lake-ray-roberts-terrain` | `RAY_ROBERTS_REFRESH_WEBHOOK_URL` |
| Alaska ShoreZone | `build-shorezone-data.ts` | `scheduled-refresh-shorezone-data` | `SHOREZONE_REFRESH_WEBHOOK_URL` |
| SE Alaska ENC substrate | `build-enc-substrate.ts` | `scheduled-refresh-enc-substrate` | `ENC_SUBSTRATE_REFRESH_WEBHOOK_URL` |
| CONUS USSEABED substrate | `build-usseabed-substrate.ts` | `scheduled-refresh-usseabed-substrate` | `USSEABED_SUBSTRATE_REFRESH_WEBHOOK_URL` |
| TX lake substrate | `build-tx-lake-substrate.ts` | `scheduled-refresh-tx-lake-substrate` | `TX_LAKE_SUBSTRATE_REFRESH_WEBHOOK_URL` |
| TX freshwater EFH | `build-tx-freshwater-efh.ts` | `scheduled-refresh-tx-freshwater-efh` | `TX_FRESHWATER_EFH_REFRESH_WEBHOOK_URL` |
| Crater Lake terrain | `build-crater-lake-terrain.ts` | `scheduled-refresh-crater-lake-terrain` | `CRATER_LAKE_REFRESH_WEBHOOK_URL` |
| Lake Tahoe terrain | `build-lake-tahoe-terrain.ts` | `scheduled-refresh-lake-tahoe-terrain` | `LAKE_TAHOE_REFRESH_WEBHOOK_URL` |

All eight wrappers share a single implementation in
`scripts/src/lib/scheduled-refresh.ts`, so the alert format, log shape, and
exit-code contract are identical across layers.

## What each wrapper does

```
pnpm --filter @workspace/scripts run scheduled-refresh-<layer>
```

1. Hashes the currently committed `.gen.json` (if any).
2. Re-runs the full build pipeline for that layer.
3. Hashes the freshly generated bundle.
4. If the hashes differ, logs a clear, greppable alert
   (`[LAYER] CHANGED …` followed by a JSON payload) and, when the layer's
   webhook env var is set, POSTs that payload to the webhook.
5. Exits non-zero on any build or webhook failure so the deployment is marked
   failed in the Deployments dashboard instead of silently rotting.

Scheduled Deployments do **not** have write access back to the git repo, which
is why each wrapper surfaces an alert instead of committing automatically.
Acting on the alert is a single PR: re-run the same command locally and commit
the regenerated `.gen.json`.

## Replit Scheduled Deployment — one-time setup

Each layer is wired as its own Scheduled Deployment. They are independent so
a failure (or a noisy "changed" alert) on one layer does not block the others.

1. Open the **Publishing** tool in the workspace.
2. Choose **Scheduled** as the deployment type.
3. Pick a cadence (see below).
4. Set the build command to: `pnpm install --frozen-lockfile`
5. Set the run command to the wrapper for that layer, e.g.
   `pnpm --filter @workspace/scripts run scheduled-refresh-shorezone-data`
6. (Optional but recommended) Add a deployment secret using the env var name
   from the table above, pointing at a Slack / Discord / PagerDuty incoming
   webhook so changes page someone rather than relying on log scraping.
7. Click **Publish**. Subsequent runs happen automatically on the configured
   cadence.

Repeat for each layer you want covered.

### Suggested cadences

All of these sources publish on multi-month-to-multi-year cycles, so weekly
probing is plenty and the runs are cheap (each finishes in well under a minute
on quiet upstreams). To avoid stampeding the same upstream services, stagger
the schedules across days and into off-peak hours:

| Layer | Cron | Why |
| --- | --- | --- |
| Lake Ray Roberts terrain | `0 4 * * 1` (Mon 04:00 UTC) | TWDB/USACE publish every few years; quiet hours for ArcGIS. |
| ShoreZone | `0 5 * * 2` (Tue 05:00 UTC) | Alaska ShoreZone updates are rare; off-peak for AGOL. |
| ENC substrate | `0 6 * * 3` (Wed 06:00 UTC) | NOAA ENC re-issues monthly per chart cell; weekly catches it well within the next release window. |
| USSEABED substrate | `0 7 * * 4` (Thu 07:00 UTC) | USGS USSEABED re-releases occasionally; weekly is generous. |
| TX lake substrate | `0 8 * * 5` (Fri 08:00 UTC) | TPWD habitat layer updates intermittently. |
| TX freshwater EFH | `0 9 * * 6` (Sat 09:00 UTC) | Same upstream as TX lake substrate; different output shape. |
| Crater Lake terrain | `0 3 * * *` (daily 03:00 UTC) | USGS ScienceBase item is currently secured; nightly probe catches the moment it becomes public. |
| Lake Tahoe terrain | `0 4 * * *` (daily 04:00 UTC) | Same rationale as Crater Lake; staggered 1 h to avoid hitting the same ScienceBase endpoints simultaneously. |

Adjust to taste — the wrapper has no opinion about the cadence beyond "more
often than the upstream actually changes".

## Finding the logs

* In the workspace, open **Deployments → Scheduled refresh — \<layer\> →
  Logs**. Each scheduled run is listed with its exit status and full
  stdout/stderr.
* Every line emitted by a wrapper is prefixed with `[LAYER]` (e.g.
  `[SHOREZONE]`, `[ENC-SUBSTRATE]`, `[USSEABED-SUBSTRATE]`,
  `[TX-LAKE-SUBSTRATE]`, `[TX-FRESHWATER-EFH]`, `[RAY-ROBERTS-TERRAIN]`,
  `[CRATER-LAKE-TERRAIN]`, `[LAKE-TAHOE-TERRAIN]`),
  so `grep` across log exports surfaces the full history per layer.
* Failed runs surface in the Deployments dashboard with a red status, so a
  silent multi-week outage is not possible.

## Single-deployment fan-out (alternative)

If you would rather run all eight on the same schedule from one deployment, use
a shell fan-out as the run command. Make sure to keep going on partial
failures so one flaky upstream does not mask the others, and exit non-zero if
any layer failed:

```sh
set +e
fail=0
for layer in \
  scheduled-refresh-lake-ray-roberts-terrain \
  scheduled-refresh-shorezone-data \
  scheduled-refresh-enc-substrate \
  scheduled-refresh-usseabed-substrate \
  scheduled-refresh-tx-lake-substrate \
  scheduled-refresh-tx-freshwater-efh \
  scheduled-refresh-crater-lake-terrain \
  scheduled-refresh-lake-tahoe-terrain; do
  echo "=== $layer ==="
  pnpm --filter @workspace/scripts run "$layer" || fail=1
done
exit $fail
```

The trade-off: a single dashboard entry to watch, but failures are mixed
together in one log stream. The per-layer deployment setup is the recommended
default.

## CI fallback (if you ever move off Replit Scheduled Deployments)

The wrappers have no Replit-specific dependencies — any cron-capable CI
(GitHub Actions `schedule:`, GitLab scheduled pipelines, a bare cron host,
etc.) can invoke the same `pnpm` commands on the same cadence. If the runner
has push access to the repo, you can additionally chain a git commit step
after each wrapper to automate the PR/commit instead of relying on the
webhook.
