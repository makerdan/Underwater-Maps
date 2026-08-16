---
name: survey.laz fixture goes stale nondeterministically
description: check:fixture-freshness intermittently flags survey.laz; root cause fixed by switching to size-only comparison.
---

The LAZ writer (laspy + lazrs/Rust LASzip) does not produce byte-identical output across environments/runs even for identical input, so `check:fixture-freshness` used to flag `survey.laz` as STALE (hash mismatch, same byte count) with no code change. This has recurred at least twice.

**Why:** LAZ compression embeds environment-dependent bytes (version strings, internal state); hash comparison is stricter than the semantic content. File *size* IS stable for the same input, so size-only is the right gate.

**Fix applied:** `check-fixture-freshness.sh` now treats `.laz` with size-only comparison (same as `.bag`/HDF5). The branch condition is `[ "$ext" = "bag" ] || [ "$ext" = "laz" ]`. Header comment updated accordingly.

**How to apply:** If `survey.laz` is flagged as STALE by a *size* mismatch (not just hash), the generator input changed — run `pnpm --filter @workspace/api-server run fixtures:regen`, then `git checkout --` the `.bag` files and commit only the `.laz`.
