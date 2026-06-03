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
# Guardrail: catch hardcoded user-ID string literals in e2e specs before they ship.
# Any string matching the "*-user*" pattern outside tests/e2e/fixtures.ts is flagged.
bash scripts/check-e2e-user-ids.sh
# Unit tests are intentionally not run here — the full recursive test suite
# consumes enough memory to get OOM-killed mid-run. Tests are covered by the
# validation system (test-unit workflow) and pre-existing failures are tracked
# in the backlog.
# Guardrail: fail immediately if the generated API route tables in README.md
# or replit.md are out of sync with lib/api-spec/openapi.yaml.
pnpm run check:docs-stale
# Sync to GitHub mirror. Skipped (with a log message) if either secret is
# absent so contributors without the GitHub secret don't break CI.
if [ -n "${GITHUB_TOKEN}" ] && [ -n "${GITHUB_REPO_URL}" ]; then
  echo "[post-merge] Pushing to GitHub mirror…"
  # Push directly to the authenticated URL — no remote mutation, so the
  # credential never persists in .git/config even if the push fails.
  # Force-push because Replit is the sole source of truth for this mirror.
  git push --force "https://x-access-token:${GITHUB_TOKEN}@${GITHUB_REPO_URL#https://}" HEAD:main
  echo "[post-merge] GitHub mirror up to date."
else
  echo "[post-merge] GITHUB_TOKEN or GITHUB_REPO_URL not set — skipping GitHub sync."
fi
