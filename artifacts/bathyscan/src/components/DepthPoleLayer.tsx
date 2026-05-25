/**
 * DepthPoleLayer — renders all depth-pole markers for the active dataset.
 *
 * Must be rendered inside the R3F Canvas (inside SceneContents in TourScene).
 * Also exports DepthPoleDomLabels — a plain HTML component that renders
 * hidden .depth-pole-label spans for accessibility and E2E testing.
 */
import React from "react";
import { useGetMarkers, getGetMarkersQueryKey } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { DepthPole } from "./DepthPole";
import { DEPTH_POLE_DEFAULT_COLOUR } from "@/lib/markerConstants";

// ---------------------------------------------------------------------------
// R3F component — lives inside <Canvas>
// ---------------------------------------------------------------------------
export const DepthPoleLayer: React.FC = () => {
  const { terrain } = useAppState();
  const datasetId = terrain?.datasetId ?? "";

  const { data: markers } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  if (!terrain || !markers?.length) return null;

  const poles = markers.filter((m) => m.type === "depth_pole");

  return (
    <>
      {poles.map((m) => (
        <DepthPole key={m.id} marker={m} terrain={terrain} />
      ))}
    </>
  );
};

// ---------------------------------------------------------------------------
// DOM overlay — lives outside <Canvas>
// Renders hidden spans so .depth-pole-label is queryable in E2E tests.
// ---------------------------------------------------------------------------
export const DepthPoleDomLabels: React.FC = () => {
  const { terrain } = useAppState();
  const datasetId = terrain?.datasetId ?? "";

  const { data: markers } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  const poles = (markers ?? []).filter((m) => m.type === "depth_pole");
  if (!poles.length) return null;

  return (
    <div aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      {poles.map((m) => {
        const depthStr = `\u2212${Math.abs(Math.round(m.depth)).toLocaleString()} m`;
        let colour = DEPTH_POLE_DEFAULT_COLOUR;
        try {
          const parsed = JSON.parse(m.notes ?? "{}") as Record<string, unknown>;
          if (typeof parsed["colour"] === "string") colour = parsed["colour"];
        } catch { /* ignored */ }
        return (
          <span
            key={m.id}
            className="depth-pole-label"
            data-id={m.id}
            data-colour={colour}
          >
            {depthStr}
          </span>
        );
      })}
    </div>
  );
};
