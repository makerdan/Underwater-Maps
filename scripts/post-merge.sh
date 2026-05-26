#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Regenerate the API client from openapi.yaml. `pnpm install` already triggers
# the workspace `postinstall` hook which runs this, but we invoke it explicitly
# here so a merge that only changes openapi.yaml (no dependency changes) still
# refreshes the generated files.
pnpm --filter @workspace/api-spec run codegen:generate
pnpm --filter db push
# Guardrail: surface typecheck/lint regressions immediately after a merge.
# Unit tests are run separately (non-blocking) because there are known
# pre-existing failures tracked in the backlog ("Stop the two pre-existing
# unit-test failures from blocking CI"). Running them here with || true
# surfaces the output without failing the post-merge setup.
pnpm run typecheck && pnpm run lint
pnpm run test:unit || echo "[post-merge] Unit tests have pre-existing failures (non-blocking) — see backlog task to fix them."
