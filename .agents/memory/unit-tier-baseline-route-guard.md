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

## Second baseline failure (same run, same treatment)

Also as of 2026-08-15, `routes-documented.test.ts` fails on
`POST /trails/{id}/soft-delete` (added to `trails.ts` 2026-08-14 without an
openapi.yaml entry). Same classification rule: pre-existing unless your
changeset touches api-server routes/openapi.yaml. A follow-up task covers both.
