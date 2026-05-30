import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithProviders as render } from "./setup";
import { DepthScaleBar } from "@/components/DepthScaleBar";
import { usePaletteStore } from "@/lib/paletteStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { DEPTH_BAND_BOUNDARIES_FT } from "@/lib/colormap";

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

    it("only shows ticks within the terrain depth range", () => {
      // minDepth=10m (32.8 ft), maxDepth=160m (524.9 ft)
      // In-range boundaries: 50, 100, 150, 200, 250, 300, 350, 450 ft (8 ticks)
      // Out-of-range: 0 ft, 600 ft, 2000 ft
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      // Compute expected count: boundaries where converted metres fall within [minDepth, maxDepth]
      const expected = DEPTH_BAND_BOUNDARIES_FT.filter((ft) => {
        const m = ft * FT_TO_M;
        return m >= mockTerrain.minDepth && m <= mockTerrain.maxDepth;
      });
      expect(ticks).toHaveLength(expected.length);
    });

    it("omits the 0 ft boundary when minDepth is above 0 m", () => {
      const { getByLabelText, getAllByTestId } = render(<DepthScaleBar />);
      act(() => {
        fireEvent.click(getByLabelText("Toggle depth legend"));
      });
      const ticks = getAllByTestId("depth-tick");
      const labels = ticks.map((t) => t.textContent ?? "");
      // 0 ft = 0 m which is below minDepth (10 m) → must be absent
      expect(labels).not.toContain("0 ft");
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
  });
});
