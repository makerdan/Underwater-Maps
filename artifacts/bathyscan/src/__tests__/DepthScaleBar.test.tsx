import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { DepthScaleBar } from "@/components/DepthScaleBar";
import { usePaletteStore } from "@/lib/paletteStore";
import { useSettingsStore } from "@/lib/settingsStore";

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
vi.mock("@/lib/colormap", () => ({
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
}));

describe("DepthScaleBar", () => {
  beforeEach(() => {
    terrain = mockTerrain;
    usePaletteStore.getState().reset();
    useSettingsStore.setState({ colormapTheme: "ocean", units: "metric" });
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
});
