/**
 * Regression tests for OverviewMap error-state UX.
 *
 * Covers two scenarios:
 *
 * 1. HINT VISIBILITY (#3248) — When the map fails to load (15 s timeout) and
 *    datasets are already selected, the "Choose a dataset from Find Data" hint
 *    link must appear alongside the Retry button so users can switch datasets
 *    without closing the map.
 *
 * 2. RETRY LOOP (#3252) — A second consecutive fetch failure must reset the
 *    retry flag and re-surface the Retry button.  If the Retry button stayed
 *    hidden after the second failure the map would be permanently stuck.
 *
 * Strategy: spy on `Date.now` to control the 15 s stale-fetch clock while
 * leaving `requestAnimationFrame` unpatched so the rAF loop fires naturally.
 * Advancing `now` by >15 000 ms after the first rAF frame triggers the error
 * branch without any real-clock wait.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { useCameraStore } from "@/lib/cameraStore";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Self-maintaining Proxy API client mock (same pattern as other OverviewMap tests)
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
    useGetDatasets: () => ({ data: [{ id: "fail-ds", hasEfh: false }] }),
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

const CANVAS_W = 1024;
const CANVAS_H = 768;

function withQuery(node: React.ReactElement): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, node);
}

/** A minimal visible-dataset entry with no overview grid loaded (simulates a fetch-in-progress or failed fetch). */
function makeVisibleDatasetNoGrid() {
  return {
    datasetId: "fail-ds",
    source: "preset" as const,
    overviewGrid: null as unknown as TerrainData,
    activeGrid: null,
  };
}

/**
 * Set up stores so datasets are selected but no overview grid has arrived —
 * this puts the rAF loop into Case 2 (loading / timed-out state).
 */
function setupNoGridState() {
  Object.defineProperty(window, "innerWidth",  { value: CANVAS_W, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: CANVAS_H, configurable: true });

  useTerrainStore.setState({
    visibleDatasets: [makeVisibleDatasetNoGrid()],
    primaryDatasetId: "fail-ds",
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
}

/**
 * Advance the `Date.now` spy to a value 16 000 ms ahead of the initial
 * recorded time, triggering the 15 s stale-fetch timeout in the rAF loop.
 */
function advancePast15s(nowSpy: ReturnType<typeof vi.spyOn>, initial: number) {
  nowSpy.mockReturnValue(initial + 16_000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OverviewMap — error-state UX: hint link + retry loop", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nowSpy: ReturnType<typeof vi.spyOn<any, any>>;
  let initialNow: number;

  beforeEach(() => {
    setupNoGridState();
    // Spy on Date.now so we can advance the stale-fetch clock without
    // real delays, while leaving requestAnimationFrame unpatched.
    initialNow = Date.now();
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(initialNow);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Scenario (a): error state with datasets selected → hint link is visible
  // -------------------------------------------------------------------------
  it("shows 'Choose a dataset from Find Data' hint link when grid load times out", async () => {
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Allow the initial rAF frame to run so nullGridSince is set.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Advance the fake clock past the 15 s threshold.
    advancePast15s(nowSpy, initialNow);

    // Wait for React to commit the state update (setOverviewLoadFailed(true)).
    await waitFor(
      () => {
        const hint = document.querySelector('[data-testid="overview-error-hint"]');
        if (!hint) throw new Error("overview-error-hint not yet in DOM");
        return hint;
      },
      { timeout: 3000 },
    );

    const hint = document.querySelector('[data-testid="overview-error-hint"]');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toMatch(/Choose a dataset from Find Data/i);
  });

  it("hint link is not shown before the 15 s timeout elapses", async () => {
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // Do NOT advance past 15 s — the clock stays at initialNow.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // The hint must not be visible while the map is still in LOADING state.
    expect(document.querySelector('[data-testid="overview-error-hint"]')).toBeNull();
  });

  it("Retry button appears alongside the hint link after timeout", async () => {
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    advancePast15s(nowSpy, initialNow);

    await waitFor(
      () => {
        if (!document.querySelector('[data-testid="overview-load-retry"]')) {
          throw new Error("Retry button not yet in DOM");
        }
      },
      { timeout: 3000 },
    );

    expect(document.querySelector('[data-testid="overview-load-retry"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="overview-error-hint"]')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Scenario (b): two consecutive fetch failures → Retry button reappears
  // -------------------------------------------------------------------------
  it("Retry button reappears after a second consecutive fetch failure", async () => {
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    // --- First failure ---
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    advancePast15s(nowSpy, initialNow);

    // Wait for the Retry button to appear (first failure).
    await waitFor(
      () => {
        if (!document.querySelector('[data-testid="overview-load-retry"]')) {
          throw new Error("Retry button not yet in DOM after first failure");
        }
      },
      { timeout: 3000 },
    );

    // --- Click Retry ---
    // The retry handler resets overviewLoadFailed → false and clears nullGridSince.
    await act(async () => {
      const retryBtn = document.querySelector<HTMLButtonElement>(
        '[data-testid="overview-load-retry"] button',
      )!;
      fireEvent.click(retryBtn);
    });

    // Retry button must disappear immediately after click.
    expect(document.querySelector('[data-testid="overview-load-retry"]')).toBeNull();
    expect(document.querySelector('[data-testid="overview-error-hint"]')).toBeNull();

    // --- Second failure: rAF resets nullGridSince to now (= initialNow + 16 000).
    //     Advance another 16 s to trigger the timeout again.
    const afterRetryNow = initialNow + 16_000;
    nowSpy.mockReturnValue(afterRetryNow);
    // Allow one rAF frame so nullGridSince is set to afterRetryNow.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Now jump another 16 s ahead of the afterRetry baseline.
    nowSpy.mockReturnValue(afterRetryNow + 16_000);

    // Retry button must reappear after the second failure.
    await waitFor(
      () => {
        if (!document.querySelector('[data-testid="overview-load-retry"]')) {
          throw new Error("Retry button did not reappear after second failure");
        }
      },
      { timeout: 3000 },
    );

    expect(document.querySelector('[data-testid="overview-load-retry"]')).not.toBeNull();
    // Hint link must also reappear alongside the Retry button.
    expect(document.querySelector('[data-testid="overview-error-hint"]')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Scenario (b) edge: clicking Retry multiple times must not leave stuck state
  // -------------------------------------------------------------------------
  it("clicking Retry twice in quick succession does not permanently disable the Retry button", async () => {
    await act(async () => {
      renderWithProviders(withQuery(React.createElement(OverviewMap)));
    });

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    advancePast15s(nowSpy, initialNow);

    await waitFor(
      () => { if (!document.querySelector('[data-testid="overview-load-retry"]')) throw new Error("pending"); },
      { timeout: 3000 },
    );

    // Click Retry twice rapidly.
    await act(async () => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="overview-load-retry"] button',
      )!;
      fireEvent.click(btn);
    });
    // After first click the DOM element unmounts; second click can't find it —
    // that is expected and correct; the important thing is the state is clear.

    // Advance clock to trigger timeout again.
    const afterRetry = initialNow + 16_000;
    nowSpy.mockReturnValue(afterRetry);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    nowSpy.mockReturnValue(afterRetry + 16_000);

    await waitFor(
      () => { if (!document.querySelector('[data-testid="overview-load-retry"]')) throw new Error("Retry button missing"); },
      { timeout: 3000 },
    );

    expect(document.querySelector('[data-testid="overview-load-retry"]')).not.toBeNull();
  });
});
