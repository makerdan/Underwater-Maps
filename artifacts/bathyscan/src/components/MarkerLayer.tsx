/**
 * MarkerLayer — fetches all markers for every visible dataset and renders
 * a MarkerSprite for each one inside the Three.js scene.
 *
 * Multi-primary: fans out useGetMarkers across all visible datasets (up to
 * VISIBLE_DATASETS_CAP = 4) and merges results. Each marker is placed in the
 * primary coordinate frame using its geographic lon/lat.
 *
 * Must be rendered inside the R3F Canvas (inside SceneContents in TourScene).
 */
import React, { useEffect, useMemo } from "react";
import {
  useGetMarkers,
  getGetMarkersQueryKey,
  useGetCatches,
  getGetCatchesQueryKey,
} from "@workspace/api-client-react";
import type { Marker, CatchEntry } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useTerrainStore } from "@/lib/terrainStore";
import { MarkerSprite } from "./MarkerSprite";
import { useSettingsStore } from "@/lib/settingsStore";
import { useMarkerLayerStore } from "@/lib/markerLayerStore";
import { markerGroupRef } from "@/lib/markerGroupRef";

// ---------------------------------------------------------------------------
// Fixed-slot hooks (hooks cannot be called in loops in React).
// We pre-call useGetMarkers for each of the VISIBLE_DATASETS_CAP slots and
// enable only the slots that have a visible dataset.
// ---------------------------------------------------------------------------

