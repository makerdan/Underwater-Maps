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
import { haversineDistance } from "./geo";
import { queryClient } from "./queryClient";
import { runMarkerDelete, type DeleteMarkerMutation } from "./markerActions";
import {
  deleteMarkersId,
  getGetMarkersQueryKey,
  type Marker,
} from "@workspace/api-client-react";

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
}

declare global {
  interface Window {
    __bathyTest?: BathyTestApi;
  }
}

export function installTestHelpers(): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;

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
  };
}
