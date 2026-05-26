import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useUiStore } from "@/lib/uiStore";
import { useTerrainStore } from "@/lib/terrainStore";

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ setDatasetId: vi.fn(), terrain: null }),
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: vi.fn(),
}));

const substrateCollection = {
  type: "FeatureCollection",
  metadata: {
    sourceName: "Test Substrate Source",
    creditUrl: "https://example.test/credit",
  },
  features: [
    {
      type: "Feature",
      properties: {
        unitId: "poly-1",
        substrate: "sand",
        shoreZoneClass: "SAND",
        cmecsCode: "SBS_SA",
        color: "#e2d5a0",
        szMaterial: "sand",
        szForm: "flat",
        areaSqM: 1234,
        natsur: "Sandy bottom per S-57 NATSUR.",
        encChart: "US5AK4DM",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-119.8, 47.3],
            [-119.7, 47.3],
            [-119.7, 47.4],
            [-119.8, 47.4],
            [-119.8, 47.3],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        unitId: "poly-2",
        substrate: "gravel",
        shoreZoneClass: "GRAVEL",
        cmecsCode: "SBS_GR",
        color: "#9ab5c4",
        szMaterial: "gravel",
        szForm: "ramp",
        areaSqM: 5678,
        natsur: "TPWD lake-survey: gravel substrate near boat ramp.",
        encChart: "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/example",
      },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [-119.5, 47.6],
              [-119.4, 47.6],
              [-119.4, 47.7],
              [-119.5, 47.7],
              [-119.5, 47.6],
            ],
          ],
        ],
      },
    },
  ],
};

vi.mock("@workspace/api-client-react", () => {
  const noop = () => ({ data: undefined });
  const noopList = () => ({ data: [], refetch: vi.fn() });
  return {
    useGetMarkers: () => ({ data: [] }),
    getGetMarkersQueryKey: (p: unknown) => ["markers", p],
    useGetTrails: () => ({ data: [], refetch: vi.fn() }),
    getGetTrailsQueryKey: (p: unknown) => ["trails", p],
    useDeleteTrailsId: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
    getTrailsIdPoints: vi.fn(),
    useGetDatasets: () => ({ data: [{ id: "test-ds", hasEfh: false }] }),
    getGetDatasetsQueryKey: (p: unknown) => ["datasets", p],
    usePostDatasetsBboxQuery: () => ({ mutateAsync: vi.fn() }),
    useGetDatasetsMySaves: noopList,
    getGetDatasetsMySavesQueryKey: () => ["my-saves"],
    usePostDatasetsCatalogIdSave: () => ({ mutateAsync: vi.fn() }),
    useGetEfh: noop,
    getGetEfhQueryKey: (p: unknown) => ["efh", p],
    useGetSubstrate: () => ({ data: substrateCollection }),
    getGetSubstrateQueryKey: (id: string) => ["substrate", id],
  };
});

import { OverviewMap } from "@/components/OverviewMap";

const CANVAS_W = 1024;
const CANVAS_H = 768;

function withQuery(node: React.ReactElement): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, node);
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

// Mirrors computeInitialTransform / lonLatToCanvas for the 1°×1° test grid.
function lonLatToPx(lon: number, lat: number): [number, number] {
  const lonRange = 1;
  const latRange = 1;
  const pxPerDeg = Math.min((CANVAS_W * 0.88) / lonRange, (CANVAS_H * 0.88) / latRange);
  const terrainW = pxPerDeg * lonRange;
  const terrainH = pxPerDeg * latRange;
  const offsetX = (CANVAS_W - terrainW) / 2;
  const offsetY = (CANVAS_H - terrainH) / 2;
  return [
    offsetX + ((lon - -120) / lonRange) * terrainW,
    offsetY + ((lat - 47) / latRange) * terrainH,
  ];
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
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
    centerLon: -119.5,
    centerLat: 47.5,
    waterType: "saltwater" as const,
  };
}

describe("OverviewMap substrate click → uiStore.selectedSubstrate", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: CANVAS_W, configurable: true });
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
      substrateColorMode: true,
      selectedSubstrate: null,
      efhOverlayEnabled: false,
      overviewOpen: true,
      pendingDropIn: null,
    });
  });

  it("clicking a Polygon feature mirrors its properties + ENC chart citation into uiStore", () => {
    const { container } = renderWithProviders(withQuery(React.createElement(OverviewMap)));
    const canvas = container.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;
    expect(canvas).not.toBeNull();

    const [px, py] = lonLatToPx(-119.75, 47.35);
    clickAt(canvas, px, py);

    const sel = useUiStore.getState().selectedSubstrate;
    expect(sel).not.toBeNull();
    expect(sel!.unitId).toBe("poly-1");
    expect(sel!.substrate).toBe("sand");
    expect(sel!.cmecsCode).toBe("SBS_SA");
    expect(sel!.natsur).toBe("Sandy bottom per S-57 NATSUR.");
    expect(sel!.encChart).toBe("US5AK4DM");
    expect(sel!.sourceName).toBe("Test Substrate Source");
    expect(sel!.creditUrl).toBe("https://example.test/credit");
  });

  it("clicking a MultiPolygon feature carries TPWD lake-page link through encChart", () => {
    const { container } = renderWithProviders(withQuery(React.createElement(OverviewMap)));
    const canvas = container.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;

    const [px, py] = lonLatToPx(-119.45, 47.65);
    clickAt(canvas, px, py);

    const sel = useUiStore.getState().selectedSubstrate;
    expect(sel).not.toBeNull();
    expect(sel!.unitId).toBe("poly-2");
    expect(sel!.substrate).toBe("gravel");
    expect(sel!.natsur).toBe("TPWD lake-survey: gravel substrate near boat ramp.");
    expect(sel!.encChart).toBe(
      "https://tpwd.texas.gov/fishboat/fish/recreational/lakes/example",
    );
  });

  it("clicking outside any polygon does not set selectedSubstrate", () => {
    const { container } = renderWithProviders(withQuery(React.createElement(OverviewMap)));
    const canvas = container.querySelector<HTMLCanvasElement>(
      'canvas[data-testid="overview-map-canvas"]',
    )!;

    // Lon/lat (-119.95, 47.95) is inside the grid but outside both polygons.
    const [px, py] = lonLatToPx(-119.95, 47.95);
    clickAt(canvas, px, py);

    expect(useUiStore.getState().selectedSubstrate).toBeNull();
  });
});
