---
name: Shared walker ignore-dirs
description: Every repo-walking check script must import IGNORED_DIRS from scripts/lib/ignored-dirs.mjs — never declare a local copy.
---

**Rule:** Any `scripts/check-*.mjs` file (or other script) that walks the repository tree must import the shared ignore-dirs set:

```js
import { IGNORED_DIRS } from './lib/ignored-dirs.mjs';
```

No local `IGNORED_DIRS` constant is permitted.

**Why:** `check:runner-step-sync` (part of the fast tier) enforces this contract and fails CI whenever a walker script declares its own private copy of the set. The shared set in `scripts/lib/ignored-dirs.mjs` is the single source of truth for directories to skip (`node_modules`, `dist`, `.git`, `test-results`, `playwright-report`, `coverage`, and any future output dirs).

**How to apply:** When writing a new walker script, add `import { IGNORED_DIRS } from './lib/ignored-dirs.mjs'` at the top and use it wherever you would have written a local constant. Do not add the constant inline or in the script's own module scope — the lint guard will catch it and fail the build.
