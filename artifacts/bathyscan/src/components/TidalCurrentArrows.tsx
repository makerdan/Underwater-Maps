/**
 * TidalCurrentArrows — Drift Planner's depth-stratified tidal current arrows.
 *
 * Thin wrapper around the shared `DirectionArrowField` primitive so the
 * Drift Planner and the always-on Current overlay render with identical
 * geometry, animation, and zoom-aware scaling.
 */
import React from "react";
import { MAX_DEPTH_WORLD } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";
import { DirectionArrowField } from "@/components/DirectionArrowField";

export type DepthLayer = "surface" | "mid" | "near-bottom";

interface TidalCurrentArrowsProps {
  currentDirection: number;
  currentSpeed: number;
  surfaceY: number;
  depthLayer: DepthLayer;
  terrain: TerrainData;
}

const LAYER_OFFSETS: Record<DepthLayer, number> = {
  surface: 0,
  mid: -MAX_DEPTH_WORLD * 0.4,
  "near-bottom": -MAX_DEPTH_WORLD * 0.8,
};

const LAYER_SPEED_ATTENUATE: Record<DepthLayer, number> = {
  surface: 1.0,
  mid: 0.6,
  "near-bottom": 0.25,
};

export const TidalCurrentArrows: React.FC<TidalCurrentArrowsProps> = ({
  currentDirection,
  currentSpeed,
  surfaceY,
  depthLayer,
}) => {
  const yOffset = LAYER_OFFSETS[depthLayer] ?? 0;
  const attenuate = LAYER_SPEED_ATTENUATE[depthLayer] ?? 1.0;

  return (
    <DirectionArrowField
      directionDeg={currentDirection}
      magnitude={Math.max(0.2, currentSpeed * attenuate)}
      referenceMagnitude={1.0}
      color="#38bdf8"
      layerY={surfaceY + yOffset}
      density={6}
      baseScale={1.2}
      animate
      opacity={0.75}
      renderOrder={3}
    />
  );
};
