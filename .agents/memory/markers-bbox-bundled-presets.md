---
name: Markers bbox guard vs bundled preset datasets
description: The POST/PATCH /api/markers bbox guard resolves dataset coverage only from DB tables; bundled preset ids (e.g. thorne-bay) crash it and 500 every marker create.
---

# Bbox guard breaks marker creation on bundled preset datasets

The bbox guard on POST/PATCH `/api/markers` (`resolveDatasetBbox` in the markers route) checks `dataset_catalog` then `custom_datasets`. Bundled preset datasets like `thorne-bay` live in code (`artifacts/api-server/src/lib/terrain.ts`), not in either table, so:

1. Catalog lookup misses.
2. `custom_datasets.id` is a UUID column — querying it with `"thorne-bay"` throws `invalid input syntax for type uuid` → DrizzleQueryError → 500 on every marker create against a bundled dataset.
3. Even with the crash guarded, the resolver would return null bbox → the guard rejects the create, so bundled presets need their own bbox resolution branch, not just a try/catch.

**Detectors:** `tests/e2e/quick-drop.spec.ts` and `tests/e2e/marker-flow-real.spec.ts` fail at baseline (11 tests, all marker POSTs 500) since the guard merged 2026-08-17. Stash-verified pre-existing on a clean tree.

**How to apply:** any resolver keyed on datasetId must handle all three id families: catalog ids, bundled preset ids (non-UUID, code-defined), and custom dataset UUIDs — validate UUID shape before querying a UUID PK column. When these e2e specs 500 on marker creation, suspect this guard before the specs.
