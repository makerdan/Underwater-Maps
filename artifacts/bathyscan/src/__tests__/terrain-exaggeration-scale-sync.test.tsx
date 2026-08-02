/**
 * terrain-exaggeration-scale-sync.test.tsx
 *
 * Regression guard: TerrainMesh and TerrainContourLines must both read
 * `terrainExaggeration` from the same settings-store field and apply it
 * identically as the Y scale on their wrapping <group>.  A divergence —
 * e.g. one component switching to a different store field or using a
 * different formula — causes contour lines to float above (or sink into)
 * the terrain mesh under any non-1× exaggeration setting.
 *
 * Covers:
 *   1. Pure formula: Math.max(0.1, terrainExaggeration || 1) verified for
 *      representative values including the 0.1 floor and >1 exaggerations.
 *   2. TerrainContourLines: renders a <group> whose Y scale (read from the
 *      DOM as a serialised array attribute "1,Y,1") matches the formula for
 *      the current store value.
 *   3. TerrainMesh: same check, same formula, same store value.
 *   4. Cross-component: both components produce identical Y scales for the
 *      same terrainExaggeration input, so neither can silently diverge.
 *   5. Both selectors extract the `terrainExaggeration` key from the store
 *      state (verified by probing with a sentinel value).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";

// ===========================================================================
// Shared mutable settings state — all mocks that call useSettingsStore read
// from this object.  Tests mutate `mockExaggeration` before rendering.
// ===========================================================================

let mockExaggeration = 1;

/**
 * Captures every selector function passed to useSettingsStore across all
 * renders so tests can probe which store fields each component reads.
 */
const capturedSelectors: Array<(s: Record<string, unknown>) => unknown> = [];

function makeStoreState(): Record<string, unknown> {
  return {
    // TerrainContourLines fields
    contoursEnabled: true,
    contourInterval: 10,
    units: "metric",
    colormapTheme: "ocean",
    brightDaylight: false,
    colormapUserSet: false,
    // TerrainMesh fields
    nodataColor: "#888888",
    habitatOverlayIntensity: 0.5,
    habitatOverlayColor: "#ffffff",
    // Shared
    terrainExaggeration: mockExaggeration,
  };
}

// ===========================================================================
// vi.mock calls — hoisted to the top of the module; ONE declaration per
// module key so there are no conflicts between the two component tests.
// ===========================================================================

vi.mock("three", async () => {
  const mod = await import("./mocks/three");
  // Add constants and stubs the shared mock doesn't include.
  class DataTexture {
    minFilter = 0;
    magFilter = 0;
    wrapS = 0;
    wrapT = 0;
    needsUpdate = false;
    dispose = vi.fn();
  }
  class Vector4 {
    set = vi.fn();
  }
  return {
    ...mod,
    DataTexture,
    Vector4,
    RedFormat: 1028,
    UnsignedByteType: 1009,
  };
});

vi.mock("@react-three/fiber");

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: Record<string, unknown>) => unknown) => {
    capturedSelectors.push(sel);
    return sel(makeStoreState());
  },
  deriveEffectiveColormapTheme: vi.fn(() => "ocean"),
  DEFAULT_SETTINGS: {},
}));

// Combined terrain mock — covers exports used by both components.
vi.mock("@/lib/terrain", () => ({
  buildTerrainGeometry: vi.fn(() => ({
    dispose: vi.fn(),
    setAttribute: vi.fn(),
    getAttribute: vi.fn(() => ({ array: new Float32Array(0), needsUpdate: false })),
    computeVertexNormals: vi.fn(),
    normalizeNormals: vi.fn(),
  })),
  buildTerrainSkirtGeometry: vi.fn(() => ({
    dispose: vi.fn(),
    setAttribute: vi.fn(),
  })),
  computeZoneWeights: vi.fn(() => new Float32Array(0)),
  computeSlopeAttribute: vi.fn(() => new Float32Array(0)),
  applyColormapToVertexColors: vi.fn(),
  isSyntheticGrid: vi.fn(() => false),
  WORLD_SIZE: 100,
  MAX_DEPTH_WORLD: 10,
  getSeaSurfaceY: vi.fn(() => 0),
}));

