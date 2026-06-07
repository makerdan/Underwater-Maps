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
import React, { useEffect } from "react";
import * as THREE from "three";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import type { Marker } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useTerrainStore, VISIBLE_DATASETS_CAP } from "@/lib/terrainStore";
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
  const { data: m3 } = useGetMarkers(
    { datasetId: id3 },
    { query: { enabled: !!id3 && VISIBLE_DATASETS_CAP >= 4, queryKey: getGetMarkersQueryKey({ datasetId: id3 }) } },
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

export const MarkerLayer: React.FC = () => {
  const { terrain } = useAppState();
  const visibleMarkerTypes = useSettingsStore((s) => s.visibleMarkerTypes);
  const showMarkerLabels = useSettingsStore((s) => s.showMarkerLabels);
  const clusterThreshold = useSettingsStore((s) => s.markerClusterThreshold);
  const setSubsampleState = useMarkerLayerStore((s) => s.setSubsampleState);
  const clear = useMarkerLayerStore((s) => s.clear);

  const markers = useAllDatasetMarkers();

  const visibleMarkers = (!terrain || !markers.length)
    ? []
    : markers.filter(
        (m) => m.type === "depth_pole" || visibleMarkerTypes.includes(m.type as typeof visibleMarkerTypes[number]),
      );

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMarkers.length, rendered.length]);

  // Clear store when this component unmounts (dataset cleared etc.)
  useEffect(() => () => { clear(); }, [clear]);

  if (!terrain || !markers.length) return null;

  return (
    <group ref={(g) => { markerGroupRef.current = g; }}>
      {rendered.map((m) => (
        <MarkerSprite key={m.id} marker={m} terrain={terrain} showLabel={showMarkerLabels} />
      ))}
    </group>
  );
};
