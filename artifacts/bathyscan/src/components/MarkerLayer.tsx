/**
 * MarkerLayer — fetches all markers for the active dataset and renders
 * a MarkerSprite for each one inside the Three.js scene.
 *
 * Must be rendered inside the R3F Canvas (inside SceneContents in TourScene).
 */
import React from "react";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { MarkerSprite } from "./MarkerSprite";

export const MarkerLayer: React.FC = () => {
  const { terrain } = useAppState();
  const datasetId = terrain?.datasetId ?? "";

  const { data: markers } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  if (!terrain || !markers?.length) return null;

  return (
    <>
      {markers.map((m) => (
        <MarkerSprite key={m.id} marker={m} terrain={terrain} />
      ))}
    </>
  );
};
