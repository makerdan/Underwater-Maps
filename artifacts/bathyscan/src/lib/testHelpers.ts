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

  window.__bathyTest = {
    showContextMenu: (x, y, items) =>
      useContextMenuStore.getState().show(x, y, items),
    hideContextMenu: () => useContextMenuStore.getState().hide(),
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
