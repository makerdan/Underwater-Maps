import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders as render } from "./setup";
import type { Marker as MarkerType } from "@workspace/api-client-react";

// Mutable override used by the per-test marker injection below.
// Tests that don't set this get the default empty array.
let mockMarkersOverride: MarkerType[] | null = null;

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

import { Minimap, drawArrow, drawHeatmap, computeMinimapUnionBbox } from "@/components/Minimap";
import { useUiStore } from "@/lib/uiStore";
import { useTerrainStore, type VisibleDataset } from "@/lib/terrainStore";
import { WORLD_SIZE, NO_DATA_COLOR } from "@/lib/terrain";
import { usePaletteStore } from "@/lib/paletteStore";
import type { ColormapTheme } from "@/lib/settingsStore";
import { geographicLonRange, longitudeOnBboxFrame } from "@/lib/geographicBounds";

const mockTerrain = {
  datasetId: "test-ds",
  name: "test-terrain",
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
  centerLon: -119.5,
  centerLat: 47.5,
  waterType: "saltwater" as const,
};

let terrain: typeof mockTerrain | null = mockTerrain;

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain }),
}));

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetMarkers: () => ({ data: mockMarkersOverride ?? [] }),
    getGetMarkersQueryKey: (p: unknown) => ["markers", p],
    getMarkers: async () => mockMarkersOverride ?? [],
  }),
);

