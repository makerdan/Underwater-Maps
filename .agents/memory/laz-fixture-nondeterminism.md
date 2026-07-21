---
name: survey.laz fixture goes stale nondeterministically
description: check:fixture-freshness intermittently flags survey.laz; regenerate via fixtures:regen but only commit the .laz.
---

The LAZ writer used by the api-server fixture generator does not produce byte-identical output across environments/runs even at identical size, so `check:fixture-freshness` can flag `survey.laz` as STALE (hash mismatch, same byte count) with no code change. This has recurred at least twice.

**Why:** LAZ compression embeds environment-dependent bytes; hash comparison is stricter than the semantic content.

**How to apply:** When only `survey.laz` is flagged, run `pnpm --filter @workspace/api-server run fixtures:regen`, then `git checkout --` the `.bag` files it also rewrites (their check is size-based and they stay OK) and commit only the regenerated `.laz`. Verify with the freshness script plus the laz-decompress/parser-cross-format tests.
