/**
 * TerrainContourLines — unit tests.
 *
 * Covers:
 *   1. Component renders nothing (returns null) when contoursEnabled = false.
 *   2. buildContourLines is NOT called when contoursEnabled = false.
 *   3. Interval-to-metres conversion for metric units (pass-through).
 *   4. Interval-to-metres conversion for imperial units (feet → metres).
 *   5. Interval-to-metres conversion for nautical units (fathoms → metres).
 *
 * All Three.js GPU objects are replaced with lightweight stubs so the tests
 * run in a jsdom environment without a WebGL context.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Three.js stub — only the constructors actually reachable in jsdom are needed.
// LineBasicMaterial runs unconditionally (outer useMemo); BufferGeometry and
// BufferAttribute only run when segments are produced.
// ---------------------------------------------------------------------------

/**
 * Tracks every BufferGeometry instance created during a test so we can
 * inspect setAttribute calls after render. The array is cleared in beforeEach.
 * Must be prefixed with "mock" so Vitest's hoist pass keeps the reference.
 */
const mockGeoInstances: Array<{ setAttribute: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];

vi.mock("three", () => {
  class LineBasicMaterial {
    dispose = vi.fn();
  }
  class BufferGeometry {
    setAttribute = vi.fn();
    dispose = vi.fn();
    constructor() {
      mockGeoInstances.push(this as InstanceType<typeof BufferGeometry>);
    }
  }
  class BufferAttribute {
    constructor(public array: Float32Array, public itemSize: number) {}
  }
  return { LineBasicMaterial, BufferGeometry, BufferAttribute };
});

// ---------------------------------------------------------------------------
// Settings store mock — controlled via `mockSettings` below.
// ---------------------------------------------------------------------------

type MockSettings = {
  contoursEnabled: boolean;
  contourInterval: number;
  units: string;
  colormapTheme: string;
  brightDaylight: boolean;
  colormapUserSet: boolean;
  terrainExaggeration: number;
};

let mockSettings: MockSettings = {
  contoursEnabled: true,
  contourInterval: 10,
  units: "metric",
  colormapTheme: "ocean",
  brightDaylight: false,
  colormapUserSet: false,
  terrainExaggeration: 1,
};

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: MockSettings) => unknown) => sel(mockSettings),
  deriveEffectiveColormapTheme: () => "ocean",
}));

// ---------------------------------------------------------------------------
// Contour-line builder mock — returns empty by default so the geometry path
// does not proceed to GPU object creation, but the call is still recorded.
// ---------------------------------------------------------------------------

const buildContourLinesMock = vi.fn((..._args: unknown[]) => [] as unknown[]);

vi.mock("@/lib/overviewRenderer", () => ({
  buildContourLines: (...args: unknown[]) => buildContourLinesMock(...args),
}));

// ---------------------------------------------------------------------------
// Colormap + terrain constants stubs
// ---------------------------------------------------------------------------

vi.mock("@/lib/colormap", () => ({
  getColormap: () => () => ({ r: 0, g: 0.5, b: 1 }),
}));

