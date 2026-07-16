/**
 * Component integration test: OverviewMap — waypoint mode click dispatch.
 *
 * Mounts the actual OverviewMap component (the same component that ships to
 * users) and exercises the full click path:
 *
 *   canvas click  →  handleClick (DOM event handler)
 *               →  canvasToLonLat (coordinate conversion)
 *               →  appendWaypoint (waypoint state reducer)
 *               →  setWaypoints   (React state update)
 *               →  setShowWaypointPanel(true)
 *
 * The test verifies:
 *   1. Enabling waypoint mode via the toolbar toggle arms the click handler.
 *   2. A canvas click in waypoint mode creates a waypoint.
 *   3. The waypoint panel opens automatically after the first click.
 *   4. appendWaypoint is called with coordinates derived from canvasToLonLat,
 *      so the dispatched lon/lat matches the click position on the map.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import * as waypointHelpers from "@/lib/waypointHelpers";

/**
 * Self-maintaining Proxy API mock — new hooks added to OverviewMap
 * are handled automatically; only hooks that need specific data are listed.
 */
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
    useGetEfh: () => ({ data: undefined }),
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

// ---------------------------------------------------------------------------
// Transform helpers mirroring overviewRenderer.ts
// ---------------------------------------------------------------------------

const LON_RANGE = 3;   // -122 to -119
const LAT_RANGE = 2;   // 47 to 49
const MIN_LON   = -122;
const MIN_LAT   = 47;

/**
 * Mirror of computeInitialTransform for the 3°×2° test grid.
 * Returns the same transform the component computes on mount.
 */
function computeTestInitialTransform() {
  const pxPerDeg = Math.min(
    (CANVAS_W * 0.88) / LON_RANGE,
    (CANVAS_H * 0.88) / LAT_RANGE,
  );
  const terrainW = pxPerDeg * LON_RANGE;
  const terrainH = pxPerDeg * LAT_RANGE;
  return {
    scale:   1,
    pxPerDeg,
    offsetX: (CANVAS_W - terrainW) / 2,
    offsetY: (CANVAS_H - terrainH) / 2,
  };
}

/**
 * Mirror of clampTransform — clamps offsetX/Y so ≥10 % of terrain is visible.
 */
function clampTestTransform(t: {
  scale: number; pxPerDeg: number; offsetX: number; offsetY: number;
}) {
  const terrainW = t.pxPerDeg * LON_RANGE * t.scale;
  const terrainH = t.pxPerDeg * LAT_RANGE * t.scale;
  const minVis = 0.10;
  return {
    ...t,
    offsetX: Math.max(-terrainW * (1 - minVis), Math.min(CANVAS_W - terrainW * minVis, t.offsetX)),
    offsetY: Math.max(-terrainH * (1 - minVis), Math.min(CANVAS_H - terrainH * minVis, t.offsetY)),
  };
}

/**
 * Mirror of lonLatToCanvas: returns the canvas pixel for a lon/lat given an
 * explicit transform (so tests can predict where to click after pan/zoom).
 */
function lonLatToPxWithTransform(
  lon: number,
  lat: number,
  t: { scale: number; pxPerDeg: number; offsetX: number; offsetY: number },
): [number, number] {
  const terrainW = t.pxPerDeg * LON_RANGE * t.scale;
  const terrainH = t.pxPerDeg * LAT_RANGE * t.scale;
  return [
    t.offsetX + ((lon - MIN_LON) / LON_RANGE) * terrainW,
    t.offsetY + (1 - (lat - MIN_LAT) / LAT_RANGE) * terrainH,
  ];
}

/**
 * Mirrors computeInitialTransform / lonLatToCanvas for a 3°×2° test grid.
 * Returns the canvas pixel for a given lon/lat.
 *
 * computeInitialTransform:
 *   pxPerDeg = min((W * 0.88) / lonRange, (H * 0.88) / latRange)
 *   offsetX = (W - pxPerDeg * lonRange) / 2
 *   offsetY = (H - pxPerDeg * latRange) / 2
 *
 * lonLatToCanvas (North-up):
 *   x = offsetX + ((lon - minLon) / lonRange) * terrainW
 *   y = offsetY + (1 - (lat - minLat) / latRange) * terrainH
 */
