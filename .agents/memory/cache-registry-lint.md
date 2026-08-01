---
name: cacheRegistry lint for new lib caches
description: Any api-server lib module with a module-level Map cache must register with cacheRegistry
---
Rule: any new file under artifacts/api-server/src/lib with a module-level `new Map(` cache must import `registerCache` from `./cacheRegistry.js` and call `registerCache(() => cache.clear())` at module init.

**Why:** `src/__tests__/cacheRegistry-lint.test.ts` statically scans lib files and fails otherwise; ensures test isolation helpers can clear all caches.

**How to apply:** when adding any in-memory cache to an api-server lib module; see satelliteTile.ts for the pattern.
