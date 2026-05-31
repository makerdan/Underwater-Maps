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
import { useSettingsStore } from "@/lib/settingsStore";

export type DepthLayer = "surface" | "mid" | "near-bottom";

interface TidalCurrentArrowsProps {
  currentDirection: number;
  currentSpeed: number;
  surfaceY: number;
  depthLayer: DepthLayer;
  terrain: TerrainData;
}

const DENSITY_MAP: Record<string, number> = {
  sparse: 6,
  normal: 10,
  dense: 16,
};

const LAYER_OPACITY: Record<DepthLayer, number> = {
  surface: 0.75,
  mid: 0.88,
  "near-bottom": 0.92,
};

const LAYER_BASE_SCALE: Record<DepthLayer, number> = {
  surface: 1.2,
  mid: 1.45,
  "near-bottom": 1.6,
};

export const LAYER_OFFSETS: Record<DepthLayer, number> = {
  surface: 0,
  mid: -MAX_DEPTH_WORLD * 0.4,
  "near-bottom": -MAX_DEPTH_WORLD * 0.8,
};

export const LAYER_SPEED_ATTENUATE: Record<DepthLayer, number> = {
  surface: 1.0,
  mid: 0.6,
  "near-bottom": 0.25,
};

/** Distinguishable per-layer colours for the always-on Current overlay. */
export const LAYER_COLORS: Record<DepthLayer, string> = {
  surface: "#22d3ee",      // cyan — surface drift
  mid: "#38bdf8",          // sky blue — mid-water
  "near-bottom": "#818cf8", // indigo — near-bottom
};

export const LAYER_LABEL: Record<DepthLayer, string> = {
  surface: "Surface",
  mid: "Mid",
  "near-bottom": "Near-bottom",
};

export const TidalCurrentArrows: React.FC<TidalCurrentArrowsProps> = ({
  currentDirection,
  currentSpeed,
  surfaceY,
  depthLayer,
}) => {
  const yOffset = LAYER_OFFSETS[depthLayer] ?? 0;
  const attenuate = LAYER_SPEED_ATTENUATE[depthLayer] ?? 1.0;
  const arrowDensity = useSettingsStore((s) => s.currentArrowDensity);
  const density = DENSITY_MAP[arrowDensity] ?? 10;
  const layerOpacity = LAYER_OPACITY[depthLayer] ?? 0.75;
  const layerBaseScale = LAYER_BASE_SCALE[depthLayer] ?? 1.2;

  return (
    <DirectionArrowField
      directionDeg={currentDirection}
      magnitude={Math.max(0.2, currentSpeed * attenuate)}
      referenceMagnitude={1.0}
      color="#38bdf8"
      layerY={surfaceY + yOffset}
      density={density}
      baseScale={layerBaseScale}
      animate
      opacity={layerOpacity}
      renderOrder={3}
    />
  );
};