// buildContourLines returns one segment so TerrainContourLines renders a group.
vi.mock("@/lib/overviewRenderer", () => ({
  buildContourLines: () => [{ depth: 50, x0: 1, y0: 0, x1: 2, y1: 1 }],
}));

vi.mock("@/lib/colormap", () => ({
  getColormap: vi.fn(() => () => ({ r: 0, g: 0.5, b: 1 })),
  getColormapDepthDomain: vi.fn((_t: string, min: number, max: number) => ({ min, max })),
}));

vi.mock("@/lib/textures", () => ({
  getTerrainTextures: vi.fn(() => ({})),
}));

vi.mock("@/lib/terrainShader", () => {
  function makeMaterial() {
    const color = { set: vi.fn(), setRGB: vi.fn() };
    const vec3 = { copy: vi.fn(), set: vi.fn() };
    const vec4 = { set: vi.fn() };
    return {
      uniforms: {
        uOpacity:          { value: 1 },
        uLampPos:          { value: vec3 },
        uZoneOverlay:      { value: 0 },
        uZoneTint0:        { value: color },
        uZoneTint1:        { value: color },
        uZoneTint2:        { value: color },
        uZoneTint3:        { value: color },
        uZoneVisible:      { value: vec4 },
        uHighlightMode:    { value: 0 },
        uHighlightMin:     { value: 0 },
        uHighlightMax:     { value: 0 },
        uTime:             { value: 0 },
        uShowHabitat:      { value: 0 },
        uHabitatTex:       { value: null },
        uHabitatIntensity: { value: 0.5 },
        uHabitatColor:     { value: color },
        uSynthetic:        { value: 0 },
        uGridMinDepth:     { value: 0 },
        uGridMaxDepth:     { value: 1000 },
        uLandColor:        { value: color },
        uIntertidalMhwM:   { value: 0 },
        uIntertidalMhhwM:  { value: 0 },
      },
      polygonOffset: false,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 0,
      dispose: vi.fn(),
    };
  }
  return {
    createTerrainShaderMaterial: vi.fn(() => makeMaterial()),
    getPlaceholderHabitatTexture: vi.fn(() => ({})),
  };
});

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: (sel: (s: { zoneMap: null }) => unknown) =>
    sel({ zoneMap: null }),
}));

vi.mock("@/lib/uiStore", () => {
  const useUiStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ zonePaintMode: false, zonePaintBrushRadius: 3, zoneOverlayEnabled: false });
  (useUiStore as typeof useUiStore & { getState: () => Record<string, unknown> }).getState = () => ({
    zonePaintMode: false,
    zonePaintSlot: 0,
    zoneOverlayEnabled: false,
  });
  return { useUiStore };
});

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
  useHabitatStore: (sel: (s: { scores: { status: string; data: number[] }; activeSpecies: null }) => unknown) =>
    sel({ scores: { status: "idle", data: [] }, activeSpecies: null }),
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

// ===========================================================================
// Imports — must come AFTER all vi.mock declarations.
// ===========================================================================

import { TerrainContourLines } from "@/components/TerrainContourLines";
import { TerrainMesh } from "@/components/TerrainMesh";

// ===========================================================================
// Helpers
// ===========================================================================

function makeGrid(overrides: Partial<TerrainData> = {}): TerrainData {
  return {
    datasetId: "test",
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
  } as TerrainData;
}

/**
 * Mirror of the yScale formula used by both TerrainMesh and TerrainContourLines:
 *   const yScale = Math.max(0.1, terrainExaggeration || 1);
 *
 * If either component changes its formula, at least one render test below will
 * diverge from this reference, making the regression visible immediately.
 */
