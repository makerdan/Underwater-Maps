---
name: Unit-tier baseline breakage — route guard missing env-pack
description: Known pre-existing test:unit failure (api-server router-duplicate-route-guard) that fails every standard+ validation tier; not caused by unrelated changesets.
---

# Unit-tier baseline breakage: router-duplicate-route-guard missing `env-pack`

As of 2026-08-15, `test:unit` (and therefore `test-standard` and heavier tiers)
fails on:

`src/__tests__/router-duplicate-route-guard.test.ts › covers every router mounted in routes/index.ts`

**Cause:** an `env-pack` router was mounted in `artifacts/api-server/src/routes/index.ts`
(by an offline-pack task) without adding it to the guard test's `ROUTERS` list.
The guard's own error message says exactly what to do.

**How to apply:** if a validation run fails only on this test and your changeset
does not touch api-server routes, classify it as pre-existing (verified 3/3 solo
on 2026-08-15) and do not escalate tiers. A follow-up task exists to add the
entry; once the guard passes again, delete this file and its index line.
