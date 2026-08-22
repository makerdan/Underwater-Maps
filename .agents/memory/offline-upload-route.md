---
name: Offline upload route
description: Authenticated uploaded terrain uses the per-user API route for offline pack reads.
---

Offline packs for uploaded UUID datasets must fetch terrain and overview through the authenticated `/api/user/datasets/:id/...` routes; the legacy `/api/datasets/:id/...` paths return not found for these records.

**Why:** Uploads are user-owned database rows and the API's unified authenticated read path enforces ownership.

**How to apply:** When constructing offline-pack URLs, branch UUID uploads to the user-datasets route while retaining preset IDs on the catalog route.