// Mock useQueries so the Minimap's multi-dataset marker fetching works without
// a real QueryClient.  Returns mockMarkersOverride for every query slot —
// matching each datasetId query — and deduplication in Minimap collapses them.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueries: ({ queries }: { queries: unknown[] }) =>
      queries.map(() => ({ data: mockMarkersOverride ?? [], dataUpdatedAt: 0 })),
  };
});

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

  // North-up convention: cameraStore heading 0° = North = top of canvas.
  // Arrow rotation formula: heading * π/180
  // heading 0   (North) → rotate(0)     → arrow points up ✓
  // heading 90  (East)  → rotate(π/2)   → arrow points right ✓
  // heading 180 (South) → rotate(π)     → arrow points down ✓
  // heading 270 (West)  → rotate(3π/2)  → arrow points left ✓
  const cases: [string, number, number][] = [
    ["North (heading 0)",   0,   0],
    ["East (heading 90)",  90,   Math.PI / 2],
    ["South (heading 180)", 180, Math.PI],
    ["West (heading 270)", 270,  3 * Math.PI / 2],
  ];

  it.each(cases)("minimap arrow rotates clockwise from North for %s", (_label, heading, expected) => {
    const ctx = makeCtx();
    drawArrow(ctx, 0, 0, heading);
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

  const FIXED_THEMES: ColormapTheme[] = ["thermal", "grayscale", "viridis", "freshwater", "pastel"];

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

// ---------------------------------------------------------------------------
// computeMinimapUnionBbox — pure helper
// ---------------------------------------------------------------------------

describe("computeMinimapUnionBbox", () => {
  const makeGrid = (
    minLon: number,
    maxLon: number,
    minLat: number,
    maxLat: number,
  ) =>
    ({
      datasetId: `ds-${minLon}`,
      name: `test-grid-${minLon}`,
      resolution: 2,
      width: 2,
      height: 2,
      depths: [1, 2, 3, 4],
      minDepth: 1,
      maxDepth: 4,
      minLon,
      maxLon,
      minLat,
      maxLat,
      centerLon: (minLon + maxLon) / 2,
      centerLat: (minLat + maxLat) / 2,
      waterType: "saltwater" as const,
    });

  const primaryTerrain = makeGrid(-120, -119, 47, 48);

  const makeVisible = (grid: ReturnType<typeof makeGrid> | null): VisibleDataset => ({
    datasetId: grid?.datasetId ?? "null-ds",
    source: "preset",
    activeGrid: null,
    overviewGrid: grid,
  });

  it("returns union of two non-overlapping bboxes when both grids are loaded", () => {
    const grid1 = makeGrid(-120, -119, 47, 48);
    const grid2 = makeGrid(-117, -116, 45, 46);
    const result = computeMinimapUnionBbox(
      [makeVisible(grid1), makeVisible(grid2)],
      primaryTerrain,
    );
    expect(result).not.toBeNull();
    expect(result!.minLon).toBeCloseTo(-120);
    expect(result!.maxLon).toBeCloseTo(-116);
    expect(result!.minLat).toBeCloseTo(45);
    expect(result!.maxLat).toBeCloseTo(48);
  });

  it("returns primary terrain bbox when no visible entry has a loaded overviewGrid", () => {
    const result = computeMinimapUnionBbox(
      [makeVisible(null)],
      primaryTerrain,
    );
    expect(result).not.toBeNull();
    expect(result!.minLon).toBe(primaryTerrain.minLon);
    expect(result!.maxLon).toBe(primaryTerrain.maxLon);
    expect(result!.minLat).toBe(primaryTerrain.minLat);
    expect(result!.maxLat).toBe(primaryTerrain.maxLat);
  });

  it("returns null when visibleDatasets is empty and primaryTerrain is null", () => {
    const result = computeMinimapUnionBbox([], null);
    expect(result).toBeNull();
  });

  it("always includes primaryTerrain even when its visible entry has overviewGrid: null but a secondary has a loaded grid", () => {
    // Primary entry has no overview yet (still loading), secondary has loaded.
    const secondaryGrid = makeGrid(-117, -116, 45, 46);
    const result = computeMinimapUnionBbox(
      [makeVisible(null), makeVisible(secondaryGrid)],
      primaryTerrain, // minLon: -120 maxLon: -119 minLat: 47 maxLat: 48
    );
    expect(result).not.toBeNull();
    // Must include primaryTerrain extents (seeded even though its entry has no grid)
    expect(result!.minLon).toBeCloseTo(primaryTerrain.minLon); // -120
    expect(result!.maxLon).toBeCloseTo(secondaryGrid.maxLon);  // -116 (expanded)
    expect(result!.minLat).toBeCloseTo(secondaryGrid.minLat);  // 45 (expanded)
    expect(result!.maxLat).toBeCloseTo(primaryTerrain.maxLat); // 48
  });

  it("union of two loaded grids always includes primaryTerrain as a seed", () => {
    const grid1 = makeGrid(-120, -119, 47, 48); // same as primary
    const grid2 = makeGrid(-115, -114, 40, 41); // far away
    const result = computeMinimapUnionBbox(
      [makeVisible(grid1), makeVisible(null)],
      primaryTerrain,
    );
    // grid1 + primaryTerrain seed → bbox equals grid1's extent (they overlap exactly)
    expect(result!.minLon).toBeCloseTo(grid1.minLon);
    expect(result!.maxLon).toBeCloseTo(grid1.maxLon);
    expect(result!.minLat).toBeCloseTo(grid1.minLat);
    expect(result!.maxLat).toBeCloseTo(grid1.maxLat);
    void grid2; // not used in this case
  });

  it("preserves a dateline bbox as a continuous 20-degree frame", () => {
    const dateline = makeGrid(170, -170, 10, 20);
    const result = computeMinimapUnionBbox([makeVisible(dateline)], dateline);
    expect(result).toMatchObject({
      minLon: dateline.minLon,
      maxLon: dateline.maxLon,
      minLat: dateline.minLat,
      maxLat: dateline.maxLat,
    });
    expect(geographicLonRange(result!)).toBe(20);
    expect(longitudeOnBboxFrame(-175, result!)).toBe(185);
  });
});

// ---------------------------------------------------------------------------
// Minimap — multi-dataset union-bbox rendering (drawImage count)
// ---------------------------------------------------------------------------

describe("Minimap — rebuildStaticLayer draws one bitmap per loaded dataset", () => {
  // In jsdom, HTMLCanvasElement.getContext() returns null, so effects that call
  // canvas.getContext("2d") silently bail.  Override it for this suite so the
  // effect body actually runs and drawImage calls can be counted.
  type Ctx2D = CanvasRenderingContext2D;
  const drawImageCalls: unknown[][] = [];

  let origGetContext: typeof HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    origGetContext = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error -- override prototype for jsdom canvas tests
    HTMLCanvasElement.prototype.getContext = function (_type: string) {
      return {
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        shadowColor: "",
        shadowBlur: 0,
        globalAlpha: 1,
        imageSmoothingEnabled: false,
        fillRect: vi.fn() as Ctx2D["fillRect"],
        drawImage: vi.fn((...args: unknown[]) => { drawImageCalls.push(args); }) as unknown as Ctx2D["drawImage"],
        putImageData: vi.fn() as Ctx2D["putImageData"],
        createImageData: vi.fn((_w: number, _h: number) => ({
          data: new Uint8ClampedArray(_w * _h * 4),
          width: _w,
          height: _h,
        })) as unknown as Ctx2D["createImageData"],
        save: vi.fn() as Ctx2D["save"],
        restore: vi.fn() as Ctx2D["restore"],
        translate: vi.fn() as Ctx2D["translate"],
        rotate: vi.fn() as Ctx2D["rotate"],
        beginPath: vi.fn() as Ctx2D["beginPath"],
        moveTo: vi.fn() as Ctx2D["moveTo"],
        lineTo: vi.fn() as Ctx2D["lineTo"],
        closePath: vi.fn() as Ctx2D["closePath"],
        arc: vi.fn() as Ctx2D["arc"],
        fill: vi.fn() as Ctx2D["fill"],
        stroke: vi.fn() as Ctx2D["stroke"],
        strokeRect: vi.fn() as Ctx2D["strokeRect"],
      } as unknown as Ctx2D;
    };
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
  });

  beforeEach(() => {
    terrain = mockTerrain;
    drawImageCalls.length = 0;
    useUiStore.setState({ pendingDropIn: null, overviewOpen: false });
    useTerrainStore.setState({ visibleDatasets: [], primaryDatasetIds: [], primaryDatasetId: null, activeGrid: null, overviewGrid: null });
  });

  afterEach(() => {
    useTerrainStore.setState({ visibleDatasets: [], primaryDatasetIds: [], primaryDatasetId: null, activeGrid: null, overviewGrid: null });
  });

  it("click outside primary terrain bbox (secondary-only area) clamps world coords to mesh bounds", () => {
    // Secondary dataset sits far east of the primary (mockTerrain: minLon=-120, maxLon=-119)
    const secondOverviewGridFar = {
      ...mockTerrain,
      datasetId: "ds-far-east",
      name: "far-east",
      minLon: -117,
      maxLon: -116,
      minLat: 45,
      maxLat: 46,
      centerLon: -116.5,
      centerLat: 45.5,
    };
    useTerrainStore.setState({
      visibleDatasets: [
        { datasetId: mockTerrain.datasetId, source: "preset" as const, activeGrid: null, overviewGrid: mockTerrain },
        { datasetId: "ds-far-east", source: "preset" as const, activeGrid: null, overviewGrid: secondOverviewGridFar },
      ],
    });

    const { container } = render(<Minimap />);
    const canvas = container.querySelector("canvas")!;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 180, bottom: 180, width: 180, height: 180, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    // Click at the far-right edge of the canvas (secondary dataset region)
    fireEvent.click(canvas, { clientX: 179, clientY: 90 });

    const pending = useUiStore.getState().pendingDropIn;
    expect(pending).not.toBeNull();
    // World coords must stay within [-WORLD_SIZE/2, +WORLD_SIZE/2]
    expect(pending!.worldX).toBeGreaterThanOrEqual(-WORLD_SIZE / 2 - 0.01);
    expect(pending!.worldX).toBeLessThanOrEqual(WORLD_SIZE / 2 + 0.01);
    expect(pending!.worldZ).toBeGreaterThanOrEqual(-WORLD_SIZE / 2 - 0.01);
    expect(pending!.worldZ).toBeLessThanOrEqual(WORLD_SIZE / 2 + 0.01);
  });

  it("calls drawImage at least twice when two datasets both have loaded overviewGrid", () => {
    const secondOverviewGrid = {
      ...mockTerrain,
      datasetId: "ds-secondary",
      name: "test-secondary",
      minLon: -118,
      maxLon: -117,
      minLat: 45,
      maxLat: 46,
      centerLon: -117.5,
      centerLat: 45.5,
    };

    // Pre-populate the terrain store with two visible datasets, both having grids.
    useTerrainStore.setState({
      visibleDatasets: [
        {
          datasetId: mockTerrain.datasetId,
          source: "preset" as const,
          activeGrid: null,
          overviewGrid: mockTerrain,
        },
        {
          datasetId: "ds-secondary",
          source: "preset" as const,
          activeGrid: null,
          overviewGrid: secondOverviewGrid,
        },
      ],
    });

    render(<Minimap />);

    // drawImage is called in rebuildStaticLayer: once for the primary heatmap
    // canvas and once for the secondary bitmap (plus possibly once for the
    // static-layer composite onto the visible canvas).  Require ≥ 2.
    // All args[0] that are HTMLCanvasElement instances are heatmap/bitmap draws.
    const canvasDraws = drawImageCalls.filter((a) => a[0] instanceof HTMLCanvasElement);
    expect(canvasDraws.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Minimap — puzzle geo transforms shift heatmap tile drawImage position
// ---------------------------------------------------------------------------

describe("Minimap — puzzle geo transforms shift heatmap drawImage position", () => {
  type Ctx2D = CanvasRenderingContext2D;

  // drawImage spy args: [image, x, y, w, h]
  const drawImageCalls: Array<[unknown, number, number, number, number]> = [];
  // translate spy args (used to verify rotation wrapping)
  const translateCalls: Array<[number, number]> = [];
  const rotateCalls: number[] = [];

  let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    origGetContext = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error -- override prototype for jsdom canvas tests
    HTMLCanvasElement.prototype.getContext = function (_type: string) {
      return {
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        shadowColor: "",
        shadowBlur: 0,
        globalAlpha: 1,
        imageSmoothingEnabled: false,
        fillRect: vi.fn() as Ctx2D["fillRect"],
        drawImage: vi.fn((...args: unknown[]) => {
          drawImageCalls.push(args as [unknown, number, number, number, number]);
        }) as unknown as Ctx2D["drawImage"],
        putImageData: vi.fn() as Ctx2D["putImageData"],
        createImageData: vi.fn((_w: number, _h: number) => ({
          data: new Uint8ClampedArray(_w * _h * 4),
          width: _w,
          height: _h,
        })) as unknown as Ctx2D["createImageData"],
        save: vi.fn() as Ctx2D["save"],
        restore: vi.fn() as Ctx2D["restore"],
        translate: vi.fn((x: number, y: number) => { translateCalls.push([x, y]); }) as unknown as Ctx2D["translate"],
        rotate: vi.fn((r: number) => { rotateCalls.push(r); }) as unknown as Ctx2D["rotate"],
        beginPath: vi.fn() as Ctx2D["beginPath"],
        moveTo: vi.fn() as Ctx2D["moveTo"],
        lineTo: vi.fn() as Ctx2D["lineTo"],
        closePath: vi.fn() as Ctx2D["closePath"],
        arc: vi.fn() as Ctx2D["arc"],
        fill: vi.fn() as Ctx2D["fill"],
        stroke: vi.fn() as Ctx2D["stroke"],
        strokeRect: vi.fn() as Ctx2D["strokeRect"],
      } as unknown as Ctx2D;
    };
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
    useUiStore.getState().clearPuzzleGeoTransforms();
  });

  beforeEach(() => {
    terrain = mockTerrain;
    drawImageCalls.length = 0;
    translateCalls.length = 0;
    rotateCalls.length = 0;
    useUiStore.setState({ pendingDropIn: null, overviewOpen: false });
    useUiStore.getState().clearPuzzleGeoTransforms();
    useTerrainStore.setState({
      visibleDatasets: [],
      primaryDatasetIds: [],
      primaryDatasetId: null,
      activeGrid: null,
      overviewGrid: null,
    });
  });

  afterEach(() => {
    useUiStore.getState().clearPuzzleGeoTransforms();
    useTerrainStore.setState({
      visibleDatasets: [],
      primaryDatasetIds: [],
      primaryDatasetId: null,
      activeGrid: null,
      overviewGrid: null,
    });
  });

  it("no puzzle transform: primary heatmap drawImage x ≈ 0 (unshifted)", () => {
    // Single dataset — union bbox = mockTerrain bbox; rect = full 180×180 canvas.
    render(<Minimap />);

    const canvasDraws = drawImageCalls.filter((a) => a[0] instanceof HTMLCanvasElement);
    // At least one drawImage for the primary heatmap canvas exists.
    expect(canvasDraws.length).toBeGreaterThan(0);

    // Without any puzzle transform the rect.x must be 0 (left edge of canvas).
    const primaryDraw = canvasDraws.find(([, x]) => Math.abs(x) < 1);
    expect(primaryDraw).toBeDefined();
  });

  it("dLon offset: primary heatmap drawImage x shifts right when dLon > 0", () => {
    // mockTerrain bbox: lon [-120, -119], lat [47, 48].
    // Seed a +0.5° lon offset for the primary dataset.
    // Effective bbox: [-119.5, -118.5, 47, 48].
    // Union bbox (single dataset → seeded from currentTerrain): [-120, -119, 47, 48].
    // rect.x = ((-119.5 - (-120)) / 1) * 180 = 90.
    useUiStore.getState().setPuzzleGeoTransforms(
      new Map([[mockTerrain.datasetId, { dLon: 0.5, dLat: 0, angleDeg: 0 }]]),
    );

    render(<Minimap />);

    const canvasDraws = drawImageCalls.filter((a) => a[0] instanceof HTMLCanvasElement);
    expect(canvasDraws.length).toBeGreaterThan(0);

    // The primary heatmap drawImage should have x ≈ 90 (shifted +0.5° = 50% of 180px).
    const shiftedDraw = canvasDraws.find(([, x]) => Math.abs(x - 90) < 2);
    expect(shiftedDraw).toBeDefined();
  });

  it("non-zero angleDeg: rotate() is called during the drawImage of a puzzle-transformed tile", () => {
    // With a non-zero rotation, the canvas save/translate/rotate/translate/drawImage/restore
    // sequence must fire. Verify rotate() is called with the correct radian value.
    const angleDeg = 30;
    const expectedRad = (angleDeg * Math.PI) / 180;

    useUiStore.getState().setPuzzleGeoTransforms(
      new Map([[mockTerrain.datasetId, { dLon: 0, dLat: 0, angleDeg }]]),
    );

    render(<Minimap />);

    // rotate() must have been called with the expected angle.
    const matchingRotate = rotateCalls.find((r) => Math.abs(r - expectedRad) < 0.001);
    expect(matchingRotate).toBeDefined();
  });

  it("clearPuzzleGeoTransforms: after clearing, tile draws at unshifted position", () => {
    // First render with an offset.
    useUiStore.getState().setPuzzleGeoTransforms(
      new Map([[mockTerrain.datasetId, { dLon: 0.5, dLat: 0, angleDeg: 0 }]]),
    );
    const { unmount } = render(<Minimap />);
    unmount();

    // Reset
    drawImageCalls.length = 0;
    useUiStore.getState().clearPuzzleGeoTransforms();

    render(<Minimap />);

    const canvasDraws = drawImageCalls.filter((a) => a[0] instanceof HTMLCanvasElement);
    expect(canvasDraws.length).toBeGreaterThan(0);

    // After clearing, x should be back near 0.
    const unshiftedDraw = canvasDraws.find(([, x]) => Math.abs(x) < 1);
    expect(unshiftedDraw).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Minimap — marker dots use union bbox for secondary-dataset markers
// ---------------------------------------------------------------------------

describe("Minimap — marker dots use union bbox when multiple datasets are loaded", () => {
  // Track arc() calls so we can verify the canvas pixel position of each dot.
  type Ctx2D = CanvasRenderingContext2D;
  const arcCalls: [number, number, number][] = []; // [x, y, radius]

  let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    origGetContext = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error -- override prototype for jsdom canvas tests
    HTMLCanvasElement.prototype.getContext = function (_type: string) {
      return {
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        shadowColor: "",
        shadowBlur: 0,
        globalAlpha: 1,
        imageSmoothingEnabled: false,
        fillRect: vi.fn() as Ctx2D["fillRect"],
        drawImage: vi.fn() as unknown as Ctx2D["drawImage"],
        putImageData: vi.fn() as Ctx2D["putImageData"],
        createImageData: vi.fn((_w: number, _h: number) => ({
          data: new Uint8ClampedArray(_w * _h * 4),
          width: _w,
          height: _h,
        })) as unknown as Ctx2D["createImageData"],
        save: vi.fn() as Ctx2D["save"],
        restore: vi.fn() as Ctx2D["restore"],
        translate: vi.fn() as Ctx2D["translate"],
        rotate: vi.fn() as Ctx2D["rotate"],
        beginPath: vi.fn() as Ctx2D["beginPath"],
        moveTo: vi.fn() as Ctx2D["moveTo"],
        lineTo: vi.fn() as Ctx2D["lineTo"],
        closePath: vi.fn() as Ctx2D["closePath"],
        arc: vi.fn((x: number, y: number, r: number) => {
          arcCalls.push([x, y, r]);
        }) as unknown as Ctx2D["arc"],
        fill: vi.fn() as Ctx2D["fill"],
        stroke: vi.fn() as Ctx2D["stroke"],
        strokeRect: vi.fn() as Ctx2D["strokeRect"],
      } as unknown as Ctx2D;
    };
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
  });

  beforeEach(() => {
    terrain = mockTerrain;
    arcCalls.length = 0;
    mockMarkersOverride = null;
    useUiStore.setState({ pendingDropIn: null, overviewOpen: false });
    useTerrainStore.setState({
      visibleDatasets: [],
      primaryDatasetIds: [],
      primaryDatasetId: null,
      activeGrid: null,
      overviewGrid: null,
    });
  });

  afterEach(() => {
    mockMarkersOverride = null;
    useTerrainStore.setState({
      visibleDatasets: [],
      primaryDatasetIds: [],
      primaryDatasetId: null,
      activeGrid: null,
      overviewGrid: null,
    });
  });

  it("marker inside secondary dataset bbox is drawn at union-bbox canvas position, not skipped by primary bbox", () => {
    // Setup:
    //   Primary terrain:   lon [-120, -119], lat [47, 48]  (mockTerrain)
    //   Secondary terrain: lon [-118, -117], lat [45, 46]
    //   Union bbox:        lon [-120, -117], lat [45, 48]  (3° × 3°)
    //
    // Marker at lon = -117.5, lat = 45.5 — inside the secondary bbox.
    //
    // With union bbox (correct):
    //   px = ((-117.5 - (-120)) / 3) * 180 = (2.5 / 3) * 180 ≈ 150
    //   py = 180 - ((45.5 - 45) / 3) * 180 = 180 - 30 = 150
    //
    // With primary bbox only (wrong / old behaviour):
    //   lonRange = 1,  px = ((-117.5 + 120) / 1) * 180 = 450  → out of canvas → skipped
    //   The marker would never appear at all.

    const secondOverviewGrid = {
      ...mockTerrain,
      datasetId: "ds-secondary-marker-test",
      name: "secondary-marker-test",
      minLon: -118,
      maxLon: -117,
      minLat: 45,
      maxLat: 46,
      centerLon: -117.5,
      centerLat: 45.5,
    };

    // Inject a marker saved under the SECONDARY dataset's ID — this is the key
    // scenario: the marker's datasetId is not the primary terrain, so the old
    // single-query code would never have fetched it.
    mockMarkersOverride = [
      {
        id: 1,
        datasetId: "ds-secondary-marker-test",
        lon: -117.5,
        lat: 45.5,
        type: "waypoint",
        label: null,
        notes: null,
        createdAt: new Date().toISOString(),
      } as unknown as MarkerType,
    ];

    useTerrainStore.setState({
      visibleDatasets: [
        {
          datasetId: mockTerrain.datasetId,
          source: "preset" as const,
          activeGrid: null,
          overviewGrid: mockTerrain,
        },
        {
          datasetId: "ds-secondary-marker-test",
          source: "preset" as const,
          activeGrid: null,
          overviewGrid: secondOverviewGrid,
        },
      ],
    });

    render(<Minimap />);

    // Union bbox coordinate transform:
    const unionMinLon = -120;
    const unionLonRange = 3;  // -117 - (-120)
    const unionMinLat = 45;
    const unionLatRange = 3;  // 48 - 45
    const expectedPx = ((-117.5 - unionMinLon) / unionLonRange) * 180; // ≈ 150
    const expectedPy = 180 - ((45.5 - unionMinLat) / unionLatRange) * 180; // = 150

    // drawMarkerDots calls ctx.arc(px, py, radius, 0, 2π) for each marker dot.
    // Find any arc call landing within 2px of the expected union-bbox position.
    const markerArc = arcCalls.find(
      ([x, y]) => Math.abs(x - expectedPx) < 2 && Math.abs(y - expectedPy) < 2,
    );

    expect(markerArc).toBeDefined();

    // Sanity check: the primary-bbox-only position (px≈450) must NOT appear —
    // that would mean the old (incorrect) code path was used.
    const wrongArc = arcCalls.find(([x]) => x > 400);
    expect(wrongArc).toBeUndefined();
  });
});
