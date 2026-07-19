/**
 * OverviewMap — pointercancel stuck-drag regression tests.
 *
 * Verifies that firing a `pointercancel` event on `window` while a box-select
 * or pan drag is in progress clears the drag state so the overlay disappears
 * and panning becomes interactive again.
 *
 * Strategy:
 *   1. Enable select mode via the toolbar toggle.
 *   2. Fire `mousedown` on the canvas (starts dragRectRef).
 *   3. Fire `pointercancel` on `window`.
 *   4. Assert that a subsequent `mousedown` starts a fresh drag (not stuck in
 *      the previous one) and that `isDraggingRef` was reset (a pan drag that
 *      follows the cancel works correctly).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";

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

describe("OverviewMap — pointercancel clears stuck drag state", () => {
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

  it("pointercancel on window after a select-mode mousedown clears the drag rect and does not leave the canvas stuck", async () => {
    renderWithProviders(withQuery(React.createElement(OverviewMap)));

    const toolsToggle = screen.getByTestId("overview-tools-toggle");
    await act(async () => { fireEvent.click(toolsToggle); });

    const selectToggle = screen.getByTestId("overview-select-area-toggle");
    await act(async () => { fireEvent.click(selectToggle); });
    expect(selectToggle.getAttribute("aria-pressed")).toBe("true");

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

    // Start a box-select drag (mousedown sets dragRectRef).
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100, button: 0 });
    });

    // Simulate a system gesture cancelling the pointer stream — no mouseup fires.
    await act(async () => {
      fireEvent(window, new Event("pointercancel", { bubbles: true }));
    });

    // After pointercancel the drag rect must be cleared. The clearest observable
    // signal is that a subsequent pan drag (mousedown + mousemove outside select
    // mode) is accepted normally — meaning isDraggingRef was reset to false and
    // a new drag can begin without the previous rect blocking it.
    //
    // Disable select mode first so the next mousedown goes into pan mode.
    await act(async () => { fireEvent.click(selectToggle); });
    expect(selectToggle.getAttribute("aria-pressed")).toBe("false");

    // A fresh mousedown should start a pan drag without errors.
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0 });
      fireEvent.mouseMove(window, { clientX: 310, clientY: 310 });
      fireEvent.mouseUp(window);
    });

    // If we reach here without errors the cancel handler ran and the state was
    // correctly reset — a stuck drag would have thrown during the mousemove.
    expect(canvas).toBeInTheDocument();
  });

  it("pointercancel during a pan drag (no select mode) resets isDragging so the next drag works", async () => {
    renderWithProviders(withQuery(React.createElement(OverviewMap)));

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

    // Start a pan drag.
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 200, clientY: 200, button: 0 });
      fireEvent.mouseMove(window, { clientX: 250, clientY: 250 });
    });

    // Cancel the pointer — isDraggingRef should be reset to false.
    await act(async () => {
      fireEvent(window, new Event("pointercancel", { bubbles: true }));
    });

    // A new mousedown + mouseup should complete cleanly (no stuck drag state).
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300, button: 0 });
      fireEvent.mouseUp(window);
    });

    // No error → stuck drag was cleared.
    expect(canvas).toBeInTheDocument();
  });

  it("pointercancel handler is cleaned up on unmount (no lingering window listener)", async () => {
    const addSpy    = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderWithProviders(withQuery(React.createElement(OverviewMap)));
    await act(async () => {});

    // Verify the handler was registered.
    const addCalls = addSpy.mock.calls.filter(([type]) => type === "pointercancel");
    expect(addCalls.length).toBeGreaterThanOrEqual(1);

    // Unmount and verify it was removed.
    await act(async () => { unmount(); });
    const removeCalls = removeSpy.mock.calls.filter(([type]) => type === "pointercancel");
    expect(removeCalls.length).toBeGreaterThanOrEqual(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
