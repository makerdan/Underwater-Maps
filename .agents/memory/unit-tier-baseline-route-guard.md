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


## Additional unit-tier failures (as of 2026-08-16 evening, main-side merges)

Beyond routes-documented, two more api-server unit files fail every standard+
run after the 2026-08-16 evening merge wave:

1. `src/__tests__/terrain-mock-guard.test.ts` — "lib/terrain.js has export(s)
   missing from createTerrainMock": a merge added a terrain.js export without
   updating `__tests__/helpers/terrainMock.ts`. Guard message prescribes the fix.
2. `src/routes/__tests__/env-pack.test.ts` ("GET /env-pack — partial fail…",
   line ~452) — the test still asserts the OLD pino arg order
   (`warn(msg, obj)`) while main's fix changed the code to `warn(obj, msg)`;
   swap the indices in the assertions.

Classify pre-existing unless your diff touches terrain.js/terrainMock.ts or
env-pack code/tests.

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
