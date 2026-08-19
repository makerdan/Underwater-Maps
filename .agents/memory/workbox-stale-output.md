---
name: Workbox stale output scanning
description: Why an old generated asset can make injectManifest reject a current build whose emitted chunks are all below the limit.
---

Workbox `injectManifest` applies its size limit to every file matched in the
output directory, including files left by earlier builds. A current Rollup
result can therefore report only sub-limit chunks while Workbox rejects an old,
oversized hashed asset that is still present on disk.

**Why:** A production bundle guard appeared to prove that the current entry was
over the default limit. Inspecting Rollup output showed the current entry was
below the limit; file timestamps exposed an older hashed entry that Workbox was
also scanning.

**How to apply:** When Workbox names an asset that is absent from the current
Rollup output, compare its timestamp/hash with the current build and clear
generated output before diagnosing chunking. Tests that preserve output need
their own isolated or freshly cleaned destination.