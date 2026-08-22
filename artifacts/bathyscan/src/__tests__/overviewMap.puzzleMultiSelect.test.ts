/**
 * Unit tests for puzzle multi-select, groups, and multi-move/rotate.
 *
 * Verifies:
 *   1. Shift-click adds an unselected tile to the current selection.
 *   2. Plain-click on an already-selected tile leaves the selection unchanged.
 *   3. Translate drag moves ALL selected tiles by the same pixel delta.
 *   4. Rotate drag around the collective center changes all selected tiles' angles.
 *   5. Group creation causes clicking any group member to expand selection.
 *   6. Unloading a dataset prunes it from its group (empty groups are dissolved).
 *   7. Reset clears both transforms and groups.
 *
 * Test strategy:
 *   - Render the real OverviewMap with two known tiles side-by-side.
 *   - Spy on `registerPuzzleTestHandlers` to capture internal callbacks.
 *   - Verify observable side-effects on puzzleTransforms via `getTransform`.
 *   - Multi-selection is inferred from translate-drag and nudge behavior
 *     (if B's transform changes after a drag/nudge initiated through A's
 *     handles, B must have been in the selection).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { useCameraStore } from "@/lib/cameraStore";
import { computeInitialTransform, lonLatToCanvas } from "@/lib/overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";
import * as testHelpersModule from "@/lib/testHelpers";

// ---------------------------------------------------------------------------
// Hoisted mock state (identical pattern to overviewMap.puzzleHandles.test.ts)
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
    useGetDatasets: () => ({ data: [{ id: "dataset-a", hasEfh: false }, { id: "dataset-b", hasEfh: false }] }),
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
const DATASET_A = "dataset-a";
const DATASET_B = "dataset-b";
const CORNER_HANDLE_OFFSET = 8; // must match OverviewMap.tsx

function withQuery(node: React.ReactElement): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, node);
}

function makeGrid(
  datasetId: string,
  minLon: number,
  maxLon: number,
  minLat = 47,
  maxLat = 49,
): TerrainData {
  const N = 4;
  const depths = new Array(N * N).fill(0).map((_, i) => 10 + i * 5);
  return {
    datasetId,
    name: `Grid ${datasetId}`,
    resolution: N, width: N, height: N,
    depths,
    minDepth: 10, maxDepth: 85,
    minLon, maxLon, minLat, maxLat,
    centerLon: (minLon + maxLon) / 2,
    centerLat: (minLat + maxLat) / 2,
    waterType: "saltwater",
  } as unknown as TerrainData;
}

/**
 * Build the combined world-grid bbox from an array of individual grids.
 * Mirrors the expansion logic in OverviewMap's worldGridRef effect.
 */
function makeWorldGrid(base: TerrainData, extras: TerrainData[]): TerrainData {
  const all = [base, ...extras];
  return {
    ...base,
    minLon: Math.min(...all.map((g) => g.minLon)),
    maxLon: Math.max(...all.map((g) => g.maxLon)),
    minLat: Math.min(...all.map((g) => g.minLat)),
    maxLat: Math.max(...all.map((g) => g.maxLat)),
  };
}

function setupStores() {
  const gridA = makeGrid(DATASET_A, -122, -119);
  const gridB = makeGrid(DATASET_B, -119, -116);

  Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

  useTerrainStore.setState({
    visibleDatasets: [
      ({ datasetId: DATASET_A, source: "preset", overviewGrid: gridA, activeGrid: null }) as unknown as VisibleDataset,
      ({ datasetId: DATASET_B, source: "preset", overviewGrid: gridB, activeGrid: null }) as unknown as VisibleDataset,
    ],
    primaryDatasetId: DATASET_A,
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
    cameraPosition: { known: true, lon: -119.0, lat: 48.0 },
    heading: 0,
    cameraDepth: 50,
    cameraAltitude: 30,
  });

  return { gridA, gridB, worldGrid: makeWorldGrid(gridA, [gridB]) };
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

type PuzzleHandlers = Parameters<typeof testHelpersModule.registerPuzzleTestHandlers>;

/**
 * Render OverviewMap, wait for first rAF draw, then return captured handlers.
 * Index layout: [0]=setMode, [1]=setSelection, [2]=getPrimary, [3]=getTransform,
 *               [4]=createGroup, [5]=getGroups.
 */
async function renderAndCapture() {
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

  expect(capturedHandlers, "registerPuzzleTestHandlers was not called").not.toBeNull();

  const [setPuzzleMode, setSelection, , getTransform, createGroup, getGroups] =
    capturedHandlers!;

  const canvas = document.querySelector<HTMLCanvasElement>(
    'canvas[data-testid="overview-map-canvas"]',
  )!;
  expect(canvas).not.toBeNull();
  canvas.getBoundingClientRect = () =>
    ({
      left: 0, top: 0, right: CANVAS_W, bottom: CANVAS_H,
      width: CANVAS_W, height: CANVAS_H, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  spy.mockRestore();
  return { canvas, setPuzzleMode, setSelection, getTransform, createGroup, getGroups };
}

/** Fire mousedown then mouseup at a canvas position (click-without-drag). */
async function clickAt(canvas: HTMLCanvasElement, x: number, y: number, shiftKey = false) {
  await act(async () => {
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: x, clientY: y, shiftKey }));
  });
  await act(async () => {
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: x, clientY: y }));
  });
}

