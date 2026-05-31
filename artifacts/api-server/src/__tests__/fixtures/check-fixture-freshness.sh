#!/usr/bin/env bash
# check-fixture-freshness.sh
#
# Verifies that the committed fixture files are in sync with generate.mjs.
#
# Strategy
# --------
#   1. Copy committed fixtures to a temp directory (no git required).
#   2. Run `node generate.mjs` in-place (it hard-codes its own dir as output).
#   3. Compare fresh output against the temp copy:
#        - SHA256 checksum for deterministic formats (TIF, NC, LAS, LAZ, GPX, NMEA)
#        - File size only for BAG/HDF5 (h5wasm embeds wall-clock timestamps in
#          object headers, making checksums non-deterministic across runs)
#   4. Scan the fixture directory for any NEW files not in the expected set —
#      catches generator additions that haven't been committed yet.
#   5. Restore committed fixtures from the temp copy (works without git).
#      A `trap` on EXIT guarantees restoration even on generator failure.
#
# Usage (from repo root):
#   bash artifacts/api-server/src/__tests__/fixtures/check-fixture-freshness.sh

set -euo pipefail

FIXTURE_DIR="artifacts/api-server/src/__tests__/fixtures"
GENERATOR="$FIXTURE_DIR/generate.mjs"

# Authoritative list — must be kept in sync with generate.mjs main().
FIXTURES=(
  survey.tif
  survey.nc
  survey_1_2.las
  survey_1_4.las
  survey.bag
  survey.laz
  survey.gpx
  survey.nmea
)

# ── Step 1: Copy committed fixtures to temp dir; set up restoration trap ────
TMPDIR_BACKUP=$(mktemp -d)
trap 'cp "$TMPDIR_BACKUP"/* "$FIXTURE_DIR/" 2>/dev/null; rm -rf "$TMPDIR_BACKUP"' EXIT

for f in "${FIXTURES[@]}"; do
  path="$FIXTURE_DIR/$f"
  if [ ! -f "$path" ]; then
    echo "ERROR: committed fixture missing: $path"
    exit 1
  fi
  cp "$path" "$TMPDIR_BACKUP/$f"
done

# ── Step 2: Regenerate fixtures in-place ────────────────────────────────────
echo "Running generate.mjs …"
node "$GENERATOR"
echo ""

# ── Step 3: Compare fresh output against committed copies ───────────────────
FAILED=0
STALE_FILES=()

for f in "${FIXTURES[@]}"; do
  committed="$TMPDIR_BACKUP/$f"
  generated="$FIXTURE_DIR/$f"

  COMMITTED_SUM=$(sha256sum "$committed" | awk '{print $1}')
  COMMITTED_SIZE=$(stat -c%s "$committed")
  FRESH_SUM=$(sha256sum "$generated" | awk '{print $1}')
  FRESH_SIZE=$(stat -c%s "$generated")

  ext="${f##*.}"

  if [ "$ext" = "bag" ]; then
    # HDF5 timestamps make checksums non-deterministic; compare sizes only.
    if [ "$FRESH_SIZE" -ne "$COMMITTED_SIZE" ]; then
      printf "  STALE  %-22s  committed %d B  ≠  generated %d B  (size mismatch)\n" \
        "$f" "$COMMITTED_SIZE" "$FRESH_SIZE"
      STALE_FILES+=("$f")
      FAILED=1
    else
      printf "  ok     %-22s  %d B  (size match; HDF5 timestamps excluded)\n" \
        "$f" "$FRESH_SIZE"
    fi
  else
    if [ "$FRESH_SUM" != "$COMMITTED_SUM" ]; then
      printf "  STALE  %-22s  committed %d B (%.8s…)  ≠  generated %d B (%.8s…)\n" \
        "$f" "$COMMITTED_SIZE" "$COMMITTED_SUM" "$FRESH_SIZE" "$FRESH_SUM"
      STALE_FILES+=("$f")
      FAILED=1
    else
      printf "  ok     %-22s  %d B\n" "$f" "$FRESH_SIZE"
    fi
  fi
done

# ── Step 4: Detect extra files produced by the generator but not committed ──
# Exclude the generator script, this check script, and any dot-files.
EXPECTED_SET=" ${FIXTURES[*]} "
EXTRA_FILES=()
while IFS= read -r -d '' generated_file; do
  base=$(basename "$generated_file")
  # Skip non-data files
  case "$base" in
    *.sh|*.mjs|.*) continue ;;
  esac
  if [[ "$EXPECTED_SET" != *" $base "* ]]; then
    echo "  EXTRA  $base  (generated but not committed — add to FIXTURES list and commit)"
    EXTRA_FILES+=("$base")
    FAILED=1
  fi
done < <(find "$FIXTURE_DIR" -maxdepth 1 -type f -print0)

# ── Step 5: Restore (trap handles the actual copy; just report) ─────────────
echo ""
echo "Restoring committed fixtures …"
# trap EXIT will fire here (or on error above), copying backup → fixture dir.

if [ "$FAILED" -ne 0 ]; then
  echo ""
  if [ "${#STALE_FILES[@]}" -gt 0 ]; then
    echo "FAIL: ${#STALE_FILES[@]} fixture file(s) are out of date with generate.mjs:"
    for f in "${STALE_FILES[@]}"; do
      echo "  $FIXTURE_DIR/$f"
    done
  fi
  if [ "${#EXTRA_FILES[@]}" -gt 0 ]; then
    echo "FAIL: ${#EXTRA_FILES[@]} file(s) produced by generate.mjs are not committed:"
    for f in "${EXTRA_FILES[@]}"; do
      echo "  $FIXTURE_DIR/$f"
    done
    echo "  Add them to the FIXTURES list in this script and commit them."
  fi
  echo ""
  echo "To fix stale fixtures, re-run the generator and commit the results:"
  echo "  node $GENERATOR"
  echo "  git add $FIXTURE_DIR/"
  echo "  git commit -m 'chore: regenerate fixtures'"
  exit 1
fi

echo "All fixture files are up to date with generate.mjs."
