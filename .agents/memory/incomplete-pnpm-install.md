---
name: Incomplete pnpm install diagnosis
description: How to treat missing test tools that are correctly declared in workspace manifests and the lockfile.
---

**Rule:** If a declared test dependency is missing from a workspace package, confirm the link in an isolated frozen-lockfile install before changing dependency declarations. Stop validation with an actionable install instruction rather than repairing links inside the validation runner.

**Why:** Validation can run alongside other jobs, so invoking an install from the runner would mutate shared node_modules during their work.

**How to apply:** Distinguish a broken or missing package link from a missing declaration; perform the install through normal setup and use validation only after links resolve.