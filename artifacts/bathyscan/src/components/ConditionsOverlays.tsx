/**
 * ConditionsOverlays — three always-on R3F overlays that visualise the
 * current wind, tide, and surface current as arrow fields across the scene.
 *
 * Each overlay subscribes to the same shared `useSurfaceConditions` hook so
 * the network call is deduped with Drift Planner.
 */
import React, { useMemo } from "react";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { useSurfaceConditions } from "@/hooks/useSurfaceConditions";
import { MAX_DEPTH_WORLD, WORLD_SIZE } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";
import { DirectionArrowField } from "@/components/DirectionArrowField";

/**
 * Build a sparse set of (worldX, worldZ) positions sampled from the shoreline
 * / shallow-water band — i.e. cells whose depth falls in the shallowest
 * fraction of the dataset range. Used to constrain the Tide overlay so its
 * arrows hug the coast where tidal flow actually matters most.
 */
function shorelineBandPositions(
  terrain: TerrainData,
  shallowFraction = 0.35,
  stride = 6,
): Array<[number, number]> {
  const { resolution: N, depths, minDepth, maxDepth } = terrain;
  const range = (maxDepth - minDepth) || 1;
  const cutoff = minDepth + range * shallowFraction;
  const cell = WORLD_SIZE / Math.max(1, N - 1);
  const half = WORLD_SIZE / 2;
  const out: Array<[number, number]> = [];
  for (let row = 0; row < N; row += stride) {
    for (let col = 0; col < N; col += stride) {
      const d = depths[row * N + col] ?? 0;
      if (d <= cutoff) {
        out.push([col * cell - half, row * cell - half]);
      }
    }
  }
  // Cap so we never explode instance count on huge grids.
  if (out.length > 256) {
    const step = Math.ceil(out.length / 256);
    return out.filter((_, i) => i % step === 0);
  }
  return out;
}

function seaSurfaceY(terrain: TerrainData): number {
  const depthRange = (terrain.maxDepth - terrain.minDepth) || 1;
  return (terrain.minDepth / depthRange) * MAX_DEPTH_WORLD;
}

// ---------------------------------------------------------------------------
// Beaufort-ish colour ramp for wind speed (knots).
// ---------------------------------------------------------------------------
export function windColor(knots: number): string {
  if (knots < 4) return "#7dd3fc";    // calm — light cyan
  if (knots < 11) return "#38bdf8";   // light breeze — sky blue
  if (knots < 17) return "#a3e635";   // moderate — lime
  if (knots < 22) return "#facc15";   // fresh — yellow
  if (knots < 28) return "#fb923c";   // strong — orange
  if (knots < 34) return "#f87171";   // near gale — red
  return "#e11d48";                    // gale+ — crimson
}

export const WindOverlay: React.FC = () => {
  const { terrain } = useAppState();
  const active = useUiStore((s) => s.windOverlayActive);
  const { snapshot, estimated, fallback } = useSurfaceConditions(active);

  if (!active || !terrain) return null;

  const speed = snapshot?.windSpeedKnots ?? fallback.windSpeedKnots;
  // Open-Meteo gives wind direction the wind is coming FROM. Flip 180° so
  // arrows point where it's blowing TOWARD (what users expect from a glance).
  const fromDeg = snapshot?.windDegrees ?? fallback.windDegrees;
  const towardDeg = (fromDeg + 180) % 360;
  // Wind arrows float a little above the sea surface so they are clearly
  // separated from current arrows below.
  const surfY = seaSurfaceY(terrain) + 3.0;

  return (
    <DirectionArrowField
      directionDeg={towardDeg}
      magnitude={Math.max(0.5, speed)}
      referenceMagnitude={12}
      color={windColor(speed)}
      layerY={surfY}
      density={6}
      baseScale={1.5}
      animate
      opacity={estimated ? 0.55 : 0.85}
      renderOrder={4}
    />
  );
};

export const TideOverlay: React.FC = () => {
  const { terrain } = useAppState();
  const active = useUiStore((s) => s.tideOverlayActive);
  const { snapshot, estimated, fallback } = useSurfaceConditions(active);

  // Constrain tide arrows to the shallow/shoreline band — tides drive flow
  // strongest where the bottom comes up, so this is where users want them.
  const positions = useMemo(
    () => (terrain ? shorelineBandPositions(terrain) : []),
    [terrain],
  );

  if (!active || !terrain || !positions.length) return null;

  const speed = snapshot?.tidalSpeedKnots ?? fallback.tidalSpeedKnots;
  const dir = snapshot?.tidalDegrees ?? fallback.tidalDegrees;
  const rising = snapshot?.tideRising ?? true;

  // Tide arrows sit just at the sea surface, slightly above current arrows.
  // Colour reflects rising (flood, green) vs falling (ebb, amber).
  const surfY = seaSurfaceY(terrain) + 1.2;
  const color = rising ? "#34d399" : "#fbbf24";

  return (
    <DirectionArrowField
      directionDeg={dir}
      magnitude={Math.max(0.3, speed)}
      referenceMagnitude={1.0}
      color={color}
      layerY={surfY}
      positions={positions}
      baseScale={1.3}
      animate
      opacity={estimated ? 0.5 : 0.8}
      renderOrder={3}
    />
  );
};

export const CurrentOverlay: React.FC = () => {
  const { terrain } = useAppState();
  const active = useUiStore((s) => s.currentOverlayActive);
  const { snapshot, estimated, fallback } = useSurfaceConditions(active);

  if (!active || !terrain) return null;

  const speed = snapshot?.tidalSpeedKnots ?? fallback.tidalSpeedKnots;
  const dir = snapshot?.tidalDegrees ?? fallback.tidalDegrees;

  // Current arrows live in mid-water so they read as sub-surface flow.
  const surfY = seaSurfaceY(terrain) - MAX_DEPTH_WORLD * 0.35;

  return (
    <DirectionArrowField
      directionDeg={dir}
      magnitude={Math.max(0.3, speed)}
      referenceMagnitude={1.0}
      color="#22d3ee"
      layerY={surfY}
      density={6}
      baseScale={1.3}
      animate
      opacity={estimated ? 0.5 : 0.75}
      renderOrder={2}
    />
  );
};

export const ConditionsOverlays: React.FC = () => (
  <>
    <WindOverlay />
    <TideOverlay />
    <CurrentOverlay />
  </>
);
