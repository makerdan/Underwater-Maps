---
name: Mobile Live 2D follow architecture
description: How mobile Live drives 2D chart centering from the shared GpsFollowState machine — gotchas for follow, retarget, and proximity with no 3D scene.
---

# Mobile Live 2D follow (chart-plotter) architecture

**Rule:** Mobile Live must reuse the desktop `GpsFollowState` machine (cameraStore) and the shared `runFollowBoundsCheck`; the 2D tick (`lib/mobileMapFollow.ts`) drives the chart transform instead of the 3D camera. Never add a parallel follow state machine.

**Why:** Two silent-failure modes guarded by tests: desktop camera-follow no-ops with no 3D scene (chart freezes while the user moves), and proximity auto-switch goes dead if it depends on the R3F camera publishing `cameraPosition`.

**How to apply / gotchas:**
- `runFollowBoundsCheck` checks **activeGrid only** for the inside-any-dataset test — a retarget target dataset must have `activeGrid` set (not just `overviewGrid`) or follow disables before the handoff fires. Test fixtures must set both.
- Dataset re-targeting goes through the **existing follow-handoff channel** (`requestFollowHandoff` → App.tsx consumer → `setPrimary` → re-enable follow), never direct `setSinglePrimary` (wipes the proximity pool) or bare `setPrimary` (skips the re-enable-follow flow).
- With no 3D scene, proximity streaming needs `startMobileGpsCameraMirror()` (gpsStore → `setCameraGeo`) or `cameraPosition` stays unknown and no dataset ever activates. Regression tests live in `useDatasetProximityStreaming.test.ts` ("no 3D scene" describe).
- Follow-tick settle deadband (0.25 px step) ÷ lerp (0.15) leaves ≤ ~1.7 px residual off-centre — convergence tests need ±2 px tolerance, not toBeCloseTo(…, 0).
- Proximity/HUD wiring shared by desktop panel and mobile shell was extracted to `hooks/useProximityStreamingWiring.ts` — add new proximity UI wiring there, not in DatasetPanel.
