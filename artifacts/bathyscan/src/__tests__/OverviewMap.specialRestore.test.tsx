/**
 * OverviewMap — special-collection layout restore atomicity (live consumer).
 *
 * The Regression Guard for the special-collection restore flow, exercised at
 * the REAL state boundary: OverviewMap's pendingRestore consumer effect. The
 * pure-builder test (puzzleRestore.test.ts) proves the builder produces both
 * views from the same objects; this test proves the mounted consumer commits
 * them together:
 *
 *  1. `puzzleStore` receives the restored record SYNCHRONOUSLY inside the
 *     restore effect — not via the later canvas→store mirror effect — so 3D
 *     marker geography can never observe the prior store layout after the
 *     canvas has restored.
 *  2. No partial store state is ever observable: every puzzleStore update
 *     that contains any restored tile contains ALL restored tiles with the
 *     exact payload values (a one-tile-applied intermediate fails).
 *  3. The canvas-side state applied in the same flush: the canvas
 *     auto-persist effect (sessionStorage "bathyscan:puzzleTransforms")
 *     serialises the same transforms the store holds.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./setup";
import { useTerrainStore, type VisibleDataset } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { usePuzzleStore, type PuzzleTransform } from "@/lib/puzzleStore";
import { useSpecialCollectionStore } from "@/lib/specialCollectionStore";
import { performSignOutCleanup } from "@/hooks/signoutCleanup";
import type { RestorePayload } from "@/lib/puzzleRestore";

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
    useGetDatasets: () => ({ data: [{ id: "ds-a", hasEfh: false }, { id: "ds-b", hasEfh: false }] }),
    getGetDatasetsQueryKey: (p: unknown) => ["datasets", p],
    usePostDatasetsBboxQuery: () => ({ mutateAsync: vi.fn() }),
    useGetDatasetsMySaves: () => ({ data: [], refetch: vi.fn() }),
    getGetDatasetsMySavesQueryKey: () => ["my-saves"],
    usePostDatasetsCatalogIdSave: () => ({ mutateAsync: vi.fn() }),
    useGetEfh: () => ({ data: undefined }),
    getGetEfhQueryKey: (p: unknown) => ["efh", p],
    useGetSubstrate: () => ({ data: undefined }),
    getGetSubstrateQueryKey: (id: unknown) => ["substrate", id],
    getUserCollectionsIdBackground: vi.fn(async () => new Blob()),
  }),
);

import { OverviewMap } from "@/components/OverviewMap";

function withQuery(node: React.ReactElement): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, node);
}

function makeGrid(datasetId: string, lonShift: number) {
  const N = 4;
  const depths = new Array(N * N).fill(0).map((_, i) => 10 + i * 5);
  return {
    datasetId,
    name: `Dataset ${datasetId}`,
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: 10,
    maxDepth: 10 + (N * N - 1) * 5,
    minLon: -122 + lonShift,
    maxLon: -119 + lonShift,
    minLat: 47,
    maxLat: 49,
    centerLon: -120.5 + lonShift,
    centerLat: 48.0,
    waterType: "saltwater" as const,
  };
}

const PAYLOAD: RestorePayload = {
  tiles: [
    { datasetId: "ds-a", tx: 12, ty: -34, angleDeg: 15, locked: true, annotation: "north shelf" },
    { datasetId: "ds-b", tx: -56, ty: 78, angleDeg: 270 },
  ],
  groups: [["ds-a", "ds-b"]],
};

describe("OverviewMap — special-collection restore applies store + canvas atomically", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    usePuzzleStore.getState().clear();
    useSpecialCollectionStore.setState({ active: null, pendingRestore: null, pendingPuzzleOn: 0 });

    const gridA = makeGrid("ds-a", 0);
    const gridB = makeGrid("ds-b", 4);
    useTerrainStore.setState({
      visibleDatasets: [
        ({ datasetId: "ds-a", source: "preset", overviewGrid: gridA, activeGrid: null } satisfies VisibleDataset),
        ({ datasetId: "ds-b", source: "preset", overviewGrid: gridB, activeGrid: null } satisfies VisibleDataset),
      ],
      primaryDatasetId: "ds-a",
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
  });

  afterEach(() => {
    usePuzzleStore.getState().clear();
    useSpecialCollectionStore.setState({ active: null, pendingRestore: null, pendingPuzzleOn: 0 });
  });

  it("restoring a revision through the live consumer updates puzzleStore and canvas state together, with no observable partial state", async () => {
    renderWithProviders(withQuery(React.createElement(OverviewMap)));
    await act(async () => {});

    // Record every puzzleStore transforms state emitted from now on.
    const observedStates: Array<Record<string, PuzzleTransform>> = [];
    const unsubscribe = usePuzzleStore.subscribe((state) => {
      observedStates.push(state.puzzleTransforms);
    });

    try {
      await act(async () => {
        useSpecialCollectionStore.getState().requestRestore(PAYLOAD);
      });
    } finally {
      unsubscribe();
    }

    // The pending restore was consumed by the mounted component.
    expect(useSpecialCollectionStore.getState().pendingRestore).toBeNull();

    // Store side: final record matches the payload exactly (both tiles,
    // including locked + annotation; flips restore false by design).
    const store = usePuzzleStore.getState().puzzleTransforms;
    expect(Object.keys(store).sort()).toEqual(["ds-a", "ds-b"]);
    expect(store["ds-a"]).toMatchObject({ tx: 12, ty: -34, angleDeg: 15, flipH: false, flipV: false, locked: true, annotation: "north shelf" });
    expect(store["ds-b"]).toMatchObject({ tx: -56, ty: 78, angleDeg: 270, flipH: false, flipV: false });
    expect(usePuzzleStore.getState().puzzleMode).toBe(true);

    // Atomicity: every store update that contains ANY restored tile contains
    // ALL restored tiles with the final payload values. A partial apply
    // (one tile restored, the other missing or stale) fails here.
    const touching = observedStates.filter(
      (rec) => "ds-a" in rec || "ds-b" in rec,
    );
    expect(touching.length).toBeGreaterThan(0);
    for (const rec of touching) {
      expect(Object.keys(rec).sort()).toEqual(["ds-a", "ds-b"]);
      expect(rec["ds-a"]).toMatchObject({ tx: 12, ty: -34, angleDeg: 15, locked: true });
      expect(rec["ds-b"]).toMatchObject({ tx: -56, ty: 78, angleDeg: 270 });
    }

    // Canvas side, observed through its auto-persist output written in the
    // same flush: the serialised canvas transforms agree with the store.
    const persisted = sessionStorage.getItem("bathyscan:puzzleTransforms");
    expect(persisted).not.toBeNull();
    const entries = new Map(JSON.parse(persisted!) as Array<[string, PuzzleTransform]>);
    expect([...entries.keys()].sort()).toEqual(["ds-a", "ds-b"]);
    expect(entries.get("ds-a")).toMatchObject({ tx: 12, ty: -34, angleDeg: 15, locked: true, annotation: "north shelf" });
    expect(entries.get("ds-b")).toMatchObject({ tx: -56, ty: 78, angleDeg: 270 });
  });

  it("the store is updated synchronously by the restore effect, not the later canvas mirror effect", async () => {
    renderWithProviders(withQuery(React.createElement(OverviewMap)));
    await act(async () => {});

    // The FIRST store update after requestRestore must already carry the full
    // restored record. If the store were only synced by the dependent mirror
    // effect, the first post-restore update would land in a later commit —
    // and a subscriber (MarkerLayer) rendering between the two commits would
    // see restored canvas + stale store. Capturing update order proves the
    // synchronous write happens before any canvas-driven mirror write.
    const firstUpdate: Array<Record<string, PuzzleTransform>> = [];
    let canvasPersistedAtFirstStoreUpdate: string | null = "unset";
    const unsubscribe = usePuzzleStore.subscribe((state) => {
      if (firstUpdate.length === 0 && ("ds-a" in state.puzzleTransforms || "ds-b" in state.puzzleTransforms)) {
        firstUpdate.push(state.puzzleTransforms);
        // Snapshot the canvas persistence output at this exact moment. The
        // canvas auto-persist effect runs on the canvas state commit; if the
        // store were synced by the (later-declared) mirror effect in that
        // same commit, the persistence write would have already happened
        // when the store first updates. The synchronous restore-effect write
        // must land BEFORE the canvas commit — i.e. before persistence.
        canvasPersistedAtFirstStoreUpdate = sessionStorage.getItem("bathyscan:puzzleTransforms");
      }
    });

    try {
      await act(async () => {
        useSpecialCollectionStore.getState().requestRestore(PAYLOAD);
      });
    } finally {
      unsubscribe();
    }

    expect(firstUpdate.length).toBe(1);
    expect(Object.keys(firstUpdate[0]!).sort()).toEqual(["ds-a", "ds-b"]);
    expect(firstUpdate[0]!["ds-a"]).toMatchObject({ tx: 12, ty: -34, angleDeg: 15, locked: true, annotation: "north shelf" });
    expect(firstUpdate[0]!["ds-b"]).toMatchObject({ tx: -56, ty: 78, angleDeg: 270 });
    // Store led; the canvas persistence write had not yet happened when the
    // store first carried the restored tiles. A mirror-effect-only sync (the
    // rejected design) persists the canvas first and fails this assertion.
    const persistedEarly =
      canvasPersistedAtFirstStoreUpdate !== "unset" &&
      canvasPersistedAtFirstStoreUpdate !== null &&
      canvasPersistedAtFirstStoreUpdate.includes("ds-a");
    expect(persistedEarly).toBe(false);
  });

  it("sign-out clears the restored layout from the LIVE mounted component, puzzleStore, and the geo-transform mirror", async () => {
    renderWithProviders(withQuery(React.createElement(OverviewMap)));
    await act(async () => {});

    // Restore a layout so live per-user state exists in every layer.
    await act(async () => {
      useSpecialCollectionStore.getState().requestRestore(PAYLOAD);
    });
    expect(Object.keys(usePuzzleStore.getState().puzzleTransforms).sort()).toEqual(["ds-a", "ds-b"]);
    // Component-local puzzle mode is on: the puzzle toolbar controls exist and
    // the toggle is pressed.
    expect(screen.getByTestId("overview-puzzle-toggle").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("overview-puzzle-snap-toggle")).not.toBeNull();
    expect(sessionStorage.getItem("bathyscan:puzzleTransforms")).not.toBeNull();

    // Seed the uiStore geo-transform mirror (jsdom draws no canvas frame, so
    // the publish effect skips headless; seed it to prove sign-out clears it).
    act(() => {
      useUiStore.getState().setPuzzleGeoTransforms(
        new Map([["ds-a", { dLon: 0.1, dLat: -0.05, angleDeg: 15 }]]),
      );
    });

    // Sign out while the component stays MOUNTED — the scenario from the
    // cross-account disclosure review finding.
    await act(async () => {
      performSignOutCleanup();
    });

    // puzzleStore mirror: wiped.
    expect(usePuzzleStore.getState().puzzleTransforms).toEqual({});
    expect(usePuzzleStore.getState().puzzleMode).toBe(false);
    // Geo-transform mirror (3D marker geography): wiped.
    expect(useUiStore.getState().puzzleGeoTransforms.size).toBe(0);
    // Persisted layout: wiped.
    expect(sessionStorage.getItem("bathyscan:puzzleTransforms")).toBeNull();
    expect(localStorage.getItem("bathyscan:puzzleTransforms")).toBeNull();
    // LIVE component-local state: puzzle mode dropped and the puzzle toolbar
    // controls are gone — the previous account's canvas layout is no longer
    // rendered or re-mirrorable. This fails if the mounted instance does not
    // react to the sign-out signal.
    expect(screen.getByTestId("overview-puzzle-toggle").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("overview-puzzle-snap-toggle")).toBeNull();

    // And the wipe must not resurrect: a later store update carrying old
    // tiles would indicate the live component re-mirrored stale local state.
    const leaked: string[] = [];
    const unsubscribe = usePuzzleStore.subscribe((state) => {
      for (const id of ["ds-a", "ds-b"]) {
        if (id in state.puzzleTransforms) leaked.push(id);
      }
    });
    try {
      await act(async () => {});
    } finally {
      unsubscribe();
    }
    expect(leaked).toEqual([]);
  });
});
