---
title: Schema & Migration Drift Audit
---
# Schema & Migration Drift Audit

## What & Why
BathyScan's Drizzle schema, migration files, OpenAPI spec, and generated TypeScript client must stay in sync. In practice they drift: `terrainJson` and `overviewJson` are untyped blobs in the DB schema but may accumulate undocumented fields in the TypeScript types; new migration files may add columns not reflected in the Drizzle schema; new API routes may not appear in `openapi.yaml`; and the generated client in `lib/api-client-react` may be stale. This audit diffs all four layers and fixes every mismatch.

## Done looks like
- Drizzle schema files (`lib/db/drizzle/schema.ts` or equivalent) match the latest migration SQL exactly — no column in a migration file is absent from the schema and vice versa.
- `terrainJson` and `overviewJson` columns have matching TypeScript types in both the Drizzle schema and the OpenAPI spec (no `any`, `unknown`, or undocumented extra fields).
- Running `orval` codegen produces no diff against the committed generated files in `lib/api-client-react/src/generated` and `lib/api-zod/src/generated`.
- Every API route in `artifacts/api-server/src/routes/` that was added or modified since the last audit appears in `openapi.yaml` with correct request/response schemas.
- The `check:codegen-stale` CI script passes cleanly (`pnpm run check:codegen-stale` exits 0).

## Out of scope
- Redesigning the DB schema or changing the public API contract.
- Adding new routes or columns beyond what is needed to fix drift.

## Steps
1. **Diff Drizzle schema vs. migration files** — List all migration SQL files in `lib/db/drizzle`; extract every `ALTER TABLE` / `CREATE TABLE` column definition; compare against the Drizzle schema TypeScript definitions. Log any mismatch.

2. **Audit `terrainJson` and `overviewJson` types** — Find the Drizzle column definitions for these two fields; find their counterparts in `openapi.yaml`; confirm the TypeScript shape matches in both places. Replace any `any` or `unknown` with a documented interface if the actual shape is known.

3. **Run codegen and check for drift** — Run `pnpm run check:codegen-stale`; if it exits non-zero, run `pnpm --filter @workspace/api-spec run codegen:generate`, review the diff, and commit the regenerated files.

4. **Audit new routes against `openapi.yaml`** — List all Express route handlers added or modified since the last schema-drift audit; cross-reference each with the paths in `openapi.yaml`. Add any missing paths with correct request/response schemas.

5. **Confirm `check:codegen-stale` passes in CI** — Run the check script and confirm it exits 0; if not, iterate on steps 3–4 until it does.

## Relevant files
- `lib/db/drizzle/` — Drizzle schema and migration files
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/`
- `lib/api-zod/src/generated/`
- `artifacts/api-server/src/routes/`
- `package.json` (`check:codegen-stale` script)
