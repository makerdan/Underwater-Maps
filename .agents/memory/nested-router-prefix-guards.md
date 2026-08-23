---
name: Nested router prefix guards
description: Structural route walkers may not expose Express mount prefixes for nested routers.
---

When testing nested Express composition, use prefix-aware checks against the composed source routers when the deep walker cannot recover a mounted prefix. Also retain an endpoint-level test for the public URL.

**Why:** Express 5 stores nested mount metadata in a way that the project's generic deep route walker can report a false duplicate for a child route mounted under a prefix.

**How to apply:** For a router composed from `/poe` and unprefixed routes, compare the nested route count and call `findDuplicateRoutesAcross` with the explicit `/poe` prefix rather than treating `findDuplicateRoutesDeep` output as authoritative.