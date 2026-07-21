---
name: Headless terrain-geometry probe for e2e
description: How e2e specs verify real terrain relief and crosshair depth without WebGL.
---

`window.__bathyTest.probeTerrainGeometry()` builds the REAL render geometry (buildTerrainGeometry, CPU-only) for the currently loaded terrain, and only when the mesh has vertical relief publishes the deepest vertex to crosshairGps — the headless analog of a raycast hit. A flattened mesh (the invisible-terrain bug class) reports `flat: true` and leaves the HUD at "— NO TERRAIN —", so `tests/e2e/terrain-visibility.spec.ts` fails exactly like a user's crosshair would miss.

**Why:** headless Chromium on this host has no WebGL, so useFrame raycasts never run; asserting the rendered scene requires probing the same lib geometry the mesh uses.

**How to apply:** for any e2e assertion about the visible terrain surface (relief, depth at a point), use probeTerrainGeometry / getTerrainSummary against a REAL dataset load (share link `?lon&lat&depth&hdg&ds=` — all params required or decodeViewParams rejects), not seedTerrain, when the goal is regression coverage of the load→geometry pipeline.
