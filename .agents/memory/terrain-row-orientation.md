---
name: Terrain grid row-order contract
description: Which row order (north-first vs south-first) each terrain grid producer/consumer uses, and how orientation bugs manifest as north–south mirrored meshes.
---

# Terrain grid row-order contract

**The serving contract is row 0 = minLat (SOUTH), row-major west→east.**

**Why:** the entire client is written against it — `buildTerrainGeometry` puts
array row 0 at world z=−half, `worldXZToLonLat` maps z=−half→minLat, picking
(`getTerrainSurfaceY`/`sampleDepthAt`), overview renderer (`dataRow = H−1−canvasRow`),
Minimap, flowField, cameraSpawn, stats all assume it — and the server's
`gridPoints` gridder (uploads + raster-commit) produces it
(`row = ((lat−minLat)/latRange)*N`). A producer that serves north-first data
renders mirrored north–south, with click coords landing on the wrong latitude.

## Producer inventory (as of the Ray Roberts flip)
- **south-first (correct):** `gridPoints` (uploads, raster-commit); bundled
  `lake-ray-roberts` — flipped at load by `loadBundledTerrain(..., {flipRows:true})`
  in api-server `lib/terrain.ts`.
- **north-first (still mirrored, known debt):** `fetchGebcoGrid` (GeoTIFF rows
  copied unflipped), `idwInterpolateGrid` (state contour sources), crater-lake
  and tahoe bundles (flag not applied), `/api/terrain/land` Copernicus DEM
  (documented top-down). Copernicus land + remote bathy are mirrored
  *consistently with each other* — flip them in lockstep or land/lake mismatch.
- **orientation-neutral:** substrate grid (documents its own row0=north lat
  mapping, geographic not terrain-row based); EFH/substrate GeoJSON (lon/lat).

## How to apply
- Any new grid producer must emit south-first; pin it with a geography-based
  test (deepest-basin centroid vs known real-world location — see
  api-server `lib/terrain-bundle-orientation.test.ts` and client
  `src/__tests__/terrain-orientation.test.ts`).
- `.gen.json` bundle files stay in generator/GeoTIFF order (north-first);
  convert read-time via `flipGridRowsInPlace`, never regenerate for orientation.
- Any orientation change to a served grid REQUIRES a `TERRAIN_CACHE_VERSION`
  bump or cached grids keep the old orientation.
- Do NOT "fix" orientation client-side in geometry/overview code: it flips all
  datasets at once (breaks the south-first producers) — the client convention
  is uniform and correct; fix producers instead.
