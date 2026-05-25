/**
 * Dev/test-only window exposure of internal Zustand stores so end-to-end
 * tests (Playwright) can drive the UI without going through the full
 * Clerk-authenticated 3D canvas + raycaster pipeline.
 *
 * Gated on `import.meta.env.DEV` so this code is tree-shaken out of
 * production builds.
 */
import { useContextMenuStore, type ContextMenuItem } from "./contextMenuStore";
import { useMeasureStore } from "./measureStore";
import { useMarkerDetailStore } from "./markerDetailStore";
import { useUiStore } from "./uiStore";
import { useCameraStore } from "./cameraStore";
import { useClassificationStore } from "./classificationStore";
import { haversineDistance } from "./geo";
import { queryClient } from "./queryClient";
import { runMarkerDelete, type DeleteMarkerMutation } from "./markerActions";
import {
  deleteMarkersId,
  getGetMarkersQueryKey,
  type Marker,
  type TerrainData,
} from "@workspace/api-client-react";
import { useDepthProfileStore, buildProfile } from "./depthProfileStore";

/** Small synthetic terrain grid used by e2e tests when no real dataset is
 *  loaded (no signed-in user). Depth ramps west→east 0→1000m so the profile
 *  has a non-zero MIN/MAX range. */
function syntheticTestGrid(): TerrainData {
  const N = 32;
  const depths: number[] = new Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      depths[r * N + c] = (c / (N - 1)) * 1000;
    }
  }
  return {
    datasetId: "e2e-synthetic",
    name: "e2e",
    waterType: "saltwater",
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: 0,
    maxDepth: 1000,
    minLon: -132.5,
    maxLon: -132.3,
    minLat: 55.9,
    maxLat: 56.1,
    centerLon: -132.4,
    centerLat: 56.0,
  } as unknown as TerrainData;
}

// AppContext-backed setter wired up by the in-tree <TestBridge/> component
// mounted inside <AppProvider/>. Without this, helpers have no way to reach
// React context state from a plain window-side call.
let appSetTerrain: ((t: TerrainData | null) => void) | null = null;
export function registerTestBridge(setTerrain: (t: TerrainData | null) => void): void {
  appSetTerrain = setTerrain;
}

export interface BathyTestApi {
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  hideContextMenu: () => void;
  showTerrainMenu: (
    x: number,
    y: number,
    point: { lon: number; lat: number; depth: number },
  ) => void;
  measureAnchor: (point: { lon: number; lat: number; depth: number }) => void;
  measureTo: (point: { lon: number; lat: number; depth: number }) => void;
  clearMeasurement: () => void;
  showMarkerDetail: (marker: {
    id: string;
    lon: number;
    lat: number;
    depth: number;
    label: string;
  }) => void;
  hideMarkerDetail: () => void;
  getMeasurementResult: () =>
    | { distanceKm: number; depthDeltaM: number }
    | null;
  setOverviewOpen: (open: boolean) => void;
  isOverviewOpen: () => boolean;
  getPendingDropIn: () => { worldX: number; worldZ: number } | null;
  clearPendingDropIn: () => void;
  /**
   * Seed the React Query marker-list cache for a dataset so tests can assert
   * on cache invalidation without going through a full GET round-trip.
   */
  seedMarkerCache: (datasetId: string, markers: Marker[]) => void;
  /**
   * Snapshot of the React Query marker-list cache for a dataset (or null if
   * none is set).
   */
  getMarkerCache: (datasetId: string) => Marker[] | null;
  /**
   * Returns the `dataUpdatedAt` of the marker-list query, or 0 if absent.
   * Tests use this to detect invalidation/refetch independent of cache value.
   */
  getMarkerCacheUpdatedAt: (datasetId: string) => number;
  /**
   * Returns whether the marker-list query for the dataset has been
   * invalidated (stale). Tests use this to verify dataset-scoped cache
   * invalidation after delete.
   */
  isMarkerCacheInvalidated: (datasetId: string) => boolean;
  /**
   * Render a production-shaped marker context menu whose "Delete marker"
   * onClick fires the REAL `deleteMarkersId` request and the REAL
   * `runMarkerDelete` cache-invalidation path (same code as
   * `useFlyControls.buildMarkerMenuItems`). `capturedDatasetId` mirrors what
   * `terrainRef.current?.datasetId` would resolve to at click time.
   */
  showProductionMarkerMenu: (
    x: number,
    y: number,
    marker: Marker,
    capturedDatasetId: string,
  ) => void;
  /**
   * Configure headers that the dev-only production-menu Delete handler
   * forwards to `deleteMarkersId`. In end-to-end tests this is set to the
   * api-server's `E2E_AUTH_BYPASS` header (`x-e2e-user-id`) so the real
   * auth-gated route is exercised without a Clerk session in the browser.
   */
  setRequestHeaders: (headers: Record<string, string>) => void;
  /**
   * Zone classification helpers (paint mode coverage).
   *
   * The browser's WebGL stack in headless CI doesn't reliably support
   * react-three-fiber raycasting, so e2e tests drive the underlying
   * classification store directly instead of simulating a 3D pointer drag
   * on the terrain canvas. The store action invoked here (`paintSlot`) is
   * the same one TerrainMesh.tsx's pointer handlers call, so this faithfully
   * exercises the paint-mode write path.
   */
  seedTerrain: (overrides?: Partial<TerrainData>) => boolean;
  seedZoneMap: (resolution: number, fillZone?: number) => void;
  paintZone: (
    row: number,
    col: number,
    radius: number,
    slot: 0 | 1 | 2 | 3,
    waterType: "saltwater" | "freshwater",
    resolution: number,
  ) => void;
  resetZonesToAi: () => void;
  getZoneSnapshot: () => {
    length: number;
    hasEdits: boolean;
    hash: string;
    sample: number[];
  } | null;
  showDepthProfileTerrainMenu: (
    x: number,
    y: number,
    point: { lon: number; lat: number; depth: number },
  ) => void;
  clearDepthProfile: () => void;
  getDepthProfileSummary: () =>
    | { points: number; totalDistanceM: number; minDepthM: number; maxDepthM: number }
    | null;
}

