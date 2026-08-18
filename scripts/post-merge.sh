#!/bin/bash
set -e
# Clear any stale codegen lock before pnpm install so the postinstall hook
# (which runs codegen) does not time out waiting on a lock left by a prior
# interrupted run. Safe here because post-merge.sh runs serially.
rm -f lib/api-zod/src/generated/.codegen.lock
# Install Python image-processing packages required by raster_contour.py.
# Uses bare `pip` + PYTHONUSERBASE=.pythonlibs per Nix pip convention (python3 -m pip
# and uv both fail against the read-only Nix store).
PYTHONUSERBASE=.pythonlibs pip install opencv-python-headless pytesseract Pillow --quiet
pnpm install --no-frozen-lockfile
# Regenerate the API client from openapi.yaml. `pnpm install` already triggers
# the workspace `postinstall` hook which runs this, but we invoke it explicitly
# here so a merge that only changes openapi.yaml (no dependency changes) still
# refreshes the generated files.
pnpm --filter @workspace/api-spec run codegen:generate
# Push the Drizzle schema to the dev database.
#
# WHY push, not migrate:
#   The dev DB has an empty __drizzle_migrations table (no migration history),
#   so `drizzle-kit migrate` always fails with "no migrations to apply" or a
#   journal mismatch.  `drizzle-kit push` is the only viable path in this
#   environment.
#
# KNOWN LIMITATION — column type changes require a manual pre-step:
#   drizzle-kit push generates bare:
#     ALTER TABLE … ALTER COLUMN … SET DATA TYPE <new_type>
#   without a USING clause.  When the column contains values that Postgres
#   cannot implicitly cast (e.g. text slugs being changed to uuid), the push
#   fails at runtime with "ERROR: column … cannot be cast automatically to
#   type uuid".
#
#   This happened for gps_trails.dataset_id (text → uuid) and WILL recur for
#   any future column type change of the same kind.
#
#   The pre-push-type-check.mjs script below now catches this automatically
#   before the push runs.  If it fires, follow the instructions it prints to
#   clean up the non-castable rows, then re-run post-merge.sh.
# Pre-flight DB connectivity check (5 s).  If the database is unreachable
# (platform outage, cold start, etc.) skip the drizzle push entirely so
# typecheck/lint can still complete and post-merge does not hang for 120 s.
# The push is non-critical for code-correctness checks; re-run post-merge.sh
# manually once Postgres is available.
_db_ping() {
  pnpm --filter @workspace/db exec node -e "
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 4000 });
    p.query('SELECT 1').then(() => { p.end(); process.exit(0); }).catch(() => { p.end(); process.exit(1); });
  " 2>/dev/null
}
if timeout 5 bash -c "$(declare -f _db_ping); _db_ping"; then
  # Pre-push guardrail: detect column-type changes that Postgres cannot
  # implicitly cast (no USING clause) and abort before the push runs.
  pnpm --filter @workspace/db exec node ../../scripts/pre-push-type-check.mjs
  echo y | timeout 120 pnpm --filter db push || { EC=$?; [ $EC -eq 124 ] && echo "[post-merge] ERROR: drizzle push timed out after 120 s — check for Postgres locks or stalled migrations"; exit $EC; }
else
  echo "[post-merge] WARNING: database unreachable (5 s ping timed out) — skipping drizzle push. Re-run post-merge.sh manually once Postgres is available."