function useAllDatasetMarkers(): Marker[] {
  const visible = useTerrainStore((s) => s.visibleDatasets);

  const id0 = visible[0]?.datasetId ?? "";
  const id1 = visible[1]?.datasetId ?? "";
  const id2 = visible[2]?.datasetId ?? "";
  const id3 = visible[3]?.datasetId ?? "";

  const { data: m0 } = useGetMarkers(
    { datasetId: id0 },
    { query: { enabled: !!id0, queryKey: getGetMarkersQueryKey({ datasetId: id0 }) } },
  );
  const { data: m1 } = useGetMarkers(
    { datasetId: id1 },
    { query: { enabled: !!id1, queryKey: getGetMarkersQueryKey({ datasetId: id1 }) } },
  );
  const { data: m2 } = useGetMarkers(
    { datasetId: id2 },
    { query: { enabled: !!id2, queryKey: getGetMarkersQueryKey({ datasetId: id2 }) } },
  );
  const maxActiveDatasets = useSettingsStore((s) => s.maxActiveDatasets ?? 3);
  const { data: m3 } = useGetMarkers(
    { datasetId: id3 },
    { query: { enabled: !!id3 && maxActiveDatasets >= 4, queryKey: getGetMarkersQueryKey({ datasetId: id3 }) } },
  );

  const merged: Marker[] = [
    ...(m0 ?? []),
    ...(m1 ?? []),
    ...(m2 ?? []),
    ...(m3 ?? []),
  ];
  // Deduplicate by marker id in case a dataset appears more than once
  // (shouldn't happen in practice but is a safe guard).
  const seen = new Set<string>();
  return merged.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/**
 * Fetch catch entries for every visible dataset (same fixed-slot pattern as
 * useAllDatasetMarkers) and group the distinct symbols per marker, insertion
 * order preserved. Used to render a row of catch symbols above each spot.
 */
export function useCatchSymbolsByMarker(): Map<string, string[]> {
  const visible = useTerrainStore((s) => s.visibleDatasets);
  const maxActiveDatasets = useSettingsStore((s) => s.maxActiveDatasets ?? 3);

  const id0 = visible[0]?.datasetId ?? "";
  const id1 = visible[1]?.datasetId ?? "";
  const id2 = visible[2]?.datasetId ?? "";
  const id3 = visible[3]?.datasetId ?? "";

  const { data: c0 } = useGetCatches(
    { datasetId: id0 },
    { query: { enabled: !!id0, queryKey: getGetCatchesQueryKey({ datasetId: id0 }) } },
  );
  const { data: c1 } = useGetCatches(
    { datasetId: id1 },
    { query: { enabled: !!id1, queryKey: getGetCatchesQueryKey({ datasetId: id1 }) } },
  );
  const { data: c2 } = useGetCatches(
    { datasetId: id2 },
    { query: { enabled: !!id2, queryKey: getGetCatchesQueryKey({ datasetId: id2 }) } },
  );
  const { data: c3 } = useGetCatches(
    { datasetId: id3 },
    { query: { enabled: !!id3 && maxActiveDatasets >= 4, queryKey: getGetCatchesQueryKey({ datasetId: id3 }) } },
  );

  return useMemo(() => {
    const all: CatchEntry[] = [
      ...(c0 ?? []),
      ...(c1 ?? []),
      ...(c2 ?? []),
      ...(c3 ?? []),
    ];
    return groupCatchSymbolsByMarker(all);
  }, [c0, c1, c2, c3]);
}

/**
 * Returns true when a marker's geographic coordinates fall within the primary
 * terrain's bounding box. Markers outside the bbox produce world XZ values
 * beyond ±50 and getTerrainSurfaceY would extrapolate rather than clamp —
 * suppressing them here is safer than rendering at an arbitrary off-edge position.
 * Exported for unit tests.
 */
export function isMarkerInBounds(
  marker: Pick<import("@workspace/api-client-react").Marker, "lon" | "lat">,
  terrain: Pick<import("@workspace/api-client-react").TerrainData, "minLon" | "maxLon" | "minLat" | "maxLat">,
): boolean {
  return (
    marker.lon >= terrain.minLon && marker.lon <= terrain.maxLon &&
    marker.lat >= terrain.minLat && marker.lat <= terrain.maxLat
  );
}

/**
 * Group catch symbols by markerId, one symbol per entry (duplicates kept —
 * two salmon entries render two salmon symbols), insertion order preserved.
 * Exported for unit tests.
 */
export function groupCatchSymbolsByMarker(entries: CatchEntry[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of entries) {
    const list = map.get(e.markerId) ?? [];
    list.push(e.symbol);
    if (!map.has(e.markerId)) map.set(e.markerId, list);
  }
  return map;
}

export const MarkerLayer: React.FC = () => {
  const { terrain } = useAppState();
  const visibleMarkerTypes = useSettingsStore((s) => s.visibleMarkerTypes);
  const showMarkerLabels = useSettingsStore((s) => s.showMarkerLabels);
  const clusterThreshold = useSettingsStore((s) => s.markerClusterThreshold);
  const setSubsampleState = useMarkerLayerStore((s) => s.setSubsampleState);
  const clear = useMarkerLayerStore((s) => s.clear);

  const markers = useAllDatasetMarkers();
  const catchSymbolsByMarker = useCatchSymbolsByMarker();

  const visibleMarkers = (!terrain || !markers.length)
    ? []
    : markers.filter(
        (m) => m.type === "depth_pole" || visibleMarkerTypes.includes(m.type as typeof visibleMarkerTypes[number]),
      ).filter((m) => {
        // Suppress markers whose geographic coordinates fall outside the primary
        // terrain's bounding box. Without this guard lonLatToWorldXZ produces
        // world X/Z values beyond ±50, and getTerrainSurfaceY extrapolates from
        // the nearest edge cell rather than returning a meaningful depth — the
        // marker would render at an arbitrary off-edge position.
        const inBounds = isMarkerInBounds(m, terrain);
        if (!inBounds && import.meta.env.DEV) {
          console.warn(
            `[MarkerLayer] marker ${m.id} suppressed: lon=${m.lon} lat=${m.lat} is outside terrain bbox ` +
            `[${terrain.minLon},${terrain.maxLon}]×[${terrain.minLat},${terrain.maxLat}]`,
          );
        }
        return inBounds;
      });

  // When the count of visible markers exceeds the user's cluster threshold,
  // subsample uniformly so the scene stays readable.
  let rendered = visibleMarkers;
  if (clusterThreshold > 0 && visibleMarkers.length > clusterThreshold) {
    const stride = Math.ceil(visibleMarkers.length / clusterThreshold);
    rendered = visibleMarkers.filter((_, i) => i % stride === 0);
  }

  // Publish subsampling state to the DOM-level HUD badge (outside R3F canvas).
  useEffect(() => {
    if (visibleMarkers.length === 0) {
      clear();
    } else {
      setSubsampleState(visibleMarkers.length, rendered.length);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clear and setSubsampleState are Zustand setters (stable refs)
  }, [visibleMarkers.length, rendered.length]);

  // Clear store when this component unmounts (dataset cleared etc.)
  useEffect(() => () => { clear(); }, [clear]);

  if (!terrain || !markers.length) return null;

  return (
    <group ref={(g) => { markerGroupRef.current = g; }}>
      {rendered.map((m) => (
        <MarkerSprite
          key={m.id}
          marker={m}
          terrain={terrain}
          showLabel={showMarkerLabels}
          catchSymbols={catchSymbolsByMarker.get(m.id)}
        />
      ))}
    </group>
  );
};
