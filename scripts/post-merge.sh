#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Regenerate the API client from openapi.yaml. `pnpm install` already triggers
# the workspace `postinstall` hook which runs this, but we invoke it explicitly
# here so a merge that only changes openapi.yaml (no dependency changes) still
# refreshes the generated files.
pnpm --filter @workspace/api-spec run codegen:generate
pnpm --filter db push
# Guardrail: surface typecheck/lint/unit-test regressions immediately after a merge.
pnpm run test-all
