---
name: ESLint flat config has no core rules by default
description: Root eslint.config.mjs enables rules explicitly; only no-dupe-keys is on workspace-wide.
---
The workspace `eslint.config.mjs` does not extend `js.configs.recommended`, so **no core ESLint rules are active unless explicitly listed** in a rules block.

**Why:** Two overlapping test-repair merges both added the same stub keys to `vi.mock` factories; the duplicate keys sailed through lint and only failed as TS1117 deep in typecheck, blocking every validation tier.

**How to apply:** `no-dupe-keys` is now enforced workspace-wide (all ts/tsx/js/mjs in artifacts, lib, scripts, tests) via catch-all blocks in eslint.config.mjs, and the root `lint` script covers those trees. Other "standard" ESLint guarantees (no-unreachable etc.) are still OFF unless explicitly listed — don't assume recommended defaults exist. Build-output dirs must be in the top ignores block (dist, dist-*, build, coverage) or eslint lints bundled output and errors on unknown inline directives.