vi.mock("@/lib/terrain", () => ({
  WORLD_SIZE: 100,
  MAX_DEPTH_WORLD: 10,
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks are hoisted
// ---------------------------------------------------------------------------

import { TerrainContourLines } from "@/components/TerrainContourLines";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGrid(overrides: Partial<TerrainData> = {}): TerrainData {
  return {
    datasetId: "test",
    width: 4,
    height: 4,
    depths: Array(16).fill(0).map((_, i) => i * 10) as number[],
    minDepth: 0,
    maxDepth: 150,
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
    resolution: 4,
    ...overrides,
  } as TerrainData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  buildContourLinesMock.mockClear();
  mockGeoInstances.length = 0;
  mockSettings = {
    contoursEnabled: true,
    contourInterval: 10,
    units: "metric",
    colormapTheme: "ocean",
    brightDaylight: false,
    colormapUserSet: false,
    terrainExaggeration: 1,
  };
});

describe("TerrainContourLines — renders nothing when contoursEnabled is false", () => {
  it("renders nothing (null) when contoursEnabled = false", () => {
    mockSettings.contoursEnabled = false;
    const { container } = render(<TerrainContourLines grid={makeGrid()} />);
    expect(container.firstChild).toBeNull();
  });

  it("does not call buildContourLines when contoursEnabled = false", () => {
    mockSettings.contoursEnabled = false;
    render(<TerrainContourLines grid={makeGrid()} />);
    expect(buildContourLinesMock).not.toHaveBeenCalled();
  });

  it("renders nothing (null) when contoursEnabled = true but contourInterval = 0", () => {
    mockSettings.contoursEnabled = true;
    mockSettings.contourInterval = 0;
    const { container } = render(<TerrainContourLines grid={makeGrid()} />);
    expect(container.firstChild).toBeNull();
  });

  it("does not call buildContourLines when contourInterval converts to 0 metres", () => {
    mockSettings.contoursEnabled = true;
    mockSettings.contourInterval = 0;
    render(<TerrainContourLines grid={makeGrid()} />);
    expect(buildContourLinesMock).not.toHaveBeenCalled();
  });
});

describe("TerrainContourLines — interval-to-metres conversion", () => {
  it("passes contourInterval straight through to buildContourLines when units = metric", () => {
    mockSettings.units = "metric";
    mockSettings.contourInterval = 25;
    render(<TerrainContourLines grid={makeGrid()} />);
    expect(buildContourLinesMock).toHaveBeenCalledWith(
      expect.anything(),
      25,
    );
  });

  it("converts feet to metres when units = imperial (feet ÷ 3.28084)", () => {
    mockSettings.units = "imperial";
    mockSettings.contourInterval = 32.8084;
    render(<TerrainContourLines grid={makeGrid()} />);
    const calledWith = buildContourLinesMock.mock.calls[0]![1] as number;
    expect(calledWith).toBeCloseTo(32.8084 / 3.28084, 5);
  });

  it("converts fathoms to metres when units = nautical (fathoms × 1.8288)", () => {
    mockSettings.units = "nautical";
    mockSettings.contourInterval = 5;
    render(<TerrainContourLines grid={makeGrid()} />);
    const calledWith = buildContourLinesMock.mock.calls[0]![1] as number;
    expect(calledWith).toBeCloseTo(5 * 1.8288, 5);
  });

  it("metric with a round interval passes the exact same number to buildContourLines", () => {
    mockSettings.units = "metric";
    mockSettings.contourInterval = 50;
    render(<TerrainContourLines grid={makeGrid()} />);
    expect(buildContourLinesMock).toHaveBeenCalledWith(expect.anything(), 50);
  });

  it("imperial conversion result is strictly less than the foot value (1 m > 1 ft)", () => {
    mockSettings.units = "imperial";
    mockSettings.contourInterval = 100;
    render(<TerrainContourLines grid={makeGrid()} />);
    const calledWith = buildContourLinesMock.mock.calls[0]![1] as number;
    expect(calledWith).toBeLessThan(100);
    expect(calledWith).toBeCloseTo(100 / 3.28084, 4);
  });

  it("nautical conversion result is greater than the fathom value (1 fathom > 1 m)", () => {
    mockSettings.units = "nautical";
    mockSettings.contourInterval = 10;
    render(<TerrainContourLines grid={makeGrid()} />);
    const calledWith = buildContourLinesMock.mock.calls[0]![1] as number;
    expect(calledWith).toBeGreaterThan(10);
    expect(calledWith).toBeCloseTo(10 * 1.8288, 4);
  });
});

// ---------------------------------------------------------------------------
// GPU geometry construction — hot path where real segments become BufferGeometry
// ---------------------------------------------------------------------------

/**
 * Helpers for the GPU geometry tests.
 *
 * Grid layout: 4×4 nodes → wSegs = hSegs = 3.
 * WORLD_SIZE = 100 (mocked).  MAX_DEPTH_WORLD = 10 (mocked).
 * getColormap always returns { r:0, g:0.5, b:1 } (mocked).
 *
 * World-coordinate formula (from source):
 *   worldX = (x0 / wSegs - 0.5) * WORLD_SIZE
 *   worldZ = (y0 / hSegs - 0.5) * WORLD_SIZE
 */

type Segment = { depth: number; x0: number; y0: number; x1: number; y1: number };

function renderWithSegments(segments: Segment[]) {
  buildContourLinesMock.mockReturnValueOnce(segments);
  const grid = makeGrid(); // width=4, height=4, minDepth=0, maxDepth=150
  render(<TerrainContourLines grid={grid} />);
}

/** Retrieve the Float32Array passed as the first argument to setAttribute("position", ...). */
function capturedPositions(): Float32Array {
  const geo = mockGeoInstances[0]!;
  const call = geo.setAttribute.mock.calls.find(
    (c: unknown[]) => c[0] === "position",
  )!;
  return (call[1] as { array: Float32Array }).array;
}

/** Retrieve the Float32Array passed as the first argument to setAttribute("color", ...). */
function capturedColors(): Float32Array {
  const geo = mockGeoInstances[0]!;
  const call = geo.setAttribute.mock.calls.find(
    (c: unknown[]) => c[0] === "color",
  )!;
  return (call[1] as { array: Float32Array }).array;
}

describe("TerrainContourLines — GPU geometry construction (segments → BufferGeometry)", () => {
  it("calls BufferGeometry.setAttribute with 'position' and 'color' for 2 segments", () => {
    renderWithSegments([
      { depth: 50, x0: 1, y0: 0, x1: 2, y1: 1 },
      { depth: 100, x0: 0, y0: 1, x1: 1, y1: 2 },
    ]);

    const geo = mockGeoInstances[0]!;
    const attrNames = geo.setAttribute.mock.calls.map((c: unknown[]) => c[0]);
    expect(attrNames).toContain("position");
    expect(attrNames).toContain("color");
  });

  it("position array has segments × 2 vertices × 3 floats length for 2 segments", () => {
    renderWithSegments([
      { depth: 50, x0: 1, y0: 0, x1: 2, y1: 1 },
      { depth: 100, x0: 0, y0: 1, x1: 1, y1: 2 },
    ]);

    const positions = capturedPositions();
    // 2 segments × 2 vertices × 3 floats = 12
    expect(positions.length).toBe(12);
  });

  it("color array has segments × 2 vertices × 3 floats length for 2 segments", () => {
    renderWithSegments([
      { depth: 50, x0: 1, y0: 0, x1: 2, y1: 1 },
      { depth: 100, x0: 0, y0: 1, x1: 1, y1: 2 },
    ]);

    const colors = capturedColors();
    // 2 segments × 2 vertices × 3 floats = 12
    expect(colors.length).toBe(12);
  });

  it("position array has correct length for 3 segments (18 floats)", () => {
    renderWithSegments([
      { depth: 30, x0: 0, y0: 0, x1: 1, y1: 0 },
      { depth: 60, x0: 1, y0: 1, x1: 2, y1: 1 },
      { depth: 90, x0: 2, y0: 2, x1: 3, y1: 2 },
    ]);

    expect(capturedPositions().length).toBe(18);
    expect(capturedColors().length).toBe(18);
  });

  it("world-x for first vertex uses (x0 / wSegs - 0.5) * WORLD_SIZE", () => {
    // Grid: width=4 → wSegs=3.  Segment x0=1.
    // worldX = (1/3 - 0.5) * 100 = -16.666...
    renderWithSegments([{ depth: 50, x0: 1, y0: 0, x1: 2, y1: 0 }]);

    const positions = capturedPositions();
    const expectedX = (1 / 3 - 0.5) * 100;
    expect(positions[0]).toBeCloseTo(expectedX, 4);
  });

  it("world-z for first vertex uses (y0 / hSegs - 0.5) * WORLD_SIZE", () => {
    // Grid: height=4 → hSegs=3.  Segment y0=2.
    // worldZ = (2/3 - 0.5) * 100 = 16.666...
    renderWithSegments([{ depth: 50, x0: 0, y0: 2, x1: 1, y1: 3 }]);

    const positions = capturedPositions();
    // positions layout: [x0, y, z0,  x1, y, z1]  → index 2 is z of first vertex
    const expectedZ = (2 / 3 - 0.5) * 100;
    expect(positions[2]).toBeCloseTo(expectedZ, 4);
  });

  it("world-x for second vertex uses (x1 / wSegs - 0.5) * WORLD_SIZE", () => {
    // Segment x1=3 → worldX = (3/3 - 0.5) * 100 = 50
    renderWithSegments([{ depth: 50, x0: 0, y0: 0, x1: 3, y1: 0 }]);

    const positions = capturedPositions();
    // Second vertex starts at index 3
    const expectedX = (3 / 3 - 0.5) * 100;
    expect(positions[3]).toBeCloseTo(expectedX, 4);
  });

  it("both vertices of a segment share the same worldY value", () => {
    renderWithSegments([{ depth: 75, x0: 1, y0: 1, x1: 2, y1: 2 }]);

    const positions = capturedPositions();
    // First vertex Y is at index 1, second vertex Y is at index 4
    expect(positions[1]).toBeCloseTo(positions[4]!, 6);
  });

  it("color arrays carry the colormap RGB for both vertices of each segment", () => {
    // getColormap mock returns { r:0, g:0.5, b:1 } for every t01
    renderWithSegments([{ depth: 50, x0: 0, y0: 0, x1: 1, y1: 1 }]);

    const colors = capturedColors();
    // Vertex 0
    expect(colors[0]).toBeCloseTo(0, 5);   // r
    expect(colors[1]).toBeCloseTo(0.5, 5); // g
    expect(colors[2]).toBeCloseTo(1, 5);   // b
    // Vertex 1 (identical — same iso-depth)
    expect(colors[3]).toBeCloseTo(0, 5);
    expect(colors[4]).toBeCloseTo(0.5, 5);
    expect(colors[5]).toBeCloseTo(1, 5);
  });

  it("setAttribute is called exactly twice (position + color) per geometry", () => {
    renderWithSegments([{ depth: 50, x0: 1, y0: 1, x1: 2, y1: 2 }]);

    const geo = mockGeoInstances[0]!;
    expect(geo.setAttribute).toHaveBeenCalledTimes(2);
  });
});
