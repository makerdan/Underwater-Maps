#!/bin/bash
# check-e2e-cjs-globals.sh
#
# Guardrail: scan the e2e test suite for CJS globals that are invalid in ESM.
#
# Playwright compiles tests/e2e/*.ts files in an ESM context.  Using CJS
# globals (__dirname, __filename, require) causes the E2E server build to
# fail silently or produce a broken bundle.  The safe replacements are:
#
#   __dirname  →  path.dirname(new URL(import.meta.url).pathname)
#                 OR process.cwd() when invoked from the repo root
#   __filename →  new URL(import.meta.url).pathname
#   require(…) →  await import(…)
#
# Pattern scope:
#   __dirname   — any non-comment use of the identifier
#   __filename  — any non-comment use of the identifier
#   require(    — any non-comment call to the CJS require function
#
# Lines whose first non-whitespace characters are // are excluded: a comment
# that *mentions* __dirname (e.g. "// Avoid __dirname here") is not a violation.
#
# Exit 0 — no violations found.
# Exit 1 — at least one CJS global found in tests/e2e/**/*.ts.

set -euo pipefail

E2E_DIR="tests/e2e"

echo "[check-e2e-cjs-globals] Scanning ${E2E_DIR} for CJS globals (__dirname, __filename, require)..."

# grep for any of the three patterns, then strip out comment-only lines
# (lines where the first non-whitespace characters are //).
# grep -rn output format: "path/to/file.ts:42:  <content>"
# The ERE filter below matches that prefix and discards lines whose content
# starts with optional POSIX whitespace followed by //.
HITS=$(grep -rn --include="*.ts" -E '__dirname|__filename|require\(' "${E2E_DIR}" \
  | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*//' \
  || true)

if [ -n "${HITS}" ]; then
  echo ""
  echo "ERROR: CJS global(s) found in an e2e test file."
  echo "These identifiers are undefined in ESM and will break the Playwright build."
  echo ""
  echo "Replacements:"
  echo "  __dirname   →  path.dirname(new URL(import.meta.url).pathname)"
  echo "                 OR process.cwd() when called from the repo root"
  echo "  __filename  →  new URL(import.meta.url).pathname"
  echo "  require(…)  →  await import(…)"
  echo ""
  echo "Violations:"
  echo "${HITS}"
  echo ""
  exit 1
fi

echo "[check-e2e-cjs-globals] OK — no CJS globals found in ${E2E_DIR}."
