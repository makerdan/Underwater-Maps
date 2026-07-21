---
name: ESLint flat config has no core rules by default
description: Root eslint.config.mjs enables rules explicitly; core rules like no-dupe-keys are off unless listed.
---
The workspace `eslint.config.mjs` does not extend `js.configs.recommended`, so **no core ESLint rules are active unless explicitly listed** in a rules block.

**Why:** Two overlapping test-repair merges both added the same stub keys to `vi.mock` factories; the duplicate keys sailed through lint and only failed as TS1117 deep in typecheck, blocking every validation tier. `no-dupe-keys` is now explicitly enabled for `artifacts/{bathyscan,api-server}/src`.

**How to apply:** When you want a "standard" ESLint guarantee (no-dupe-keys, no-unreachable, etc.), check it's actually listed in eslint.config.mjs — don't assume recommended defaults exist.
