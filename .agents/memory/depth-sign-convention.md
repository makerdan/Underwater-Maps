---
name: Depth sign convention is positive-down
description: BathyScan terrain grids use positive-down depths; clamps assuming negative-down flatten the whole mesh.
---

Terrain grids (API payloads, bundled lakes) use the **positive-down** convention: depth 0 = waterline, +N = N metres below the surface, negative = above-water land.

**Why:** A land-flattening clamp of `Math.min(depth, 0)` (assuming negative-down) mapped every all-positive grid — e.g. bundled Lake Ray Roberts (0…21 m) — to t=0, flattening the entire mesh to Y=0: terrain invisible, crosshair raycast always missed, while contours/skirt (which don't clamp) still had real depths. Correct land clamp is `Math.max(depth, 0)`.

**How to apply:** Any new depth→worldY mapping in `lib/terrain.ts` (geometry, skirt, shaders reconstructing depth from Y) must treat positive as deeper. Debug hint: if the mesh exists with uOpacity=1 but the viewport is blank, dump the geometry bounding box — a flat bbox (minY=maxY=0) means the displacement step collapsed, not a fade/material bug. Regression tests live in `src/__tests__/terrain.test.ts` (buildTerrainGeometry describe block).

- Vertex colouring treats depth <= 0 as land/nodata (never samples the palette); any test asserting palette colours at the 0-depth boundary must use an epsilon-positive depth instead of exactly 0.