/** Fire mousedown, mousemove by delta, then mouseup. */
async function drag(
  canvas: HTMLCanvasElement,
  startX: number,
  startY: number,
  dx: number,
  dy: number,
) {
  await act(async () => {
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: startX, clientY: startY }));
  });
  await act(async () => {
    canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: startX + dx, clientY: startY + dy }));
  });
  await act(async () => {
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
}

/** Compute canvas center for a grid's tile (no puzzle offset applied). */
function tileCenterPx(grid: TerrainData, worldGrid: TerrainData): { x: number; y: number } {
  const t = computeInitialTransform(worldGrid, CANVAS_W, CANVAS_H);
  const [bx0, by0] = lonLatToCanvas(grid.minLon, grid.maxLat, worldGrid, t);
  const [bx1, by1] = lonLatToCanvas(grid.maxLon, grid.minLat, worldGrid, t);
  return { x: (bx0 + bx1) / 2, y: (by0 + by1) / 2 };
}

/** Compute corner-handle position for the topRight handle of a grid. */
function topRightHandle(grid: TerrainData, worldGrid: TerrainData): { x: number; y: number } {
  const t = computeInitialTransform(worldGrid, CANVAS_W, CANVAS_H);
  const [, by0] = lonLatToCanvas(grid.minLon, grid.maxLat, worldGrid, t);
  const [bx1] = lonLatToCanvas(grid.maxLon, grid.minLat, worldGrid, t);
  return { x: bx1 + CORNER_HANDLE_OFFSET, y: by0 - CORNER_HANDLE_OFFSET };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OverviewMap — puzzle multi-select", () => {
  beforeEach(() => {
    // Clear both storage layers so accumulated puzzle transforms/groups from
    // prior tests do not interfere with the fresh tile positions each test
    // expects.
    sessionStorage.clear();
    localStorage.clear();
    setupStores();
  });

  // -------------------------------------------------------------------------
  // 1. Shift-click adds unselected tile to selection
  //    Observable: a nudge via A's corner handle also changes B's angle.
  // -------------------------------------------------------------------------
  it("shift-click on tile B adds it to selection while keeping tile A", async () => {
    const { canvas, setPuzzleMode, setSelection, getTransform } =
      await renderAndCapture();

    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const wg = makeWorldGrid(gridA, [gridB]);

    await act(async () => { setPuzzleMode(true); });
    // Select only tile A via bridge.
    await act(async () => { setSelection([DATASET_A]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Shift-click tile B center.
    const bCenter = tileCenterPx(gridB, wg);
    await clickAt(canvas, bCenter.x, bCenter.y, /* shiftKey */ true);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // Now both A and B should be selected.
    // Observable test: drag from tile A center; both A and B should move.
    const aCenter = tileCenterPx(gridA, wg);
    const DELTA = 20;
    await drag(canvas, aCenter.x, aCenter.y, DELTA, DELTA);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const xfA = getTransform(DATASET_A);
    const xfB = getTransform(DATASET_B);
    expect(xfA?.tx).toBeCloseTo(DELTA, 0);
    expect(xfA?.ty).toBeCloseTo(DELTA, 0);
    expect(xfB?.tx).toBeCloseTo(DELTA, 0);
    expect(xfB?.ty).toBeCloseTo(DELTA, 0);
  });

  // -------------------------------------------------------------------------
  // 2. Plain-click on an already-selected tile keeps the full selection
  //    Observable: drag from A still moves B.
  // -------------------------------------------------------------------------
  it("plain-click on already-selected tile A keeps B in selection", async () => {
    const { canvas, setPuzzleMode, setSelection, getTransform } =
      await renderAndCapture();
    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const wg = makeWorldGrid(gridA, [gridB]);

    await act(async () => { setPuzzleMode(true); });
    // Select both tiles via bridge.
    await act(async () => { setSelection([DATASET_A, DATASET_B]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Plain-click on tile A (which is already selected) — should keep [A, B].
    const aCenter = tileCenterPx(gridA, wg);
    await clickAt(canvas, aCenter.x, aCenter.y);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // Drag tile A — B should also move since it is still selected.
    const DELTA = 15;
    await drag(canvas, aCenter.x, aCenter.y, DELTA, 0);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const xfB = getTransform(DATASET_B);
    expect(xfB?.tx).toBeCloseTo(DELTA, 0);
  });

  // -------------------------------------------------------------------------
  // 3. Translate drag moves ALL selected tiles by the same delta
  // -------------------------------------------------------------------------
  it("dragging tile A when [A,B] selected moves both by the same delta", async () => {
    const { canvas, setPuzzleMode, setSelection, getTransform } =
      await renderAndCapture();
    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const wg = makeWorldGrid(gridA, [gridB]);

    await act(async () => { setPuzzleMode(true); });
    await act(async () => { setSelection([DATASET_A, DATASET_B]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const aCenter = tileCenterPx(gridA, wg);
    const DX = 30;
    const DY = 10;
    await drag(canvas, aCenter.x, aCenter.y, DX, DY);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const xfA = getTransform(DATASET_A);
    const xfB = getTransform(DATASET_B);
    expect(xfA?.tx).toBeCloseTo(DX, 0);
    expect(xfA?.ty).toBeCloseTo(DY, 0);
    expect(xfB?.tx).toBeCloseTo(DX, 0);
    expect(xfB?.ty).toBeCloseTo(DY, 0);
  });

  // -------------------------------------------------------------------------
  // 4. Rotate drag changes both tiles' angles (multi-tile rotate)
  // -------------------------------------------------------------------------
  it("rotate drag on A's corner handle changes both A and B angles", async () => {
    const { canvas, setPuzzleMode, setSelection, getTransform } =
      await renderAndCapture();
    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const wg = makeWorldGrid(gridA, [gridB]);

    await act(async () => { setPuzzleMode(true); });
    // A is primary (first in array), B is also selected.
    await act(async () => { setSelection([DATASET_A, DATASET_B]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Drag the topRight handle of tile A (primary tile) to some position.
    const handle = topRightHandle(gridA, wg);
    // Move the pointer significantly so we get a non-zero angle delta.
    await drag(canvas, handle.x, handle.y, 50, -50);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const xfA = getTransform(DATASET_A);
    const xfB = getTransform(DATASET_B);
    // Both tiles must have a non-zero angle (was 0 before).
    expect(xfA?.angleDeg ?? 0).not.toBe(0);
    expect(xfB?.angleDeg ?? 0).not.toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5. Group creation: clicking any member auto-expands selection
  // -------------------------------------------------------------------------
  it("clicking a group member auto-selects all group co-members", async () => {
    const { canvas, setPuzzleMode, setSelection, getTransform, createGroup } =
      await renderAndCapture();
    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const wg = makeWorldGrid(gridA, [gridB]);

    await act(async () => { setPuzzleMode(true); });

    // Create group {A, B}.
    await act(async () => { createGroup([DATASET_A, DATASET_B]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Clear selection first.
    await act(async () => { setSelection([]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // Plain-click tile B — should auto-expand to include A (group co-member).
    const bCenter = tileCenterPx(gridB, wg);
    await clickAt(canvas, bCenter.x, bCenter.y);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Observable: drag from tile B should also move tile A (A must be selected).
    const DX = 25;
    await drag(canvas, bCenter.x, bCenter.y, DX, 0);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const xfA = getTransform(DATASET_A);
    expect(xfA?.tx).toBeCloseTo(DX, 0);
  });

  // -------------------------------------------------------------------------
  // 6. Unloading a dataset prunes its group membership
  // -------------------------------------------------------------------------
  it("removing a dataset from visibleDatasets prunes it from groups", async () => {
    const { setPuzzleMode, setSelection, createGroup, getGroups } =
      await renderAndCapture();

    await act(async () => { setPuzzleMode(true); });
    await act(async () => { setSelection([DATASET_A, DATASET_B]); });

    // Create group {A, B}.
    await act(async () => { createGroup([DATASET_A, DATASET_B]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Verify group exists.
    const groupsBefore = getGroups();
    expect(Object.keys(groupsBefore).length).toBeGreaterThan(0);

    // Remove dataset B from visibleDatasets.
    await act(async () => {
      useTerrainStore.setState((prev) => ({
        visibleDatasets: prev.visibleDatasets.filter((v) => v.datasetId !== DATASET_B),
      }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    // The group should be dissolved (only 1 member remains → size < 2).
    const groupsAfter = getGroups();
    expect(Object.keys(groupsAfter).length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 7. Switching the visible dataset set preserves valid layout state
  //    while pruning a genuinely unloaded group member.
  // -------------------------------------------------------------------------
  it("preserves valid puzzle members across a visible-set switch and prunes unloaded members", async () => {
    const { canvas, setPuzzleMode, setSelection, createGroup, getGroups, getTransform } =
      await renderAndCapture();
    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const datasetC = "dataset-c";
    const gridC = makeGrid(datasetC, -116, -113);
    const worldGrid = makeWorldGrid(gridA, [gridB]);

    await act(async () => { setPuzzleMode(true); });
    await act(async () => { setSelection([DATASET_A, DATASET_B]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Establish a real layout change for the members that must survive.
    const aCenter = tileCenterPx(gridA, worldGrid);
    await drag(canvas, aCenter.x, aCenter.y, 24, -11);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const transformA = getTransform(DATASET_A);
    const transformB = getTransform(DATASET_B);
    expect(transformA?.tx).toBeCloseTo(24, 0);
    expect(transformB?.ty).toBeCloseTo(-11, 0);

    // Add C to the visible set and create a valid three-member group.
    await act(async () => {
      useTerrainStore.setState((prev) => ({
        visibleDatasets: [
          ...prev.visibleDatasets,
          ({ datasetId: datasetC, source: "preset", overviewGrid: gridC, activeGrid: null }) as unknown as VisibleDataset,
        ],
      }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await act(async () => { createGroup([DATASET_A, DATASET_B, datasetC]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(Object.values(getGroups())[0]).toEqual(
      expect.arrayContaining([DATASET_A, DATASET_B, datasetC]),
    );

    // C is genuinely unloaded while A and B remain visible.
    await act(async () => {
      useTerrainStore.setState((prev) => ({
        visibleDatasets: prev.visibleDatasets.filter((v) => v.datasetId !== datasetC),
      }));
    });
    await waitFor(() => {
      const members = Object.values(getGroups())[0];
      expect(members).toEqual(expect.arrayContaining([DATASET_A, DATASET_B]));
      expect(members).not.toContain(datasetC);
    });
    expect(getTransform(DATASET_A)).toMatchObject(transformA!);
    expect(getTransform(DATASET_B)).toMatchObject(transformB!);

    // Restoring the original visible set must not resurrect the pruned member.
    await act(async () => {
      useTerrainStore.setState((prev) => ({
        visibleDatasets: [
          ...prev.visibleDatasets,
          ({ datasetId: datasetC, source: "preset", overviewGrid: gridC, activeGrid: null }) as unknown as VisibleDataset,
        ],
      }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const restoredMembers = Object.values(getGroups())[0];
    expect(restoredMembers).toEqual(expect.arrayContaining([DATASET_A, DATASET_B]));
    expect(restoredMembers).not.toContain(datasetC);
    expect(getTransform(DATASET_A)).toMatchObject(transformA!);
    expect(getTransform(DATASET_B)).toMatchObject(transformB!);
  });

  // -------------------------------------------------------------------------
  // 8. Reset clears all transforms AND groups
  // -------------------------------------------------------------------------
  it("Reset button clears all puzzle transforms and groups", async () => {
    const { canvas, setPuzzleMode, setSelection, getTransform, createGroup, getGroups } =
      await renderAndCapture();
    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const wg = makeWorldGrid(gridA, [gridB]);

    await act(async () => { setPuzzleMode(true); });
    await act(async () => { setSelection([DATASET_A, DATASET_B]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Drag both tiles so we have non-zero transforms.
    const aCenter = tileCenterPx(gridA, wg);
    await drag(canvas, aCenter.x, aCenter.y, 40, 20);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // Create a group.
    await act(async () => { createGroup([DATASET_A, DATASET_B]); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    expect(getTransform(DATASET_A)?.tx ?? 0).not.toBe(0);
    expect(Object.keys(getGroups()).length).toBeGreaterThan(0);

    // Both storage layers should have been written through before reset.
    expect(localStorage.getItem("bathyscan:puzzleTransforms")).not.toBeNull();
    expect(localStorage.getItem("bathyscan:puzzleGroups")).not.toBeNull();

    // Click the Reset button.
    const resetBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="overview-puzzle-reset"]',
    );
    expect(resetBtn).not.toBeNull();
    await act(async () => { resetBtn!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Both transforms and groups should be cleared.
    expect(getTransform(DATASET_A)).toBeNull();
    expect(getTransform(DATASET_B)).toBeNull();
    expect(Object.keys(getGroups()).length).toBe(0);

    // Reset must also remove from both storage layers.
    expect(sessionStorage.getItem("bathyscan:puzzleTransforms")).toBeNull();
    expect(sessionStorage.getItem("bathyscan:puzzleGroups")).toBeNull();
    expect(localStorage.getItem("bathyscan:puzzleTransforms")).toBeNull();
    expect(localStorage.getItem("bathyscan:puzzleGroups")).toBeNull();
  });
});
