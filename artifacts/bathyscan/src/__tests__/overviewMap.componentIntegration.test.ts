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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, waitFor, fireEvent, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useSpecialCollectionStore } from "@/lib/specialCollectionStore";
import { usePuzzleStore } from "@/lib/puzzleStore";
import * as overviewRenderer from "@/lib/overviewRenderer";
import { POLYGON_LOD_MIN_ZOOM } from "@/lib/overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Configurable mock state — updated per-test so useGetEfh can return data.
// Must be hoisted so it's in scope when vi.mock factories run.
// ---------------------------------------------------------------------------
const mockConfig = vi.hoisted(() => ({
  efhData: undefined as unknown,
  bboxQueryMutation: vi.fn(),
  saveMutation: vi.fn(),
  refetchMySaves: vi.fn(),
  mySaves: [] as unknown[],
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
    usePostDatasetsBboxQuery: () => ({ mutateAsync: mockConfig.bboxQueryMutation }),
    useGetDatasetsMySaves: () => ({ data: mockConfig.mySaves, refetch: mockConfig.refetchMySaves }),
    getGetDatasetsMySavesQueryKey: () => ["my-saves"],
    usePostDatasetsCatalogIdSave: () => ({ mutateAsync: mockConfig.saveMutation }),
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

function resetBoxSelectMocks() {
  mockConfig.bboxQueryMutation.mockReset();
  mockConfig.saveMutation.mockReset();
  mockConfig.refetchMySaves.mockReset().mockResolvedValue(undefined);
  mockConfig.mySaves = [];
}

beforeEach(() => {
  resetBoxSelectMocks();
});

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

const BOX_SELECT_CATALOG_RESULT = {
  id: "box-select-catalog",
  name: "Box Select Survey",
  sourceAgency: "Test Hydrographic Office",
  dataType: "bathymetry",
  coverageBbox: { minLon: -121.5, minLat: 47.5, maxLon: -120, maxLat: 48.5 },
  waterType: "saltwater",
  createdAt: "2024-01-01",
  relevanceScore: 1,
};

const BOX_SELECT_NEIGHBOR_RESULT = {
  ...BOX_SELECT_CATALOG_RESULT,
  id: "box-select-neighbor",
  name: "Neighboring Box Select Survey",
};

/** Shared store setup used by both describe blocks. */
function setupStores() {
  Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

  const grid = makeOverviewGrid();
  useTerrainStore.setState({
    visibleDatasets: [
      ({ datasetId: grid.datasetId, source: "preset", overviewGrid: grid, activeGrid: null } satisfies VisibleDataset),
    ],
    primaryDatasetId: grid.datasetId,
    overviewGrid: grid,
    activeGrid: null,
    collectionScopeId: null,
    collectionScopeIds: [],
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
    cameraPosition: { known: true, lon: -120.5, lat: 48.0 },
    heading: 0,
    cameraDepth: 50,
    cameraAltitude: 30,
  });
  useSpecialCollectionStore.setState({ active: null, pendingRestore: null });
  usePuzzleStore.setState({
    puzzleMode: false,
    puzzleTransforms: {},
    overviewTransform: null,
    worldGrid: null,
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

async function openBoxSelectResult(catalogResults = [BOX_SELECT_CATALOG_RESULT]) {
  setupStores();
  mockConfig.bboxQueryMutation.mockResolvedValue({
    datasets: catalogResults,
  });

  await act(async () => {
    renderWithProviders(withQuery(React.createElement(OverviewMap)));
  });

  const toolsToggle = screen.getByTestId("overview-tools-toggle");
  await act(async () => { fireEvent.click(toolsToggle); });
  await act(async () => {
    fireEvent.click(screen.getByTestId("overview-select-area-toggle"));
  });

  const canvas = screen.getByTestId("overview-map-canvas");
  canvas.getBoundingClientRect = () =>
    ({
      left: 0, top: 0,
      right: CANVAS_W, bottom: CANVAS_H,
      width: CANVAS_W, height: CANVAS_H,
      x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  await act(async () => {
    fireEvent.mouseDown(canvas, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 500 });
    fireEvent.mouseUp(window);
  });

  await waitFor(() => expect(screen.getByTestId("overview-bbox-panel")).toBeInTheDocument());
  await act(async () => {
    fireEvent.click(screen.getByTestId("overview-bbox-request"));
  });
  await waitFor(() => expect(screen.getAllByTestId("overview-bbox-result-card")).not.toHaveLength(0));
}

describe("OverviewMap — Box Select save feedback", () => {
  it("shows a useful error, keeps the result available, and retries successfully", async () => {
    mockConfig.saveMutation.mockRejectedValueOnce({
      data: { detail: "The library service is temporarily unavailable." },
    });

    await openBoxSelectResult();
    const saveButton = screen.getByTestId("overview-bbox-save");

    await act(async () => { fireEvent.click(saveButton); });

    const error = await screen.findByTestId("overview-bbox-save-error-box-select-catalog");
    expect(error).toHaveTextContent(
      "Could not save this dataset: The library service is temporarily unavailable. Please try again.",
    );
    expect(screen.getByTestId("overview-bbox-panel")).toBeInTheDocument();
    expect(screen.getByTestId("overview-bbox-result-card")).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    expect(saveButton).toHaveTextContent("+ SAVE");

    mockConfig.saveMutation.mockResolvedValueOnce(undefined);
    mockConfig.refetchMySaves.mockImplementationOnce(async () => {
      mockConfig.mySaves = [{ catalogId: BOX_SELECT_CATALOG_RESULT.id }];
    });

    await act(async () => { fireEvent.click(saveButton); });

    await waitFor(() => {
      expect(screen.getByTestId("overview-bbox-save")).toHaveTextContent("✓ SAVED");
    });
    expect(screen.queryByTestId("overview-bbox-save-error-box-select-catalog")).toBeNull();
    expect(mockConfig.saveMutation).toHaveBeenCalledTimes(2);
  });

  it("keeps successful saves in the SAVED state", async () => {
    mockConfig.saveMutation.mockResolvedValueOnce(undefined);
    mockConfig.refetchMySaves.mockImplementationOnce(async () => {
      mockConfig.mySaves = [{ catalogId: BOX_SELECT_CATALOG_RESULT.id }];
    });

    await openBoxSelectResult();
    await act(async () => {
      fireEvent.click(screen.getByTestId("overview-bbox-save"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("overview-bbox-save")).toHaveTextContent("✓ SAVED");
    });
    expect(screen.queryByTestId("overview-bbox-save-error-box-select-catalog")).toBeNull();
  });

  it("isolates one failed save from a neighboring result and preserves both across retry", async () => {
    mockConfig.saveMutation
      .mockRejectedValueOnce({
        data: { detail: "The first dataset could not be saved." },
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const savedCatalogIds: string[] = [];
    mockConfig.refetchMySaves.mockImplementation(async () => {
      const lastSave = mockConfig.saveMutation.mock.calls.at(-1)?.[0] as { id?: string } | undefined;
      if (lastSave?.id && !savedCatalogIds.includes(lastSave.id)) {
        savedCatalogIds.push(lastSave.id);
      }
      mockConfig.mySaves = savedCatalogIds.map((catalogId) => ({ catalogId }));
    });

    await openBoxSelectResult([BOX_SELECT_CATALOG_RESULT, BOX_SELECT_NEIGHBOR_RESULT]);

    const failedCard = screen
      .getByText(BOX_SELECT_CATALOG_RESULT.name)
      .closest('[data-testid="overview-bbox-result-card"]');
    const neighboringCard = screen
      .getByText(BOX_SELECT_NEIGHBOR_RESULT.name)
      .closest('[data-testid="overview-bbox-result-card"]');
    expect(failedCard).not.toBeNull();
    expect(neighboringCard).not.toBeNull();

    const failedSaveButton = within(failedCard!).getByTestId("overview-bbox-save");
    const neighboringSaveButton = within(neighboringCard!).getByTestId("overview-bbox-save");
    expect(failedSaveButton).toBeEnabled();
    expect(neighboringSaveButton).toBeEnabled();

    await act(async () => { fireEvent.click(failedSaveButton); });

    expect(await within(failedCard!).findByTestId("overview-bbox-save-error-box-select-catalog"))
      .toHaveTextContent(
        "Could not save this dataset: The first dataset could not be saved. Please try again.",
      );
    expect(within(neighboringCard!).queryByRole("alert")).toBeNull();
    expect(neighboringSaveButton).toBeEnabled();
    expect(neighboringSaveButton).toHaveTextContent("+ SAVE");

    await act(async () => { fireEvent.click(neighboringSaveButton); });
    await waitFor(() => expect(neighboringSaveButton).toHaveTextContent("✓ SAVED"));
    expect(screen.getByText(BOX_SELECT_CATALOG_RESULT.name)).toBeInTheDocument();
    expect(within(failedCard!).getByTestId("overview-bbox-save")).toHaveTextContent("+ SAVE");

    await act(async () => { fireEvent.click(failedSaveButton); });
    await waitFor(() => expect(failedSaveButton).toHaveTextContent("✓ SAVED"));

    expect(screen.getByText(BOX_SELECT_NEIGHBOR_RESULT.name)).toBeInTheDocument();
    expect(within(neighboringCard!).getByTestId("overview-bbox-save")).toHaveTextContent("✓ SAVED");
    expect(within(failedCard!).queryByRole("alert")).toBeNull();
    expect(mockConfig.saveMutation.mock.calls).toEqual([
      [{ id: BOX_SELECT_CATALOG_RESULT.id }],
      [{ id: BOX_SELECT_NEIGHBOR_RESULT.id }],
      [{ id: BOX_SELECT_CATALOG_RESULT.id }],
    ]);
  });
});

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

  // rot = cameraHeading directly (North=0°=up in SVG, arrow defined pointing up).
  // See OverviewMap.tsx "Heading 0° = North = rotate(0)" comment.
  const HEADING_CASES = [
    { heading: 0,   expectedRot: 0 },
    { heading: 90,  expectedRot: 90 },
    { heading: 180, expectedRot: 180 },
    { heading: 270, expectedRot: 270 },
  ] as const;

  for (const { heading, expectedRot } of HEADING_CASES) {
    it(`heading ${heading}° → SVG polygon contains rotate(${expectedRot})`, async () => {
      useCameraStore.setState({ heading });

      await act(async () => {
        renderWithProviders(withQuery(React.createElement(OverviewMap)));
      });

      // rAF must fire first to set svgTransform; then the polygon appears.
      const polygon = await waitForCameraArrow();

      const transform = poly?.getAttribute("transform") ?? "";
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

    // rot = heading → each +90° heading step → +90° rotation step
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

    const spy = vi.spyOn(overviewRenderer, "renderEfhLegend");

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    const canvas = screen.getByTestId("overview-map-canvas") as HTMLCanvasElement;

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );
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

    const canvas = screen.getByTestId("overview-map-canvas") as HTMLCanvasElement;

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );
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

    const canvas = screen.getByTestId("overview-map-canvas") as HTMLCanvasElement;

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );
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

    const canvas = screen.getByTestId("overview-map-canvas") as HTMLCanvasElement;

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );
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
// 4. Retry button — appears after 15 s load timeout, clicking it resets to LOADING
//
// When visibleDatasets is non-empty but the overview grid never arrives, the
// rAF loop flips overviewLoadFailed → true after 15 s, which mounts the
// data-testid="overview-load-retry" DOM button.  Clicking it calls
// handleOverviewRetry, which resets overviewLoadFailed → false (button
// unmounts) and resets nullGridSince so the LOADING spinner restarts.
// ---------------------------------------------------------------------------

describe("OverviewMap — retry button after load timeout", () => {
  beforeEach(() => {
    mockConfig.efhData = undefined;
  });

  // Always restore mocks so a failing assertion doesn't leak Date.now() into
  // the next test (testing-library's waitFor uses Date.now() for its deadline,
  // so a stale far-future mock causes every subsequent waitFor to time out
  // immediately).
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retry button appears after 15 s and clicking it removes the button (back to LOADING state)", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    // Dataset selected but grid never arrives — simulates a stalled fetch.
    useTerrainStore.setState({
      visibleDatasets: [
        ({ datasetId: "slow-ds", source: "preset", overviewGrid: null, activeGrid: null } satisfies VisibleDataset),
      ],
      primaryDatasetId: "slow-ds",
      primaryDatasetIds: ["slow-ds"],
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

    // Keep a valid in-bounds camera position so the Zustand store isn't left
    // with `known: false` for subsequent tests that rely on it being in-bounds.
    useCameraStore.setState({
      cameraPosition: { known: true, lon: -120.5, lat: 48.0 },
      heading: 0,
      cameraDepth: 50,
      cameraAltitude: 30,
    });

    // Freeze Date.now() at a known baseline so we can jump time precisely.
    const realNow = Date.now();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(realNow);

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Allow several rAF frames so nullGridSince is established at ~realNow.
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    // Retry button must NOT be visible yet (< 15 s elapsed).
    expect(document.querySelector('[data-testid="overview-load-retry"]')).toBeNull();

    // Jump Date.now() 16 s into the future so the next rAF frame sees
    // waitedMs > 15_000 and flips overviewLoadFailed → true.
    dateSpy.mockReturnValue(realNow + 16_000);

    // Use waitFor so the test keeps polling until the React state update from
    // inside the rAF callback is flushed and the DOM reflects the new state.
    const retryWrapper = await waitFor(
      () => {
        const el = document.querySelector('[data-testid="overview-load-retry"]');
        if (!el) throw new Error("Retry button not yet in DOM (rAF / React flush pending)");
        return el;
      },
      { timeout: 4000 },
    );

    expect(
      retryWrapper,
      "Expected data-testid='overview-load-retry' to appear after 15 s timeout",
    ).not.toBeNull();

    // Click the retry button — handleOverviewRetry sets overviewLoadFailed → false.
    await act(async () => {
      const btn = retryWrapper.querySelector("button");
      expect(btn, "Expected a <button> inside the retry wrapper").not.toBeNull();
      btn!.click();
    });

    // After clicking Retry the error state is cleared → button unmounts.
    expect(
      document.querySelector('[data-testid="overview-load-retry"]'),
      "Expected retry button to disappear after clicking it",
    ).toBeNull();
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
        ({ datasetId: "loading-ds", source: "preset", overviewGrid: null, activeGrid: null } satisfies VisibleDataset),
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
    const canvas = screen.getByTestId("overview-map-canvas") as HTMLCanvasElement;

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );
    expect(canvas).not.toBeNull();
  });

  it("canvas background (#020818) is painted even when overviewGrid is null", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    useTerrainStore.setState({
      visibleDatasets: [
        ({ datasetId: "loading-ds", source: "preset", overviewGrid: null, activeGrid: null } satisfies VisibleDataset),
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
        canvas: { width: CANVAS_W, height: CANVAS_H },
        fillRect: vi.fn(),
        fillStyle: "" as string | CanvasGradient | CanvasPattern,
        font: "",
        textAlign: "start" as CanvasTextAlign,
        textBaseline: "alphabetic" as CanvasTextBaseline,
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 50 })),
        drawImage: vi.fn((bitmap: unknown) => {
          drawImageOrder.push(bitmap);
        }),
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
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createImageData: vi.fn((w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        })),
        putImageData: vi.fn(),
      } as Record<string, unknown>,
      {
        set(target, prop: string, value: unknown) { target[prop] = value; return true; },
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
        ({ datasetId: grid.datasetId, source: "preset", overviewGrid: grid, activeGrid: null } satisfies VisibleDataset),
        ({ datasetId: "loading-ds", source: "preset", overviewGrid: null, activeGrid: null } satisfies VisibleDataset),
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

// ---------------------------------------------------------------------------
// 4. Empty-state detection — no datasets selected shows hint, not LOADING
//
// When visibleDatasets is empty the rAF loop now takes the early-exit
// empty-state branch, rendering "No datasets selected" text.  It must NOT
// render "LOADING" which previously spun forever in this state.
// ---------------------------------------------------------------------------

describe("OverviewMap — empty visibleDatasets shows empty-state hint, not LOADING", () => {
  beforeEach(() => {
    mockConfig.efhData = undefined;
  });

  /** Build a mock canvas 2D context that records every fillText call. */
  function makeMockCtxWithFillText() {
    const fillTextCalls: string[] = [];
    const ctx = new Proxy(
      {
        fillRect: vi.fn(),
        fillStyle: "" as string | CanvasGradient | CanvasPattern,
        font: "",
        textAlign: "start" as CanvasTextAlign,
        textBaseline: "alphabetic" as CanvasTextBaseline,
        fillText: vi.fn((...args: [string, number, number]) => {
          fillTextCalls.push(args[0]);
        }),
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
          target[prop] = value;
          return true;
        },
      },
    );
    return { ctx, fillTextCalls };
  }

  it("renders 'No datasets selected' hint and does NOT render 'LOADING' when visibleDatasets is empty", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    // Empty visibleDatasets — this is the state that caused the eternal LOADING spinner.
    useTerrainStore.setState({
      visibleDatasets: [],
      primaryDatasetId: null,
      primaryDatasetIds: [],
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
      cameraPosition: { known: false },
      heading: 0,
      cameraDepth: 0,
      cameraAltitude: 0,
    });

    const { ctx, fillTextCalls } = makeMockCtxWithFillText();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Allow several rAF frames to fire so the loop definitely executes.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    getContextSpy.mockRestore();

    // Must have rendered the empty-state message.
    expect(
      fillTextCalls.some((t) => t.includes("No datasets selected")),
      `Expected fillText to be called with "No datasets selected". Got: ${JSON.stringify(fillTextCalls)}`,
    ).toBe(true);

    // Must NOT have rendered the loading spinner text.
    expect(
      fillTextCalls.some((t) => t.startsWith("LOADING")),
      `Expected "LOADING" text to be absent when visibleDatasets is empty. Got: ${JSON.stringify(fillTextCalls)}`,
    ).toBe(false);
  });

  it("still renders 'LOADING' when a dataset is selected but its grid is not yet fetched", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    // One dataset selected, grid not yet loaded — grid fetch is in flight.
    useTerrainStore.setState({
      visibleDatasets: [
        ({ datasetId: "fetching-ds", source: "preset", overviewGrid: null, activeGrid: null } satisfies VisibleDataset),
      ],
      primaryDatasetId: "fetching-ds",
      primaryDatasetIds: ["fetching-ds"],
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
      cameraPosition: { known: false },
      heading: 0,
      cameraDepth: 0,
      cameraAltitude: 0,
    });

    const { ctx, fillTextCalls } = makeMockCtxWithFillText();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    getContextSpy.mockRestore();

    // Must have rendered the loading indicator (dataset selected, grid in-flight).
    expect(
      fillTextCalls.some((t) => t.startsWith("LOADING")),
      `Expected "LOADING" text when dataset is selected but grid is null. Got: ${JSON.stringify(fillTextCalls)}`,
    ).toBe(true);

    // Must NOT have rendered the empty-state message.
    expect(
      fillTextCalls.some((t) => t.includes("No datasets selected")),
      `Expected "No datasets selected" to be absent when a dataset is selected. Got: ${JSON.stringify(fillTextCalls)}`,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Reference-image placement guidance
// ---------------------------------------------------------------------------

describe("OverviewMap — reference-image placement guidance", () => {
  beforeEach(() => {
    mockConfig.efhData = undefined;
    setupStores();
    useTerrainStore.setState({
      visibleDatasets: [],
      primaryDatasetId: null,
      primaryDatasetIds: [],
      overviewGrid: null,
      activeGrid: null,
    });
    useSpecialCollectionStore.setState({
      active: {
        collectionId: "unplaced-reference",
        name: "Unplaced reference",
        bgImage: {} as CanvasImageSource,
        bgImageW: 100,
        bgImageH: 100,
        bgOpacity: 0.5,
        bgGeoAnchors: null,
        layoutRevisions: [],
        activeRevisionId: null,
      },
    });
  });

  afterEach(() => {
    useSpecialCollectionStore.setState({ active: null, pendingRestore: null });
  });

  it("explains how to place a loaded reference image with no anchors or dataset bounds", async () => {
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    expect(screen.getByTestId("overview-reference-image-placement-hint")).toHaveTextContent(
      "Load a dataset or save two valid GPS anchors.",
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Multi-dataset drawImage — both heatmaps placed at correct canvas positions
//
// When two non-overlapping datasets are loaded the rAF loop must call
// ctx.drawImage twice: once for the secondary bitmap (via renderHeatmapAtBbox)
// and once for the primary bitmap (also via renderHeatmapAtBbox when
// worldGridRef is non-null).  Both drawImage calls must use canvas pixel
// origins derived from the union-bbox transform, so the positions reflect
// each dataset's actual geographic location.
//
// Datasets:
//   A (primary)  : -122..-119 lon, 47..49 lat  (id = "test-ds")
//   B (secondary): -88..-85  lon, 41..43 lat   (id = "ds-b")
//   Union bbox   : -122..-85 lon, 41..49 lat   (37° × 8°)
//
// Expected canvas positions (canvas 1024×768, 88% fill):
//   pxPerDeg = (1024 * 0.88) / 37 ≈ 24.355
//   offsetX  = (1024 - pxPerDeg*37) / 2 ≈ 61.44
//   offsetY  = (768  - pxPerDeg*8)  / 2 ≈ 286.58
//
//   NW corner of A (-122, 49): x ≈ offsetX, y ≈ offsetY
//   NW corner of B (-88,  43): x ≈ offsetX + (34/37)*pxPerDeg*37
//                               y ≈ offsetY + (1 - 2/8)*pxPerDeg*8
// ---------------------------------------------------------------------------

describe("OverviewMap — multi-dataset heatmaps drawn at correct canvas positions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ctx.drawImage is called with each dataset's bitmap at its geographically correct canvas origin (±2 px)", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    // -----------------------------------------------------------------------
    // Fake canvases — distinct object identities so we can trace which drawImage
    // call belongs to which dataset.
    // -----------------------------------------------------------------------
    const fakeCanvasA = { __id: "bitmap-A" } as unknown as HTMLCanvasElement;
    const fakeCanvasB = { __id: "bitmap-B" } as unknown as HTMLCanvasElement;

    // buildHeatmapBitmap: first call → primary dataset A, second → secondary B.
    const buildSpy = vi.spyOn(overviewRenderer, "buildContourLines");

    // -----------------------------------------------------------------------
    // Canvas 2D context mock — captures every drawImage call.
    // -----------------------------------------------------------------------
    type DrawImageCall = { bitmap: unknown; x: number; y: number; w: number; h: number };
    const drawImageCalls: DrawImageCall[] = [];
    const backgroundFillCalls: Array<[number, number, number, number]> = [];

    const mockCtx = new Proxy(
      {
        canvas: { width: CANVAS_W, height: CANVAS_H },
        fillRect: vi.fn(),
        fillStyle: "" as string | CanvasGradient | CanvasPattern,
        font: "",
        textAlign: "start" as CanvasTextAlign,
        textBaseline: "alphabetic" as CanvasTextBaseline,
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 50 })),
        drawImage: vi.fn((bitmap: unknown) => {
          drawImageOrder.push(bitmap);
        }),
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
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createImageData: vi.fn((w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        })),
        putImageData: vi.fn(),
      } as Record<string, unknown>,
      {
        set(target, prop: string, value: unknown) { target[prop] = value; return true; },
      },
    );

    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

    // -----------------------------------------------------------------------
    // Seed the store with two fully-loaded datasets.
    // -----------------------------------------------------------------------
    const gridA = makeGrid("ds-older"); // 2022-01-01 — older
    const N = 4;
    const gridB = makeGrid("ds-newer"); // 2024-01-01 — newer

    useTerrainStore.setState({
      visibleDatasets: [
        ({ datasetId: gridA.datasetId, source: "preset", overviewGrid: gridA, activeGrid: null } satisfies VisibleDataset),
        ({ datasetId: gridB.datasetId, source: "preset", overviewGrid: gridB, activeGrid: null } satisfies VisibleDataset),
      ],
      primaryDatasetId: gridA.datasetId,
      overviewGrid: gridA,
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
      cameraPosition: { known: true, lon: -105.0, lat: 45.0 },
      heading: 0,
      cameraDepth: 50,
      cameraAltitude: 30,
    });

    // -----------------------------------------------------------------------
    // Mount and wait for the rAF draw loop to fire.
    // -----------------------------------------------------------------------
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // The camera-arrow polygon is set by the rAF loop after a successful draw —
    // its presence guarantees at least one full draw frame has completed.
    await waitForCameraArrow();
    // Let the follow-up frame caused by publishing the SVG transform settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    // A clean animation frame must preserve the loaded maps rather than
    // clearing the canvas before deciding whether a redraw is needed. Every
    // loaded-data background clear belongs to a redraw with at least one
    // heatmap image; idle frames must not add background-only clears.
    expect(backgroundFillCalls.length).toBeLessThanOrEqual(drawImageCalls.length);

    getContextSpy.mockRestore();

    // -----------------------------------------------------------------------
    // Verify drawImage was called for both datasets.
    // -----------------------------------------------------------------------
    const callA = drawImageCalls.find((c) => c.bitmap === fakeCanvasA);
    const callB = drawImageCalls.find((c) => c.bitmap === fakeCanvasB);

    expect(
      callA,
      `Expected ctx.drawImage to be called with fakeCanvasA (dataset A). ` +
      `Calls: ${drawImageCalls.map((c) => String((c.bitmap as { __id?: string }).__id)).join(", ")}`,
    ).toBeDefined();
    expect(
      callB,
      `Expected ctx.drawImage to be called with fakeCanvasB (dataset B). ` +
      `Calls: ${drawImageCalls.map((c) => String((c.bitmap as { __id?: string }).__id)).join(", ")}`,
    ).toBeDefined();

    // -----------------------------------------------------------------------
    // Verify geographically correct pixel origins within the union-bbox transform.
    //
    // Union bbox: minLon=-122, maxLon=-85, minLat=41, maxLat=49 (37° × 8°)
    // Canvas: 1024 × 768, 88% fill.
    // -----------------------------------------------------------------------
    const UNION_MIN_LON = -122;
    const UNION_MAX_LON = -85;
    const UNION_MIN_LAT = 41;
    const UNION_MAX_LAT = 49;
    const unionLonRange = UNION_MAX_LON - UNION_MIN_LON; // 37
    const unionLatRange = UNION_MAX_LAT - UNION_MIN_LAT; // 8

    const pxPerDeg = Math.min(
      (CANVAS_W * 0.88) / unionLonRange,
      (CANVAS_H * 0.88) / unionLatRange,
    );
    const terrainW = pxPerDeg * unionLonRange;
    const terrainH = pxPerDeg * unionLatRange;
    const offsetX = (CANVAS_W - terrainW) / 2;
    const offsetY = (CANVAS_H - terrainH) / 2;

    // NW corner of A (minLon=-122, maxLat=49) in union frame:
    const expectedXA = offsetX + ((-122 - UNION_MIN_LON) / unionLonRange) * terrainW;
    const expectedYA = offsetY + (1 - (49 - UNION_MIN_LAT) / unionLatRange) * terrainH;

    // NW corner of B (minLon=-88, maxLat=43) in union frame:
    const expectedXB = offsetX + ((-88 - UNION_MIN_LON) / unionLonRange) * terrainW;
    const expectedYB = offsetY + (1 - (43 - UNION_MIN_LAT) / unionLatRange) * terrainH;

    const TOL = 2; // ±2 px tolerance

    expect(callA!.x).toBeCloseTo(expectedXA, 0);
    expect(Math.abs(callA!.x - expectedXA)).toBeLessThan(TOL);

    expect(callA!.y).toBeCloseTo(expectedYA, 0);
    expect(Math.abs(callA!.y - expectedYA)).toBeLessThan(TOL);

    expect(callB!.x).toBeCloseTo(expectedXB, 0);
    expect(Math.abs(callB!.x - expectedXB)).toBeLessThan(TOL);

    expect(callB!.y).toBeCloseTo(expectedYB, 0);
    expect(Math.abs(callB!.y - expectedYB)).toBeLessThan(TOL);

    // -----------------------------------------------------------------------
    // Verify the two origins are separated by the expected pixel distance.
    // -----------------------------------------------------------------------
    const expectedDx = expectedXB - expectedXA; // ≈ 827.9 px
    const expectedDy = expectedYB - expectedYA; // ≈ 146.1 px
    const actualDx   = callB!.x - callA!.x;
    const actualDy   = callB!.y - callA!.y;

    expect(Math.abs(actualDx - expectedDx)).toBeLessThan(TOL);
    expect(Math.abs(actualDy - expectedDy)).toBeLessThan(TOL);

    // B must be to the right of and below A (east + south).
    expect(actualDx).toBeGreaterThan(0);
    expect(actualDy).toBeGreaterThan(0);

    buildSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 7. Collection-scoped GAPS — only loaded member grids participate
// ---------------------------------------------------------------------------

describe("OverviewMap — collection-scoped gap drawing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    usePuzzleStore.setState({
      puzzleMode: false,
      puzzleTransforms: {},
      overviewTransform: null,
      worldGrid: null,
    });
    useTerrainStore.setState({ collectionScopeId: null, collectionScopeIds: [] });
  });

  it("draws the gap/overlap mask from loaded collection member grids", async () => {
    const gridA = makeGrid("ds-older"); // 2022-01-01 — older
    const gridB = makeGrid("ds-newer"); // 2024-01-01 — newer
    const mockCtx = new Proxy(
      {
        canvas: { width: CANVAS_W, height: CANVAS_H },
        fillRect: vi.fn(),
        fillStyle: "" as string | CanvasGradient | CanvasPattern,
        font: "",
        textAlign: "start" as CanvasTextAlign,
        textBaseline: "alphabetic" as CanvasTextBaseline,
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 50 })),
        drawImage: vi.fn((bitmap: unknown) => {
          drawImageOrder.push(bitmap);
        }),
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
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createImageData: vi.fn((w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        })),
        putImageData: vi.fn(),
      } as Record<string, unknown>,
      {
        set(target, prop: string, value: unknown) { target[prop] = value; return true; },
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);
    vi.spyOn(overviewRenderer, "buildHeatmapBitmap")
      .mockReturnValue({} as HTMLCanvasElement);
    const drawGapSpy = vi.spyOn(overviewRenderer, "drawGapOverlap");

    useTerrainStore.setState({
      visibleDatasets: [
        { datasetId: gridA.datasetId, source: "preset", overviewGrid: gridA, activeGrid: gridA },
        { datasetId: gridB.datasetId, source: "preset", overviewGrid: gridB, activeGrid: gridB },
      ],
      primaryDatasetId: gridA.datasetId,
      primaryDatasetIds: [gridA.datasetId, gridB.datasetId],
      overviewGrid: gridA,
      activeGrid: gridA,
      collectionScopeId: "collection-under-test",
      collectionScopeIds: [gridA.datasetId, gridB.datasetId],
    });

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });
    fireEvent.click(screen.getByTestId("overview-puzzle-toggle"));
    fireEvent.click(screen.getByTestId("overview-puzzle-gap-toggle"));

    await waitFor(() => {
      expect(drawGapSpy).toHaveBeenCalled();
    }, { timeout: 4000 });
    expect(drawGapSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ counts: expect.any(Uint8Array) }),
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Recency sort — newer dataUpdatedAt bitmap drawn last (on top)
//
// When two datasets overlap in the Overview Map, the one with the more recent
// `dataUpdatedAt` should be drawn last so it paints over the older one.
//
// Setup: dataset A (2022-01-01) and dataset B (2024-01-01) both have loaded
// overview grids that share the same bounding box (maximum overlap).  After
// the rAF draw loop runs, ctx.drawImage should be called with B's bitmap AFTER
// A's bitmap.
// ---------------------------------------------------------------------------

describe("OverviewMap — recency sort draws older bitmap before newer bitmap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dataset with earlier dataUpdatedAt is drawn before dataset with later dataUpdatedAt", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    // -----------------------------------------------------------------------
    // Track drawImage calls in order, recording the ImageBitmap source.
    // -----------------------------------------------------------------------
    const drawImageOrder: unknown[] = [];
    const mockCtx = new Proxy(
      {
        canvas: { width: CANVAS_W, height: CANVAS_H },
        fillRect: vi.fn(),
        fillStyle: "" as string | CanvasGradient | CanvasPattern,
        font: "",
        textAlign: "start" as CanvasTextAlign,
        textBaseline: "alphabetic" as CanvasTextBaseline,
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 50 })),
        drawImage: vi.fn((bitmap: unknown) => {
          drawImageOrder.push(bitmap);
        }),
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
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createImageData: vi.fn((w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        })),
        putImageData: vi.fn(),
      } as Record<string, unknown>,
      {
        set(target, prop: string, value: unknown) { target[prop] = value; return true; },
      },
    );

    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

    // Two datasets sharing the same bbox (maximum overlap).
    const N = 4;
    const makeGrid = (id: string) => ({
      datasetId: id,
      name: id,
      resolution: N,
      width: N,
      height: N,
      depths: new Array(N * N).fill(0).map((_, i) => 10 + i * 5),
      minDepth: 10,
      maxDepth: 10 + (N * N - 1) * 5,
      minLon: -122,
      maxLon: -119,
      minLat: 47,
      maxLat: 49,
      centerLon: -120.5,
      centerLat: 48.0,
      waterType: "saltwater" as const,
    } as unknown as import("@workspace/api-client-react").TerrainData);

    const gridA = makeGrid("ds-older"); // 2022-01-01 — older
    const gridB = makeGrid("ds-newer"); // 2024-01-01 — newer

    // Two distinct sentinel ImageBitmap-like objects so we can tell them apart
    // in the drawImage call list.
    const bitmapA = { _id: "bitmap-A" };
    const bitmapB = { _id: "bitmap-B" };

    // buildHeatmapBitmap is called by the rAF loop to generate the heatmap bitmaps.
    // Use a call counter so the first call returns bitmapA (primary gridA) and
    // subsequent calls return bitmapB (secondary gridB).
    let buildCallCount = 0;
    const buildSpy = vi.spyOn(overviewRenderer, "buildContourLines");

    // Seed the store with A (older, 2022) as primary and B (newer, 2024) as secondary.
    useTerrainStore.setState({
      visibleDatasets: [
        ({ datasetId: gridA.datasetId, source: "preset", overviewGrid: gridA, activeGrid: null, dataUpdatedAt: "2022-01-01" } satisfies VisibleDataset),
        ({ datasetId: gridB.datasetId, source: "preset", overviewGrid: gridB, activeGrid: null, dataUpdatedAt: "2024-01-01" } satisfies VisibleDataset),
      ],
      primaryDatasetId: gridA.datasetId,
      overviewGrid: gridA,
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
      cameraPosition: { known: true, lon: -120.5, lat: 48.0 },
      heading: 0,
      cameraDepth: 50,
      cameraAltitude: 30,
    });

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Wait for the rAF draw loop to complete at least one full pass.
    await waitFor(
      () => {
        if (drawImageOrder.length < 2) throw new Error("Waiting for 2 drawImage calls");
      },
      { timeout: 4000 },
    );

    // drawImageOrder[0] should be bitmapA (older, drawn first/behind),
    // drawImageOrder[last] should be bitmapB (newer, drawn last/on top).
    const firstBitmap  = drawImageOrder[0];
    const secondBitmap = drawImageOrder.find((b) => b !== firstBitmap);

    // We verify ordering: the older dataset's bitmap is drawn before the newer one.
    // Since both use the same bbox grid, the sort is purely date-driven.
    const firstCallIdx  = drawImageOrder.findIndex((b) => b === bitmapA);
    const secondCallIdx = drawImageOrder.findIndex((b) => b === bitmapB);

    // Both bitmaps must appear in the draw list.
    expect(firstCallIdx).toBeGreaterThanOrEqual(0);
    expect(secondCallIdx).toBeGreaterThanOrEqual(0);

    // Older (A, 2022) must be drawn before newer (B, 2024).
    expect(firstCallIdx).toBeLessThan(secondCallIdx);

    buildSpy.mockRestore();
    getContextSpy.mockRestore();
    // Mark firstBitmap/secondBitmap as used to avoid lint warnings.
    void firstBitmap; void secondBitmap;
  });

  it("draw order is independent of visibleDatasets[0] position — newer primary drawn last", async () => {
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

    // -----------------------------------------------------------------------
    // SWAP: now the PRIMARY (index 0) is the NEWER dataset and the secondary
    // is older.  The sort must still draw the older one first (the newer one
    // on top) — recency, not selection order, controls draw position.
    // -----------------------------------------------------------------------
    const drawImageOrder: unknown[] = [];
    const mockCtx = new Proxy(
      {
        canvas: { width: CANVAS_W, height: CANVAS_H },
        fillRect: vi.fn(),
        fillStyle: "" as string | CanvasGradient | CanvasPattern,
        font: "",
        textAlign: "start" as CanvasTextAlign,
        textBaseline: "alphabetic" as CanvasTextBaseline,
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 50 })),
        drawImage: vi.fn((bitmap: unknown) => {
          drawImageOrder.push(bitmap);
        }),
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
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createImageData: vi.fn((w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        })),
        putImageData: vi.fn(),
      } as Record<string, unknown>,
      {
        set(target, prop: string, value: unknown) { target[prop] = value; return true; },
      },
    );

    const getContextSpy2 = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

    const N = 4;
    const makeGrid2 = (id: string) => ({
      datasetId: id,
      name: id,
      resolution: N,
      width: N,
      height: N,
      depths: new Array(N * N).fill(0).map((_, i) => 10 + i * 5),
      minDepth: 10,
      maxDepth: 10 + (N * N - 1) * 5,
      minLon: -122,
      maxLon: -119,
      minLat: 47,
      maxLat: 49,
      centerLon: -120.5,
      centerLat: 48.0,
      waterType: "saltwater" as const,
    } as unknown as import("@workspace/api-client-react").TerrainData);

    // SWAPPED: primary (index 0) is the NEWER dataset (2024), secondary is OLDER (2022).
    const gridNewer = makeGrid2("ds-newer-primary"); // 2024-01-01 — newer, but index 0 (primary)
    const gridOlder = makeGrid2("ds-older-secondary"); // 2022-01-01 — older, but index 1 (secondary)

    const bitmapNewer = { _id: "bitmap-newer" };
    const bitmapOlder = { _id: "bitmap-older" };

    let buildCallCount2 = 0;
    const buildSpy2 = vi
      .spyOn(await import("@/lib/overviewRenderer"), "buildHeatmapBitmap")
      .mockImplementation(() => {
        buildCallCount2 += 1;
        // First call is for primary (gridNewer), subsequent calls for secondary (gridOlder).
        return (buildCallCount2 === 1 ? bitmapNewer : bitmapOlder) as unknown as ImageBitmap;
      });

    // PRIMARY (index 0) = newer, SECONDARY (index 1) = older.
    useTerrainStore.setState({
      visibleDatasets: [
        ({ datasetId: gridNewer.datasetId, source: "preset", overviewGrid: gridNewer, activeGrid: null, dataUpdatedAt: "2024-01-01" } satisfies VisibleDataset),
        ({ datasetId: gridOlder.datasetId, source: "preset", overviewGrid: gridOlder, activeGrid: null, dataUpdatedAt: "2022-01-01" } satisfies VisibleDataset),
      ],
      primaryDatasetId: gridNewer.datasetId,
      overviewGrid: gridNewer,
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
      cameraPosition: { known: true, lon: -120.5, lat: 48.0 },
      heading: 0,
      cameraDepth: 50,
      cameraAltitude: 30,
    });

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    await waitFor(
      () => {
        if (drawImageOrder.length < 2) throw new Error("Waiting for 2 drawImage calls");
      },
      { timeout: 4000 },
    );

    const newerIdx = drawImageOrder.findIndex((b) => b === bitmapNewer);
    const olderIdx = drawImageOrder.findIndex((b) => b === bitmapOlder);

  const UNDERLYING_ID = "ds-underlying";
  /** Minimal TerrainData grid with distinct datasetId and real depth values. */
  function makeContourGrid(id: string): TerrainData {
    const N = 4;
    return {
      datasetId: id,
      name: id,
      resolution: N,
      width: N,
      height: N,
      depths: new Array(N * N).fill(0).map((_, i) => 10 + i * 5),
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

  beforeEach(() => {
    mockConfig.efhData = undefined;
    Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls buildContourLines for both datasets on initial mount and for both again after contourInterval changes", async () => {
    const gridPrimary   = makeContourGrid("ds-contour-primary");
    const gridSecondary = makeContourGrid("ds-contour-secondary");

    // Enable contours with a known initial interval so the effect definitely runs.
    useSettingsStore.setState({ contoursEnabled: true, contourInterval: 10, units: "imperial" });

    useTerrainStore.setState({
      visibleDatasets: [
        ({ datasetId: gridPrimary.datasetId,   source: "preset", overviewGrid: gridPrimary,   activeGrid: null } satisfies VisibleDataset),
        ({ datasetId: gridSecondary.datasetId, source: "preset", overviewGrid: gridSecondary, activeGrid: null } satisfies VisibleDataset),
      ],
      primaryDatasetId: gridPrimary.datasetId,
      overviewGrid: gridPrimary,
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
      cameraPosition: { known: true, lon: -120.5, lat: 48.0 },
      heading: 0,
      cameraDepth: 50,
      cameraAltitude: 30,
    });

    const buildSpy = vi.spyOn(overviewRenderer, "buildContourLines");

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Allow React effects to flush.
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    // Phase 1 — initial mount: both datasets must have had segments built.
    const mountDatasetIds = buildSpy.mock.calls.map((c) => (c[0] as TerrainData).datasetId);
    expect(
      mountDatasetIds,
      `Expected buildContourLines to be called for both datasets on mount. Called for: ${JSON.stringify(mountDatasetIds)}`,
    ).toContain(gridPrimary.datasetId);
    expect(
      mountDatasetIds,
      `Expected buildContourLines to be called for secondary dataset on mount. Called for: ${JSON.stringify(mountDatasetIds)}`,
    ).toContain(gridSecondary.datasetId);

    // Capture call count baseline, then clear so rebuild calls are isolated.
    buildSpy.mockClear();

    // Phase 2 — change contourInterval; the effect must re-run for every
    // visible dataset, not just the primary one.
    await act(async () => {
      useSettingsStore.setState({ contourInterval: 20 });
    });

    // Allow the React effect triggered by the store change to flush.
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    const rebuildDatasetIds = buildSpy.mock.calls.map((c) => (c[0] as TerrainData).datasetId);
    expect(
      rebuildDatasetIds,
      `Expected buildContourLines to be called for primary dataset after interval change. Called for: ${JSON.stringify(rebuildDatasetIds)}`,
    ).toContain(gridPrimary.datasetId);
    expect(
      rebuildDatasetIds,
      `Expected buildContourLines to be called for secondary dataset after interval change. Called for: ${JSON.stringify(rebuildDatasetIds)}`,
    ).toContain(gridSecondary.datasetId);
  });
});

