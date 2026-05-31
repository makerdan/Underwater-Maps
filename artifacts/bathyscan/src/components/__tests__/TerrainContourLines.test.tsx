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

vi.mock("three", () => {
  class LineBasicMaterial {
    dispose = vi.fn();
  }
  class BufferGeometry {
    setAttribute = vi.fn();
    dispose = vi.fn();
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

const buildContourLinesMock = vi.fn(() => []);

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