function lonLatToPx(lon: number, lat: number): [number, number] {
  return lonLatToPxWithTransform(lon, lat, computeTestInitialTransform());
}

function clickAt(canvas: HTMLCanvasElement, x: number, y: number) {
  canvas.getBoundingClientRect = () =>
    ({
      left: 0, top: 0,
      right: CANVAS_W, bottom: CANVAS_H,
      width: CANVAS_W, height: CANVAS_H,
      x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  fireEvent.click(canvas, { clientX: x, clientY: y });
}

function makeOverviewGrid() {
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
  };
}

describe("OverviewMap — waypoint mode click dispatches correct lat/lon", () => {
  beforeEach(() => {
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
  });

  it("enabling waypoint mode via the toolbar toggle arms the click handler", async () => {
    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const toolsToggle = screen.getByTestId("overview-tools-toggle");
    await act(async () => { fireEvent.click(toolsToggle); });

    const waypointToggle = screen.getByTestId("overview-waypoint-mode-toggle");
    expect(waypointToggle).not.toBeNull();

    await act(async () => { fireEvent.click(waypointToggle); });
    expect(waypointToggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("canvas click in waypoint mode calls appendWaypoint with coordinates from canvasToLonLat", async () => {
    const spy = vi.spyOn(waypointHelpers, "appendWaypoint");

    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const toolsToggle = screen.getByTestId("overview-tools-toggle");
    await act(async () => { fireEvent.click(toolsToggle); });

    const waypointToggle = screen.getByTestId("overview-waypoint-mode-toggle");
    await act(async () => { fireEvent.click(waypointToggle); });

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    expect(canvas).not.toBeNull();

    const targetLon = -120.5;
    const targetLat = 48.0;
    const [px, py] = lonLatToPx(targetLon, targetLat);

    await act(async () => { clickAt(canvas, px, py); });

    expect(spy).toHaveBeenCalledOnce();
    const [, lon, lat] = spy.mock.calls[0] as [unknown, number, number];
    expect(lon).toBeCloseTo(targetLon, 1);
    expect(lat).toBeCloseTo(targetLat, 1);

    spy.mockRestore();
  });

  it("waypoint panel opens automatically after placing the first waypoint", async () => {
    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const toolsToggle = screen.getByTestId("overview-tools-toggle");
    await act(async () => { fireEvent.click(toolsToggle); });

    const waypointToggle = screen.getByTestId("overview-waypoint-mode-toggle");
    await act(async () => { fireEvent.click(waypointToggle); });

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    const [px, py] = lonLatToPx(-120.5, 48.0);
    await act(async () => { clickAt(canvas, px, py); });

    // The click handler calls setShowWaypointPanel(true) immediately after
    // placing a waypoint — the panel is rendered without needing to click the
    // panel-toggle button first.
    const panel = screen.getByTestId("overview-waypoint-panel");
    expect(panel).not.toBeNull();
  });

  it("each additional canvas click adds another waypoint (sequential pin drop)", async () => {
    const spy = vi.spyOn(waypointHelpers, "appendWaypoint");

    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const toolsToggle = screen.getByTestId("overview-tools-toggle");
    await act(async () => { fireEvent.click(toolsToggle); });

    const waypointToggle = screen.getByTestId("overview-waypoint-mode-toggle");
    await act(async () => { fireEvent.click(waypointToggle); });

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;

    const clicks = [
      { lon: -121.0, lat: 47.5 },
      { lon: -120.5, lat: 48.0 },
      { lon: -120.0, lat: 48.5 },
    ];

    for (const { lon, lat } of clicks) {
      const [px, py] = lonLatToPx(lon, lat);
      await act(async () => { clickAt(canvas, px, py); });
    }

    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it("non-waypoint mode canvas click does NOT call appendWaypoint", async () => {
    const spy = vi.spyOn(waypointHelpers, "appendWaypoint");

    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    const [px, py] = lonLatToPx(-120.5, 48.0);
    await act(async () => { clickAt(canvas, px, py); });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  /**
   * ZOOM scenario — verifies coordinate accuracy after the user wheel-zooms
   * before dropping a waypoint.
   *
   * Strategy:
   *   1. Mount the component and enable waypoint mode.
   *   2. Fire a wheel zoom-in event at the canvas centre so the component
   *      mutates its internal transformRef.
   *   3. Mirror the exact handleWheel + clampTransform math locally to predict
   *      the new transform.
   *   4. Compute the canvas pixel that corresponds to the target lon/lat using
   *      the predicted transform, then click there.
   *   5. Assert that appendWaypoint receives coordinates that round-trip back
   *      to the target position (to 1 decimal-degree precision).
   */
  it("coordinate accuracy is maintained after a wheel zoom before dropping a waypoint", async () => {
    const spy = vi.spyOn(waypointHelpers, "appendWaypoint");

    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const toolsToggle = screen.getByTestId("overview-tools-toggle");
    await act(async () => { fireEvent.click(toolsToggle); });

    const waypointToggle = screen.getByTestId("overview-waypoint-mode-toggle");
    await act(async () => { fireEvent.click(waypointToggle); });

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

    // --- Zoom in at the canvas centre ---
    const zoomCx = CANVAS_W / 2;
    const zoomCy = CANVAS_H / 2;
    await act(async () => {
      fireEvent.wheel(canvas, { clientX: zoomCx, clientY: zoomCy, deltaY: -100 });
    });

    // Mirror handleWheel math to predict transformRef after the event.
    const init = computeTestInitialTransform();
    const factor = 1.15; // deltaY < 0 → zoom in
    const newScale = init.scale * factor;
    const ratio = newScale / init.scale;
    const rawOffsetX = zoomCx + (init.offsetX - zoomCx) * ratio;
    const rawOffsetY = zoomCy + (init.offsetY - zoomCy) * ratio;
    const zoomedTransform = clampTestTransform({
      scale: newScale,
      pxPerDeg: init.pxPerDeg,
      offsetX: rawOffsetX,
      offsetY: rawOffsetY,
    });

    // Compute the canvas pixel for the target lon/lat using the zoomed transform.
    const targetLon = -120.5;
    const targetLat = 48.0;
    const [px, py] = lonLatToPxWithTransform(targetLon, targetLat, zoomedTransform);

    await act(async () => { clickAt(canvas, px, py); });

    expect(spy).toHaveBeenCalledOnce();
    const [, lon, lat] = spy.mock.calls[0] as [unknown, number, number];
    expect(lon).toBeCloseTo(targetLon, 1);
    expect(lat).toBeCloseTo(targetLat, 1);

    spy.mockRestore();
  });

  /**
   * MULTI-DATASET scenario — verifies that waypoint coordinates are computed
   * from the union-bbox transform (worldGridRef) rather than the single-dataset
   * overviewGrid when two datasets are loaded simultaneously.
   *
   * Strategy:
   *   1. Seed two datasets with non-overlapping bboxes into visibleDatasets:
   *        A: -122..-119 lon, 47..49 lat
   *        B: -116..-113 lon, 44..46 lat
   *      Union bbox: -122..-113 lon, 44..49 lat (lon=9°, lat=5°)
   *   2. Mount the component; the visibleDatasets effect sets worldGridRef to
   *      the union bbox and recomputes the transform via computeInitialTransform.
   *   3. Mirror that math locally to predict the canvas transform.
   *   4. Derive the canvas pixel for a target point using the union grid's
   *      lonLatToCanvas semantics, then click there.
   *   5. Assert appendWaypoint receives the correct lon/lat (would be wrong if
   *      the single-dataset overviewGrid were used instead of the union).
   */
  it("multi-dataset: waypoint click uses union-bbox transform so coordinates are not silently wrong", async () => {
    const gridA = makeOverviewGrid(); // -122..-119 lon, 47..49 lat, id="test-ds"

    const N = 4;
    const depthsB = new Array(N * N).fill(0).map((_, i) => 20 + i * 3);
    const gridB = {
      datasetId: "ds-b",
      name: "Dataset B",
      resolution: N,
      width: N,
      height: N,
      depths: depthsB,
      minDepth: 20,
      maxDepth: 20 + (N * N - 1) * 3,
      minLon: -116,
      maxLon: -113,
      minLat: 44,
      maxLat: 46,
      centerLon: -114.5,
      centerLat: 45.0,
      waterType: "saltwater" as const,
    };

    // Override store with two-dataset state (runs after beforeEach, before mount).
    useTerrainStore.setState({
      visibleDatasets: [
        { datasetId: gridA.datasetId, source: "preset", overviewGrid: gridA, activeGrid: null },
        { datasetId: gridB.datasetId, source: "preset", overviewGrid: gridB, activeGrid: null },
      ],
      primaryDatasetId: gridA.datasetId,
      overviewGrid: gridA,
      activeGrid: null,
    });

    const spy = vi.spyOn(waypointHelpers, "appendWaypoint");

    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const toolsToggle = screen.getByTestId("overview-tools-toggle");
    await act(async () => { fireEvent.click(toolsToggle); });

    const waypointToggle = screen.getByTestId("overview-waypoint-mode-toggle");
    await act(async () => { fireEvent.click(waypointToggle); });

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    expect(canvas).not.toBeNull();

    // Mirror the union-bbox transform that worldGridRef produces:
    //   union minLon=-122, maxLon=-113 (lonRange=9)
    //   union minLat=44,   maxLat=49  (latRange=5)
    const UNION_MIN_LON = -122, UNION_MAX_LON = -113;
    const UNION_MIN_LAT = 44,   UNION_MAX_LAT = 49;
    const unionLonRange = UNION_MAX_LON - UNION_MIN_LON; // 9
    const unionLatRange = UNION_MAX_LAT - UNION_MIN_LAT; // 5
    const unionPxPerDeg = Math.min(
      (CANVAS_W * 0.88) / unionLonRange,
      (CANVAS_H * 0.88) / unionLatRange,
    );
    const unionTerrainW = unionPxPerDeg * unionLonRange;
    const unionTerrainH = unionPxPerDeg * unionLatRange;
    const unionOffsetX  = (CANVAS_W - unionTerrainW) / 2;
    const unionOffsetY  = (CANVAS_H - unionTerrainH) / 2;

    // Target: a point inside dataset A's bbox.
    // If the click handler mistakenly used overviewGrid (A's 3°×2° bbox) instead
    // of the union (9°×5°) the round-trip lat would be off by several degrees.
    const targetLon = -120.5;
    const targetLat = 48.0;

    // Mirror lonLatToCanvas with the union grid (scale=1).
    const px = unionOffsetX + ((targetLon - UNION_MIN_LON) / unionLonRange) * unionTerrainW;
    const py = unionOffsetY + (1 - (targetLat - UNION_MIN_LAT) / unionLatRange) * unionTerrainH;

    await act(async () => {
      canvas.getBoundingClientRect = () =>
        ({
          left: 0, top: 0,
          right: CANVAS_W, bottom: CANVAS_H,
          width: CANVAS_W, height: CANVAS_H,
          x: 0, y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      fireEvent.click(canvas, { clientX: px, clientY: py });
    });

    expect(spy).toHaveBeenCalledOnce();
    const [, lon, lat] = spy.mock.calls[0] as [unknown, number, number];
    expect(lon).toBeCloseTo(targetLon, 1);
    expect(lat).toBeCloseTo(targetLat, 1);

    spy.mockRestore();
  });

  /**
   * WORLD-GRID PAN CLAMPING scenario — verifies that panning uses the union-bbox
   * (worldGridRef) as the clamp boundary when two datasets are loaded, rather
   * than the smaller single-dataset overviewGrid.
   *
   * Strategy:
   *   1. Seed two datasets with non-overlapping bboxes:
   *        A: -122..-119 lon, 47..49 lat  (primary)
   *        B: -116..-113 lon, 44..46 lat
   *      Union bbox: -122..-113 lon (9°), 44..49 lat (5°)
   *   2. Mount the component; the visibleDatasets effect sets worldGridRef to
   *      the union bbox and computes the initial transform from it.
   *   3. Fire a very large drag to the left so the raw offset is far beyond
   *      even the union clamp limit, ensuring it hits the clamp boundary.
   *   4. Mirror the expected union-clamp math locally to predict the clamped
   *      offsetX, then click at a fixed pixel and compute the expected lon/lat.
   *   5. Assert appendWaypoint receives that lon — which would be ~5 degrees off
   *      if A's smaller grid had been used for clamping instead of the union.
   */
  it("world-grid pan clamping uses union bbox so panning is not over-restricted to the primary dataset", async () => {
    const gridA = makeOverviewGrid(); // -122..-119 lon, 47..49 lat

    const NB = 4;
    const depthsB = new Array(NB * NB).fill(0).map((_, i) => 20 + i * 3);
    const gridB = {
      datasetId: "ds-b",
      name: "Dataset B",
      resolution: NB,
      width: NB,
      height: NB,
      depths: depthsB,
      minDepth: 20,
      maxDepth: 20 + (NB * NB - 1) * 3,
      minLon: -116,
      maxLon: -113,
      minLat: 44,
      maxLat: 46,
      centerLon: -114.5,
      centerLat: 45.0,
      waterType: "saltwater" as const,
    };

    useTerrainStore.setState({
      visibleDatasets: [
        { datasetId: gridA.datasetId, source: "preset", overviewGrid: gridA, activeGrid: null },
        { datasetId: gridB.datasetId, source: "preset", overviewGrid: gridB, activeGrid: null },
      ],
      primaryDatasetId: gridA.datasetId,
      overviewGrid: gridA,
      activeGrid: null,
    });

    const spy = vi.spyOn(waypointHelpers, "appendWaypoint");

    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const toolsToggle = screen.getByTestId("overview-tools-toggle");
    await act(async () => { fireEvent.click(toolsToggle); });

    const waypointToggle = screen.getByTestId("overview-waypoint-mode-toggle");
    await act(async () => { fireEvent.click(waypointToggle); });

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

    // Mirror the union-bbox initial transform that the component computes
    // (two datasets → worldGridRef set → computeInitialTransform uses union grid).
    const UNION_MIN_LON = -122;
    const UNION_MAX_LON = -113;
    const UNION_MIN_LAT = 44;
    const UNION_MAX_LAT = 49;
    const unionLonRange = UNION_MAX_LON - UNION_MIN_LON; // 9
    const unionLatRange = UNION_MAX_LAT - UNION_MIN_LAT; // 5
    const unionPxPerDeg = Math.min(
      (CANVAS_W * 0.88) / unionLonRange,
      (CANVAS_H * 0.88) / unionLatRange,
    );
    const unionTerrainW = unionPxPerDeg * unionLonRange;
    const unionTerrainH = unionPxPerDeg * unionLatRange;
    const initOffsetX = (CANVAS_W - unionTerrainW) / 2;
    const initOffsetY = (CANVAS_H - unionTerrainH) / 2;

    // Drag 5000 px to the left — far beyond the union clamp minimum.
    // After clamping, offsetX must equal -(unionTerrainW * 0.9), NOT the
    // narrower -(primaryTerrainW * 0.9) that gridA alone would produce.
    const DRAG_DX = -5000;
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 400, clientY: 300 });
      fireEvent.mouseMove(window, { clientX: 400 + DRAG_DX, clientY: 300 });
      fireEvent.mouseUp(window,   { clientX: 400 + DRAG_DX, clientY: 300 });
    });

    // Reset hasDraggedRef so the next click is not swallowed by the drag guard.
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0 });
    });

    // Predict the clamped offset using union-grid bounds.
    // Union clamp: offsetX ∈ [-(unionTerrainW * 0.9), CANVAS_W - unionTerrainW * 0.1]
    // With DRAG_DX=-5000, raw offsetX ≪ clamp minimum → lands at the minimum.
    const unionClampMinX = -(unionTerrainW * 0.9);
    const clampedOffsetX = Math.max(
      unionClampMinX,
      Math.min(CANVAS_W - unionTerrainW * 0.1, initOffsetX + DRAG_DX),
    );
    // No vertical drag → offsetY unchanged.
    const clampedOffsetY = initOffsetY;

    // Click at a fixed canvas pixel and compute expected lon/lat from union transform.
    // If gridA's smaller bbox had been used for clamping, clampedOffsetX would be
    // ~540 px less negative, yielding a lon ~5° different — detectable at ±0.5°.
    const CLICK_X = 200;
    const CLICK_Y = 300;
    const expectedLon =
      UNION_MIN_LON +
      ((CLICK_X - clampedOffsetX) / (unionPxPerDeg * unionLonRange)) * unionLonRange;
    const expectedLat =
      UNION_MIN_LAT +
      (1 - (CLICK_Y - clampedOffsetY) / (unionPxPerDeg * unionLatRange)) * unionLatRange;

    await act(async () => {
      fireEvent.click(canvas, { clientX: CLICK_X, clientY: CLICK_Y });
    });

    expect(spy).toHaveBeenCalledOnce();
    const [, lon, lat] = spy.mock.calls[0] as [unknown, number, number];
    // 0 decimal places → ±0.5° tolerance; the wrong-grid error is ~5°.
    expect(lon).toBeCloseTo(expectedLon, 0);
    expect(lat).toBeCloseTo(expectedLat, 0);

    spy.mockRestore();
  });

  /**
   * PAN scenario — verifies coordinate accuracy after the user drags (pans)
   * the overview map before dropping a waypoint.
   *
   * Strategy:
   *   1. Mount the component and enable waypoint mode.
   *   2. Simulate a mouse drag of (panDx, panDy) pixels so the component
   *      mutates its internal transformRef via handleMouseMove.
   *   3. Fire a second mousedown (no movement) to reset hasDraggedRef so
   *      the subsequent click is not swallowed by the drag guard.
   *   4. Mirror handleMouseMove + clampTransform math to predict the new
   *      transform, compute the target pixel, click there, and assert
   *      appendWaypoint receives the correct coordinates.
   */
  it("coordinate accuracy is maintained after a mouse pan before dropping a waypoint", async () => {
    const spy = vi.spyOn(waypointHelpers, "appendWaypoint");

    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const toolsToggle = screen.getByTestId("overview-tools-toggle");
    await act(async () => { fireEvent.click(toolsToggle); });

    const waypointToggle = screen.getByTestId("overview-waypoint-mode-toggle");
    await act(async () => { fireEvent.click(waypointToggle); });

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

    // --- Pan: drag 60 px right, 40 px down ---
    const panDx = 60;
    const panDy = 40;
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300 });
      fireEvent.mouseMove(window, { clientX: 300 + panDx, clientY: 300 + panDy });
      fireEvent.mouseUp(window,   { clientX: 300 + panDx, clientY: 300 + panDy });
    });

    // After the drag, hasDraggedRef=true which would swallow the next click.
    // A fresh mousedown resets hasDraggedRef to false (mirrors component logic).
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0 });
    });

    // Mirror handleMouseMove pan + clampTransform to predict transformRef.
    const init = computeTestInitialTransform();
    const pannedTransform = clampTestTransform({
      scale:    init.scale,
      pxPerDeg: init.pxPerDeg,
      offsetX:  init.offsetX + panDx,
      offsetY:  init.offsetY + panDy,
    });

    // Compute the canvas pixel for the target lon/lat using the panned transform.
    const targetLon = -121.0;
    const targetLat = 47.5;
    const [px, py] = lonLatToPxWithTransform(targetLon, targetLat, pannedTransform);

    await act(async () => { clickAt(canvas, px, py); });

    expect(spy).toHaveBeenCalledOnce();
    const [, lon, lat] = spy.mock.calls[0] as [unknown, number, number];
    expect(lon).toBeCloseTo(targetLon, 1);
    expect(lat).toBeCloseTo(targetLat, 1);

    spy.mockRestore();
  });
});
