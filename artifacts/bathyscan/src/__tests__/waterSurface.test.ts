/**
 * Water surface correctness tests.
 *
 * Covers three regression scenarios that were previously either untested or
 * unrepresentable:
 *
 *  1. TidalWaterPlane gap-zone: the camera enters the 0 < camY < tidalSurfY
 *     band (above the terrain floor but below the water surface) — the bottom
 *     face of the DoubleSide plane must not fill the viewport.
 *
 *  2. Stale-Y after dataset switch: promoting a second dataset with a
 *     different minDepth must immediately produce a fresh surfY.  The
 *     WaterSurface discriminated union makes "visible but stale-Y" an
 *     unrepresentable state, so this is verified at the type / value level.
 *
 *  3. WaterSurface union correctness: buildWaterSurface always bundles the
 *     visibility flag and the Y-coordinate atomically from the current
 *     terrain, eliminating the two-field drift.
 */
import { describe, it, expect } from "vitest";
import { buildWaterSurface, getSeaSurfaceY, MAX_DEPTH_WORLD } from "@/lib/terrain";
import { applyWaterPlaneVisibility } from "@/components/WaterSurfacePlane";
import { computeSurfaceY } from "@/components/TidalWaterPlane";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTerrain(minDepth: number, maxDepth: number): TerrainData {
  return {
    datasetId: `test-${minDepth}-${maxDepth}`,
    resolution: 2,
    depths: [minDepth, minDepth, minDepth, minDepth],
    minDepth,
    maxDepth,
    minLat: 0,
    maxLat: 1,
    minLon: 0,
    maxLon: 1,
    source: "test",
  } as unknown as TerrainData;
}

function makeMesh(visible = true): { visible: boolean } {
  return { visible };
}

function makeState(initial = true): { current: boolean } {
  return { current: initial };
}

// ---------------------------------------------------------------------------
// 1. WaterSurface discriminated union — buildWaterSurface
// ---------------------------------------------------------------------------

