/**
 * Component-level integration tests for OverviewMap rendering.
 *
 * These tests mount the real OverviewMap component (React.createElement — no
 * JSX syntax needed in a .ts file) and verify wiring through the component's
 * rAF draw loop and SVG overlay:
 *
 * 1. CAMERA HEADING — cameraStore.heading → SVG camera-arrow rotate(180-heading)
 *    OverviewMap renders a <polygon fill="#d4ac0d"> whose SVG transform is
 *    `translate(cx,cy) rotate(180 - cameraHeading)`.  Changing
 *    useCameraStore.heading must produce the correct rotation value.  The
 *    rotation is computed in the React render function (not the rAF loop), so
 *    it updates immediately when the store changes.
 *
 * 2. LOD GATE — renderEfhOverlay suppressed below POLYGON_LOD_MIN_ZOOM
 *    The rAF draw loop guards renderEfhOverlay behind shouldDrawOverlayAtScale:
 *      if (showEfhRef && efhFeaturesRef.length > 0 && shouldDrawOverlayAtScale(t.scale))
 *        renderEfhOverlay(...)
 *    At the default overview zoom (scale=1.0 < 1.5) the spy must NOT fire;
 *    after wheel-zooming past the threshold (1.15^4 ≈ 1.75 > 1.5) it must fire.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { useCameraStore } from "@/lib/cameraStore";
import * as overviewRenderer from "@/lib/overviewRenderer";
import { POLYGON_LOD_MIN_ZOOM } from "@/lib/overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Configurable mock state — updated per-test so useGetEfh can return data.
// Must be hoisted so it's in scope when vi.mock factories run.
// ---------------------------------------------------------------------------
const mockConfig = vi.hoisted(() => ({
  efhData: undefined as unknown,
}));

// Self-maintaining Proxy API client mock (same pattern as other OverviewMap tests).
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false, refetch: noop };
  }
  function mutationHook() {
    return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined };
  }
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

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ setDatasetId: vi.fn(), setTerrain: vi.fn(), terrain: null }),
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetMarkers: () => ({ data: [] }),
    getGetMarkersQueryKey: (p: unknown) => ["markers", p],
    useGetTrails: () => ({ data: [], refetch: vi.fn() }),
    getGetTrailsQueryKey: (p: unknown) => ["trails", p],
    useDeleteTrailsId: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
    getTrailsIdPoints: vi.fn(),
    useGetDatasets: () => ({ data: [{ id: "test-ds", hasEfh: false }] }),
    getGetDatasetsQueryKey: (p: unknown) => ["datasets", p],
    usePostDatasetsBboxQuery: () => ({ mutateAsync: vi.fn() }),
    useGetDatasetsMySaves: () => ({ data: [], refetch: vi.fn() }),
    getGetDatasetsMySavesQueryKey: () => ["my-saves"],
    usePostDatasetsCatalogIdSave: () => ({ mutateAsync: vi.fn() }),
    // useGetEfh reads from the mutable mockConfig so per-test overrides work
    useGetEfh: () => ({ data: mockConfig.efhData, isLoading: false, isError: false, refetch: vi.fn() }),
    getGetEfhQueryKey: (p: unknown) => ["efh", p],
    useGetSubstrate: () => ({ data: undefined }),
    getGetSubstrateQueryKey: (id: unknown) => ["substrate", id],
  }),
);

import { OverviewMap } from "@/components/OverviewMap";

const CANVAS_W = 1024;
const CANVAS_H = 768;

function withQuery(node: React.ReactElement): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, node);
}

function makeOverviewGrid(): TerrainData {
  const N = 4;
  const depths = new Array(N * N).fill(0).map((_, i) => 10 + i * 5);
  return {
    datasetId: "test-ds",
    name: "Test Dataset",
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: 10,
    maxDepth: 10 + (N * N - 1) * 5,
    minLon: -122,
    maxLon: -119,
    minLat: 47,
    maxLat: 49,
    centerLon: -120.5,
    centerLat: 48.0,
    waterType: "saltwater" as const,
  } as unknown as TerrainData;
}

/** A single EFH polygon that sits within the test grid's bbox. */
function makeEfhFeature() {
  return {
    type: "Feature",
    properties: {
      species: "halibut",
      commonName: "Pacific Halibut",
      fmp: "Test FMP",
      depthRangeM: [0, 200],
      habitatDescription: "Rocky substrate",
      source: "NOAA",
      creditUrl: "https://example.com",
      color: "#00e5ff",
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-121.0, 47.5], [-120.0, 47.5], [-120.0, 48.5],
        [-121.0, 48.5], [-121.0, 47.5],
      ]],
    },
  };
}

