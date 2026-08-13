/**
 * Regression tests for puzzle-mode corner rotation handles.
 *
 * Verifies three behaviours after the handle positions were moved from edge
 * midpoints to tile corners:
 *
 *   1. Corner positions — mousedown at the four expected corner positions
 *      triggers the rotate sub-mode (observable via the ±1° nudge that fires
 *      on mousedown + mouseup without movement).
 *   2. Old edge-midpoint positions — mousedown at the old edge midpoints does
 *      NOT trigger a nudge (confirms handles are no longer there).
 *   3. Nudge direction — topRight / bottomLeft → +1°; topLeft / bottomRight → −1°.
 *
 * Test strategy:
 *   - Render the real OverviewMap component with a known grid.
 *   - Use `computeInitialTransform` + `lonLatToCanvas` (both exported from
 *     overviewRenderer) to compute expected corner screen coordinates.
 *   - Spy on `registerPuzzleTestHandlers` to capture the internal getTransform
 *     callback so we can read angleDeg without going through window.__bathyTest.
 *   - Fire mousedown + mouseup at computed positions and assert angleDeg delta.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore } from "@/lib/terrainStore";
import type { VisibleDataset } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { useCameraStore } from "@/lib/cameraStore";
import { computeInitialTransform, lonLatToCanvas } from "@/lib/overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";
import * as testHelpersModule from "@/lib/testHelpers";

// ---------------------------------------------------------------------------
// Hoisted mock state
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
    useGetEfh: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
    getGetEfhQueryKey: (p: unknown) => ["efh", p],
    useGetSubstrate: () => ({ data: undefined }),
    getGetSubstrateQueryKey: (id: unknown) => ["substrate", id],
  }),
);

import { OverviewMap } from "@/components/OverviewMap";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANVAS_W = 1024;
const CANVAS_H = 768;
const DATASET_ID = "test-ds";
const CORNER_HANDLE_OFFSET = 8; // must match OverviewMap.tsx

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
    datasetId: DATASET_ID,
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
      ({ datasetId: grid.datasetId, source: "preset", overviewGrid: grid, activeGrid: null } satisfies VisibleDataset),
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
    cameraPosition: { known: true, lon: -120.5, lat: 48.0 },
    heading: 0,
    cameraDepth: 50,
    cameraAltitude: 30,
  });
}

/** Wait until the SVG camera-arrow polygon is in the DOM (proxy for "rAF completed"). */
async function waitForCameraArrow(): Promise<Element> {
  return waitFor(
    () => {
      const el = document.querySelector('polygon[fill="#d4ac0d"]');
      if (!el) throw new Error("Camera arrow not yet rendered");
      return el;
    },
    { timeout: 4000 },
  );
}

/**
 * Compute the four corner handle screen positions for the test grid,
 * given the initial canvas transform (no puzzle transform offset applied,
 * angleDeg = 0).
 *
 * Returns { topLeft, topRight, bottomRight, bottomLeft } in canvas px.
 */
function computeCornerHandles(grid: TerrainData) {
  const t = computeInitialTransform(grid, CANVAS_W, CANVAS_H);
  const [bx0, by0] = lonLatToCanvas(grid.minLon, grid.maxLat, grid, t);
  const [bx1, by1] = lonLatToCanvas(grid.maxLon, grid.minLat, grid, t);
  return {
    topLeft:     { x: bx0 - CORNER_HANDLE_OFFSET, y: by0 - CORNER_HANDLE_OFFSET },
    topRight:    { x: bx1 + CORNER_HANDLE_OFFSET, y: by0 - CORNER_HANDLE_OFFSET },
    bottomRight: { x: bx1 + CORNER_HANDLE_OFFSET, y: by1 + CORNER_HANDLE_OFFSET },
    bottomLeft:  { x: bx0 - CORNER_HANDLE_OFFSET, y: by1 + CORNER_HANDLE_OFFSET },
    // old edge-midpoint positions (should no longer trigger rotate)
    edgeTop:    { x: (bx0 + bx1) / 2, y: by0 - 16 },
    edgeRight:  { x: bx1 + 16,        y: (by0 + by1) / 2 },
    edgeBottom: { x: (bx0 + bx1) / 2, y: by1 + 16 },
    edgeLeft:   { x: bx0 - 16,        y: (by0 + by1) / 2 },
  };
}

/**
 * Render OverviewMap, wait for the first rAF draw, then return
 * { canvas, getTransform, setPuzzleMode, setSelected }.
 *
 * The puzzle handlers are captured from the spy on registerPuzzleTestHandlers.
 */
