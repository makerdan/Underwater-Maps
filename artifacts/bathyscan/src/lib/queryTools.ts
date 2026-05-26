/**
 * queryTools — client-side tool executor for natural-language terrain queries.
 *
 * Each tool reads from/writes to Zustand stores:
 *   terrainStore    — activeGrid (read)
 *   uiStore         — pendingDropIn, overviewOpen (write)
 *   cameraStore     — cameraLon/Lat/Depth (read)
 *   classificationStore — zoneMap (read)
 *   highlightStore  — setHighlight / clearHighlight (write)
 *
 * executeTool(name, args, opts) is the single dispatcher called by QueryPanel.
 * opts.setDatasetId is passed in because dataset state lives in AppContext.
 */
import { useTerrainStore }       from "./terrainStore";
import { requestDatasetSwitch }   from "./simulatedDataStore";
import { useUiStore }             from "./uiStore";
import { useCameraStore }         from "./cameraStore";
import { useClassificationStore } from "./classificationStore";
import { useHighlightStore }      from "./highlightStore";
import { computeStatistic, lonLatToWorldXZ } from "./terrain";
import {
  SALTWATER_ZONES,
  FRESHWATER_ZONES,
  SALTWATER_ZONE_TO_SLOT,
  FRESHWATER_ZONE_TO_SLOT,
} from "./zoneMap";
import type { StatMetric } from "./terrain";

export interface ToolOptions {
  /** Switch the active dataset — comes from AppContext so is injected by QueryPanel. */
  setDatasetId: (id: string | null) => void;
  /** Called when showStatistic produces a human-readable result to display. */
  onStatResult: (text: string) => void;
  /** Called when describeCurrentLocation generates a description. */
  onDescription: (text: string) => void;
}

// ---------------------------------------------------------------------------
// Individual tool implementations
// ---------------------------------------------------------------------------

function navigateTo(args: { lon: number; lat: number }): string {
  const { activeGrid } = useTerrainStore.getState();
  if (!activeGrid) return "No terrain loaded.";
  const { x, z } = lonLatToWorldXZ(args.lon, args.lat, activeGrid);
  useUiStore.getState().setPendingDropIn({ worldX: x, worldZ: z });
  return `Navigating to lon=${args.lon.toFixed(4)}, lat=${args.lat.toFixed(4)}.`;
}

function navigateToDeepestPoint(): string {
  const { activeGrid } = useTerrainStore.getState();
  if (!activeGrid) return "No terrain loaded.";
  const result = computeStatistic("deepest_coordinates", activeGrid);
  if (typeof result === "number") return "Could not compute deepest point.";
  const { x, z } = lonLatToWorldXZ(result.lon, result.lat, activeGrid);
  useUiStore.getState().setPendingDropIn({ worldX: x, worldZ: z });
  const depth = computeStatistic("max_depth", activeGrid);
  return `Navigating to deepest point (${(depth as number).toFixed(0)} m) at lon=${result.lon.toFixed(4)}, lat=${result.lat.toFixed(4)}.`;
}

function navigateToShallowPoint(): string {
  const { activeGrid } = useTerrainStore.getState();
  if (!activeGrid) return "No terrain loaded.";
  const result = computeStatistic("shallowest_coordinates", activeGrid);
  if (typeof result === "number") return "Could not compute shallowest point.";
  const { x, z } = lonLatToWorldXZ(result.lon, result.lat, activeGrid);
  useUiStore.getState().setPendingDropIn({ worldX: x, worldZ: z });
  const depth = computeStatistic("min_depth", activeGrid);
  return `Navigating to shallowest point (${(depth as number).toFixed(0)} m) at lon=${result.lon.toFixed(4)}, lat=${result.lat.toFixed(4)}.`;
}

function highlightDepthRange(args: { minMetres: number; maxMetres: number }): string {
  useHighlightStore.getState().setHighlight("depthRange", {
    min: args.minMetres,
    max: args.maxMetres,
  });
  return `Highlighting depths ${args.minMetres.toFixed(0)}–${args.maxMetres.toFixed(0)} m.`;
}

function highlightSlope(args: { minDegrees: number; maxDegrees: number }): string {
  useHighlightStore.getState().setHighlight("slope", {
    min: args.minDegrees,
    max: args.maxDegrees,
  });
  return `Highlighting slopes ${args.minDegrees.toFixed(0)}°–${args.maxDegrees.toFixed(0)}°.`;
}

