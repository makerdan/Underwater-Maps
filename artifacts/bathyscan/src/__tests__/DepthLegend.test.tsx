import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderWithProviders as render } from "./setup";
import { DepthLegend } from "@/components/DepthLegend";
import { useSettingsStore } from "@/lib/settingsStore";
import { DEPTH_BAND_BOUNDARIES_FT } from "@/lib/colormap";

const FT_TO_M = 0.3048;

// minDepth=10 m (32.8 ft), maxDepth=160 m (524.9 ft)
// In-range boundaries: 50, 100, 150, 200, 250, 300, 350, 450 ft  → 8 ticks
// Out-of-range: 0 ft (0 m < 10 m), 600 ft (182.9 m > 160 m), 2000 ft
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

describe("DepthLegend", () => {
  beforeEach(() => {
    terrain = mockTerrain;
    useSettingsStore.setState({ units: "imperial" });
  });

  it("renders nothing when terrain is null", () => {
    terrain = null;
    const { container } = render(<DepthLegend />);
    expect(container.firstChild).toBeNull();
  });

  it("renders tick marks within the terrain depth range", () => {
    const { getAllByText } = render(<DepthLegend />);
    const expected = DEPTH_BAND_BOUNDARIES_FT.filter((ft) => {
      const m = ft * FT_TO_M;
      return m >= mockTerrain.minDepth && m <= mockTerrain.maxDepth;
    });
    // Every in-range boundary should produce a visible label
    expect(expected.length).toBeGreaterThan(0);
    // 50 ft = 15 m is within [10, 160] → should be rendered
    expect(getAllByText("50 ft")).toHaveLength(1);
    expect(getAllByText("450 ft")).toHaveLength(1);
  });

  it("omits the 0 ft boundary when minDepth > 0", () => {
    const { queryByText } = render(<DepthLegend />);
    // 0 ft = 0 m is below minDepth (10 m)
    expect(queryByText("0 ft")).toBeNull();
  });

  it("omits boundaries above the dataset's maxDepth", () => {
    const { queryByText } = render(<DepthLegend />);
    // 600 ft = 182.9 m > maxDepth (160 m)
    expect(queryByText("600 ft")).toBeNull();
    expect(queryByText("2,000 ft")).toBeNull();
  });

  it("shows only in-range tick marks — correct count", () => {
    const { getByTestId } = render(<DepthLegend />);
    const spans = getByTestId("depth-legend-ticks").querySelectorAll("span");
    const expected = DEPTH_BAND_BOUNDARIES_FT.filter((ft) => {
      const m = ft * FT_TO_M;
      return m >= mockTerrain.minDepth && m <= mockTerrain.maxDepth;
    });
    expect(spans.length).toBe(expected.length);
  });

  it("displays tick labels in metric units when the setting is metric", () => {
    useSettingsStore.setState({ units: "metric" });
    const { getByTestId } = render(<DepthLegend />);
    const spans = Array.from(
      getByTestId("depth-legend-ticks").querySelectorAll("span"),
    );
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((s) => s.textContent?.endsWith(" m"))).toBe(true);
  });

  it("displays tick labels in imperial units when the setting is imperial", () => {
    useSettingsStore.setState({ units: "imperial" });
    const { getByTestId } = render(<DepthLegend />);
    const spans = Array.from(
      getByTestId("depth-legend-ticks").querySelectorAll("span"),
    );
    expect(spans.every((s) => s.textContent?.endsWith(" ft"))).toBe(true);
  });

  it("renders no ticks when terrain has zero depth span (flat dataset)", () => {
    terrain = { ...mockTerrain, minDepth: 50, maxDepth: 50 };
    const { getByTestId } = render(<DepthLegend />);
    const spans = getByTestId("depth-legend-ticks").querySelectorAll("span");
    expect(spans.length).toBe(0);
  });
});
