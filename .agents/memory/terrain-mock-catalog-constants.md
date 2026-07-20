---
name: Terrain mock must export catalog constants
description: vi.mock("…/lib/terrain.js") factories must include the catalog-strategy constants or suites crash at import time
---
`src/lib/catalogFetchStrategy.ts` (imported transitively by app.js via routes/terrain-bundles.ts) reads `NYSDEC_BATHY_FEATURE_SERVICE`, `MN_DNR_BATHY_FEATURE_SERVICE`, and `BUNDLED_TERRAIN` from `lib/terrain.js` at module load. Any test that fully mocks terrain.js must include those three exports (fake URL strings + `BUNDLED_TERRAIN: {}`) or the whole suite fails to collect with "No export is defined on the mock".

**Why:** the on-demand-bundles change added these module-level imports; six suites broke at once.
**How to apply:** when adding a new export consumed at import time in terrain.js, grep for `vi.mock(".*lib/terrain` and update every factory.