function highlightZone(args: { zone: string }): string {
  const { activeGrid } = useTerrainStore.getState();
  const waterType = activeGrid?.waterType ?? "saltwater";
  const isFresh = waterType === "freshwater";
  const zones     = isFresh ? FRESHWATER_ZONES     : SALTWATER_ZONES;
  const zoneToSlot = isFresh ? FRESHWATER_ZONE_TO_SLOT : SALTWATER_ZONE_TO_SLOT;
  const zoneIndex = (zones as readonly string[]).indexOf(args.zone);
  if (zoneIndex === -1) {
    return `Unknown zone "${args.zone}". Available: ${zones.join(", ")}.`;
  }
  const slot = zoneToSlot[zoneIndex] ?? 0;
  useHighlightStore.getState().setHighlight("zone", {
    min: slot,
    max: slot,
    zoneName: args.zone,
  });
  return `Highlighting zone: ${args.zone}.`;
}

function showStatistic(args: { metric: string }, opts: ToolOptions): string {
  const { activeGrid } = useTerrainStore.getState();
  if (!activeGrid) return "No terrain loaded.";
  const metric = args.metric as StatMetric;
  const result = computeStatistic(metric, activeGrid);

  let text: string;
  if (typeof result === "number") {
    const label = metric.replace(/_/g, " ");
    if (metric === "area_km2") {
      text = `${label}: ${result.toFixed(2)} km²`;
    } else if (metric === "slope_mean") {
      text = `${label}: ${result.toFixed(1)}°`;
    } else {
      text = `${label}: ${result.toFixed(1)} m`;
    }
  } else {
    text = `${metric.replace(/_/g, " ")}: lon=${result.lon.toFixed(4)}, lat=${result.lat.toFixed(4)}`;
  }
  opts.onStatResult(text);
  return text;
}

function describeCurrentLocation(opts: ToolOptions): string {
  const cam = useCameraStore.getState();
  const { activeGrid } = useTerrainStore.getState();
  const lon = cam.cameraLon;
  const lat = cam.cameraLat;
  const depth = cam.cameraDepth;

  const parts: string[] = [];
  if (lon != null && lat != null) {
    parts.push(`lon=${lon.toFixed(4)}, lat=${lat.toFixed(4)}`);
  }
  if (depth != null) parts.push(`depth=${depth.toFixed(0)} m`);
  if (activeGrid) {
    parts.push(`dataset: ${activeGrid.name ?? activeGrid.datasetId}`);
  }

  const zoneMap = useClassificationStore.getState().zoneMap;
  if (zoneMap && activeGrid && lon != null && lat != null) {
    const N = activeGrid.resolution;
    const col = Math.round(((lon - activeGrid.minLon) / (activeGrid.maxLon - activeGrid.minLon)) * (N - 1));
    const row = Math.round(((lat - activeGrid.minLat) / (activeGrid.maxLat - activeGrid.minLat)) * (N - 1));
    const idx = Math.max(0, Math.min(N * N - 1, row * N + col));
    const zoneIdx = zoneMap[idx] ?? 0;
    parts.push(`zone index: ${zoneIdx}`);
  }

  const desc = parts.join(", ");
  opts.onDescription(desc);
  return `Current location: ${desc}`;
}

function clearHighlights(): string {
  useHighlightStore.getState().clearHighlight();
  return "Highlights cleared.";
}

function openOverview(): string {
  useUiStore.getState().setOverviewOpen(true);
  return "Opening overview map.";
}

function switchDataset(args: { datasetId: string }, opts: ToolOptions): string {
  void requestDatasetSwitch({
    datasetId: args.datasetId,
    onConfirm: () => opts.setDatasetId(args.datasetId),
  });
  return `Switching to dataset: ${args.datasetId}.`;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function executeTool(
  name: string,
  args: Record<string, unknown>,
  opts: ToolOptions,
): string {
  try {
    switch (name) {
      case "navigateTo":
        return navigateTo(args as { lon: number; lat: number });
      case "navigateToDeepestPoint":
        return navigateToDeepestPoint();
      case "navigateToShallowPoint":
        return navigateToShallowPoint();
      case "highlightDepthRange":
        return highlightDepthRange(args as { minMetres: number; maxMetres: number });
      case "highlightSlope":
        return highlightSlope(args as { minDegrees: number; maxDegrees: number });
      case "highlightZone":
        return highlightZone(args as { zone: string });
      case "showStatistic":
        return showStatistic(args as { metric: string }, opts);
      case "describeCurrentLocation":
        return describeCurrentLocation(opts);
      case "clearHighlights":
        return clearHighlights();
      case "openOverview":
        return openOverview();
      case "switchDataset":
        return switchDataset(args as { datasetId: string }, opts);
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : "unknown"}`;
  }
}
