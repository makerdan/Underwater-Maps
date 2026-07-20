#!/bin/bash
# check-e2e-user-ids.sh
#
# Guardrail: scan the e2e test suite for hardcoded user-ID string literals.
#
# The only place a raw user-ID literal is allowed is tests/e2e/fixtures.ts,
# where it defines the canonical E2E_USER_ID constant.  Any other occurrence
# in a spec file means a contributor copy-pasted (or invented) a string that
# may diverge from the actual bypass identity used by the fetch patch, causing
# silent auth failures in DELETE / PUT calls.
#
# Two patterns are checked:
#
#   1. A user-ID-shaped string literal on a line that is NOT also setting the
#      "x-e2e-user-id" header key (catches `const TEST_USER_ID = "e2e-user"`
#      and similar standalone constant definitions).
#
#   2. The header key "x-e2e-user-id" followed immediately by a string literal
#      (catches inline hardcoding like `"x-e2e-user-id": "dev-user-bypass"`).
#
# The HTTP header name "x-e2e-user-id" itself is excluded from pattern 1
# because it legitimately contains "-user-" and is never a user-ID value.
#
# Exit 0 — no violations found.
# Exit 1 — at least one hardcoded user-ID string found outside fixtures.ts.

set -euo pipefail

E2E_DIR="tests/e2e"
FIXTURES_FILE="${E2E_DIR}/fixtures.ts"

echo "[check-e2e-user-ids] Scanning ${E2E_DIR} for hardcoded user-ID strings..."

# Pattern 1: quoted strings that look like user-ID values, excluding lines
# that only match because of the "x-e2e-user-id" header key.
HITS_CONST=$(grep -rn --include="*.ts" -E '"[A-Za-z0-9_-]*-user[A-Za-z0-9_-]*"' "${E2E_DIR}" \
  | grep -v "^${FIXTURES_FILE}:" \
  | grep -v '"x-e2e-user-id"' || true)

# Pattern 2: the header key "x-e2e-user-id" assigned any raw string literal
# instead of referencing the E2E_USER_ID constant.  The value regex is
# intentionally broad ([^"]+) so IDs that don't contain "-user" are caught
# (e.g. "bypass_e2e", "testId123").
HITS_INLINE=$(grep -rn --include="*.ts" \
  -E '"x-e2e-user-id"\s*:\s*"[^"]+"' "${E2E_DIR}" \
  | grep -v "^${FIXTURES_FILE}:" || true)

HITS="${HITS_CONST}${HITS_INLINE}"

if [ -n "${HITS}" ]; then
  echo ""
  echo "ERROR: Hardcoded user-ID string literal found in an e2e test file."
  echo "Import and use the E2E_USER_ID constant from fixtures.ts instead:"
  echo ""
  echo "  import { E2E_USER_ID } from \"./fixtures\";"
  echo ""
  echo "Violations:"
  echo "${HITS}"
  echo ""
  exit 1
fi

echo "[check-e2e-user-ids] OK — no hardcoded user-ID strings found."