declare global {
  interface Window {
    __bathyTest?: BathyTestApi;
  }
}

export function installTestHelpers(): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;

  const buildDepthProfileTerrainMenuItems = (
    lon: number,
    lat: number,
    depth: number,
  ): ContextMenuItem[] => {
    const profileAnchor = useDepthProfileStore.getState().anchor;
    const items: ContextMenuItem[] = [
      {
        label: profileAnchor
          ? "End depth profile here"
          : "Start depth profile here",
        icon: "📈",
        onClick: () => {
          const store = useDepthProfileStore.getState();
          if (store.anchor) {
            const grid = syntheticTestGrid();
            const result = buildProfile(
              grid,
              store.anchor,
              { lon, lat, depth },
              null,
            );
            store.setProfile(result);
          } else {
            store.setAnchor({ lon, lat, depth });
          }
        },
      },
    ];
    if (profileAnchor) {
      items.push({
        label: "Cancel depth profile",
        icon: "✖",
        onClick: () => useDepthProfileStore.getState().clearAnchor(),
      });
    }
    return items;
  };

  const buildTerrainMenuItems = (
    lon: number,
    lat: number,
    depth: number,
  ): ContextMenuItem[] => {
    const anchor = useMeasureStore.getState().anchorGps;
    return [
      {
        label: "Drop GPS pin here",
        icon: "📍",
        onClick: () => {
          useCameraStore.getState().setLastClickedGps({ lon, lat, depth });
          useUiStore.getState().setMarkerFormOpen(true);
        },
      },
      {
        label: anchor ? "Measure to here" : "Measure from here",
        icon: "📏",
        onClick: () => {
          const ms = useMeasureStore.getState();
          if (ms.anchorGps) {
            const distanceKm = haversineDistance(
              { lon: ms.anchorGps.lon, lat: ms.anchorGps.lat },
              { lon, lat },
            );
            ms.setResult(distanceKm, depth - ms.anchorGps.depth);
          } else {
            ms.setAnchor({ lon, lat, depth });
          }
        },
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: "Copy coordinates",
        icon: "📋",
        onClick: () => {
          /* no-op in tests */
        },
      },
    ];
  };

  let requestHeaders: Record<string, string> = {};

  const buildProductionMarkerMenuItems = (
    marker: Marker,
    capturedDatasetId: string,
  ): ContextMenuItem[] => [
    { label: "Fly to marker", icon: "✈️", onClick: () => {} },
    {
      label: "View details",
      icon: "ℹ️",
      onClick: () => useMarkerDetailStore.getState().show(marker),
    },
    { label: "Copy coordinates", icon: "📋", onClick: () => {} },
    { label: "", onClick: () => {}, separator: true },
    {
      label: "Delete marker",
      icon: "🗑️",
      onClick: () => {
        // Mirror useFlyControls.buildMarkerMenuItems: real DELETE +
        // dataset-scoped query-cache invalidation through the same
        // runMarkerDelete helper that production code uses.
        runMarkerDelete({
          marker,
          datasetId: capturedDatasetId,
          queryClient,
          mutation: {
            mutate: ((vars: { id: string }, opts?: {
              onSuccess?: (...args: unknown[]) => void;
              onError?: (...args: unknown[]) => void;
            }) => {
              void deleteMarkersId(vars.id, { headers: requestHeaders })
                .then((res) => opts?.onSuccess?.(res, vars, {}, {}))
                .catch((err) => opts?.onError?.(err, vars, {}, {}));
            }) as unknown as DeleteMarkerMutation["mutate"],
          },
        });
      },
    },
  ];

  window.__bathyTest = {
    showContextMenu: (x, y, items) =>
      useContextMenuStore.getState().show(x, y, items),
    hideContextMenu: () => useContextMenuStore.getState().hide(),
    seedMarkerCache: (datasetId, markers) => {
      queryClient.setQueryData(getGetMarkersQueryKey({ datasetId }), markers);
    },
    getMarkerCache: (datasetId) =>
      queryClient.getQueryData<Marker[]>(
        getGetMarkersQueryKey({ datasetId }),
      ) ?? null,
    getMarkerCacheUpdatedAt: (datasetId) =>
      queryClient.getQueryState(getGetMarkersQueryKey({ datasetId }))
        ?.dataUpdatedAt ?? 0,
    isMarkerCacheInvalidated: (datasetId) =>
      queryClient.getQueryState(getGetMarkersQueryKey({ datasetId }))
        ?.isInvalidated ?? false,
    showProductionMarkerMenu: (x, y, marker, capturedDatasetId) =>
      useContextMenuStore
        .getState()
        .show(x, y, buildProductionMarkerMenuItems(marker, capturedDatasetId)),
    setRequestHeaders: (headers) => {
      requestHeaders = { ...headers };
    },
    showTerrainMenu: (x, y, point) =>
      useContextMenuStore
        .getState()
        .show(x, y, buildTerrainMenuItems(point.lon, point.lat, point.depth)),
    measureAnchor: (point) => useMeasureStore.getState().setAnchor(point),
    measureTo: (point) => {
      const ms = useMeasureStore.getState();
      if (!ms.anchorGps) {
        ms.setAnchor(point);
        return;
      }
      const distanceKm = haversineDistance(
        { lon: ms.anchorGps.lon, lat: ms.anchorGps.lat },
        { lon: point.lon, lat: point.lat },
      );
      ms.setResult(distanceKm, point.depth - ms.anchorGps.depth);
    },
    clearMeasurement: () => {
      useMeasureStore.getState().clearAnchor();
      useMeasureStore.getState().clearResult();
    },
    showMarkerDetail: (marker) =>
      useMarkerDetailStore.getState().show(marker as never),
    hideMarkerDetail: () => useMarkerDetailStore.getState().hide(),
    getMeasurementResult: () => {
      const r = useMeasureStore.getState().result;
      return r ? { distanceKm: r.distanceKm, depthDeltaM: r.depthDeltaM } : null;
    },
    setOverviewOpen: (open) => useUiStore.getState().setOverviewOpen(open),
    isOverviewOpen: () => useUiStore.getState().overviewOpen,
    getPendingDropIn: () => useUiStore.getState().pendingDropIn,
    clearPendingDropIn: () => useUiStore.getState().clearPendingDropIn(),
    seedTerrain: (overrides) => {
      if (!appSetTerrain) return false;
      const resolution = overrides?.resolution ?? 64;
      const N = resolution * resolution;
      const depths = overrides?.depths ?? new Array(N).fill(10);
      const base: TerrainData = {
        datasetId: "e2e-test",
        name: "E2E Test Dataset",
        waterType: "saltwater",
        resolution,
        width: resolution,
        height: resolution,
        depths: depths as number[],
        minDepth: 0,
        maxDepth: 20,
        minLon: -1,
        maxLon: 1,
        minLat: -1,
        maxLat: 1,
        centerLon: 0,
        centerLat: 0,
        ...overrides,
      };
      appSetTerrain(base);
      return true;
    },
    seedZoneMap: (resolution, fillZone = 0) => {
      const N = resolution * resolution;
      const zoneMap = new Uint8Array(N);
      if (fillZone !== 0) zoneMap.fill(fillZone);
      useClassificationStore.setState({
        zoneMap,
        aiZoneMap: new Uint8Array(zoneMap),
        hasEdits: false,
        loading: false,
        error: null,
        currentGridHash: "e2etest0",
      });
    },
    paintZone: (row, col, radius, slot, waterType, resolution) => {
      useClassificationStore
        .getState()
        .paintSlot(row, col, radius, slot, waterType, resolution);
    },
    resetZonesToAi: () => {
      useClassificationStore.getState().resetToAi();
    },
    getZoneSnapshot: () => {
      const s = useClassificationStore.getState();
      const zm = s.zoneMap;
      if (!zm) return null;
      let h = 0x811c9dc5;
      for (let i = 0; i < zm.length; i++) {
        h ^= zm[i] ?? 0;
        h = (Math.imul(h, 0x01000193) >>> 0);
      }
      const hash = (h >>> 0).toString(16).padStart(8, "0");
      const sample: number[] = [];
      const step = Math.max(1, Math.floor(zm.length / 16));
      for (let i = 0; i < zm.length; i += step) sample.push(zm[i] ?? 0);
      return { length: zm.length, hasEdits: s.hasEdits, hash, sample };
    },
    showDepthProfileTerrainMenu: (x, y, point) =>
      useContextMenuStore
        .getState()
        .show(
          x,
          y,
          buildDepthProfileTerrainMenuItems(point.lon, point.lat, point.depth),
        ),
    clearDepthProfile: () => {
      useDepthProfileStore.getState().clearAnchor();
      useDepthProfileStore.getState().clearProfile();
    },
    getDepthProfileSummary: () => {
      const p = useDepthProfileStore.getState().profile;
      return p
        ? {
            points: p.points.length,
            totalDistanceM: p.totalDistanceM,
            minDepthM: p.minDepthM,
            maxDepthM: p.maxDepthM,
          }
        : null;
    },
  };
}
