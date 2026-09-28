---
name: Isolated task checkout freshness
description: How to recognize when recently merged fixes have not reached an active task workspace.
---

An active task checkout may lag behind the project's main branch even when the corresponding tasks show as merged.

**Why:** A task retry still hit an expired validation record after its separate repair had merged; the local checkout had diverged from `main-repl/main`, which already contained the repair.

**How to apply:** When merged work appears absent, compare the checkout and `main-repl/main` ancestry and inspect the specific files first. If the workspace is clean, sync the merged main branch rather than duplicating its fixes in the task. Treat unrelated validation failures introduced by that sync as separate work.