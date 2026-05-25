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

/**
 * Module-level mutable ref to the marker group, consumed by useFlyControls
 * to raycast against marker meshes for right-click context menu detection.
 * Null when no markers are rendered.
 */
export const markerGroupRef: { current: THREE.Group | null } = { current: null };

export const MarkerLayer: React.FC = () => {
  const { terrain } = useAppState();
  const datasetId = terrain?.datasetId ?? "";

  const { data: markers } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  if (!terrain || !markers?.length) return null;

  return (
    <group ref={(g) => { markerGroupRef.current = g; }}>
      {markers.map((m) => (
        <MarkerSprite key={m.id} marker={m} terrain={terrain} />
      ))}
    </group>
  );
};
