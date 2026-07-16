import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useUiStore } from "@/lib/uiStore";
import { useTerrainStore } from "@/lib/terrainStore";

/**
 * SELF-MAINTAINING API CLIENT MOCK — same Proxy pattern as
 * OverviewMapSubstrateClick.test.tsx and overviewMap.componentIntegration.test.ts.
 */
const mockConfig = vi.hoisted(() => ({
  efhData: undefined as unknown,
}));

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
    useGetDatasets: () => ({ data: [{ id: "test-ds", hasEfh: true }] }),
    getGetDatasetsQueryKey: (p: unknown) => ["datasets", p],
    usePostDatasetsBboxQuery: () => ({ mutateAsync: vi.fn() }),
    useGetDatasetsMySaves: () => ({ data: [], refetch: vi.fn() }),
    getGetDatasetsMySavesQueryKey: () => ["my-saves"],
    usePostDatasetsCatalogIdSave: () => ({ mutateAsync: vi.fn() }),
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

/**
 * Grid spanning 3°×2° so it comfortably contains the EFH test polygon
 * which occupies lon [-121, -120], lat [47.5, 48.5].
 */
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

/**
 * Convert a lon/lat point to canvas-pixel coordinates matching
 * computeInitialTransform / lonLatToCanvas for the 3°×2° test grid.
 *
 * lonLatToCanvas formula:
 *   cx = offsetX + ((lon - minLon) / lonRange) * terrainW
 *   cy = offsetY + (1 - (lat - minLat) / latRange) * terrainH
 */
function lonLatToPx(lon: number, lat: number): [number, number] {
  const lonRange = 3; // -122 to -119
  const latRange = 2; // 47 to 49
  const pxPerDeg = Math.min((CANVAS_W * 0.88) / lonRange, (CANVAS_H * 0.88) / latRange);
  const terrainW = pxPerDeg * lonRange;
  const terrainH = pxPerDeg * latRange;
  const offsetX = (CANVAS_W - terrainW) / 2;
  const offsetY = (CANVAS_H - terrainH) / 2;
  return [
    offsetX + ((lon - -122) / lonRange) * terrainW,
    offsetY + (1 - (lat - 47) / latRange) * terrainH,
  ];
}

function clickAt(canvas: HTMLCanvasElement, x: number, y: number) {
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: CANVAS_W,
      bottom: CANVAS_H,
      width: CANVAS_W,
      height: CANVAS_H,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  fireEvent.click(canvas, { clientX: x, clientY: y });
}

/** EFH polygon occupying lon [-121, -120], lat [47.5, 48.5]. */
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

describe("OverviewMap EFH hit-test (click-to-select species)", () => {
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
      selectedEfh: null,
      efhOverlayEnabled: false,
      overviewOpen: true,
      pendingDropIn: null,
    });
  });

  it("clicking inside an EFH polygon sets uiStore.selectedEfh to the species properties", async () => {
    mockConfig.efhData = { features: [makeEfhFeature()] };
    useUiStore.setState({ ...useUiStore.getState(), efhOverlayEnabled: true });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = renderWithProviders(withQuery(React.createElement(OverviewMap))));
    });

    const canvas = container.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    expect(canvas).not.toBeNull();

    // Centre of the EFH polygon: lon=-120.5, lat=48.0
    const [px, py] = lonLatToPx(-120.5, 48.0);
    clickAt(canvas, px, py);

    const sel = useUiStore.getState().selectedEfh;
    expect(sel).not.toBeNull();
    expect(sel!.species).toBe("halibut");
    expect(sel!.commonName).toBe("Pacific Halibut");
    expect(sel!.fmp).toBe("Test FMP");
    expect(sel!.creditUrl).toBe("https://example.com");
  });

  it("clicking outside all EFH polygons does not set uiStore.selectedEfh", async () => {
    mockConfig.efhData = { features: [makeEfhFeature()] };
    useUiStore.setState({ ...useUiStore.getState(), efhOverlayEnabled: true });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = renderWithProviders(withQuery(React.createElement(OverviewMap))));
    });

    const canvas = container.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    expect(canvas).not.toBeNull();

    // lon=-121.5, lat=47.25 is inside the grid but well outside the EFH polygon
    // (polygon covers [-121,-120] × [47.5, 48.5]).
    const [px, py] = lonLatToPx(-121.5, 47.25);
    clickAt(canvas, px, py);

    expect(useUiStore.getState().selectedEfh).toBeNull();
  });
});
