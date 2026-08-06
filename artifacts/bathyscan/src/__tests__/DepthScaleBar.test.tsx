import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithProviders as render } from "./setup";
import { DepthScaleBar } from "@/components/DepthScaleBar";
import { usePaletteStore } from "@/lib/paletteStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { DEPTH_BAND_BOUNDARIES_FT } from "@/lib/colormap";
import type { VisibleDataset } from "@/lib/terrainStore";

const FT_TO_M = 0.3048;

// mockTerrain: minDepth=10 m (32.8 ft), maxDepth=160 m (524.9 ft)
// Band boundaries within range: 50, 100, 150, 200, 250, 300, 350, 450 ft
// Boundaries outside range: 0 ft (0 m < 10 m), 600 ft (182.9 m > 160 m), 2000 ft
const mockTerrain = {
  datasetId: "test-ds",
  resolution: 4,
  width: 4,
  height: 4,
  depths: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160],
  minDepth: 10,
  maxDepth: 160,
  minLon: -120,
  maxLon: -119,
  minLat: 47,
  maxLat: 48,
  waterType: "saltwater" as const,
};

let terrain: typeof mockTerrain | null = mockTerrain;

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain }),
}));

// Mutable visible-datasets list for union-range tests.
let mockVisibleDatasets: VisibleDataset[] = [];

vi.mock("@/lib/terrainStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/terrainStore")>();
  return {
    ...actual,
    useTerrainStore: (selector: (s: { visibleDatasets: VisibleDataset[] }) => unknown) =>
      selector({ visibleDatasets: mockVisibleDatasets }),
  };
});

// jsdom's HTMLCanvasElement.toDataURL doesn't reflect drawing operations, so
// we mock colormapCanvas to produce a deterministic, distinguishable canvas
// whose toDataURL encodes the current palette + theme. The point of this
// test is to verify the component re-runs the canvas-generation effect when
// the palette store or theme changes — not to validate the gradient pixels
// themselves (covered by colormap.test.ts).
const colormapCanvasMock = vi.fn();
vi.mock("@/lib/colormap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/colormap")>();
  return {
    ...actual,
    colormapCanvas: (w: number, h: number, theme: string) => {
      colormapCanvasMock(w, h, theme);
      const { shallow, deep } = usePaletteStore.getState();
      const tag = `${theme}|${shallow}|${deep}|${w}x${h}`;
      return {
        width: w,
        height: h,
        toDataURL: () => `data:image/png;base64,${btoa(tag)}`,
      } as unknown as HTMLCanvasElement;
    },
  };
});