fi
# Guardrail: surface typecheck/lint regressions immediately after a merge.
# Unit tests are run separately (non-blocking) because there are known
# pre-existing failures tracked in the backlog ("Stop the two pre-existing
# unit-test failures from blocking CI"). Running them here with || true
# surfaces the output without failing the post-merge setup.
pnpm run typecheck && pnpm run lint
# Scheduled bbox drift audit — runs after every merge so drift is caught
# automatically rather than only when someone remembers to run the script.
# Requires a live DATABASE_URL (available here because the schema push above
# already connected).  AUDIT_MARKER_BBOX_ENABLED=1 activates the audit;
# without it the script exits 0 immediately (graceful no-op for offline runs).
# Exit 1 when any marker falls outside its dataset's bbox or references a
# deleted dataset — the merge completes but the output surfaces the drift.
AUDIT_MARKER_BBOX_ENABLED=1 pnpm --filter @workspace/db audit:marker-bbox -- --ci || \
  echo "[post-merge] WARNING: bbox audit found drift — run 'pnpm --filter @workspace/db audit:marker-bbox -- --fix' to clear stale dataset_id references."
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
# Guardrail: reject a .replit that adds workflow.run tasks to the run-button
# workflow, which would launch a boot storm on every environment restart.
# This check runs after the merge has landed so any agent-written .replit
# replacement is evaluated before the environment restarts and fires it.
node scripts/check-runbutton-noop.mjs
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
# Guardrail: keep artifacts/bathyscan/public/failure-gate-skill.zip in sync
# with .agents/skills/failure-gate/SKILL.md. Auto-regenerate if stale and
# commit the result so the check:failure-gate-zip step passes cleanly.
if ! node scripts/check-failure-gate-zip-stale.mjs 2>/dev/null; then
  echo "[post-merge] failure-gate-skill.zip was stale — regenerating and committing..."
  (cd .agents/skills && zip ../../artifacts/bathyscan/public/failure-gate-skill.zip failure-gate/SKILL.md)
  git add artifacts/bathyscan/public/failure-gate-skill.zip
  if ! git diff --cached --quiet; then
    # Set a fallback identity in case the runner has no global git config.
    git config --local user.email "post-merge@replit.local" 2>/dev/null || true
    git config --local user.name  "BathyScan Post-Merge Bot"  2>/dev/null || true
    git commit -m "chore: sync failure-gate-skill.zip with SKILL.md [post-merge]"
  fi
  echo "[post-merge] failure-gate-skill.zip updated."
fi
# Guardrail: keep artifacts/bathyscan/public/poe-setup-skill.zip in sync
# with .agents/skills/poe-setup/SKILL.md. Auto-regenerate if stale and
# commit the result so the check:poe-setup-zip step passes cleanly.
# Skip entirely if the zip has not yet been published.
if [ -f "artifacts/bathyscan/public/poe-setup-skill.zip" ]; then
  if ! node scripts/check-poe-setup-zip-stale.mjs 2>/dev/null; then
    echo "[post-merge] poe-setup-skill.zip was stale — regenerating and committing..."
    (cd .agents/skills && zip ../../artifacts/bathyscan/public/poe-setup-skill.zip poe-setup/SKILL.md)
    git add artifacts/bathyscan/public/poe-setup-skill.zip
    if ! git diff --cached --quiet; then
      # Set a fallback identity in case the runner has no global git config.
      git config --local user.email "post-merge@replit.local" 2>/dev/null || true
      git config --local user.name  "BathyScan Post-Merge Bot"  2>/dev/null || true
      git commit -m "chore: sync poe-setup-skill.zip with SKILL.md [post-merge]"
    fi
    echo "[post-merge] poe-setup-skill.zip updated."
  fi
fi
# Guardrail: keep artifacts/bathyscan/public/port-authority-skill.zip in sync
# with .agents/skills/Port-Authority/SKILL.md. Auto-regenerate if stale and
# commit the result so the check:port-authority-zip step passes cleanly.
# Skip entirely if the zip has not yet been published.
if [ -f "artifacts/bathyscan/public/port-authority-skill.zip" ]; then
  if ! node scripts/check-port-authority-zip-stale.mjs 2>/dev/null; then
    echo "[post-merge] port-authority-skill.zip was stale — regenerating and committing..."
    (cd .agents/skills && zip ../../artifacts/bathyscan/public/port-authority-skill.zip Port-Authority/SKILL.md)
    git add artifacts/bathyscan/public/port-authority-skill.zip
    if ! git diff --cached --quiet; then
      # Set a fallback identity in case the runner has no global git config.
      git config --local user.email "post-merge@replit.local" 2>/dev/null || true
      git config --local user.name  "BathyScan Post-Merge Bot"  2>/dev/null || true
      git commit -m "chore: sync port-authority-skill.zip with SKILL.md [post-merge]"
    fi
    echo "[post-merge] port-authority-skill.zip updated."
  fi
