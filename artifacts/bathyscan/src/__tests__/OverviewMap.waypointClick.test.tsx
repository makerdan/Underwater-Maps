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
  const minLon = -122, maxLon = -119;
  const minLat = 47, maxLat = 49;
  const lonRange = maxLon - minLon;
  const latRange = maxLat - minLat;
  const pxPerDeg = Math.min((CANVAS_W * 0.88) / lonRange, (CANVAS_H * 0.88) / latRange);
  const terrainW = pxPerDeg * lonRange;
  const terrainH = pxPerDeg * latRange;
  const offsetX = (CANVAS_W - terrainW) / 2;
  const offsetY = (CANVAS_H - terrainH) / 2;
  return [
    offsetX + ((lon - minLon) / lonRange) * terrainW,
    offsetY + (1 - (lat - minLat) / latRange) * terrainH,
  ];
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
});
