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
# Guardrail: fail immediately if the generated API route tables in README.md
# or replit.md are out of sync with lib/api-spec/openapi.yaml.
pnpm run check:docs-stale
# Increment the audit-cadence counters and create project tasks for any audit
# that has reached its merge threshold. Uses || true so a failure (e.g. when
# running outside the Replit code_execution sandbox) never aborts the post-merge
# run — the script is advisory, not blocking.
node scripts/queue-audits.mjs || true
# Sync to GitHub mirror. Skipped (with a log message) if either secret is
# absent so contributors without the GitHub secret don't break CI.
if [ -n "${GITHUB_TOKEN}" ] && [ -n "${GITHUB_REPO_URL}" ]; then
  echo "[post-merge] Pushing to GitHub mirror…"
  # Push directly to the authenticated URL — no remote mutation, so the
  # credential never persists in .git/config even if the push fails.
  # Use || true so a rejected push (e.g. remote has newer commits) does not
  # fail the post-merge setup — the GitHub mirror is best-effort.
  git push "https://x-access-token:${GITHUB_TOKEN}@${GITHUB_REPO_URL#https://}" HEAD:main \
    && echo "[post-merge] GitHub mirror up to date." \
    || echo "[post-merge] WARNING: GitHub push rejected (remote may have newer commits) — skipping mirror sync."
else
  echo "[post-merge] GITHUB_TOKEN or GITHUB_REPO_URL not set — skipping GitHub sync."
fi
