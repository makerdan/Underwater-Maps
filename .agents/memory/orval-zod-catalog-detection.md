---
name: Orval Zod catalog detection
description: Generator upgrades need an explicit Zod version when the workspace uses a catalog specifier.
---

Orval's Zod generator may infer the wrong major version when the output package declares `zod` through the pnpm workspace catalog. Pin the generator's Zod output version to the installed Zod major instead of relying on automatic inference.

**Why:** A patched Orval release generated Zod 4-only `uuid` and `looseObject` calls against the project's Zod 3 dependency, even though generation succeeded; only downstream TypeScript caught the incompatibility.

**How to apply:** During generator upgrades, check the installed Zod major, inspect the generated runtime calls, then build shared declarations and consumers after regeneration.