describe("DepthScaleBar", () => {
  beforeEach(() => {
    terrain = mockTerrain;
    mockVisibleDatasets = [];
    usePaletteStore.getState().reset();
    useSettingsStore.setState({ colormapTheme: "ocean", units: "imperial" });
    colormapCanvasMock.mockClear();
  });

  it("renders nothing when terrain is null", () => {
    terrain = null;
    const { container } = render(<DepthScaleBar />);
    expect(container.firstChild).toBeNull();
    expect(colormapCanvasMock).not.toHaveBeenCalled();
  });

  it("renders an img and populates its src from colormapCanvas", () => {
    const { container } = render(<DepthScaleBar />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(colormapCanvasMock).toHaveBeenCalledWith(20, 200, "ocean");
    expect(img?.getAttribute("src") ?? "").toMatch(/^data:image\/png/);
  });

  it("regenerates the canvas image when the shallow palette colour changes", () => {
    const { container } = render(<DepthScaleBar />);
    const img = container.querySelector("img")!;
    const before = img.getAttribute("src");
    const callsBefore = colormapCanvasMock.mock.calls.length;

    act(() => {
      usePaletteStore.getState().setShallow("#ff00ff");
    });

    const after = img.getAttribute("src");
    expect(colormapCanvasMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(after).toMatch(/^data:image\/png/);
    expect(after).not.toEqual(before);
  });

  it("regenerates the canvas image when the deep palette colour changes", () => {
    const { container } = render(<DepthScaleBar />);
    const img = container.querySelector("img")!;
    const before = img.getAttribute("src");
    const callsBefore = colormapCanvasMock.mock.calls.length;

    act(() => {
      usePaletteStore.getState().setDeep("#00ff88");
    });

    const after = img.getAttribute("src");
    expect(colormapCanvasMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(after).toMatch(/^data:image\/png/);
    expect(after).not.toEqual(before);
  });

  it("regenerates the canvas image when the colormap theme changes", () => {
    const { container } = render(<DepthScaleBar />);
    const img = container.querySelector("img")!;
    const before = img.getAttribute("src");
    const callsBefore = colormapCanvasMock.mock.calls.length;

    act(() => {
      useSettingsStore.setState({ colormapTheme: "thermal" });
    });

    const after = img.getAttribute("src");
    const themedCall = colormapCanvasMock.mock.calls
      .slice(callsBefore)
      .find((c) => c[2] === "thermal");
    expect(themedCall).toBeTruthy();
    expect(after).toMatch(/^data:image\/png/);
    expect(after).not.toEqual(before);
  });

  describe("expanded tick labels", () => {
    it("shows no ticks in collapsed state", () => {
      const { queryByTestId } = render(<DepthScaleBar />);
      expect(queryByTestId("depth-tick")).toBeNull();
    });

    it("shows tick marks after expanding the legend", () => {
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      expect(ticks.length).toBeGreaterThan(0);
    });

    it("always includes pinned __min and __max endpoint ticks", () => {
      // minDepth=10m → 33 ft, maxDepth=160m → 525 ft
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      // First tick must be the shallowest depth (pos=0, top of ramp)
      expect(labels[0]).toBe("33 ft");
      // Last tick must be the deepest depth (pos=1, bottom of ramp)
      expect(labels[labels.length - 1]).toBe("525 ft");
    });

    it("shows __min and __max endpoint ticks even when no band boundary falls within the dataset range (shallow dataset)", () => {
      // A very shallow dataset: 0.1 m – 1.5 m. No band boundary from the
      // default palette (first one is 50 ft = 15.24 m) falls within [0.1, 1.5].
      terrain = { ...mockTerrain, minDepth: 0.1, maxDepth: 1.5 };
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      // Only the two endpoint ticks should appear (no intermediate boundaries in range).
      expect(ticks).toHaveLength(2);
      // Labels should represent the actual min/max, not a band boundary.
      expect(labels[0]).toBe("0 ft");   // 0.1 m rounds to 0 ft
      expect(labels[1]).toBe("5 ft");   // 1.5 m rounds to 5 ft
    });

    it("only shows ticks within the terrain depth range plus the two endpoint ticks", () => {
      // minDepth=10m (32.8 ft), maxDepth=160m (524.9 ft)
      // Band boundaries within raw range: 50, 100, 150, 200, 250, 300, 350, 450 ft
      // After 8% endpoint guard: 50 ft (pos≈0.035) is suppressed; rest stay.
      // So intermediate count = 7, plus 2 endpoints = 9 total.
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");

      const depthSpan = mockTerrain.maxDepth - mockTerrain.minDepth; // 150 m
      const GUARD = 0.08;
      const inRangeBoundaries = DEPTH_BAND_BOUNDARIES_FT.filter((ft) => {
        const m = ft * FT_TO_M;
        const pos = (m - mockTerrain.minDepth) / depthSpan;
        return pos >= 0 && pos <= 1 && pos > GUARD && pos < 1 - GUARD;
      });
      // 2 pinned endpoints + filtered intermediate boundaries
      expect(ticks).toHaveLength(inRangeBoundaries.length + 2);
    });

    it("suppresses an intermediate boundary tick within 8% of the top endpoint", () => {
      // 50 ft = 15.24 m → pos = (15.24 - 10) / 150 ≈ 0.035 → within 8% of 0 → suppressed
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      // 50 ft should NOT appear as an intermediate tick (suppressed)
      const intermediateLabels = labels.slice(1, -1); // exclude endpoints
      expect(intermediateLabels).not.toContain("164 ft"); // 50 ft boundary in imperial
    });

    it("omits the 0 ft boundary when minDepth is above 0 m", () => {
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      // 0 ft = 0 m which is below minDepth (10 m) → must be absent as an intermediate tick
      const intermediateLabels = labels.slice(1, -1); // exclude pinned endpoints
      expect(intermediateLabels).not.toContain("0 ft");
    });

    it("omits the 600 ft boundary when maxDepth is below 182.9 m", () => {
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      // 600 ft = 182.88 m which is above maxDepth (160 m) → must be absent
      expect(labels).not.toContain("600 ft");
      expect(labels).not.toContain("2,000 ft");
    });

    it("displays tick labels in metric units when the setting is metric", () => {
      useSettingsStore.setState({ colormapTheme: "ocean", units: "metric" });
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      // All tick labels should end with "m" (metres) not "ft"
      expect(labels.every((l) => l.endsWith(" m"))).toBe(true);
    });

    it("displays tick labels in imperial units when the setting is imperial", () => {
      useSettingsStore.setState({ colormapTheme: "ocean", units: "imperial" });
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      expect(labels.every((l) => l.endsWith(" ft"))).toBe(true);
    });

    it("uses the union depth range when two active grids are loaded", () => {
      // Grid A: 10–160 m, Grid B: 5–200 m → union: 5–200 m
      const gridA = { ...mockTerrain, datasetId: "grid-a", minDepth: 10, maxDepth: 160 };
      const gridB = { ...mockTerrain, datasetId: "grid-b", minDepth: 5, maxDepth: 200 };
      mockVisibleDatasets = [
        { datasetId: "grid-a", source: "preset" as const, activeGrid: gridA, overviewGrid: null },
        { datasetId: "grid-b", source: "preset" as const, activeGrid: gridB, overviewGrid: null },
      ];
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      // Endpoint ticks must reflect union range: 5 m → 16 ft, 200 m → 656 ft
      expect(labels[0]).toBe("16 ft");             // unionMinDepth = 5 m
      expect(labels[labels.length - 1]).toBe("656 ft"); // unionMaxDepth = 200 m
    });

    it("falls back to terrain min/max when no active grids have loaded data", () => {
      // visibleDatasets all have activeGrid=null → fall back to terrain.minDepth/maxDepth
      mockVisibleDatasets = [
        { datasetId: "ds-a", source: "preset" as const, activeGrid: null, overviewGrid: null },
      ];
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      // Should fall back to mockTerrain: minDepth=10 m → 33 ft, maxDepth=160 m → 525 ft
      expect(labels[0]).toBe("33 ft");
      expect(labels[labels.length - 1]).toBe("525 ft");
    });

    it("shows a single endpoint label without crashing for a flat dataset", () => {
      // Flat dataset: minDepth === maxDepth (no span).
      terrain = { ...mockTerrain, minDepth: 50, maxDepth: 50 };
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      // depthSpan = 0 → no intermediate ticks, only __min and __max
      // Both endpoints are at the same depth (164 ft), but they are distinct keys.
      const ticks = getAllByTestId("depth-tick");
      expect(ticks.length).toBe(2);
      const labels = ticks.map((t) => t.textContent ?? "");
      expect(labels[0]).toBe("164 ft"); // 50 m in ft
      expect(labels[1]).toBe("164 ft");
    });
  });
});
