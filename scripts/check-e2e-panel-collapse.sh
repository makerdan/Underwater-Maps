#!/bin/bash
# check-e2e-panel-collapse.sh
#
# Guardrail: scan the e2e spec files for bare localStorage.removeItem calls
# targeting the "bathyscan:panel-collapse" key.
#
# Removing the key races with server-side hydration and only clears the
# local value — it does NOT actively force all panels open.  The correct
# approach is the `resetPanelCollapse` fixture defined in fixtures.ts, which
# writes an explicit all-open payload and waits for the page to confirm it.
#
# Why this matters:
#   localStorage.removeItem("bathyscan:panel-collapse") leaves the panel state
#   undefined.  If the server returns a collapsed payload before the next render
#   the panels stay collapsed, causing the test to fail for an unrelated reason.
#   The resetPanelCollapse fixture avoids this race entirely.
#
# Usage in a spec:
#   test.beforeEach(async ({ resetPanelCollapse }) => { void resetPanelCollapse; });
#
# Scope:
#   Only *.spec.ts files under tests/e2e/ are checked.  fixtures.ts is the
#   canonical home of panel-collapse helpers and is excluded.
#
# Pattern coverage:
#   Uses ripgrep --multiline so both single-line and argument-wrapped forms are
#   caught, e.g.:
#     localStorage.removeItem("bathyscan:panel-collapse");         // caught
#     localStorage.removeItem(                                      // caught
#       "bathyscan:panel-collapse"
#     );
#
# Exit 0 — no violations found.
# Exit 1 — at least one removeItem("bathyscan:panel-collapse") found in a spec.

set -euo pipefail

E2E_DIR="tests/e2e"
FIXTURES_FILE="${E2E_DIR}/fixtures.ts"

echo "[check-e2e-panel-collapse] Scanning ${E2E_DIR}/**/*.spec.ts for removeItem(\"bathyscan:panel-collapse\") calls..."

# Use ripgrep with --multiline so split-argument forms are also caught.
# -l lists matching files first; we then re-run with line numbers for the report.
HITS=$(rg --multiline \
  --glob "*.spec.ts" \
  --glob "!${FIXTURES_FILE}" \
  --line-number \
  'localStorage\.removeItem\(\s*["\x27]bathyscan:panel-collapse["\x27]\s*\)' \
  "${E2E_DIR}" || true)

if [ -n "${HITS}" ]; then
  echo ""
  echo "ERROR: localStorage.removeItem(\"bathyscan:panel-collapse\") found in an e2e spec."
  echo "This pattern races with server-side hydration and silently leaves panels collapsed."
  echo ""
  echo "Use the resetPanelCollapse fixture instead:"
  echo ""
  echo "  test.beforeEach(async ({ resetPanelCollapse }) => { void resetPanelCollapse; });"
  echo ""
  echo "The fixture writes an explicit all-open payload and waits for confirmation."
  echo "See tests/e2e/fixtures.ts for details."
  echo ""
  echo "Violations:"
  echo "${HITS}"
  echo ""
  exit 1
fi

echo "[check-e2e-panel-collapse] OK — no bare removeItem(\"bathyscan:panel-collapse\") calls found in specs."
