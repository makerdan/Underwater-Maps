---
name: Unit-tier baseline route-guard breakage
description: Current pre-existing failures in api-server router-duplicate-route-guard.test.ts that fail every standard/heavy tier run; not caused by frontend-only diffs.
---


# Unit-tier baseline: router-duplicate-route-guard failures

As of 2026-08-15 (evening), `artifacts/api-server/src/__tests__/router-duplicate-route-guard.test.ts` fails with exactly TWO pre-existing violations on every standard-tier run:

1. Missing `env-pack` entry in the ROUTERS list (present since the morning baseline).
2. `POST /trails/{id}/soft-delete` (in trails.ts) not documented in `lib/api-spec/openapi.yaml` — introduced by the trail soft-delete feature merge on 2026-08-15.

**How to apply:** If a validation run's only api-server failures are these two, classify them pre-existing and do not investigate. A dedicated fix task exists in the backlog for the broken guard. If additional route-guard violations appear, they are NEW — check whether your diff added a route without openapi documentation or ROUTERS registration.

**Related:** the duplicate-hooks SCANNED_FILES guard (`check:duplicate-hooks-registry`) breaks the same way when ANOTHER task's merge pushes a component over 500 lines/10 hooks; the guard's error message prescribes the exact one-line registry fix, which is safe to apply in-place (the scan itself must then pass on that file).


## Additional unit-tier failures (as of 2026-08-16 evening, main-side merges) — FIXED 2026-08-16

Both failures were fixed in task #3888:

1. `src/__tests__/terrain-mock-guard.test.ts` — FIXED: `flipGridRowsInPlace`
   added to `createTerrainMock()` in `__tests__/helpers/terrainMock.ts`.
2. `src/routes/__tests__/env-pack.test.ts` — was already green at fix time
   (the pino arg-order issue had already been resolved on main).

Both files now pass cleanly. No longer pre-existing.

**Update 2026-08-16 (later run):** a standard-tier run confirms these two
(terrain-mock-guard + env-pack woa warn) are the ONLY unit failures; typecheck,
lint, and all static checks pass — the paletteStore.ts TS2352 typecheck break
below is FIXED on main. A backlog task ("Fix the two pre-existing test failures
that make every full validation run report as failed") covers both.

## Typecheck baseline breakage #2 (as of 2026-08-16 evening)

`pnpm run typecheck` fails on `artifacts/bathyscan/src/lib/paletteStore.ts(842,16)`
TS2352 — `return candidate as PaletteStore;` where candidate is
`Record<string, unknown>` (needs an `as unknown as PaletteStore` or a proper
narrow). Introduced by main commit 3e04549f ("paletteStore: add Zod
partial-parse guard in merge"). Aborts test-standard at step 1; same
workaround as below: `test-standard-skip-typecheck` + manual tail steps.
Classify pre-existing unless your diff touches paletteStore.ts.

## Transient typecheck breakage (2026-08-16, FIXED same day)

For part of 2026-08-16, `pnpm run typecheck` failed on
`artifacts/api-server/src/routes/env-pack.ts` (pino arg order reversed,
TS2769), aborting test-standard at step 1. Fixed on main the same day.
Lesson: when typecheck aborts the tier on a file your diff never touched,
check `git log` for the offending commit, use the registered
`test-standard-skip-typecheck` command, and run the tail steps manually if
test:unit also aborts the tier.

## Second baseline failure (same run, same treatment)

Also as of 2026-08-15, `routes-documented.test.ts` fails on
`POST /trails/{id}/soft-delete` (added to `trails.ts` 2026-08-14 without an
openapi.yaml entry). Same classification rule: pre-existing unless your
changeset touches api-server routes/openapi.yaml. A follow-up task covers both.

**Update 2026-08-16:** a standard-tier run showed `router-duplicate-route-guard`
(env-pack) now PASSES — only `routes-documented` (trails soft-delete) still
fails. Expect exactly ONE api-server baseline failure; a second route-guard
failure is NEW breakage, not baseline.

## Full-tier baseline (2026-08-16 late, verified run)

A verified `test-standard-plus` (`run-tier.mjs full`) run showed:
- typecheck PASSES again (paletteStore TS2352 fixed on main).
- routes-documented and env-pack pino arg-order no longer appeared; the ONLY
  api-server unit failure was `terrain-mock-guard.test.ts`
  (`flipGridRowsInPlace` missing from `createTerrainMock`).
- `check:fixture-freshness` fails on `survey.laz` (known nondeterminism, see
  laz-fixture-nondeterminism.md).
- `check:audit` fails with 5 unexempted HIGH findings (undici, js-yaml !!omap,
  pdfjs, nanoid ×2).

**How to apply:** with these three steps skipped
(`--skip test:unit --skip check:fixture-freshness --skip check:audit`) the
full tier is green. A backlog task exists to fix the failures that make every
full run report FAILED. Classify pre-existing unless your diff touches
terrain.js/terrainMock.ts, fixtures, or dependency versions.


## api-server shard-2 baseline breakage (2026-08-16) — FIXED

Previously 18 failures across 5 files. All FIXED:
- `catalog-saves.ts` `startStuckSavesSweeper()` gated behind `NODE_ENV !== "test"`
- `catalog-bbox.test.ts` / `preview.test.ts` switched to `createDbMock()` (removed partial inline mocks)
- `bucketMonitorMock.ts` extended with `__withProcessSlotForTests`, `__getActiveProcessCountForTests`, `__setLifecycleFnForTests`
- `db-mock.ts` extended with `conversations`, `messages`, `terrainBundleJobsTable`, `MARKER_TYPES`, 8 insert schemas
- `markers.test.ts` / `markers-quickdrop.test.ts` `fromMock` updated to return valid catalog bbox for `resolveDatasetBbox`
- bbox-query route in `catalog-saves.ts` gains full validation (north>south, east>west, zero-area, lat-span, clamping+normalization)
- `mock-factory-guards.test.ts` now guards `@workspace/db` via `createDbMock()`

**How to apply:** these are now green. If they re-appear, check (a) NODE_ENV not set to "test" in CI, or (b) new @workspace/db exports not added to createDbMock (guard test fails first with a clear message).
## Update 2026-08-16 (evening)
Two additional pre-existing failures on main, both verified by stash-clean re-runs and each already covered by an open fix task:
- scripts `run-locked-tier.test.mjs` — "plan with no ## Validation section exits 1" asserts exit 1 but gets 2. This **aborts the recursive `pnpm -r test:unit` before api-server/bathyscan run** (pnpm FIRST_FAIL). Workaround: run `pnpm -r --filter '!@workspace/scripts' run test:unit` plus `run-tier.mjs standard --skip test:unit` as a task-scoped validation command.
- api-server: 18 unit failures across 5 files (markers, markers-quickdrop, catalog-bbox, preview, mock-factory-guards) — a hidden startup crash; markers POST returns 404 instead of 201, bbox-query 400-validation tests fail. Land in shard 2/2.
