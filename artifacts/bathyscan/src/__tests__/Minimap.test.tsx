import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders as render } from "./setup";

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

import { Minimap, drawArrow, drawHeatmap } from "@/components/Minimap";
import { useUiStore } from "@/lib/uiStore";
import { WORLD_SIZE, NO_DATA_COLOR } from "@/lib/terrain";
import { usePaletteStore } from "@/lib/paletteStore";
import type { ColormapTheme } from "@/lib/settingsStore";

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

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetMarkers: () => ({ data: [] }),
    getGetMarkersQueryKey: (p: unknown) => ["markers", p],
  }),
);

describe("Minimap", () => {
  beforeEach(() => {
    terrain = mockTerrain;
    useUiStore.setState({ pendingDropIn: null, overviewOpen: false });
  });

  it("renders nothing when terrain is null", () => {
    terrain = null;
    const { container } = render(<Minimap />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a canvas when terrain is loaded", () => {
    const { container } = render(<Minimap />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(180);
    expect(canvas?.height).toBe(180);
  });

  it("click on minimap canvas fires setPendingDropIn with world coords", () => {
    const { container } = render(<Minimap />);
    const canvas = container.querySelector("canvas")!;

    // Mock getBoundingClientRect → 180x180 at origin
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 180, bottom: 180, width: 180, height: 180, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.click(canvas, { clientX: 90, clientY: 90 });

    const pending = useUiStore.getState().pendingDropIn;
    expect(pending).not.toBeNull();
    // Centre click → (0, 0) in world coords (worldX = 90/180 * WORLD_SIZE - WORLD_SIZE/2)
    expect(pending!.worldX).toBeCloseTo(0, 5);
    expect(pending!.worldZ).toBeCloseTo(0, 5);

    // Click at (0,0) corner → top-left is now North-West in North-up orientation.
    // worldX = -WORLD_SIZE/2 (west edge, unchanged), worldZ = +WORLD_SIZE/2 (north edge, flipped).
    fireEvent.click(canvas, { clientX: 0, clientY: 0 });
    expect(useUiStore.getState().pendingDropIn!.worldX).toBeCloseTo(-WORLD_SIZE / 2, 5);
    expect(useUiStore.getState().pendingDropIn!.worldZ).toBeCloseTo(WORLD_SIZE / 2, 5);
  });

  it("OVERVIEW button opens overview", () => {
    const { getByText } = render(<Minimap />);
    fireEvent.click(getByText(/OVERVIEW/));
    expect(useUiStore.getState().overviewOpen).toBe(true);
  });

  it("renders N, S, E, and W direction labels", () => {
    const { getByTestId } = render(<Minimap />);
    expect(getByTestId("minimap-north").textContent).toBe("N");
    expect(getByTestId("minimap-south").textContent).toBe("S");
    expect(getByTestId("minimap-east").textContent).toBe("E");
    expect(getByTestId("minimap-west").textContent).toBe("W");
  });

  it("N label is at the top edge (top ≤ 10px) and S label is at the bottom edge (bottom ≤ 10px)", () => {
    const { getByTestId } = render(<Minimap />);
    const north = getByTestId("minimap-north");
    const south = getByTestId("minimap-south");

    const topPx = parseFloat(north.style.top);
    expect(topPx).toBeLessThanOrEqual(10);

    const bottomPx = parseFloat(south.style.bottom);
    expect(bottomPx).toBeLessThanOrEqual(10);
  });

  it("click at top-center of minimap canvas teleports to North (worldZ > 0)", () => {
    const { container } = render(<Minimap />);
    const canvas = container.querySelector("canvas")!;

    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 180, bottom: 180, width: 180, height: 180, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.click(canvas, { clientX: 90, clientY: 0 });

    const pending = useUiStore.getState().pendingDropIn;
    expect(pending).not.toBeNull();
    expect(pending!.worldZ).toBeGreaterThan(0);
  });
});

describe("drawArrow cardinal directions", () => {
  function makeCtx() {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      shadowColor: "",
      shadowBlur: 0,
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
  }

  // North-up convention: cameraStore heading 180° = North = top of canvas.
  // Arrow rotation formula: (180 - heading) * π/180
  // heading 180 (North) → rotate(0) → arrow points up ✓
  // heading 0  (South) → rotate(π) → arrow points down ✓
  // heading 90 (East)  → rotate(π/2) → arrow points right ✓
  // heading 270 (West) → rotate(-π/2) → arrow points left ✓
  const cases: [string, number][] = [
    ["South (heading 0)", 0],
    ["East (heading 90)", 90],
    ["North (heading 180)", 180],
    ["West (heading 270)", 270],
  ];

  it.each(cases)("rotate is called with (180 - heading) * π/180 for %s", (_label, heading) => {
    const ctx = makeCtx();
    drawArrow(ctx, 0, 0, heading);
    const expected = (180 - heading) * (Math.PI / 180);
    expect(ctx.rotate).toHaveBeenCalledWith(expected);
  });
});

describe("drawHeatmap — full palette domain", () => {
  beforeEach(() => {
    // Ensure the default 10-band ocean palette is active.
    usePaletteStore.getState().reset();
  });

  function makeHeatmapCtx(w: number, h: number) {
    const captured: Uint8ClampedArray[] = [];
    const imageData = {
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    };
    const ctx = {
      createImageData: (_w: number, _h: number) => imageData,
      putImageData: vi.fn((id: typeof imageData) => {
        captured.push(new Uint8ClampedArray(id.data));
      }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, captured };
  }

  it("renders visibly different colors for 5 m vs 120 m depth on the ocean theme", () => {
    // drawHeatmap maps grid cells to a 180x180 canvas; use a 2×1 grid so the
    // two depth values land in predictable canvas columns.
    // depths: [5, 120] — 5 m ≈ band 0 (cyan), 120 m ≈ band 6 (royal blue).
    const depths = [5, 120] as unknown as import("@workspace/api-client-react").DepthsArray;
    const { ctx, captured } = makeHeatmapCtx(180, 180);

    drawHeatmap(ctx, depths, 2, 1, 5, 120, "ocean");

    expect(captured.length).toBeGreaterThan(0);
    const pixels = captured[0]!;

    // Canvas px=0 maps to grid col 0 (depth 5 m); px=179 maps to grid col 1 (depth 120 m).
    const i0 = 0 * 4; // first pixel of the last row (gy flipped)
    const i1 = 179 * 4;
    const r0 = pixels[i0]!, g0 = pixels[i0 + 1]!, b0 = pixels[i0 + 2]!;
    const r1 = pixels[i1]!, g1 = pixels[i1 + 1]!, b1 = pixels[i1 + 2]!;

    const diff = Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1);
    // Pre-fix: both pixels got band 0's color → diff = 0.
    // Post-fix: different bands → diff >> 30.
    expect(diff).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------------------
// drawHeatmap — null depths, topography, and fixed preset themes
// ---------------------------------------------------------------------------

describe("drawHeatmap — null depths, topography cells, and fixed preset themes", () => {
  type DepthsArray = import("@workspace/api-client-react").DepthsArray;

  beforeEach(() => {
    usePaletteStore.getState().reset();
  });

  /** Same 180×180 mock canvas used by the function (W and H are module constants). */
  function makeHeatmapCtx() {
    const imageData = {
      data: new Uint8ClampedArray(180 * 180 * 4),
      width: 180,
      height: 180,
    };
    const captured: Uint8ClampedArray[] = [];
    const ctx = {
      createImageData: () => imageData,
      putImageData: vi.fn((id: typeof imageData) => {
        captured.push(new Uint8ClampedArray(id.data));
      }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, captured };
  }

  /** Read one pixel (r,g,b,a) from a flat 180-wide image-data buffer. */
  function px(data: Uint8ClampedArray, canvasPx: number, canvasPy: number): [number, number, number, number] {
    const i = (canvasPy * 180 + canvasPx) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
  }

  /** Replicate the linToSRGBByte transform used by drawHeatmap for NO_DATA_COLOR. */
  function linToSRGBByte(c: number): number {
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(s * 255)));
  }

  // ── null / undefined depths → NO_DATA_COLOR ────────────────────────────

  it("null-depth pixel renders as NO_DATA_COLOR (sRGB-converted)", () => {
    // Single-cell grid, depth is null → survey gap
    const depths = [null] as unknown as DepthsArray;
    const { ctx, captured } = makeHeatmapCtx();

    drawHeatmap(ctx, depths, 1, 1, 0, 100, "ocean");

    expect(captured.length).toBeGreaterThan(0);
    const data = captured[0]!;

    const expectedR = linToSRGBByte(NO_DATA_COLOR.r);
    const expectedG = linToSRGBByte(NO_DATA_COLOR.g);
    const expectedB = linToSRGBByte(NO_DATA_COLOR.b);

    // Every canvas pixel should be the no-data colour (all cells are null).
    const [r, g, b, a] = px(data, 0, 0);
    expect(a).toBe(255);
    expect(r).toBe(expectedR);
    expect(g).toBe(expectedG);
    expect(b).toBe(expectedB);

    // Spot-check centre pixel as well.
    const [r2, g2, b2] = px(data, 90, 90);
    expect([r2, g2, b2]).toEqual([expectedR, expectedG, expectedB]);
  });

  it("undefined-depth pixel also renders as NO_DATA_COLOR", () => {
    const depths = [undefined] as unknown as DepthsArray;
    const { ctx, captured } = makeHeatmapCtx();

    drawHeatmap(ctx, depths, 1, 1, 0, 100, "thermal");

    const data = captured[0]!;
    const expectedR = linToSRGBByte(NO_DATA_COLOR.r);
    const [r, g, b, a] = px(data, 0, 0);
    expect(a).toBe(255);
    expect(r).toBe(expectedR);
    // null and undefined must produce the identical byte — not the theme colour.
    expect([r, g, b]).toEqual([linToSRGBByte(NO_DATA_COLOR.r), linToSRGBByte(NO_DATA_COLOR.g), linToSRGBByte(NO_DATA_COLOR.b)]);
  });

  it("null-depth cells are a different colour from valid-depth cells in the same heatmap", () => {
    // 2-cell grid: left cell null, right cell has a real depth.
    const depths = [null, 50] as unknown as DepthsArray;
    const { ctx, captured } = makeHeatmapCtx();

    drawHeatmap(ctx, depths, 2, 1, 0, 100, "ocean");

    const data = captured[0]!;
    const [rNull] = px(data, 0, 0);   // left half → null cell
    const [rReal] = px(data, 179, 0); // right half → depth 50 m

    // The null pixel should not match the coloured depth pixel.
    // (They would be equal if the null branch were accidentally falling through
    // into the colour calculation.)
    const expectedNdR = linToSRGBByte(NO_DATA_COLOR.r);
    expect(rNull).toBe(expectedNdR);
    expect(rReal).not.toBe(expectedNdR);
  });

  // ── topography > 0 cells → flat gray (120, 120, 120) ───────────────────

  it("topography > 0 cell renders as flat gray (120, 120, 120)", () => {
    // Single-cell grid: depth 50 m but topography elevation is positive (land).
    const depths = [50] as unknown as DepthsArray;
    const topography = [1]; // > 0 → land

    const { ctx, captured } = makeHeatmapCtx();
    drawHeatmap(ctx, depths, 1, 1, 0, 100, "ocean", topography);

    const data = captured[0]!;
    const [r, g, b, a] = px(data, 0, 0);
    expect(a).toBe(255);
    expect(r).toBe(120);
    expect(g).toBe(120);
    expect(b).toBe(120);
  });

  it("topography = 0 cell is NOT treated as land (renders the depth colour instead)", () => {
    const depths = [50] as unknown as DepthsArray;
    const topography = [0]; // exactly 0 → not land

    const { ctx, captured } = makeHeatmapCtx();
    drawHeatmap(ctx, depths, 1, 1, 0, 100, "ocean", topography);

    const data = captured[0]!;
    const [r, g, b] = px(data, 0, 0);
    // Should NOT be the flat gray — it must be a colour-mapped depth pixel.
    expect([r, g, b]).not.toEqual([120, 120, 120]);
    // And should not be no-data colour.
    expect(r).not.toBe(linToSRGBByte(NO_DATA_COLOR.r));
  });

  it("topography > 0 overrides a valid depth: land colour, not depth colour", () => {
    // 2-cell grid: left is land (topo > 0), right is ocean depth
    const depths = [30, 90] as unknown as DepthsArray;
    const topography = [5, 0]; // left = land, right = ocean

    const { ctx, captured } = makeHeatmapCtx();
    drawHeatmap(ctx, depths, 2, 1, 0, 100, "viridis", topography);

    const data = captured[0]!;
    const [rLand, gLand, bLand] = px(data, 0, 0);
    const [rOcean] = px(data, 179, 0);

    expect([rLand, gLand, bLand]).toEqual([120, 120, 120]);
    expect(rOcean).not.toBe(120); // ocean cell gets a colormap colour, not gray
  });

  // ── fixed preset themes: non-flat gradient ──────────────────────────────

  const FIXED_THEMES: ColormapTheme[] = ["thermal", "grayscale", "viridis", "freshwater"];

  it.each(FIXED_THEMES)(
    'theme "%s" paints a non-flat gradient (shallow ≠ deep pixel)',
    (theme) => {
      // 2-cell grid: one shallow cell, one deep cell.
      const depths = [1, 99] as unknown as DepthsArray;
      const { ctx, captured } = makeHeatmapCtx();

      drawHeatmap(ctx, depths, 2, 1, 1, 99, theme);

      expect(captured.length).toBeGreaterThan(0);
      const data = captured[0]!;

      const [r0, g0, b0] = px(data, 0, 0);   // shallow cell (left)
      const [r1, g1, b1] = px(data, 179, 0); // deep cell (right)

      const diff = Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1);
      // A flat palette would produce diff === 0; any working gradient must differ.
      expect(diff).toBeGreaterThan(0);
    },
  );

  it.each(FIXED_THEMES)(
    'theme "%s" produces at least 3 distinct colours across a 5-step depth gradient',
    (theme) => {
      // 5-cell 1D grid spanning full minDepth→maxDepth
      const depths = [0, 25, 50, 75, 100] as unknown as DepthsArray;
      const { ctx, captured } = makeHeatmapCtx();

      drawHeatmap(ctx, depths, 5, 1, 0, 100, theme);

      const data = captured[0]!;
      const colourSet = new Set<string>();
      for (let gx = 0; gx < 5; gx++) {
        // Sample the canvas column that maps to grid cell gx
        const canvasPx = Math.floor((gx / 5) * 180);
        const [r, g, b] = px(data, canvasPx, 0);
        colourSet.add(`${r},${g},${b}`);
      }
      // A palette with ≥ 2 stops must produce more than 1 distinct colour
      // across a 0→100 range; require at least 3 to catch severely flattened palettes.
      expect(colourSet.size).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(FIXED_THEMES)(
    'theme "%s" never produces the NO_DATA_COLOR or the flat-land gray for a valid depth',
    (theme) => {
      const depths = [50] as unknown as DepthsArray;
      const { ctx, captured } = makeHeatmapCtx();

      drawHeatmap(ctx, depths, 1, 1, 0, 100, theme);

      const data = captured[0]!;
      const [r, g, b] = px(data, 0, 0);

      const expectedNdR = linToSRGBByte(NO_DATA_COLOR.r);
      const expectedNdG = linToSRGBByte(NO_DATA_COLOR.g);
      const expectedNdB = linToSRGBByte(NO_DATA_COLOR.b);

      expect([r, g, b]).not.toEqual([expectedNdR, expectedNdG, expectedNdB]);
      expect([r, g, b]).not.toEqual([120, 120, 120]);
    },
  );
});
