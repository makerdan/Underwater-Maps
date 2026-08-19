---
name: PWA bundle guard stale output
description: How preserved dist/public files can create false oversized-chunk failures in the production bundle guard.
---

The production bundle guard can report an oversized hashed asset that was not emitted by the current build. The test's programmatic build preserves `dist/public`, and Workbox scans that directory when producing the precache manifest.

**Why:** An obsolete 4.26 MiB entry file caused the full standard tier and three isolated retries to fail, while the current branch and baseline each emitted an approximately 1.44 MiB entry and passed from a clean output directory.

**How to apply:** When the guard names an unexpected hash, compare it with the current emitted entry and inspect ignored build output before changing chunking or cache limits. Clear only generated `dist/public` output, then rerun the same guard and validation tier.