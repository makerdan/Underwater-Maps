/**
 * terrainContextMenu.ts — shared builder + open-helper for the terrain
 * action menu (Drop GPS pin / Measure / Set as home / Depth profile /
 * Copy coordinates).
 *
 * Used by:
 *   - useFlyControls right-click + crosshair (Q / touch button) flows
 *   - touch long-press handler
 *   - unit tests
 *
 * Extracted out of useFlyControls so the same logic powers both the
 * unlocked right-click menu and the pointer-locked crosshair shortcut.
 */
import type { TerrainData } from "@workspace/api-client-react";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { useMeasureStore } from "@/lib/measureStore";
import { useDepthProfileStore, buildProfile } from "@/lib/depthProfileStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useSettingsStore } from "@/lib/settingsStore";
import {
  useContextMenuStore,
  type ContextMenuItem,
} from "@/lib/contextMenuStore";
import { haversineDistance } from "@/lib/geo";
import { toast } from "@/hooks/use-toast";

function copyToClipboard(text: string): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(text).catch(() => {
    // Best-effort; clipboard may be blocked by permissions
  });
}

function copyShareLink(): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  const url = window.location.href;
  navigator.clipboard
    .writeText(url)
    .then(() => {
      toast({
        title: "Link copied",
        description: "Share link copied to clipboard.",
        duration: 3000,
      });
    })
    .catch(() => {
      toast({
        title: "Copy failed",
        description: "Could not access clipboard. Copy the URL bar manually.",
        duration: 4000,
      });
    });
}

function formatCoords(lon: number, lat: number, depth: number): string {
  return `lat: ${lat.toFixed(5)}, lon: ${lon.toFixed(5)}, depth: ${Math.round(depth)}m`;
}

export function buildTerrainMenuItems(
  lon: number,
  lat: number,
  depth: number,
  datasetId: string,
  getTerrainGrid: () => TerrainData | null,
): ContextMenuItem[] {
  const measureAnchor = useMeasureStore.getState().anchorGps;
  const profileAnchor = useDepthProfileStore.getState().anchor;
  const items: ContextMenuItem[] = [
    {
      label: "Drop GPS pin here",
      icon: "📍",
      onClick: () => {
        useCameraStore.getState().setLastClickedGps({ lon, lat, depth });
        useUiStore.getState().setMarkerFormOpen(true);
      },
    },
    {
      label: measureAnchor ? "Measure to here" : "Measure from here",
      icon: "📏",
      onClick: () => {
        const ms = useMeasureStore.getState();
        if (ms.anchorGps) {
          const distanceKm = haversineDistance(
            { lon: ms.anchorGps.lon, lat: ms.anchorGps.lat },
            { lon, lat },
          );
          const depthDeltaM = depth - ms.anchorGps.depth;
          ms.setResult(distanceKm, depthDeltaM);
        } else {
          ms.setAnchor({ lon, lat, depth });
        }
      },
    },
    {
      label: "Set as home position",
      icon: "🏠",
      onClick: () => {
        if (datasetId) {
          useSettingsStore
            .getState()
            .setDatasetHome(datasetId, { lon, lat, depth });
        }
      },
      disabled: !datasetId,
    },
    {
      label: profileAnchor
        ? "End depth profile here"
        : "Start depth profile here",
      icon: "📈",
      onClick: () => {
        const store = useDepthProfileStore.getState();
        const grid = getTerrainGrid();
        if (store.anchor && grid) {
          const zoneMap = useClassificationStore.getState().zoneMap;
          const result = buildProfile(
            grid,
            store.anchor,
            { lon, lat, depth },
            zoneMap,
          );
          store.setProfile(result);
        } else {
          store.setAnchor({ lon, lat, depth });
        }
      },
    },
    ...(profileAnchor
      ? [
          {
            label: "Cancel depth profile",
            icon: "✖",
            onClick: () => useDepthProfileStore.getState().clearAnchor(),
          } as ContextMenuItem,
        ]
      : []),
    { label: "", onClick: () => {}, separator: true },
    {
      label: "Copy coordinates",
      icon: "📋",
      onClick: () => copyToClipboard(formatCoords(lon, lat, depth)),
    },
    {
      label: "Copy share link",
      icon: "🔗",
      onClick: () => copyShareLink(),
    },
  ];
  return items;
}

export interface OpenCrosshairMenuOptions {
  /** Viewport-space X to anchor the menu at (usually canvas centre). */
  centerX: number;
  /** Viewport-space Y to anchor the menu at (usually canvas centre). */
  centerY: number;
  /** Returns the active terrain grid, or null if no dataset is loaded. */
  getTerrainGrid: () => TerrainData | null;
  /**
   * Called before the menu is shown so the caller can release pointer
   * lock (only invoked when the menu will actually open).
   */
  exitPointerLock?: () => void;
}

/**
 * Open the terrain action menu anchored at the crosshair. No-ops (returns
 * false) when the crosshair isn't currently on terrain or no dataset is
 * loaded, so callers can wire the same helper to a key, button, or touch
 * trigger without worrying about empty-menu edge cases.
 */
export function openCrosshairContextMenu(
  opts: OpenCrosshairMenuOptions,
): boolean {
  const gps = useCameraStore.getState().crosshairGps;
  const grid = opts.getTerrainGrid();
  if (!gps || !grid) return false;
  opts.exitPointerLock?.();
  useContextMenuStore
    .getState()
    .show(
      opts.centerX,
      opts.centerY,
      buildTerrainMenuItems(
        gps.lon,
        gps.lat,
        gps.depth,
        grid.datasetId,
        opts.getTerrainGrid,
      ),
    );
  return true;
}