// ---------------------------------------------------------------------------
// Puzzle geo-transform publication — single-grid mode
//
// Verifies that when OverviewMap mounts with a single overview grid (the common
// case where worldGridRef is null) and sessionStorage has a saved puzzle
// transform, the component correctly publishes geographic offsets to uiStore
// rather than silently clearing them.
// ---------------------------------------------------------------------------

describe("OverviewMap — puzzle geo-transform publication with a single grid", () => {
  const PUZZLE_DS_ID = "test-ds";

  beforeEach(() => {
    setupStores();
    useUiStore.getState().clearPuzzleGeoTransforms();
    sessionStorage.removeItem("bathyscan:puzzleTransforms");
    localStorage.removeItem("bathyscan:puzzleTransforms");
  });

  afterEach(() => {
    useUiStore.getState().clearPuzzleGeoTransforms();
    sessionStorage.removeItem("bathyscan:puzzleTransforms");
    localStorage.removeItem("bathyscan:puzzleTransforms");
  });

  it("publishes non-zero dLon/dLat to uiStore when a positive tx pixel offset is set via sessionStorage hydration", async () => {
    // Seed sessionStorage with a 20px east, 10px north puzzle offset.
    // After OverviewMap hydrates, the [puzzleTransforms] effect must convert
    // these to geographic offsets and store them in uiStore.puzzleGeoTransforms.
    const TX = 50; // 50 px east offset
    const TY = -10;
    sessionStorage.setItem(
      "bathyscan:puzzleTransforms",
      JSON.stringify([[PUZZLE_DS_ID, { tx: TX, ty: TY, angleDeg: 0 }]]),
    );

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Wait for rAF / first draw (camera arrow is the signal).
    await waitForCameraArrow();

    // Allow useEffect microtasks to settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    const geo = useUiStore.getState().puzzleGeoTransforms;
    expect(geo.size).toBeGreaterThan(0);

    const entry = useUiStore.getState().puzzleGeoTransforms.get(PUZZLE_DS_ID);
    expect(entry).toBeDefined();
    // Positive tx (east shift) must produce positive dLon.
    expect(entry!.dLon).toBeGreaterThan(0);
    // Negative ty (north shift, North-up canvas) must produce positive dLat.
    expect(entry!.dLat).toBeGreaterThan(0);
  });

  it("publishes angleDeg unchanged from the pixel-space transform", async () => {
    const ANGLE = 45;
    sessionStorage.setItem(
      "bathyscan:puzzleTransforms",
      JSON.stringify([[PUZZLE_DS_ID, { tx: 0, ty: 0, angleDeg: ANGLE }]]),
    );

    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    await waitForCameraArrow();
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    const entry = useUiStore.getState().puzzleGeoTransforms.get(PUZZLE_DS_ID);
    expect(entry).toBeDefined();
    expect(entry!.angleDeg).toBe(ANGLE);
  });

  it("clears puzzleGeoTransforms when sessionStorage has no saved transforms (normal mode)", async () => {
    // Pre-populate geo transforms so we can verify they get cleared.
    useUiStore.getState().setPuzzleGeoTransforms(
      new Map([[PUZZLE_DS_ID, { dLon: 1, dLat: 1, angleDeg: 0 }]]),
    );

    // No sessionStorage entry — hydration finds nothing, puzzleTransforms stays empty.
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    await waitForCameraArrow();
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    // The [puzzleTransforms] effect fires with size === 0 → clearPuzzleGeoTransforms.
    expect(useUiStore.getState().puzzleGeoTransforms.size).toBe(0);
  });

  it("re-publishes smaller dLon after zooming in — rAF loop stays consistent with canvas transform", async () => {
    // Regression: puzzle geo offsets must track the current canvas transform scale,
    // not just the transform at hydration time.  When the user zooms in (scale
    // increases), each pixel covers fewer degrees, so the same px offset should
    // produce a strictly smaller |dLon|.
    const TX = 50; // 50 px east offset
    sessionStorage.setItem(
      "bathyscan:puzzleTransforms",
      JSON.stringify([[PUZZLE_DS_ID, { tx: TX, ty: 0, angleDeg: 0 }]]),
    );

    const { container } = await act(async () =>
      renderWithProviders(withQuery(React.createElement(OverviewMap))),
    );

    await waitForCameraArrow();
    // Let the initial rAF frame settle and publish geo transforms.
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    const dLonBefore = useUiStore.getState().puzzleGeoTransforms.get(PUZZLE_DS_ID)?.dLon;
    expect(dLonBefore).toBeDefined();
    expect(dLonBefore!).toBeGreaterThan(0);

    // Fire a zoom-in wheel event on the canvas (deltaY < 0 → scale * 1.15).
    const canvas = screen.getByTestId("overview-map-canvas") as HTMLCanvasElement;

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );
    expect(canvas).not.toBeNull();
    fireEvent.wheel(canvas!, { deltaY: -120, clientX: 512, clientY: 384, deltaMode: 0 });

    // Allow the dirty rAF loop to process the new transform and republish.
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });

    const dLonAfter = useUiStore.getState().puzzleGeoTransforms.get(PUZZLE_DS_ID)?.dLon;
    expect(dLonAfter).toBeDefined();
    // After zooming in, each pixel spans fewer degrees → dLon must decrease.
    expect(dLonAfter!).toBeLessThan(dLonBefore!);
  });
});

