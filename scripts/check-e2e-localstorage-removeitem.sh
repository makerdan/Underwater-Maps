#!/bin/bash
# check-e2e-localstorage-removeitem.sh
#
# Guardrail: scan e2e spec files for bare localStorage.removeItem calls
# targeting server-synced localStorage keys.
#
# Why this matters:
#   localStorage.removeItem on a server-synced key leaves that key undefined.
#   If the Zustand persist middleware rehydrates (or the server sync hook runs)
#   before the spec's next assertion, the store falls back to in-memory defaults
#   rather than the explicit state the test set up — producing spurious failures
#   that are hard to reproduce locally.
#
#   The safe pattern for each key type is:
#
#   bathyscan:palette
#     Write a known default state instead of removing:
#       localStorage.setItem("bathyscan:palette",
#         JSON.stringify({ state: { shallow: "#00e5ff", deep: "#283593" }, version: 1 }));
#
#   bathyscan:settings
#     Do NOT clear the key locally.  The resetSettings fixture (tests/e2e/fixtures.ts)
#     resets server state via PUT /api/settings; server hydration propagates the
#     correct values when the page mounts.  Any fields that need a specific local
#     value should be patched inside the JSON (see suppressOnboarding fixture).
#
#   bathyscan:sidebarMode
#     Write an explicit value instead of removing:
#       localStorage.setItem("bathyscan:sidebarMode",
#         JSON.stringify({ state: { mode: "explore" }, version: 0 }));
#
#   bathyscan:zoneOverlaySlots  /  :saltwater  /  :freshwater
#     Write the default slot array instead of removing:
#       const DEFAULT_ZONE_SLOTS = [
#         { color: "#f5d58a", visible: true },
#         { color: "#c49a6c", visible: true },
#         { color: "#8ab4d0", visible: true },
#         { color: "#b06060", visible: true },
#       ];
#       localStorage.setItem("bathyscan:zoneOverlaySlots:saltwater",
#         JSON.stringify(DEFAULT_ZONE_SLOTS));
#       localStorage.setItem("bathyscan:zoneOverlaySlots:freshwater",
#         JSON.stringify(DEFAULT_ZONE_SLOTS));
#
# Scope:
#   Only *.spec.ts files under tests/e2e/ are checked.  fixtures.ts is the
#   canonical home of reset helpers and is excluded.
#
# Pattern coverage:
#   Uses ripgrep --multiline so both single-line and argument-wrapped forms are
#   caught, e.g.:
#     localStorage.removeItem("bathyscan:settings");                // caught
#     localStorage.removeItem(                                       // caught
#       "bathyscan:settings"
#     );
#
# Exit 0 — no violations found.
# Exit 1 — at least one removeItem targeting a server-synced key found in a spec.

set -euo pipefail

E2E_DIR="tests/e2e"
FIXTURES_FILE="${E2E_DIR}/fixtures.ts"

# Keys whose removeItem is dangerous because they are server-synced.
# Each alternation arm is the key literal (quotes handled by the outer regex).
DANGEROUS_KEYS='bathyscan:settings|bathyscan:palette|bathyscan:sidebarMode|bathyscan:zoneOverlaySlots(?::(?:saltwater|freshwater))?'

echo "[check-e2e-localstorage-removeitem] Scanning ${E2E_DIR}/**/*.spec.ts for removeItem(<server-synced key>) calls..."

HITS=$(rg --multiline \
  --glob "*.spec.ts" \
  --glob "!${FIXTURES_FILE}" \
  --line-number \
  "localStorage\\.removeItem\\(\\s*[\"'](?:${DANGEROUS_KEYS})[\"']\\s*\\)" \
  "${E2E_DIR}" || true)

if [ -n "${HITS}" ]; then
  echo ""
  echo "ERROR: localStorage.removeItem(<server-synced key>) found in an e2e spec."
  echo ""
  echo "Removing a server-synced key races with Zustand rehydration and server"
  echo "settings sync — the store may fall back to stale defaults mid-test."
  echo ""
  echo "Use setItem with an explicit known-good value instead of removeItem."
  echo "See the script header for the correct pattern for each key."
  echo ""
  echo "For bathyscan:settings specifically: do NOT clear the key at all —"
  echo "rely on the resetSettings fixture (PUT /api/settings) and patch only"
  echo "the fields you need via addInitScript JSON patching."
  echo ""
  echo "Violations:"
  echo "${HITS}"
  echo ""
  exit 1
fi

echo "[check-e2e-localstorage-removeitem] OK — no removeItem(<server-synced key>) calls found in specs."
