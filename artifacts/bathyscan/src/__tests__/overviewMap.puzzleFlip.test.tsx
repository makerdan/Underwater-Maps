/**
 * OverviewMap — puzzle tile flip & context-menu rotation persistence tests.
 *
 * Covers three "Confirm" scenarios as permanent regression tests:
 *   1. Right-click context menu on a puzzle tile shows "Flip H" / "Flip V"
 *      and clicking each toggles the corresponding flag in puzzleStore (#4195 family).
 *   2. Context-menu rotation updates survive an unmount and remount, while the
 *      removed header controls stay absent.
 *   3. The composite canvas draw applies the horizontal/vertical flip via
 *      ctx.scale(-1, 1) / ctx.scale(1, -1) — a flipped tile is actually
 *      drawn mirrored, not just flagged in state.
 *
 * Harness copied from overviewMap.puzzleMultiSelect.test.ts (real OverviewMap
 * render + registerPuzzleTestHandlers bridge).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, waitFor, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore, type VisibleDataset } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { useCameraStore } from "@/lib/cameraStore";
import { usePuzzleStore } from "@/lib/puzzleStore";
import { computeInitialTransform, lonLatToCanvas } from "@/lib/overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";
import * as testHelpersModule from "@/lib/testHelpers";

// ---------------------------------------------------------------------------
// Hoisted mock state (identical pattern to overviewMap.puzzleMultiSelect.test.ts)
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

// Neutralise the Poe upscale hook — the real hook fires fetch() requests with
// AbortSignals that jsdom/undici rejects, adding noise and load-dependent
// latency to every render. The flip tests never exercise upscaling.
vi.mock("@/hooks/useUpscaledHeatmap", () => ({
  useUpscaledHeatmap: () => ({
    isUpscaling: false,
    upscaledBitmap: null,
    requestUpscaleIfNeeded: () => {},
    invalidate: () => {},
  }),
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
import { ContextMenu } from "@/components/ContextMenu";

// ---------------------------------------------------------------------------
// Constants & harness
// ---------------------------------------------------------------------------
const CANVAS_W = 1024;
const CANVAS_H = 768;
const DATASET_A = "dataset-a";
const DATASET_B = "dataset-b";
const TRANSFORM_KEY = "bathyscan:puzzleTransforms";

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

async function waitForCameraArrow(): Promise<Element> {
  return waitFor(
    () => {
      const el = document.querySelector('polygon[fill="#d4ac0d"]');
      if (!el) throw new Error("Camera arrow not yet rendered");
      return el;
    },
    { timeout: 8000 },
  );
}

type PuzzleHandlers = Parameters<typeof testHelpersModule.registerPuzzleTestHandlers>;

/**
 * Render OverviewMap (plus the app-level ContextMenu portal so right-click
 * menus materialise in the DOM), wait for first rAF draw, return handlers.
 */
async function renderAndCapture() {
  let capturedHandlers: PuzzleHandlers | null = null;

  const spy = vi
    .spyOn(testHelpersModule, "registerPuzzleTestHandlers")
    .mockImplementation((...args: PuzzleHandlers) => {
      capturedHandlers = args;
    });

  let result: ReturnType<typeof renderWithProviders> | null = null;
  await act(async () => {
    result = renderWithProviders(
      withQuery(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(OverviewMap),
          React.createElement(ContextMenu),
        ),
      ),
    );
  });
  await waitForCameraArrow();

  expect(capturedHandlers, "registerPuzzleTestHandlers was not called").not.toBeNull();

  const [setPuzzleMode, setSelection, , getTransform, createGroup] = capturedHandlers!;

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
  return {
    canvas,
    setPuzzleMode,
    setSelection,
    getTransform,
    createGroup,
    unmount: () => result!.unmount(),
  };
}

async function rightClickAt(canvas: HTMLCanvasElement, x: number, y: number) {
  await act(async () => {
    canvas.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  });
}

function tileCenterPx(grid: TerrainData, worldGrid: TerrainData): { x: number; y: number } {
  const t = computeInitialTransform(worldGrid, CANVAS_W, CANVAS_H);
  const [bx0, by0] = lonLatToCanvas(grid.minLon, grid.maxLat, worldGrid, t);
  const [bx1, by1] = lonLatToCanvas(grid.maxLon, grid.minLat, worldGrid, t);
  return { x: (bx0 + bx1) / 2, y: (by0 + by1) / 2 };
}

