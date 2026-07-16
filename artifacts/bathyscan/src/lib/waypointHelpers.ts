/**
 * Pure helpers for the OverviewMap waypoint tool.
 *
 * Extracted from OverviewMap.tsx so they can be unit-tested independently
 * of the React component and canvas rendering.
 */

import type { TerrainData } from "@workspace/api-client-react";
import { lonLatToWorldXZ } from "@/lib/terrain";

export interface Waypoint {
  id: string;
  lon: number;
  lat: number;
  label: string;
}

/**
 * Pure reducer that mirrors `setWaypoints((prev) => [...prev, newWp])`
 * in OverviewMap.tsx's waypointMode click handler.
 *
 * Stores lon/lat only — no world-coordinate projection occurs here,
 * so no camera teleport can happen on waypoint append.
 */
export function appendWaypoint(prev: Waypoint[], lon: number, lat: number): Waypoint[] {
  const newWp: Waypoint = {
    id: Math.random().toString(36).slice(2),
    lon,
    lat,
    label: String(prev.length + 1),
  };
  return [...prev, newWp];
}

/**
 * Computes the ordered list of camera drop-in targets for a fly-through.
 *
 * Mirrors the projection loop inside `flyThroughWaypoints` in OverviewMap.tsx.
 * Returns [] when there are fewer than 2 waypoints (matching the production guard).
 */
export function planFlyThroughStops(
  waypoints: Waypoint[],
  overviewGrid: TerrainData,
): Array<{ worldX: number; worldZ: number }> {
  if (waypoints.length < 2) return [];
  return waypoints.map((wp) => {
    const { x: worldX, z: worldZ } = lonLatToWorldXZ(wp.lon, wp.lat, overviewGrid);
    return { worldX, worldZ };
  });
}
