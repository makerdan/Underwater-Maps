/**
 * Confirms that the `activeEfhFeatures` and `datasetsWithGrid` useMemo calls
 * in OverviewMap have stable deps that don't produce spurious recomputes when
 * unrelated state changes.
 *
 * Approach:
 *   - Spy on `filterEfhByBbox` (the inner computation of `activeEfhFeatures`).
 *   - Mount OverviewMap with a fixed overviewGrid + efhData snapshot.
 *   - Trigger a camera heading change — entirely unrelated to EFH or grid data.
 *   - Assert filterEfhByBbox was called exactly once (on mount), not again
 *     after the heading change.
 *
 * If any dep in the `activeEfhFeatures` memo were an inline object literal or
 * otherwise recreated each render, filterEfhByBbox would be called on every
 * re-render that the camera heading causes, and the spy call count would grow.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { useCameraStore } from "@/lib/cameraStore";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Spy on filterEfhByBbox — hoisted so vi.mock factory can reference it.
// ---------------------------------------------------------------------------
const filterEfhByBboxSpy = vi.hoisted(() => vi.fn((features: unknown) => features));

vi.mock("@/lib/efhBboxFilter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/efhBboxFilter")>();
  return {
    ...actual,
    filterEfhByBbox: filterEfhByBboxSpy,
  };
});

// ---------------------------------------------------------------------------
// Standard OverviewMap mock surface (mirrors overviewMap.componentIntegration)
// ---------------------------------------------------------------------------
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

const mockEfhData = vi.hoisted(() => ({
  features: [
    {
      type: "Feature",
      properties: {
        species: "halibut", commonName: "Pacific Halibut", fmp: "Test FMP",
        depthRangeM: [0, 200], habitatDescription: "Rocky", source: "NOAA",
        creditUrl: "https://example.com", color: "#00e5ff",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[[-121, 47.5], [-120, 47.5], [-120, 48.5], [-121, 48.5], [-121, 47.5]]],
      },
    },
  ],
}));

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
    useGetDatasets: () => ({
      data: [{ id: "test-ds", hasEfh: true, name: "Test Dataset" }],
    }),
    getGetDatasetsQueryKey: (p: unknown) => ["datasets", p],
    usePostDatasetsBboxQuery: () => ({ mutateAsync: vi.fn() }),
    useGetDatasetsMySaves: () => ({ data: [], refetch: vi.fn() }),
    getGetDatasetsMySavesQueryKey: () => ["my-saves"],
    usePostDatasetsCatalogIdSave: () => ({ mutateAsync: vi.fn() }),
    useGetEfh: () => ({ data: mockEfhData, isLoading: false, isError: false, refetch: vi.fn() }),
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
    efhOverlayEnabled: true,
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
}

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
// Tests
// ---------------------------------------------------------------------------

describe("OverviewMap — activeEfhFeatures memo stability", () => {
  beforeEach(() => {
    filterEfhByBboxSpy.mockClear();
    setupStores();
  });

  afterEach(() => {
    cleanup();
  });

  it("filterEfhByBbox is called on mount but NOT on a subsequent camera heading change", async () => {
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    await waitForCameraArrow();

    const callsAfterMount = filterEfhByBboxSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    filterEfhByBboxSpy.mockClear();

    await act(async () => {
      useCameraStore.setState({ heading: 90 });
    });

    expect(filterEfhByBboxSpy).not.toHaveBeenCalled();
  });

  it("filterEfhByBbox IS called again when the overviewGrid itself changes (confirming memo reacts to real dep changes)", async () => {
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    await waitForCameraArrow();
    filterEfhByBboxSpy.mockClear();

    const newGrid = {
      ...makeOverviewGrid(),
      minLon: -120,
      maxLon: -118,
    };

    await act(async () => {
      useTerrainStore.setState({
        overviewGrid: newGrid as unknown as TerrainData,
        visibleDatasets: [
          { datasetId: newGrid.datasetId, source: "preset", overviewGrid: newGrid, activeGrid: null },
        ],
      });
    });

    expect(filterEfhByBboxSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
