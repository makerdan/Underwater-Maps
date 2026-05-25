# @workspace/api-spec

This package owns the OpenAPI specification that describes the BathyScan HTTP API.
It is the **source of truth** for both the server (Express handlers in
`artifacts/api-server`) and the client (React Query hooks consumed by
`artifacts/bathyscan`).

## Files

- `openapi.yaml` — the OpenAPI 3.1 spec. Edit this to add, remove, or change
  endpoints, request bodies, query params, or response shapes.
- `orval.config.ts` — Orval configuration that drives the codegen.

## Generated output

Running codegen produces TypeScript files in **two** sibling packages:

- `lib/api-client-react/src/generated/` — typed `fetch` + React Query hooks
  (`api.ts`, `api.schemas.ts`).
- `lib/api-zod/src/generated/` — Zod schemas (`api.ts`) used by the API server
  to validate inputs at runtime.

These directories are **git-ignored**. They are regenerated on demand and must
never be hand-edited.

## When codegen runs

1. **On `pnpm install`** — the workspace root `postinstall` script runs
   `pnpm --filter @workspace/api-spec run codegen:generate`. A fresh clone
   therefore always has the generated files before anything that imports them
   runs.
2. **After a task merge** — `scripts/post-merge.sh` invokes the same
   `codegen:generate` script (in addition to the implicit `postinstall`) so a
   merge that only touches `openapi.yaml` still refreshes the output.
3. **On demand** — run it yourself any time you edit the spec:

   ```sh
   pnpm --filter @workspace/api-spec run codegen
   ```

   The full `codegen` script also runs `pnpm run typecheck:libs` afterwards to
   verify the generated code still typechecks against its consumers.

## Guardrail

The root `typecheck` (and therefore `test-all`) script runs `check:codegen`
first. That check fails with a clear, actionable error message if any of the
generated files are missing — pointing you straight at
`pnpm --filter @workspace/api-spec run codegen` instead of letting the failure
surface later as a cryptic Vite "Failed to resolve import" error.

If you ever see the guardrail fail, run codegen and try again.