async function settle(ms = 40) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OverviewMap — puzzle tile flips & rotation persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    usePuzzleStore.setState({ puzzleTransforms: {} });
    setupStores();
  });

  // -------------------------------------------------------------------------
  // 1. Right-click context menu: Flip H / Flip V (Task #4195 family)
  // -------------------------------------------------------------------------
  it("right-click on a puzzle tile shows Flip H / Flip V and clicking each toggles the flag", { timeout: 30_000 }, async () => {
    const { canvas, setPuzzleMode } = await renderAndCapture();
    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const wg = makeWorldGrid(gridA, [gridB]);

    await act(async () => { setPuzzleMode(true); });
    await settle();

    const aCenter = tileCenterPx(gridA, wg);

    // --- Flip H ---
    await rightClickAt(canvas, aCenter.x, aCenter.y);
    await waitFor(() => {
      expect(screen.getByText("Flip H")).toBeInTheDocument();
      expect(screen.getByText("Flip V")).toBeInTheDocument();
    }, { timeout: 8000 });
    fireEvent.click(screen.getByText("Flip H"));
    await settle();

    let xf = usePuzzleStore.getState().puzzleTransforms[DATASET_A];
    expect(xf?.flipH).toBe(true);
    expect(xf?.flipV ?? false).toBe(false);

    // --- Flip V (flipH must stay set) ---
    await rightClickAt(canvas, aCenter.x, aCenter.y);
    await waitFor(() => expect(screen.getByText("Flip V")).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getByText("Flip V"));
    await settle();

    xf = usePuzzleStore.getState().puzzleTransforms[DATASET_A];
    expect(xf?.flipH).toBe(true);
    expect(xf?.flipV).toBe(true);

    // --- Flip H again toggles OFF ---
    await rightClickAt(canvas, aCenter.x, aCenter.y);
    await waitFor(() => expect(screen.getByText("Flip H")).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getByText("Flip H"));
    await settle();

    xf = usePuzzleStore.getState().puzzleTransforms[DATASET_A];
    expect(xf?.flipH ?? false).toBe(false);
    expect(xf?.flipV).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Context-menu rotation survives unmount → remount
  // -------------------------------------------------------------------------
  it("moves rotation actions to the tile menu and persists their result across remount", { timeout: 30_000 }, async () => {
    const first = await renderAndCapture();
    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const wg = makeWorldGrid(gridA, [gridB]);

    await act(async () => { first.setPuzzleMode(true); });
    await act(async () => { first.setSelection([DATASET_A]); });
    await settle(60);

    expect(document.querySelector('[data-testid="overview-puzzle-rotation-panel"]')).toBeNull();
    expect(document.querySelector('[data-testid="overview-puzzle-rotate-dropdown"]')).toBeNull();
    expect(document.querySelector('[data-testid="overview-puzzle-angle-input"]')).toBeNull();

    const aCenter = tileCenterPx(gridA, wg);
    await rightClickAt(first.canvas, aCenter.x, aCenter.y);
    await waitFor(() => {
      expect(screen.getByText("Rotate 45° clockwise")).toBeInTheDocument();
      expect(screen.getByText("Rotate 5° counter-clockwise")).toBeInTheDocument();
      expect(screen.getByText("Reset rotation")).toBeInTheDocument();
    }, { timeout: 8000 });
    fireEvent.click(screen.getByText("Rotate 45° clockwise"));
    await settle(60);

    await rightClickAt(first.canvas, aCenter.x, aCenter.y);
    await waitFor(() => expect(screen.getByText("Rotate 5° counter-clockwise")).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getByText("Rotate 5° counter-clockwise"));
    await settle(60);

    expect(first.getTransform(DATASET_A)?.angleDeg).toBe(40);
    // The write-through persistence layer must have captured it.
    expect(sessionStorage.getItem(TRANSFORM_KEY) ?? "").toContain("40");

    // Unmount the whole map mid-session…
    await act(async () => { first.unmount(); });

    // …and remount it. Transforms rehydrate from sessionStorage.
    const second = await renderAndCapture();
    await act(async () => { second.setPuzzleMode(true); });
    await act(async () => { second.setSelection([DATASET_A]); });
    await settle(60);

    expect(document.querySelector('[data-testid="overview-puzzle-rotation-panel"]')).toBeNull();
    expect(second.getTransform(DATASET_A)?.angleDeg).toBe(40);
  });

  it("rotates and resets every unlocked group member while leaving locked members unchanged", { timeout: 30_000 }, async () => {
    const { canvas, setPuzzleMode, createGroup } = await renderAndCapture();
    const gridA = makeGrid(DATASET_A, -122, -119);
    const gridB = makeGrid(DATASET_B, -119, -116);
    const wg = makeWorldGrid(gridA, [gridB]);
    const aCenter = tileCenterPx(gridA, wg);
    const bCenter = tileCenterPx(gridB, wg);

    await act(async () => { setPuzzleMode(true); });
    await act(async () => { createGroup([DATASET_A, DATASET_B]); });
    await settle(60);

    await rightClickAt(canvas, aCenter.x, aCenter.y);
    await waitFor(() => expect(screen.getByText("Rotate 5° clockwise")).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getByText("Rotate 5° clockwise"));
    await settle();
    expect(usePuzzleStore.getState().puzzleTransforms[DATASET_A]?.angleDeg).toBe(5);
    expect(usePuzzleStore.getState().puzzleTransforms[DATASET_B]?.angleDeg).toBe(5);

    await rightClickAt(canvas, bCenter.x, bCenter.y);
    await waitFor(() => expect(screen.getByText("Lock tile")).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getByText("Lock tile"));
    await settle();

    await rightClickAt(canvas, aCenter.x, aCenter.y);
    await waitFor(() => expect(screen.getByText("Rotate 45° clockwise")).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getByText("Rotate 45° clockwise"));
    await settle();
    expect(usePuzzleStore.getState().puzzleTransforms[DATASET_A]?.angleDeg).toBe(50);
    expect(usePuzzleStore.getState().puzzleTransforms[DATASET_B]?.angleDeg).toBe(5);

    await rightClickAt(canvas, aCenter.x, aCenter.y);
    await waitFor(() => expect(screen.getByText("Reset rotation")).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getByText("Reset rotation"));
    await settle();
    expect(usePuzzleStore.getState().puzzleTransforms[DATASET_A]?.angleDeg).toBe(0);
    expect(usePuzzleStore.getState().puzzleTransforms[DATASET_B]?.angleDeg).toBe(5);
  });

  // -------------------------------------------------------------------------
  // 3. Toolbar flip buttons mirror to puzzleStore (alternate flip entry point)
  // -------------------------------------------------------------------------
  it("toolbar Flip H / Flip V buttons toggle the flags on the selected tile", { timeout: 30_000 }, async () => {
    const { setPuzzleMode, setSelection } = await renderAndCapture();

    await act(async () => { setPuzzleMode(true); });
    await act(async () => { setSelection([DATASET_A]); });
    await settle(60);

    const flipH = document.querySelector<HTMLButtonElement>('[data-testid="overview-puzzle-flip-h"]');
    const flipV = document.querySelector<HTMLButtonElement>('[data-testid="overview-puzzle-flip-v"]');
    expect(flipH, "toolbar Flip H button should exist").not.toBeNull();
    expect(flipV, "toolbar Flip V button should exist").not.toBeNull();

    await act(async () => { flipH!.click(); });
    await settle();
    expect(usePuzzleStore.getState().puzzleTransforms[DATASET_A]?.flipH).toBe(true);

    await act(async () => { flipV!.click(); });
    await settle();
    const xf = usePuzzleStore.getState().puzzleTransforms[DATASET_A];
    expect(xf?.flipH).toBe(true);
    expect(xf?.flipV).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Composite draw applies the flip via ctx.scale (pixel-transform guard)
// ---------------------------------------------------------------------------
//
// The global test setup returns a fresh throwaway 2D-context object per
// getContext() call, so scale() calls are unobservable by default. This
// describe overrides getContext with a recording proxy: every scale(x, y)
// call from any context lands in a shared array we can assert on.
describe("OverviewMap — flipped tile draw transform", () => {
  const scaleCalls: Array<[number, number]> = [];
  let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

  function makeRecordingCtx(): CanvasRenderingContext2D {
    const propStore: Record<PropertyKey, unknown> = {};
    const target: Record<PropertyKey, unknown> = {
      scale: (x: number, y: number) => { scaleCalls.push([x, y]); },
      measureText: () => ({ width: 10 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createPattern: () => null,
      isPointInPath: () => false,
    };
    return new Proxy(target, {
      get(t, p) {
        if (p in t) return t[p];
        if (p in propStore) return propStore[p];
        return () => undefined; // any other method: no-op
      },
      set(_t, p, v) { propStore[p] = v; return true; },
      has() { return true; },
    }) as unknown as CanvasRenderingContext2D;
  }

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    usePuzzleStore.setState({ puzzleTransforms: {} });
    setupStores();
    scaleCalls.length = 0;
    origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return makeRecordingCtx();
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
  });

  it("draws a tile with flipH via ctx.scale(-1, 1)", { timeout: 30_000 }, async () => {
    // Seed a horizontally-flipped transform BEFORE mount — OverviewMap
    // rehydrates from sessionStorage on mount.
    sessionStorage.setItem(
      TRANSFORM_KEY,
      JSON.stringify([[DATASET_A, { tx: 0, ty: 0, angleDeg: 0, flipH: true, flipV: false }]]),
    );

    await renderAndCapture();
    await waitFor(() => {
      expect(scaleCalls.length, "composite draw should call ctx.scale").toBeGreaterThan(0);
    });

    expect(
      scaleCalls.some(([x, y]) => x === -1 && y === 1),
      `expected a scale(-1, 1) call for the flipH tile; saw: ${JSON.stringify(scaleCalls.slice(0, 20))}`,
    ).toBe(true);
  });

  it("draws a tile with flipV via ctx.scale(1, -1)", { timeout: 30_000 }, async () => {
    sessionStorage.setItem(
      TRANSFORM_KEY,
      JSON.stringify([[DATASET_A, { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: true }]]),
    );

    await renderAndCapture();
    await waitFor(() => {
      expect(scaleCalls.length).toBeGreaterThan(0);
    });

    expect(scaleCalls.some(([x, y]) => x === 1 && y === -1)).toBe(true);
  });

  it("never mirrors when no tile is flipped (control)", { timeout: 30_000 }, async () => {
    await renderAndCapture();
    await waitFor(() => {
      expect(scaleCalls.length).toBeGreaterThan(0);
    });

    expect(scaleCalls.some(([x, y]) => x < 0 || y < 0)).toBe(false);
  });
});