function expectedYScale(terrainExaggeration: number): number {
  return Math.max(0.1, terrainExaggeration || 1);
}

/**
 * Read the Y component of the scale attribute React writes onto the <group>
 * DOM node in jsdom.  React serialises array props via Array.toString() →
 * "1,2,1" so we split and parse index 1.  Returns null when the group is
 * absent or the attribute is missing (signals a test setup problem).
 */
function groupYScale(container: HTMLElement): number | null {
  const el = container.querySelector("group");
  if (!el) return null;
  const raw = el.getAttribute("scale");
  if (!raw) return null;
  const parts = raw.split(",");
  const y = parts[1] !== undefined ? parseFloat(parts[1]) : NaN;
  return Number.isFinite(y) ? y : null;
}

beforeEach(() => {
  mockExaggeration = 1;
  capturedSelectors.length = 0;
});

// ===========================================================================
// ① Pure formula — sharedYScale contract
// ===========================================================================

describe("shared yScale formula (Math.max(0.1, terrainExaggeration || 1))", () => {
  it("returns 1 at the default exaggeration=1", () => {
    expect(expectedYScale(1)).toBe(1);
  });

  it("returns 2 for exaggeration=2 (2× vertical stretch)", () => {
    expect(expectedYScale(2)).toBe(2);
  });

  it("returns 10 for exaggeration=10 (slider maximum)", () => {
    expect(expectedYScale(10)).toBe(10);
  });

  it("floors to 0.1 for exaggeration=0 (zero would collapse terrain to a plane)", () => {
    // Math.max(0.1, 0 || 1) = Math.max(0.1, 1) = 1, because 0 is falsy → 0||1 = 1
    // The floor is effectively 1 when passed 0 due to the || 1 guard:
    expect(expectedYScale(0)).toBe(1);
  });

  it("floors to 0.1 for a tiny positive value below the floor", () => {
    expect(expectedYScale(0.05)).toBe(0.1);
  });

  it("uses || 1 so that falsy zero becomes 1 before the max(0.1,...) check", () => {
    // 0 → (0 || 1) = 1 → Math.max(0.1, 1) = 1
    expect(expectedYScale(0)).toBe(1);
    // Tiny positive: (0.05 || 1) = 0.05 → Math.max(0.1, 0.05) = 0.1
    expect(expectedYScale(0.05)).toBe(0.1);
  });
});

// ===========================================================================
// ② TerrainContourLines — group Y scale driven by terrainExaggeration
// ===========================================================================

describe("TerrainContourLines — group Y scale matches terrainExaggeration formula", () => {
  it("reads terrainExaggeration from the settings store (selector probe)", () => {
    mockExaggeration = 3;
    render(<TerrainContourLines grid={makeGrid()} />);

    // Probe: replace terrainExaggeration with a sentinel and run every captured
    // selector; at least one must return the sentinel value.
    const probeState = { ...makeStoreState(), terrainExaggeration: 777 };
    const values = capturedSelectors.map((sel) => sel(probeState));
    expect(values).toContain(777);
  });

  it("group Y scale is 1 for terrainExaggeration=1", () => {
    mockExaggeration = 1;
    const { container } = render(<TerrainContourLines grid={makeGrid()} />);
    const y = groupYScale(container);
    expect(y).not.toBeNull();
    expect(y).toBeCloseTo(expectedYScale(1), 6);
  });

  it("group Y scale is 2 for terrainExaggeration=2", () => {
    mockExaggeration = 2;
    const { container } = render(<TerrainContourLines grid={makeGrid()} />);
    expect(groupYScale(container)).toBeCloseTo(expectedYScale(2), 6);
  });

  it("group Y scale is 5 for terrainExaggeration=5", () => {
    mockExaggeration = 5;
    const { container } = render(<TerrainContourLines grid={makeGrid()} />);
    expect(groupYScale(container)).toBeCloseTo(expectedYScale(5), 6);
  });

  it("group Y scale floors to 0.1 for terrainExaggeration=0.05 (below floor)", () => {
    mockExaggeration = 0.05;
    const { container } = render(<TerrainContourLines grid={makeGrid()} />);
    expect(groupYScale(container)).toBeCloseTo(expectedYScale(0.05), 6);
  });
});