/** Shared store setup used by both describe blocks. */
function setupStores() {
  Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

  const grid = makeOverviewGrid();
  useTerrainStore.setState({
    visibleDatasets: [
      { datasetId: grid.datasetId, source: "preset", overviewGrid: grid, activeGrid: null },
    ],
    primaryDatasetId: grid.datasetId,
    overviewGrid: grid,
    activeGrid: null,
  });

  useUiStore.setState({
    substrateColorMode: false,
    selectedSubstrate: null,
    efhOverlayEnabled: false,
    overviewOpen: true,
    pendingDropIn: null,
  });

  // Place the camera at the grid centre so the SVG camera-arrow appears on screen.
  useCameraStore.setState({
    cameraLon: -120.5,
    cameraLat: 48.0,
    heading: 0,
    cameraDepth: 50,
    cameraAltitude: 30,
  });
}

/**
 * Wait until the SVG camera-arrow polygon is in the DOM.
 * The polygon is rendered only after the rAF draw loop fires and sets
 * svgTransform; it serves as a reliable "rAF completed" signal.
 */
async function waitForCameraArrow(): Promise<Element> {
  return waitFor(
    () => {
      const el = document.querySelector('polygon[fill="#d4ac0d"]');
      if (!el) throw new Error("Camera arrow polygon not yet rendered (rAF pending)");
      return el;
    },
    { timeout: 4000 },
  );
}

// ---------------------------------------------------------------------------
// 1. Camera heading → SVG camera-arrow rotation
//
// OverviewMap SVG layer (line ~1809 of OverviewMap.tsx):
//   const rot = 180 - cameraHeading;
//   <polygon transform={`translate(${cx},${cy}) rotate(${rot})`} ... />
//
// The component subscribes to useCameraStore via a selector so heading
// changes trigger an immediate React re-render without waiting for the rAF.
// ---------------------------------------------------------------------------