async function renderAndCapturePuzzleHandlers() {
  type PuzzleHandlers = Parameters<typeof testHelpersModule.registerPuzzleTestHandlers>;
  let capturedHandlers: PuzzleHandlers | null = null;

  const spy = vi
    .spyOn(testHelpersModule, "registerPuzzleTestHandlers")
    .mockImplementation((...args: PuzzleHandlers) => {
      capturedHandlers = args;
    });

  await act(async () => {
    renderWithProviders(withQuery(React.createElement(OverviewMap)));
  });

  await waitForCameraArrow();

  expect(capturedHandlers, "registerPuzzleTestHandlers was not called by OverviewMap").not.toBeNull();

  const [setPuzzleMode, setSelectedId, , getTransform] = capturedHandlers!;

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

  spy.mockRestore();

  return { canvas, setPuzzleMode, setSelectedId, getTransform };
}

/**
 * Simulate a click-without-drag on the canvas at (x, y):
 *   mousedown → mouseup (no mousemove in between).
 * Returns the angleDeg of the tile after the event pair.
 */
async function clickAt(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  getTransform: (id: string) => { tx: number; ty: number; angleDeg: number } | null,
): Promise<number> {
  await act(async () => {
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: x, clientY: y }));
  });
  await act(async () => {
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: x, clientY: y }));
  });
  return getTransform(DATASET_ID)?.angleDeg ?? 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OverviewMap — puzzle corner rotation handles", () => {
  beforeEach(() => {
    setupStores();
  });

  // -------------------------------------------------------------------------
  // 1. Corner hit-test starts rotate sub-mode (observable via nudge)
  // -------------------------------------------------------------------------
  describe("corner handles trigger rotate (nudge on click-without-drag)", () => {
    const corners = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

    for (const corner of corners) {
      it(`clicking the ${corner} corner handle produces a ±1° nudge`, async () => {
        const { canvas, setPuzzleMode, setSelectedId, getTransform } =
          await renderAndCapturePuzzleHandlers();

        // Enter puzzle mode and select the tile via the test bridge.
        await act(async () => { setPuzzleMode(true); });
        await act(async () => { setSelectedId(DATASET_ID); });

        // Wait for state to propagate through the useEffect → ref.
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

        const handles = computeCornerHandles(makeOverviewGrid());
        const pos = handles[corner];

        const beforeAngle = getTransform(DATASET_ID)?.angleDeg ?? 0;
        const afterAngle = await clickAt(canvas, pos.x, pos.y, getTransform);
        const delta = afterAngle - beforeAngle;

        // The nudge must be exactly ±1°; either direction is valid here — the
        // direction test is covered separately below.
        expect(Math.abs(delta)).toBeCloseTo(1, 5);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 2. Old edge-midpoint positions should NOT trigger a nudge
  // -------------------------------------------------------------------------
  describe("old edge-midpoint positions do NOT trigger rotate", () => {
    const edges = ["edgeTop", "edgeRight", "edgeBottom", "edgeLeft"] as const;

    for (const edge of edges) {
      it(`clicking old ${edge} midpoint does not change angleDeg`, async () => {
        const { canvas, setPuzzleMode, setSelectedId, getTransform } =
          await renderAndCapturePuzzleHandlers();

        await act(async () => { setPuzzleMode(true); });
        await act(async () => { setSelectedId(DATASET_ID); });
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

        const handles = computeCornerHandles(makeOverviewGrid());
        const pos = handles[edge];

        const beforeAngle = getTransform(DATASET_ID)?.angleDeg ?? 0;
        const afterAngle = await clickAt(canvas, pos.x, pos.y, getTransform);

        // No nudge — handles are no longer at edge midpoints.
        expect(afterAngle).toBeCloseTo(beforeAngle, 5);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 3. Nudge direction: topRight / bottomLeft → +1°; topLeft / bottomRight → −1°
  // -------------------------------------------------------------------------
  describe("nudge direction by corner", () => {
    const cases = [
      { corner: "topRight"    as const, expectedDelta:  1 },
      { corner: "bottomLeft"  as const, expectedDelta:  1 },
      { corner: "topLeft"     as const, expectedDelta: -1 },
      { corner: "bottomRight" as const, expectedDelta: -1 },
    ];

    for (const { corner, expectedDelta } of cases) {
      it(`${corner} nudges angleDeg by ${expectedDelta > 0 ? "+" : ""}${expectedDelta}°`, async () => {
        const { canvas, setPuzzleMode, setSelectedId, getTransform } =
          await renderAndCapturePuzzleHandlers();

        await act(async () => { setPuzzleMode(true); });
        await act(async () => { setSelectedId(DATASET_ID); });
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

        const handles = computeCornerHandles(makeOverviewGrid());
        const pos = handles[corner];

        const beforeAngle = getTransform(DATASET_ID)?.angleDeg ?? 0;
        const afterAngle = await clickAt(canvas, pos.x, pos.y, getTransform);

        expect(afterAngle - beforeAngle).toBeCloseTo(expectedDelta, 5);
      });
    }
  });
});