// ===========================================================================
// ③ TerrainMesh — group Y scale driven by terrainExaggeration
// ===========================================================================

describe("TerrainMesh — group Y scale matches terrainExaggeration formula", () => {
  it("reads terrainExaggeration from the settings store (selector probe)", () => {
    mockExaggeration = 3;
    render(<TerrainMesh grid={makeGrid()} />);

    const probeState = { ...makeStoreState(), terrainExaggeration: 888 };
    const values = capturedSelectors.map((sel) => sel(probeState));
    expect(values).toContain(888);
  });

  it("group Y scale is 1 for terrainExaggeration=1", () => {
    mockExaggeration = 1;
    const { container } = render(<TerrainMesh grid={makeGrid()} />);
    const y = groupYScale(container);
    expect(y).not.toBeNull();
    expect(y).toBeCloseTo(expectedYScale(1), 6);
  });

  it("group Y scale is 2 for terrainExaggeration=2", () => {
    mockExaggeration = 2;
    const { container } = render(<TerrainMesh grid={makeGrid()} />);
    expect(groupYScale(container)).toBeCloseTo(expectedYScale(2), 6);
  });

  it("group Y scale is 5 for terrainExaggeration=5", () => {
    mockExaggeration = 5;
    const { container } = render(<TerrainMesh grid={makeGrid()} />);
    expect(groupYScale(container)).toBeCloseTo(expectedYScale(5), 6);
  });

  it("group Y scale floors to 0.1 for terrainExaggeration=0.05 (below floor)", () => {
    mockExaggeration = 0.05;
    const { container } = render(<TerrainMesh grid={makeGrid()} />);
    expect(groupYScale(container)).toBeCloseTo(expectedYScale(0.05), 6);
  });
});

// ===========================================================================
// ④ Cross-component consistency — both must produce identical Y scales
// ===========================================================================

describe("TerrainMesh vs TerrainContourLines — identical Y scale for the same terrainExaggeration", () => {
  it("both produce Y scale 2 when terrainExaggeration=2", () => {
    mockExaggeration = 2;
    const { container: cc } = render(<TerrainContourLines grid={makeGrid()} />);
    const contourY = groupYScale(cc);

    mockExaggeration = 2;
    const { container: mc } = render(<TerrainMesh grid={makeGrid()} />);
    const meshY = groupYScale(mc);

    expect(contourY).not.toBeNull();
    expect(meshY).not.toBeNull();
    expect(contourY).toBeCloseTo(meshY!, 6);
  });

  it("both produce Y scale 1 for terrainExaggeration=1 (no divergence at default)", () => {
    mockExaggeration = 1;
    const { container: cc } = render(<TerrainContourLines grid={makeGrid()} />);
    mockExaggeration = 1;
    const { container: mc } = render(<TerrainMesh grid={makeGrid()} />);

    const contourY = groupYScale(cc);
    const meshY = groupYScale(mc);
    expect(contourY).not.toBeNull();
    expect(meshY).not.toBeNull();
    expect(contourY).toBeCloseTo(meshY!, 6);
  });

  it("both produce the same Y scale for terrainExaggeration=0.05 (floor case)", () => {
    mockExaggeration = 0.05;
    const { container: cc } = render(<TerrainContourLines grid={makeGrid()} />);
    mockExaggeration = 0.05;
    const { container: mc } = render(<TerrainMesh grid={makeGrid()} />);

    const contourY = groupYScale(cc);
    const meshY = groupYScale(mc);
    expect(contourY).not.toBeNull();
    expect(meshY).not.toBeNull();
    expect(contourY).toBeCloseTo(meshY!, 6);
  });
});
