---
name: Express nested router guard prefixes
description: Structural route guards must preserve mount prefixes when walking nested Express routers.
---

Nested Express routers do not reliably expose their mount path through the
internal layer stack. A recursive guard can therefore report false duplicate
routes such as a prefixed router's `/query` colliding with a root `/query`.

**Why:** Domain composition mounts existing routers under prefixes such as
`/poe` and `/github`, while Express's private layer shape varies by version.

**How to apply:** Keep leaf-router duplicate checks, and use an explicit
route inventory with known mount prefixes for aggregate cross-domain checks.