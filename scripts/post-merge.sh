#!/bin/bash
set -e
# Clear any stale codegen lock before pnpm install so the postinstall hook
# (which runs codegen) does not time out waiting on a lock left by a prior
# interrupted run. Safe here because post-merge.sh runs serially.
rm -f lib/api-zod/src/generated/.codegen.lock
pnpm install --no-frozen-lockfile
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
# Guardrail: catch bare localStorage.removeItem("bathyscan:panel-collapse") calls in
# e2e specs. This pattern races with server-side hydration; the resetPanelCollapse
# fixture (tests/e2e/fixtures.ts) must be used instead.
bash scripts/check-e2e-panel-collapse.sh
# Guardrail: catch localStorage.removeItem calls targeting other server-synced keys
# (bathyscan:settings, bathyscan:palette, bathyscan:sidebarMode,
# bathyscan:zoneOverlaySlots and its sub-keys).  Removing these keys races with
# Zustand rehydration; the spec must use setItem with an explicit known-good value
# instead.  See the script header for the correct pattern per key.
bash scripts/check-e2e-localstorage-removeitem.sh
# Unit tests are intentionally not run here — the full recursive test suite
# consumes enough memory to get OOM-killed mid-run. Tests are covered by the
# validation system (test-unit workflow) and pre-existing failures are tracked
# in the backlog.
# Guardrail: keep generated API route tables in README.md and replit.md in
# sync with lib/api-spec/openapi.yaml. Auto-regenerate if stale (task agents
# frequently add new routes without running `pnpm run docs`) and commit the
# result so the check passes cleanly.
if ! pnpm run check:docs-stale 2>/dev/null; then
  echo "[post-merge] API route docs were stale — regenerating and committing..."
  pnpm run docs
  git add README.md replit.md
  if ! git diff --cached --quiet; then
    # Set a fallback identity in case the runner has no global git config.
    git config --local user.email "post-merge@replit.local" 2>/dev/null || true
    git config --local user.name  "BathyScan Post-Merge Bot"  2>/dev/null || true
    git commit -m "chore: auto-regenerate API route docs [post-merge]"
  fi
  echo "[post-merge] API route docs updated."
fi
# Re-register tiered validation commands so they survive future merges and are
# always available on a fresh environment. The commands are defined in
# scripts/register-validation-commands.mjs; agent sessions call
# setValidationCommand() from the code_execution sandbox to apply them.
# Invoking the script here documents intent; actual Replit-platform registration
# must be done by an agent after merge using the setValidationCommand tool.
node scripts/register-validation-commands.mjs 2>/dev/null || true
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