describe("OverviewMap — toolbar zoom preserves geographic registration", () => {
  beforeEach(() => {
    mockConfig.efhData = undefined;
    setupStores();
  });

  it("keeps the centered geographic point fixed across repeated zoom-in/out rounds", async () => {
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });
    await waitForCameraArrow();

    const canvas = screen.getByTestId("overview-map-canvas") as HTMLCanvasElement;

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );

    const viewTransform = overviewRenderer.computeInitialTransform(
      underlyingGrid,
      CANVAS_W,
      CANVAS_H,
    );
    canvas.getBoundingClientRect = () =>
      ({
        left: 0, top: 0,
        right: CANVAS_W, bottom: CANVAS_H,
        width: CANVAS_W, height: CANVAS_H,
        x: 0, y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const initial = usePuzzleStore.getState().overviewTransform;
    expect(initial).not.toBeNull();
    const pivot = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    const initialGeo = overviewRenderer.canvasToLonLat(
      pivot.x,
      pivot.y,
      makeOverviewGrid(),
      initial!,
    );

    for (let round = 0; round < 3; round++) {
      await act(async () => {
        fireEvent.click(screen.getByTestId("overview-zoom-in"));
        await new Promise((resolve) => setTimeout(resolve, 360));
      });
      const zoomed = usePuzzleStore.getState().overviewTransform;
      expect(zoomed).not.toBeNull();
      const zoomedGeo = overviewRenderer.canvasToLonLat(
        pivot.x,
        pivot.y,
        makeOverviewGrid(),
        zoomed!,
      );
      expect(zoomedGeo.lon).toBeCloseTo(initialGeo.lon, 6);
      expect(zoomedGeo.lat).toBeCloseTo(initialGeo.lat, 6);

      await act(async () => {
        fireEvent.click(screen.getByTestId("overview-zoom-out"));
        await new Promise((resolve) => setTimeout(resolve, 360));
      });
      const restored = usePuzzleStore.getState().overviewTransform;
      expect(restored).not.toBeNull();
      expect(restored!.scale).toBeCloseTo(initial!.scale, 6);
      expect(restored!.offsetX).toBeCloseTo(initial!.offsetX, 6);
      expect(restored!.offsetY).toBeCloseTo(initial!.offsetY, 6);
    }
  });
});

    const selectedPoint = { lon: -120.2, lat: 48.25 };

    const topmostGrid = { ...makeOverviewGrid(), datasetId: TOPMOST_ID, name: "Topmost" };

  function transformedCanvasPoint(
    lon: number,
    lat: number,
    grid: TerrainData,
    transform: overviewRenderer.OverviewTransform,
    tileTransform: typeof TILE_TRANSFORM,
  ): [number, number] {
    const [x, y] = overviewRenderer.lonLatToCanvas(lon, lat, grid, transform);
    const [x0, y0] = overviewRenderer.lonLatToCanvas(
      grid.minLon,
      grid.maxLat,
      grid,
      transform,
    );
    const [x1, y1] = overviewRenderer.lonLatToCanvas(
      grid.maxLon,
      grid.minLat,
      grid,
      transform,
    );
    const centerX = (x0 + x1) / 2;
    const centerY = (y0 + y1) / 2;
    const localX = (tileTransform.flipH ? -1 : 1) * (x - centerX);
    const localY = (tileTransform.flipV ? -1 : 1) * (y - centerY);
    const angle = (tileTransform.angleDeg * Math.PI) / 180;
    return [
      centerX + tileTransform.tx + localX * Math.cos(angle) - localY * Math.sin(angle),
      centerY + tileTransform.ty + localX * Math.sin(angle) + localY * Math.cos(angle),
    ];
  }

    const underlyingGrid = { ...makeOverviewGrid(), datasetId: UNDERLYING_ID, name: "Underlying" };

  const TILE_TRANSFORM = {
    tx: 42,
    ty: -26,
    angleDeg: 37,
    flipH: true,
    flipV: false,
  };

    const [clientX, clientY] = transformedCanvasPoint(
      selectedPoint.lon,
      selectedPoint.lat,
      topmostGrid,
      viewTransform,
      TILE_TRANSFORM,
    );

    const [startX, startY] = transformedCanvasPoint(
      -120.2,
      48.25,
      topmostGrid,
      viewTransform,
      TILE_TRANSFORM,
    );

  const TOPMOST_ID = "ds-topmost";
