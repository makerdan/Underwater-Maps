/**
 * TrailLayer — renders the active Live-session GPS trail in the 3D scene.
 *
 * Draws a decimated polyline slightly above the terrain surface so the
 * angler can see the path travelled this session alongside their catch
 * markers. Rendering rules:
 *  - Only shown while a trail session has points (recording or paused).
 *  - Points outside the active dataset bounds are skipped.
 *  - Decimated to MAX_RENDERED_TRAIL_POINTS via uniform index decimation.
 *  - Raycasting is disabled on the line so catch markers underneath the
 *    trail stay tappable.
 */
import React, { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { useTrailStore } from "@/lib/trailStore";
import { useAppState } from "@/lib/context";
import { lonLatToWorldXZ, getTerrainSurfaceY } from "@/lib/terrain";
import { decimateTrailPoints, MAX_RENDERED_TRAIL_POINTS } from "@/lib/trailDecimation";

/** World units above the terrain surface the trail floats. */
const TRAIL_Y_OFFSET = 0.35;

const TRAIL_COLOR = "#fb923c";

const noopRaycast = () => null;

export const TrailLayer: React.FC = () => {
  const currentPoints = useTrailStore((s) => s.currentPoints);
  const { terrain } = useAppState();

  const worldPoints = useMemo(() => {
    if (!terrain || currentPoints.length < 2) return null;
    const inBounds = currentPoints.filter(
      (p) =>
        p.lat >= terrain.minLat &&
        p.lat <= terrain.maxLat &&
        p.lon >= terrain.minLon &&
        p.lon <= terrain.maxLon,
    );
    if (inBounds.length < 2) return null;
    const decimated = decimateTrailPoints(inBounds, MAX_RENDERED_TRAIL_POINTS);
    return decimated.map((p) => {
      const { x, z } = lonLatToWorldXZ(p.lon, p.lat, terrain);
      const y = getTerrainSurfaceY(terrain, x, z) + TRAIL_Y_OFFSET;
      return new THREE.Vector3(x, y, z);
    });
  }, [currentPoints, terrain]);

  if (!worldPoints) return null;

  const head = worldPoints[worldPoints.length - 1]!;

  return (
    <group name="trail-layer">
      <Line
        points={worldPoints}
        color={TRAIL_COLOR}
        lineWidth={2.5}
        transparent
        opacity={0.85}
        raycast={noopRaycast}
      />
      {/* Head dot — the boat's most recent sampled position. */}
      <mesh position={head} raycast={noopRaycast}>
        <sphereGeometry args={[0.5, 12, 12]} />
        <meshBasicMaterial color={TRAIL_COLOR} transparent opacity={0.9} />
      </mesh>
    </group>
  );
};