describe("buildWaterSurface — discriminated union", () => {
  it("returns { visible: false } when showWaterSurface is false", () => {
    const terrain = makeTerrain(10, 100);
    const ws = buildWaterSurface(false, terrain);
    expect(ws.visible).toBe(false);
  });

  it("returns { visible: false } when terrain is null", () => {
    const ws = buildWaterSurface(true, null);
    expect(ws.visible).toBe(false);
  });

  it("returns { visible: true; y } when show=true and terrain is provided", () => {
    const terrain = makeTerrain(10, 100); // depthRange=90, surfY=(10/90)*50≈5.56
    const ws = buildWaterSurface(true, terrain);
    expect(ws.visible).toBe(true);
    if (ws.visible) {
      expect(ws.y).toBeCloseTo(getSeaSurfaceY(terrain));
    }
  });

  it("y matches getSeaSurfaceY for minDepth=0 (standard ocean survey)", () => {
    const terrain = makeTerrain(0, 200);
    const ws = buildWaterSurface(true, terrain);
    expect(ws.visible).toBe(true);
    if (ws.visible) {
      expect(ws.y).toBe(0); // minDepth=0 → surfY=0
    }
  });

  it("y matches getSeaSurfaceY for elevated minDepth (survey starts below surface)", () => {
    const terrain = makeTerrain(50, 150); // depthRange=100, surfY=(50/100)*50=25
    const ws = buildWaterSurface(true, terrain);
    expect(ws.visible).toBe(true);
    if (ws.visible) {
      expect(ws.y).toBeCloseTo(25);
    }
  });

  it("surfY is clamped to [0, MAX_DEPTH_WORLD]", () => {
    const terrain = makeTerrain(500, 600); // raw=(500/100)*50=250 → clamped to 50
    const ws = buildWaterSurface(true, terrain);
    expect(ws.visible).toBe(true);
    if (ws.visible) {
      expect(ws.y).toBe(MAX_DEPTH_WORLD);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Stale-Y after dataset switch — union always produces fresh Y
// ---------------------------------------------------------------------------

describe("stale-Y after dataset switch — buildWaterSurface always produces fresh Y", () => {
  it("switching terrain immediately updates the Y in the union (no stale state possible)", () => {
    const terrain1 = makeTerrain(10, 100); // surfY ≈ 5.56
    const terrain2 = makeTerrain(50, 200); // surfY = (50/150)*50 ≈ 16.67

    const ws1 = buildWaterSurface(true, terrain1);
    const ws2 = buildWaterSurface(true, terrain2);

    expect(ws1.visible).toBe(true);
    expect(ws2.visible).toBe(true);

    if (ws1.visible && ws2.visible) {
      // Each union carries the Y derived from its own terrain — they differ.
      expect(ws1.y).toBeCloseTo(getSeaSurfaceY(terrain1));
      expect(ws2.y).toBeCloseTo(getSeaSurfaceY(terrain2));
      expect(ws1.y).not.toBeCloseTo(ws2.y);
    }
  });

  it("promoting second dataset (deeper survey) gives lower surfY", () => {
    // Dataset 1: shallow survey starting just below surface
    const terrain1 = makeTerrain(5, 50);   // surfY=(5/45)*50≈5.56
    // Dataset 2: open-ocean survey starting at true surface
    const terrain2 = makeTerrain(0, 5000); // surfY=0
    const ws1 = buildWaterSurface(true, terrain1);
    const ws2 = buildWaterSurface(true, terrain2);
    if (ws1.visible && ws2.visible) {
      expect(ws1.y).toBeGreaterThan(ws2.y);
    }
  });

  it("visibility=false emitted immediately when user toggles off regardless of terrain", () => {
    const terrain = makeTerrain(20, 100);
    const wsOn = buildWaterSurface(true, terrain);
    const wsOff = buildWaterSurface(false, terrain);
    expect(wsOn.visible).toBe(true);
    expect(wsOff.visible).toBe(false);
    // Type guard: wsOff has no .y property
    expect("y" in wsOff).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. TidalWaterPlane gap-zone — using applyWaterPlaneVisibility
// ---------------------------------------------------------------------------

describe("TidalWaterPlane gap-zone guard (via applyWaterPlaneVisibility)", () => {
  it("hides the plane when camera is in the gap zone (0 < camY < tidalSurfY)", () => {
    // tidal surface is at Y=8; camera at Y=3 is in the gap zone
    const mesh = makeMesh(true);
    const state = makeState(true);
    const tidalSurfY = 8;
    applyWaterPlaneVisibility(mesh, state, 3, tidalSurfY);
    expect(mesh.visible).toBe(false);
    expect(state.current).toBe(false);
  });

  it("hides the plane at the low end of the gap (camY=0.01, tidalSurfY=5)", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, 0.01, 5);
    expect(mesh.visible).toBe(false);
  });

  it("hides the plane at the high end of the gap (camY=tidalSurfY-0.01)", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, 4.99, 5);
    expect(mesh.visible).toBe(false);
  });

  it("shows the plane when camera is underwater (camY < 0)", () => {
    const mesh = makeMesh(false);
    const state = makeState(false);
    const tidalSurfY = 8;
    // Camera well underwater: camY=-5, tidalSurfY=8 → enter below-surface
    applyWaterPlaneVisibility(mesh, state, -5, tidalSurfY);
    expect(mesh.visible).toBe(true);
    expect(state.current).toBe(true);
  });

  it("shows the plane when camera crosses the entry threshold at sea-level (tidalSurfY=0, camY=-0.6)", () => {
    // No gap when surfY=0; camY=-0.6 < surfY-0.5=-0.5 → crosses entry threshold → visible
    const mesh = makeMesh(false);
    const state = makeState(false);
    applyWaterPlaneVisibility(mesh, state, -0.6, 0);
    expect(mesh.visible).toBe(true);
  });

  it("hides the plane when camera is above the tidal surface (camY > tidalSurfY + 0.5)", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, 9, 8); // 9 > 8 + 0.5
    expect(mesh.visible).toBe(false);
  });

  it("full transition: underwater → gap → above tidal surface → back underwater", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    const tidalSurfY = 6;

    // Underwater: visible
    applyWaterPlaneVisibility(mesh, state, -10, tidalSurfY);
    expect(mesh.visible).toBe(true);

    // Rising into gap: hidden
    applyWaterPlaneVisibility(mesh, state, 2, tidalSurfY);
    expect(mesh.visible).toBe(false);

    // Above surface: hidden
    applyWaterPlaneVisibility(mesh, state, 7, tidalSurfY);
    expect(mesh.visible).toBe(false);

    // Descent through gap: still hidden
    applyWaterPlaneVisibility(mesh, state, 3, tidalSurfY);
    expect(mesh.visible).toBe(false);

    // Back underwater: visible
    applyWaterPlaneVisibility(mesh, state, -2, tidalSurfY);
    expect(mesh.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. computeSurfaceY — tidal Y formula
// ---------------------------------------------------------------------------

describe("computeSurfaceY — tidal water plane Y formula", () => {
  it("returns base surfY when tideHeight=0", () => {
    const terrain = makeTerrain(10, 100); // depthRange=90, base=(10/90)*50≈5.56
    const y = computeSurfaceY(terrain, 0);
    expect(y).toBeCloseTo((10 / 90) * MAX_DEPTH_WORLD);
  });

  it("adds positive tidal offset for incoming tide", () => {
    const terrain = makeTerrain(0, 100); // depthRange=100, base=0
    const y = computeSurfaceY(terrain, 2); // 2m tide, offset=(2/100)*50=1
    expect(y).toBeCloseTo(1);
  });

  it("subtracts tidal offset for outgoing tide (negative tideHeight)", () => {
    const terrain = makeTerrain(50, 150); // depthRange=100, base=25
    const y = computeSurfaceY(terrain, -5); // offset=(-5/100)*50=-2.5
    expect(y).toBeCloseTo(22.5);
  });

  it("handles degenerate depthRange (min === max) without divide-by-zero", () => {
    const terrain = makeTerrain(50, 50); // depthRange would be 0 → treated as 1
    expect(() => computeSurfaceY(terrain, 1)).not.toThrow();
  });
});
