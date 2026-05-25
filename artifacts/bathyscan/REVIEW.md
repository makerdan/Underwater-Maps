# BathyScan — Code Review & Gap Analysis

**Reviewed against:** Tasks 1–4, 7, 8, 9 acceptance criteria
**Date:** 2026-05-25
**Reviewer:** Automated architectural audit (Task #6)

---

## Summary

132/132 unit tests pass. TypeScript typecheck exits 0. Lint exits 0. All API routes confirmed wired to the frontend via generated hooks. No production-path stubs or mocks remain beyond one intentional design decision (habitat texture). Two stale "coming soon" labels fixed inline.

---

## Feature Status Table

| Feature | Task | Status | Notes |
|---|---|---|---|
| `pnpm run typecheck` exits 0 | All | **PASS** | Clean; no unchecked `any` casts in production paths |
| `useGetDatasets` wired to real route | 1 | **PASS** | App.tsx ← `GET /api/datasets` |
| `useGetDatasetsIdTerrain` wired | 1 | **PASS** | DatasetPanel.tsx, TourScene.tsx ← `GET /api/datasets/:id/terrain` |
| `useGetDatasetsIdOverview` wired | 1 | **PASS** | DatasetPanel.tsx ← `GET /api/datasets/:id/overview` |
| `usePostDatasetsUpload` wired | 1 | **PASS** | FileUpload.tsx ← `POST /api/datasets/upload` |
| `useGetMarkers` wired | 2 | **PASS** | MarkerLayer.tsx, Minimap.tsx, DepthPoleLayer.tsx |
| `usePostMarkers` wired | 2 | **PASS** | MarkerForm.tsx, HabitatPanel.tsx |
| `useDeleteMarkersId` wired | 2 | **PASS** | DatasetPanel.tsx, useFlyControls.ts |
| `useDeleteMarkersMine` wired | 2 | **PASS** | Settings.tsx |
| `useGetSettings` / `usePutSettings` wired | 8 | **PASS** | App.tsx, Settings.tsx, WaterTypeToggle.tsx |
| `useGetUserDatasets*` hooks wired | 1 | **PASS** | DatasetPanel.tsx (all three user-dataset hooks) |
| No `TODO`/`FIXME`/placeholder comments in prod paths | All | **PASS** | Only CSS `placeholder:` pseudo-class matches and one intentional design note (see below) |
| Terrain depths array non-empty with variance | 1 | **PASS** | `buildTerrainGrid` fills `Float32Array(N*N)`; synthetic fbm fallback also produces non-trivially-flat values |
| `width * height === depths.length` | 1 | **PASS** | Both presets and uploads: `depths = new Float32Array(N * N)`, `width = height = N` |
| Overview grid is 64×64 | 1 | **PASS** | `buildTerrainGrid(id, 64, …)` called explicitly in overview route; `OverviewMap.tsx` reads `overviewGrid` state slot (never `activeGrid`) |
| Dynamic colormap — full-range normalisation | 3 | **PASS** | `colormap.ts` maps `t = (depth − minDepth) / depthRange` per vertex; each region independently spans 0→1 regardless of absolute depth range |
| Five colormap themes available | 7 | **PASS** | ocean / thermal / grayscale / viridis / freshwater all defined in `colormap.ts` |
| Bottom texture zones visually distinct | 3 | **PASS** | Four procedural textures (sand / sediment / silt / basalt) each have distinct noise frequency, colour, and normal-map strength in `textures.ts` |
| Zone thresholds relative to per-dataset range | 3 | **PASS** | `computeZoneWeights` in `terrain.ts:233–320` uses `t = (depth − minDepth) / depthRange` before all threshold comparisons |
| Slope override to basalt | 3 | **PASS** | `terrain.ts:283–288`: `slopeAngle > 35°` → `wBasalt = max(wBasalt, slopeBlend)`, other weights suppressed |
| Four textures sampled and blended in shader | 3 | **PASS** | `terrainShader.ts`: `vSlope` attribute, four uniform sampler2D texture pairs, blended via `vWeights` in fragment shader |
| GPS raycaster fires every frame | 4 | **PASS** | `useFlyControls.ts:526–538`: per-frame raycast from NDC centre → writes `setCrosshairGps` |
| Raycaster maps hit to lon/lat/depth | 4 | **PASS** | `worldXZToLonLat(pt.x, pt.z, grid)` + `worldYToMetres` used on every intersection |
| `G` key places marker form at correct coords | 4 | **PASS** | `useFlyControls.ts:204–207`: `KeyG` reads `crosshairGps` → `setLastClickedGps`; `MarkerForm` reads that value |
| Submitted markers survive page reload | 4 | **PASS** | POST persisted to DB; `useGetMarkers` re-fetches on mount; query cache invalidated on create |
| Marker deletion removes sprite immediately | 4 | **PASS** | `useDeleteMarkersId` invalidates markers query key → `MarkerLayer` re-renders with marker removed |
| Marker dots on minimap | 4 | **PASS** | `Minimap.tsx` imports `useGetMarkers`, renders dots at `lonLatToWorldXZ` positions |
| Overview map uses 64×64 downsampled grid | 4 | **PASS** | `OverviewMap.tsx:57` reads `useTerrainStore((s) => s.overviewGrid)` exclusively |
| Pan/zoom works; range 0.5×–20× | 4 | **PASS** | `OverviewMap.tsx:370`: `Math.max(0.5, Math.min(20, …))` |
| Geographic grid lines at zoom ≥ 2× | 4 | **PASS** | `overviewRenderer.ts:163`: "Only visible at scale ≥ 2" |
| Drop-in positions camera above terrain | 4 | **PASS** | `OverviewMap` sets `uiStore.pendingDropIn`; `useFlyControls.ts:465–467` consumes it |
| `O` key toggles overview map | 4 | **PASS** | `App.tsx:379`: `KeyO` toggles `overviewOpen` in uiStore |
| Camera arrow on overview updates with heading | 4 | **PASS** | `OverviewMap.tsx:233`: `renderCameraArrow(ctx, cam.cameraLon, cam.cameraLat, cam.heading, …)` |
| Upload pipeline: XYZ + CSV → valid `TerrainGrid` | 1 | **PASS** | `POST /api/datasets/upload` via multer, returns `{ terrain, overview }` with `width * height === depths.length` |
| No console errors on startup / terrain swap | All | **PASS** | Only `[BathyScan] AI classification failed` warn (intentional, AI route optional) |
| Watertype toggle persists across reload | 20 | **PASS** | `WaterTypeToggle` calls `usePutSettings` immediately; `App.tsx` hydrates from `useGetSettings` on load |
| Colormap auto-switches on watertype change | 20 | **PASS** | `App.tsx:243–253`: swaps ocean↔freshwater default unless user picked a non-default theme |
| Marker types filter by watertype | 20 | **PASS** | `Settings.tsx`: `SALTWATER_MARKER_TYPE_OPTIONS` vs `FRESHWATER_MARKER_TYPE_OPTIONS` chosen by `s.waterType` |
| Lamp colour differs by watertype | 20 | **PASS** | `TourScene.tsx:45`: `#eaffff` freshwater vs `#fff8e8` saltwater |

---

## Intentional Designs (Not Gaps)

| Item | File | Explanation |
|---|---|---|
| Habitat texture initialised to 1×1 zero DataTexture | `terrainShader.ts:260–261` | This is correct: the habitat suitability overlay is off by default. When the AI classification pipeline (`classificationStore`) produces scores it replaces this texture. The comment "placeholder until scores arrive" is accurate engineering documentation, not a stub. |
| `dummy` variable in `TidalCurrentArrows.tsx` | `TidalCurrentArrows.tsx:107` | THREE.js `Object3D` named `dummy` is idiomatic for instanced mesh matrix calculation. Not a code stub. |
| Synthetic fbm fallback flag | `terrain.ts` | `synthetic: true` is set when GEBCO WCS is unreachable; this is intentional and the flag is now propagated through the OpenAPI schema so clients can display a "synthetic data" notice. |

---

## Fixes Applied Inline (< 20 lines each)

| Fix | Files Changed | Description |
|---|---|---|
| O-key "coming soon" labels | `ControlsLegend.tsx`, `KeyboardShortcutsPanel.tsx` | `App.tsx:379` had a live `KeyO` binding for the overview toggle since Task 4, but both keyboard-help UI panels still showed `"Overview map (coming soon)"`. Changed to `"Toggle overview map"`. |

---

## Out of Scope (as specified in task)

- Performance profiling beyond 30fps confirmation
- Accessibility audit
- Cross-browser testing beyond Chrome
- GLERL/USGS freshwater bathymetry pipeline (tracked in follow-up tasks)