fi
# Guardrail: keep artifacts/bathyscan/public/port-authority-heavy-skill.zip in sync
# with .agents/skills/Port-Authority-Heavy/SKILL.md. Auto-regenerate if stale and
# commit the result so the check:port-authority-heavy-zip step passes cleanly.
# Skip entirely if the zip has not yet been published.
if [ -f "artifacts/bathyscan/public/port-authority-heavy-skill.zip" ]; then
  if ! node scripts/check-port-authority-heavy-zip-stale.mjs 2>/dev/null; then
    echo "[post-merge] port-authority-heavy-skill.zip was stale — regenerating and committing..."
    (cd .agents/skills && zip ../../artifacts/bathyscan/public/port-authority-heavy-skill.zip Port-Authority-Heavy/SKILL.md)
    git add artifacts/bathyscan/public/port-authority-heavy-skill.zip
    if ! git diff --cached --quiet; then
      # Set a fallback identity in case the runner has no global git config.
      git config --local user.email "post-merge@replit.local" 2>/dev/null || true
      git config --local user.name  "BathyScan Post-Merge Bot"  2>/dev/null || true
      git commit -m "chore: sync port-authority-heavy-skill.zip with SKILL.md [post-merge]"
    fi
    echo "[post-merge] port-authority-heavy-skill.zip updated."
  fi
fi
# Guardrail: keep .local/custom_skills/<name>/SKILL.md in sync with the
# canonical .agents/skills/<name>/SKILL.md for every skill that already has a
# live-copy directory. .local/ is gitignored so git never updates these copies;
# this block re-copies and re-fingerprints them after every merge so agents
# always read the current instructions.
if [ -d ".local/custom_skills" ]; then
  _synced=0
  for canonical_dir in .agents/skills/*/; do
    skill_name="$(basename "$canonical_dir")"
    canonical_skill="$canonical_dir/SKILL.md"
    [ -f "$canonical_skill" ] || continue

    # Match case-insensitively: local dir names may differ in casing.
    local_dir=""
    for candidate in .local/custom_skills/*/; do
      candidate_name="$(basename "$candidate")"
      if [ "$(echo "$candidate_name" | tr '[:upper:]' '[:lower:]')" = "$(echo "$skill_name" | tr '[:upper:]' '[:lower:]')" ]; then
        local_dir="$candidate"
        break
      fi
    done
    [ -n "$local_dir" ] || continue

    cp "$canonical_skill" "${local_dir}SKILL.md"
    md5sum "$canonical_skill" | awk '{print $1}' > "${local_dir}.fingerprint"
    _synced=$((_synced + 1))
  done
  echo "[post-merge] Skill mirror sync: updated ${_synced} local custom_skills copy/copies."
else
  echo "[post-merge] .local/custom_skills/ not found — skipping skill mirror sync (normal in fresh CI)."
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
  # Disable LFS lock verification inline (-c flag, no .git/config mutation):
  # the GitHub remote does not support the Git LFS locking API and returns
  # "Fatal error: Unable to verify locks" without this flag.
  # Retry a few times: concurrent post-merge runs can race on the remote ref
  # ("cannot lock ref ... but expected ..."), which succeeds on retry.
  # A mirror-push failure must not fail the whole setup — the mirror is a
  # convenience copy, and the next merge will force-push the current state.
  mirror_pushed=0
  for attempt in 1 2 3; do
    if git -c lfs.locksverify=false push --force "https://x-access-token:${GITHUB_TOKEN}@${GITHUB_REPO_URL#https://}" HEAD:main; then
      mirror_pushed=1
      break
    fi
    echo "[post-merge] mirror push attempt ${attempt} failed — retrying in 3s…"
    sleep 3
  done
  if [ "${mirror_pushed}" = "1" ]; then
    echo "[post-merge] GitHub mirror up to date."
  else
    echo "[post-merge] WARNING: GitHub mirror push failed after 3 attempts — continuing (next merge will retry)."
  fi
else
  echo "[post-merge] GITHUB_TOKEN or GITHUB_REPO_URL not set — skipping GitHub sync."
fi
