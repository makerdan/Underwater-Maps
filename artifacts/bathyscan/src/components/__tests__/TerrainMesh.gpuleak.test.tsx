/**
 * TerrainMesh — GPU-leak regression tests.
 *
 * Exercises Bug D: double-dispose of BufferGeometry on primary-dataset switch.
 *
 * Root cause: the geometry useEffect had BOTH a setup-phase dispose
 * (`if (prev && prev !== geometry) prev.dispose()`) AND a cleanup-phase
 * dispose (`return () => { geometry.dispose() }`).  React's effect cycle
 * runs the OLD cleanup before the NEW setup, so by the time setup ran,
 * prevGeometryRef.current already pointed to the just-cleaned-up geometry
 * and called dispose() on it a second time.
 *
 * Fix: remove the setup-phase dispose entirely; let the cleanup-phase own
 * disposal, and null prevGeometryRef.current after each cleanup.
 *
 * These tests render the real TerrainMesh component (with Three.js and all
 * stores fully mocked) and assert that dispose is called exactly once — not
 * twice — when the grid prop changes.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Controlled geometry instances — "mock" prefix required for vitest hoisting.
// ---------------------------------------------------------------------------
const mockGeoInstances: Array<{ dispose: ReturnType<typeof vi.fn>; setAttribute: ReturnType<typeof vi.fn>; getAttribute: ReturnType<typeof vi.fn> }> = [];
const mockSkirtGeoInstances: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];

// ---------------------------------------------------------------------------
// vi.mock for three — shared mock is sufficient except we need spy dispose.
// ---------------------------------------------------------------------------
vi.mock("three");

// ---------------------------------------------------------------------------
// @react-three/fiber — shared no-op stub.
// ---------------------------------------------------------------------------
vi.mock("@react-three/fiber");

// ---------------------------------------------------------------------------
// @/lib/terrain — buildTerrainGeometry returns a fresh controlled geo object
// each call so we can track per-instance dispose.
// ---------------------------------------------------------------------------
vi.mock("@/lib/terrain", () => ({
  buildTerrainGeometry: vi.fn(() => {
    const geo = {
      dispose: vi.fn(),
      setAttribute: vi.fn(),
      getAttribute: vi.fn(() => ({ array: new Float32Array(0), needsUpdate: false })),
      computeVertexNormals: vi.fn(),
      normalizeNormals: vi.fn(),
    };
    mockGeoInstances.push(geo);
    return geo;
  }),
  buildTerrainSkirtGeometry: vi.fn(() => {
    const geo = { dispose: vi.fn(), setAttribute: vi.fn() };
    mockSkirtGeoInstances.push(geo);
    return geo;
  }),
  computeZoneWeights: vi.fn(() => new Float32Array(0)),
  computeSlopeAttribute: vi.fn(() => new Float32Array(0)),
  applyColormapToVertexColors: vi.fn(),
  isSyntheticGrid: vi.fn(() => false),
  WORLD_SIZE: 100,
  MAX_DEPTH_WORLD: 50,
  getSeaSurfaceY: vi.fn(() => 0),
}));

// ---------------------------------------------------------------------------
// @/lib/textures
// ---------------------------------------------------------------------------
vi.mock("@/lib/textures", () => ({
  getTerrainTextures: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// @/lib/terrainShader — returns a material mock with all uniforms TerrainMesh
// accesses so no effect throws "Cannot read properties of undefined".
// ---------------------------------------------------------------------------
function makeMaterialMock() {
  const vec3 = { copy: vi.fn(), set: vi.fn() };
  const vec4 = { set: vi.fn() };
  const color = { set: vi.fn(), setRGB: vi.fn() };
  return {
    uniforms: {
      uOpacity:            { value: 1 },
      uLampPos:            { value: vec3 },
      uZoneOverlay:        { value: 0 },
      uZoneTint0:          { value: color },
      uZoneTint1:          { value: color },
      uZoneTint2:          { value: color },
      uZoneTint3:          { value: color },
      uZoneVisible:        { value: vec4 },
      uHighlightMode:      { value: 0 },
      uHighlightMin:       { value: 0 },
      uHighlightMax:       { value: 0 },
      uTime:               { value: 0 },
      uShowHabitat:        { value: 0 },
      uHabitatTex:         { value: null },
      uHabitatIntensity:   { value: 0.5 },
      uHabitatColor:       { value: color },
      uSynthetic:          { value: 0 },
      uGridMinDepth:       { value: 0 },
      uGridMaxDepth:       { value: 1000 },
      uLandColor:          { value: color },
      uIntertidalMhwM:     { value: 0 },
      uIntertidalMhhwM:    { value: 0 },
    },
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
    dispose: vi.fn(),
  };
}

vi.mock("@/lib/terrainShader", () => ({
  createTerrainShaderMaterial: vi.fn(() => makeMaterialMock()),
  getPlaceholderHabitatTexture: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// Store mocks — minimal selectors, all returning stable values.
// ---------------------------------------------------------------------------
vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: (sel: (s: { zoneMap: null }) => unknown) =>
    sel({ zoneMap: null }),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      colormapTheme: "ocean",
      brightDaylight: false,
      colormapUserSet: false,
      nodataColor: "#888888",
      terrainExaggeration: 1,
      habitatOverlayIntensity: 0.5,
      habitatOverlayColor: "#ffffff",
    }),
  deriveEffectiveColormapTheme: vi.fn(() => "ocean"),
  DEFAULT_SETTINGS: {},
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ zonePaintMode: false, zonePaintBrushRadius: 3, zoneOverlayEnabled: false }),
  // getState used inside useFrame:
}));

vi.mock("@/lib/zoneOverlayStore", () => ({
  useZoneOverlayStore: {
    getState: () => ({
      slots: [
        { visible: false, color: "#fff" },
        { visible: false, color: "#fff" },
        { visible: false, color: "#fff" },
        { visible: false, color: "#fff" },
      ],
    }),
  },
}));

vi.mock("@/lib/highlightStore", () => ({
  useHighlightStore: {
    getState: () => ({ mode: "none", params: { min: 0, max: 0 } }),
  },
}));

vi.mock("@/lib/habitatStore", () => ({
  useHabitatStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ scores: { status: "idle" }, activeSpecies: null }),
}));

vi.mock("@/lib/paletteStore", () => ({
  usePaletteStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      shallow: "#ffffff",
      deep: "#000000",
      customStops: [],
      bandColors: [],
      bandBoundaries: [],
      blendBands: false,
    }),
}));

vi.mock("@/lib/colormap", () => ({
  getColormap: vi.fn(() => () => ({ r: 0, g: 0.5, b: 1 })),
  getColormapDepthDomain: vi.fn((_theme: string, min: number, max: number) => ({ min, max })),
}));

vi.mock("@/lib/webglContextStore", () => ({
  useWebglContextStore: (sel: (s: { floatTextureLinear: boolean }) => unknown) =>
    sel({ floatTextureLinear: true }),
}));

vi.mock("@/lib/useIntertidal", () => ({
  useIntertidal: () => ({ mhwFt: null, mhhwFt: null }),
}));

vi.mock("@/components/SimulatedTerrainLabel", () => ({
  SimulatedTerrainLabel: () => null,
}));

vi.mock("@/lib/simulatedTreatmentRegistry", () => ({
  registerSimulatedTreatment: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

// ---------------------------------------------------------------------------
// Import component AFTER all mocks are declared.
// ---------------------------------------------------------------------------
import { TerrainMesh } from "@/components/TerrainMesh";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function makeGrid(overrides: Partial<TerrainData> = {}): TerrainData {
  return {
    datasetId: "test-a",
    name: "Test",
    waterType: "saltwater" as const,
    resolution: 4,
    width: 4,
    height: 4,
    depths: Array.from({ length: 16 }, (_, i) => i * 10),
    minDepth: 0,
    maxDepth: 150,
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
    centerLon: -119.5,
    centerLat: 47.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockGeoInstances.length = 0;
  mockSkirtGeoInstances.length = 0;
});

// ---------------------------------------------------------------------------
// Bug D — geometry disposed exactly once per grid change (not twice)
// ---------------------------------------------------------------------------
describe("TerrainMesh — Bug D: no double-dispose of geometry on grid change", () => {
  it("geometry.dispose() is called exactly once when the grid prop changes", async () => {
    const gridA = makeGrid({ datasetId: "grid-a" });
    const gridB = makeGrid({ datasetId: "grid-b" });

    const { rerender } = render(<TerrainMesh grid={gridA} />);
    // buildTerrainGeometry and buildTerrainSkirtGeometry push to separate arrays.
    expect(mockGeoInstances).toHaveLength(1); // main geometry only

    const firstMainGeo = mockGeoInstances[0]!;
    expect(firstMainGeo.dispose).not.toHaveBeenCalled();

    // Swap to gridB — triggers both geometry and skirt geometry effects.
    await act(async () => {
      rerender(<TerrainMesh grid={gridB} />);
    });

    // Old geometry must have been disposed exactly once — not twice.
    expect(firstMainGeo.dispose).toHaveBeenCalledTimes(1);
  });

  it("skirt geometry.dispose() is called exactly once when the grid prop changes", async () => {
    const gridA = makeGrid({ datasetId: "grid-a" });
    const gridB = makeGrid({ datasetId: "grid-b" });

    const { rerender } = render(<TerrainMesh grid={gridA} />);
    const firstSkirtGeo = mockSkirtGeoInstances[0]!;
    expect(firstSkirtGeo.dispose).not.toHaveBeenCalled();

    await act(async () => {
      rerender(<TerrainMesh grid={gridB} />);
    });

    expect(firstSkirtGeo.dispose).toHaveBeenCalledTimes(1);
  });

  it("geometry.dispose() is called exactly once on unmount (no double-dispose from stale ref)", async () => {
    const grid = makeGrid();
    const { unmount } = render(<TerrainMesh grid={grid} />);
    const geo = mockGeoInstances[0]!;

    await act(async () => { unmount(); });
    expect(geo.dispose).toHaveBeenCalledTimes(1);
  });

  it("switching grid twice disposes each generation exactly once", async () => {
    const gridA = makeGrid({ datasetId: "a" });
    const gridB = makeGrid({ datasetId: "b" });
    const gridC = makeGrid({ datasetId: "c" });

    const { rerender } = render(<TerrainMesh grid={gridA} />);
    const geoA = mockGeoInstances[0]!; // first buildTerrainGeometry call

    await act(async () => { rerender(<TerrainMesh grid={gridB} />); });
    const geoB = mockGeoInstances[1]!; // second buildTerrainGeometry call

    await act(async () => { rerender(<TerrainMesh grid={gridC} />); });

    expect(geoA.dispose).toHaveBeenCalledTimes(1);
    expect(geoB.dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Net budget — zero GPU leak across 5 consecutive grid switches
//
// Each switch must dispose the previous geometry/skirt exactly once, so the
// number of live (not yet disposed) geometries never exceeds 1 at any point.
// This is the regression guard described in task 3160: it will fail if
// a future change re-introduces the double-dispose bug (geometry disposed
// before the ref tracking it is updated) or a missed-dispose bug (cleanup
// effect removed or dependency array widened).
// ---------------------------------------------------------------------------
describe("TerrainMesh — net GPU budget: zero geometry leak across 5 grid switches", () => {
  it("disposes every superseded main geometry exactly once; exactly 1 live at all times", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"]; // 5 switches between 6 grids
    const grids = ids.map((id) => makeGrid({ datasetId: id }));

    const { rerender } = render(<TerrainMesh grid={grids[0]!} />);

    for (let i = 1; i < grids.length; i++) {
      await act(async () => { rerender(<TerrainMesh grid={grids[i]!} />); });

      // Every geometry created so far except the current one must be disposed.
      for (let j = 0; j < i; j++) {
        expect(mockGeoInstances[j]!.dispose).toHaveBeenCalledTimes(1);
      }
      // Current geometry must NOT be disposed yet.
      expect(mockGeoInstances[i]!.dispose).not.toHaveBeenCalled();

      // Invariant: exactly one geometry is still live (not disposed) at all times.
      const liveCount = mockGeoInstances.filter((g) => g.dispose.mock.calls.length === 0).length;
      expect(liveCount).toBe(1);
    }
  });

  it("disposes every superseded skirt geometry exactly once; exactly 1 live at all times", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const grids = ids.map((id) => makeGrid({ datasetId: id }));

    const { rerender } = render(<TerrainMesh grid={grids[0]!} />);

    for (let i = 1; i < grids.length; i++) {
      await act(async () => { rerender(<TerrainMesh grid={grids[i]!} />); });

      for (let j = 0; j < i; j++) {
        expect(mockSkirtGeoInstances[j]!.dispose).toHaveBeenCalledTimes(1);
      }
      expect(mockSkirtGeoInstances[i]!.dispose).not.toHaveBeenCalled();

      const liveCount = mockSkirtGeoInstances.filter((g) => g.dispose.mock.calls.length === 0).length;
      expect(liveCount).toBe(1);
    }
  });

  it("after unmount following 5 switches, no geometry instance is left live", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const grids = ids.map((id) => makeGrid({ datasetId: id }));

    const { rerender, unmount } = render(<TerrainMesh grid={grids[0]!} />);
    for (let i = 1; i < grids.length; i++) {
      await act(async () => { rerender(<TerrainMesh grid={grids[i]!} />); });
    }

    await act(async () => { unmount(); });

    // Every geometry (main + skirt) must now be disposed exactly once.
    for (const geo of mockGeoInstances) {
      expect(geo.dispose).toHaveBeenCalledTimes(1);
    }
    for (const skirt of mockSkirtGeoInstances) {
      expect(skirt.dispose).toHaveBeenCalledTimes(1);
    }
  });
});
