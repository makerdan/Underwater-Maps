/**
 * MarkerLayer — fetches all markers for the active dataset and renders
 * a MarkerSprite for each one inside the Three.js scene.
 *
 * Must be rendered inside the R3F Canvas (inside SceneContents in TourScene).
 */
import React from "react";
import * as THREE from "three";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { MarkerSprite } from "./MarkerSprite";
import { useSettingsStore } from "@/lib/settingsStore";

/**
 * Module-level mutable ref to the marker group, consumed by useFlyControls
 * to raycast against marker meshes for right-click context menu detection.
 * Null when no markers are rendered.
 */
export const markerGroupRef: { current: THREE.Group | null } = { current: null };

export const MarkerLayer: React.FC = () => {
  const { terrain } = useAppState();
  const datasetId = terrain?.datasetId ?? "";
  const visibleMarkerTypes = useSettingsStore((s) => s.visibleMarkerTypes);
  const showMarkerLabels = useSettingsStore((s) => s.showMarkerLabels);
  const clusterThreshold = useSettingsStore((s) => s.markerClusterThreshold);

  const { data: markers } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  if (!terrain || !markers?.length) return null;

  const visibleMarkers = markers.filter(
    (m) => m.type === "depth_pole" || visibleMarkerTypes.includes(m.type as typeof visibleMarkerTypes[number]),
  );

  // When the count of visible markers exceeds the user's cluster threshold,
  // subsample uniformly so the scene stays readable. Picks every Nth marker
  // so the survivors remain spatially spread rather than head-biased.
  let rendered = visibleMarkers;
  if (clusterThreshold > 0 && visibleMarkers.length > clusterThreshold) {
    const stride = Math.ceil(visibleMarkers.length / clusterThreshold);
    rendered = visibleMarkers.filter((_, i) => i % stride === 0);
  }

  return (
    <group ref={(g) => { markerGroupRef.current = g; }}>
      {rendered.map((m) => (
        <MarkerSprite key={m.id} marker={m} terrain={terrain} showLabel={showMarkerLabels} />
      ))}
    </group>
  );
};