describe("OverviewMap — camera heading drives SVG arrow rotation", () => {
  beforeEach(() => {
    mockConfig.efhData = undefined;
    setupStores();
  });

  const HEADING_CASES = [
    { heading: 0,   expectedRot: 180 },
    { heading: 90,  expectedRot: 90 },
    { heading: 180, expectedRot: 0 },
    { heading: 270, expectedRot: -90 },
  ] as const;

  for (const { heading, expectedRot } of HEADING_CASES) {
    it(`heading ${heading}° → SVG polygon contains rotate(${expectedRot})`, async () => {
      useCameraStore.setState({ heading });

      await act(async () => {
        renderWithProviders(withQuery(React.createElement(OverviewMap)));
      });

      // rAF must fire first to set svgTransform; then the polygon appears.
      const polygon = await waitForCameraArrow();

      const transform = polygon.getAttribute("transform") ?? "";
      const rotMatch = /rotate\(([^)]+)\)/.exec(transform);
      expect(
        rotMatch,
        `Expected transform to contain rotate(...), got: "${transform}"`,
      ).not.toBeNull();
      expect(parseFloat(rotMatch![1]!)).toBeCloseTo(expectedRot, 5);
    });
  }

  it("each 90° heading increment decrements the rotate angle by exactly 90°", async () => {
    useCameraStore.setState({ heading: 0 });

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Wait for the first rAF so svgTransform is set and the polygon exists.
    await waitForCameraArrow();

    const rotations: number[] = [];

    for (const heading of [0, 90, 180, 270]) {
      await act(async () => {
        useCameraStore.setState({ heading });
      });
      // After act() flushes the React re-render the polygon's transform is updated.
      const poly = document.querySelector('polygon[fill="#d4ac0d"]');
      const transform = poly?.getAttribute("transform") ?? "";
      const m = /rotate\(([^)]+)\)/.exec(transform);
      if (!m) throw new Error(`No rotate() in: ${transform}`);
      rotations.push(parseFloat(m[1]!));
    }

    // rot = 180 - heading → each +90° heading step → -90° rotation step
    for (let i = 1; i < rotations.length; i++) {
      expect(rotations[i]! - rotations[i - 1]!).toBeCloseTo(-90, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. LOD gate — renderEfhOverlay suppressed below POLYGON_LOD_MIN_ZOOM
//
// OverviewMap.tsx rAF loop (~line 1168):
//   if (showEfhRef.current && efhFeaturesRef.current.length > 0
//       && shouldDrawOverlayAtScale(t.scale)) {
//     renderEfhOverlay(ctx, visibleEfhFeatures, worldGrid, t);
//   }
//
// computeInitialTransform always produces scale=1.0, which is below the
// POLYGON_LOD_MIN_ZOOM threshold (1.5), so the default view suppresses EFH.
// Wheel-zooming in (deltaY < 0, factor=1.15 per tick) pushes scale above 1.5
// after ≥ 3 ticks (1.15³ ≈ 1.52).  Four ticks gives 1.15⁴ ≈ 1.75 — clearly
// above the threshold — to avoid off-by-one rounding concerns.
// ---------------------------------------------------------------------------

describe("OverviewMap — LOD gate suppresses renderEfhOverlay below POLYGON_LOD_MIN_ZOOM", () => {
  beforeEach(() => {
    mockConfig.efhData = undefined;
    setupStores();
  });

  it(`renderEfhOverlay NOT called at default zoom (scale=1.0 < ${POLYGON_LOD_MIN_ZOOM})`, async () => {
    mockConfig.efhData = { features: [makeEfhFeature()] };
    useUiStore.setState({ ...useUiStore.getState(), efhOverlayEnabled: true });

    const spy = vi.spyOn(overviewRenderer, "renderEfhOverlay");

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Use the camera-arrow polygon as a proxy for "at least one rAF draw completed".
    // The rAF loop calls setSvgTransform at the end of each successful draw;
    // the polygon only renders once svgTransform is non-null.
    await waitForCameraArrow();

    // At scale 1.0, shouldDrawOverlayAtScale(1.0) returns false → spy must be clean.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it(`renderEfhOverlay called once scale exceeds ${POLYGON_LOD_MIN_ZOOM} via wheel zoom`, async () => {
    mockConfig.efhData = { features: [makeEfhFeature()] };
    useUiStore.setState({ ...useUiStore.getState(), efhOverlayEnabled: true });

    const spy = vi.spyOn(overviewRenderer, "renderEfhOverlay");

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    expect(canvas).not.toBeNull();

    // Give the canvas a real bounding rect so handleWheel can compute mouse offsets.
    canvas.getBoundingClientRect = () =>
      ({
        left: 0, top: 0,
        right: CANVAS_W, bottom: CANVAS_H,
        width: CANVAS_W, height: CANVAS_H,
        x: 0, y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // 4 zoom-in ticks: scale = 1.0 × 1.15⁴ ≈ 1.75 > POLYGON_LOD_MIN_ZOOM (1.5)
    await act(async () => {
      for (let i = 0; i < 4; i++) {
        fireEvent.wheel(canvas, { deltaY: -100, clientX: CANVAS_W / 2, clientY: CANVAS_H / 2 });
      }
    });

    // The next rAF frame will see scale ≥ 1.5 → shouldDrawOverlayAtScale returns true
    await waitFor(
      () => { expect(spy).toHaveBeenCalled(); },
      { timeout: 4000 },
    );

    spy.mockRestore();
  });

  it("renderEfhOverlay NOT called when efhOverlayEnabled is false, even at high zoom", async () => {
    mockConfig.efhData = { features: [makeEfhFeature()] };
    // efhOverlayEnabled stays false (default from setupStores)

    const spy = vi.spyOn(overviewRenderer, "renderEfhOverlay");

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    canvas.getBoundingClientRect = () =>
      ({
        left: 0, top: 0,
        right: CANVAS_W, bottom: CANVAS_H,
        width: CANVAS_W, height: CANVAS_H,
        x: 0, y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // Zoom past the LOD threshold
    await act(async () => {
      for (let i = 0; i < 4; i++) {
        fireEvent.wheel(canvas, { deltaY: -100, clientX: CANVAS_W / 2, clientY: CANVAS_H / 2 });
      }
    });

    // Wait for at least one more rAF at the elevated scale
    await waitForCameraArrow();
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    // showEfhRef.current is false → guard fails before shouldDrawOverlayAtScale
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. EFH legend — renderEfhLegend called/suppressed alongside renderEfhOverlay
//
// OverviewMap.tsx rAF loop (~line 1175):
//   if (showEfhRef.current && efhFeaturesRef.current.length > 0
//       && shouldDrawOverlayAtScale(t.scale)) {
//     renderEfhOverlay(...);
//     efhLegendLayoutRef.current = renderEfhLegend(ctx, efhFeaturesRef.current, cW, cH, ...);
//   } else {
//     efhLegendLayoutRef.current = null;   ← legend skipped
//   }
//
// renderEfhLegend lives in the same guard branch as renderEfhOverlay:
//   • NOT called at scale < POLYGON_LOD_MIN_ZOOM (default zoom = 1.0)
//   • NOT called when efhOverlayEnabled is false
//   • Called with the full efhFeaturesRef array once scale ≥ POLYGON_LOD_MIN_ZOOM
// ---------------------------------------------------------------------------

describe("OverviewMap — renderEfhLegend called/suppressed by LOD gate and overlay toggle", () => {
  beforeEach(() => {
    mockConfig.efhData = undefined;
    setupStores();
  });

  it(`renderEfhLegend NOT called at default zoom (scale=1.0 < ${POLYGON_LOD_MIN_ZOOM})`, async () => {
    mockConfig.efhData = { features: [makeEfhFeature()] };
    useUiStore.setState({ ...useUiStore.getState(), efhOverlayEnabled: true });

    const spy = vi.spyOn(overviewRenderer, "renderEfhLegend");

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Camera-arrow appearing signals at least one complete rAF draw at scale=1.0.
    await waitForCameraArrow();

    // shouldDrawOverlayAtScale(1.0) → false → legend branch skipped entirely.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it(`renderEfhLegend called with expected features once scale exceeds ${POLYGON_LOD_MIN_ZOOM}`, async () => {
    const efhFeature = makeEfhFeature();
    mockConfig.efhData = { features: [efhFeature] };
    useUiStore.setState({ ...useUiStore.getState(), efhOverlayEnabled: true });

    const spy = vi.spyOn(overviewRenderer, "renderEfhLegend");

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    expect(canvas).not.toBeNull();

    canvas.getBoundingClientRect = () =>
      ({
        left: 0, top: 0,
        right: CANVAS_W, bottom: CANVAS_H,
        width: CANVAS_W, height: CANVAS_H,
        x: 0, y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // 4 zoom-in ticks: scale = 1.0 × 1.15⁴ ≈ 1.75 > POLYGON_LOD_MIN_ZOOM (1.5)
    await act(async () => {
      for (let i = 0; i < 4; i++) {
        fireEvent.wheel(canvas, { deltaY: -100, clientX: CANVAS_W / 2, clientY: CANVAS_H / 2 });
      }
    });

    // Wait until the legend spy fires (same rAF frame as renderEfhOverlay).
    await waitFor(
      () => { expect(spy).toHaveBeenCalled(); },
      { timeout: 4000 },
    );

    // Verify the second argument — the full feature array — contains our species.
    const [, featuresArg] = spy.mock.calls[0]!;
    expect(Array.isArray(featuresArg)).toBe(true);
    const typedFeatures = featuresArg as Array<{ properties: { species: string } }>;
    expect(typedFeatures.some((f) => f.properties.species === efhFeature.properties.species)).toBe(true);

    spy.mockRestore();
  });

  it("renderEfhLegend NOT called when efhOverlayEnabled is false, even at high zoom", async () => {
    mockConfig.efhData = { features: [makeEfhFeature()] };
    // efhOverlayEnabled stays false (default from setupStores)

    const spy = vi.spyOn(overviewRenderer, "renderEfhLegend");

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    canvas.getBoundingClientRect = () =>
      ({
        left: 0, top: 0,
        right: CANVAS_W, bottom: CANVAS_H,
        width: CANVAS_W, height: CANVAS_H,
        x: 0, y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // Zoom well past the LOD threshold
    await act(async () => {
      for (let i = 0; i < 4; i++) {
        fireEvent.wheel(canvas, { deltaY: -100, clientX: CANVAS_W / 2, clientY: CANVAS_H / 2 });
      }
    });

    // Let at least one more rAF draw settle at elevated scale.
    await waitForCameraArrow();
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    // showEfhRef.current is false → the guard fails → legend never invoked.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 4. Null overviewGrid guard — no crash when a visible dataset has no grid yet
//
// OverviewMap.tsx useEffect (line ~987):
//   const withGrid = visibleDatasets.filter(v => !!v.overviewGrid);
//   ...
//   const refGrid = worldGridRef.current ?? withGrid.find(d => d.overviewGrid != null)?.overviewGrid;
//   if (refGrid) { transformRef.current = computeInitialTransform(refGrid, ...); }
//
// Before the guard, withGrid[0]!.overviewGrid! would throw if a dataset
// appeared in visibleDatasets before its grid loaded.  This describe block
// verifies the guard holds: mounting with overviewGrid: null on the primary
// entry must not crash and must leave the canvas in a drawable state.
// ---------------------------------------------------------------------------

describe("OverviewMap — null overviewGrid in visibleDatasets does not crash", () => {
  beforeEach(() => {
    mockConfig.efhData = undefined;
  });

  it("renders without throwing when the primary visibleDataset has overviewGrid: null", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    useTerrainStore.setState({
      visibleDatasets: [
        { datasetId: "loading-ds", source: "preset", overviewGrid: null, activeGrid: null },
      ],
      primaryDatasetId: "loading-ds",
      overviewGrid: null,
      activeGrid: null,
    });

    useUiStore.setState({
      substrateColorMode: false,
      selectedSubstrate: null,
      efhOverlayEnabled: false,
      overviewOpen: true,
      pendingDropIn: null,
    });

    useCameraStore.setState({
      cameraLon: -120.5,
      cameraLat: 48.0,
      heading: 0,
      cameraDepth: 50,
      cameraAltitude: 30,
    });

    // Should not throw during mount or the first rAF frame.
    await expect(
      act(async () => {
        renderWithProviders(withQuery(React.createElement(OverviewMap)));
      }),
    ).resolves.not.toThrow();

    // The canvas must be present even though no transform was computed yet.
    const canvas = document.querySelector('canvas[data-testid="overview-map-canvas"]');
    expect(canvas).not.toBeNull();
  });

  it("canvas background (#020818) is painted even when overviewGrid is null", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    useTerrainStore.setState({
      visibleDatasets: [
        { datasetId: "loading-ds", source: "preset", overviewGrid: null, activeGrid: null },
      ],
      primaryDatasetId: "loading-ds",
      overviewGrid: null,
      activeGrid: null,
    });

    useUiStore.setState({
      substrateColorMode: false,
      selectedSubstrate: null,
      efhOverlayEnabled: false,
      overviewOpen: true,
      pendingDropIn: null,
    });

    useCameraStore.setState({
      cameraLon: -120.5,
      cameraLat: 48.0,
      heading: 0,
      cameraDepth: 50,
      cameraAltitude: 30,
    });

    // Intercept 2D context creation so we can observe fill calls.
    const fillRectCalls: Array<[number, number, number, number]> = [];
    const fillStyles: string[] = [];

    const mockCtx = new Proxy(
      {
        fillRect: vi.fn((...args: [number, number, number, number]) => {
          fillRectCalls.push(args);
        }),
        fillStyle: "" as string | CanvasGradient | CanvasPattern,
        font: "",
        textAlign: "start" as CanvasTextAlign,
        textBaseline: "alphabetic" as CanvasTextBaseline,
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 50 })),
        drawImage: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        setLineDash: vi.fn(),
        strokeStyle: "",
        lineWidth: 1,
        globalAlpha: 1,
        imageSmoothingEnabled: true,
        shadowColor: "",
        shadowBlur: 0,
        strokeRect: vi.fn(),
        roundRect: vi.fn(),
        clip: vi.fn(),
        createImageData: vi.fn((w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        })),
        putImageData: vi.fn(),
      },
      {
        set(target: Record<string, unknown>, prop: string, value: unknown) {
          if (prop === "fillStyle" && typeof value === "string") {
            fillStyles.push(value);
          }
          target[prop] = value;
          return true;
        },
      },
    );

    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Allow several rAF frames to fire so the loop definitely executes.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    getContextSpy.mockRestore();

    // The background fill must have been set to the dark-navy colour and
    // fillRect must have been called — even though overviewGrid is null.
    const bgFillIndex = fillStyles.indexOf("#020818");
    expect(
      bgFillIndex,
      `Expected fillStyle to be set to "#020818" at some point. Got: ${JSON.stringify(fillStyles)}`,
    ).toBeGreaterThanOrEqual(0);

    // fillRect must be called at some point after the "#020818" fillStyle assignment.
    expect(
      fillRectCalls.length,
      "Expected fillRect to be called at least once for the background",
    ).toBeGreaterThan(0);
  });

  it("renders without throwing when one dataset has a grid and a second has overviewGrid: null", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    const grid = makeOverviewGrid();

    useTerrainStore.setState({
      visibleDatasets: [
        { datasetId: grid.datasetId, source: "preset", overviewGrid: grid, activeGrid: null },
        { datasetId: "loading-ds", source: "preset", overviewGrid: null, activeGrid: null },
      ],
      primaryDatasetId: grid.datasetId,
      overviewGrid: grid,
      activeGrid: null,
    });

    useUiStore.setState({
      substrateColorMode: false,
      selectedSubstrate: null,
      efhOverlayEnabled: false,
      overviewOpen: true,
      pendingDropIn: null,
    });

    useCameraStore.setState({
      cameraLon: -120.5,
      cameraLat: 48.0,
      heading: 0,
      cameraDepth: 50,
      cameraAltitude: 30,
    });

    await expect(
      act(async () => {
        renderWithProviders(withQuery(React.createElement(OverviewMap)));
      }),
    ).resolves.not.toThrow();

    // The camera-arrow confirms a full rAF draw completed — the primary grid
    // was available so the transform and bitmap should have been computed.
    await waitForCameraArrow();
  });
});
