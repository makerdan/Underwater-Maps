/**
 * MarkerSprite — a billboard (always-facing-camera) 3D marker in the scene.
 *
 * Position is computed from lon/lat (world XZ) and terrain grid depth (world Y),
 * floating 1.5 units above the surface. Renders a coloured disc + label text.
 */
import React from "react";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import type { Marker, TerrainData } from "@workspace/api-client-react";
import { lonLatToWorldXZ, MAX_DEPTH_WORLD } from "@/lib/terrain";
import { MARKER_COLOR, MARKER_ICON } from "@/lib/markerConstants";

interface Props {
  marker: Marker;
  terrain: TerrainData;
}

/** Look up the terrain Y world position for a lon/lat pair. */
function terrainWorldY(lon: number, lat: number, grid: TerrainData): number {
  const { resolution: N, depths, minDepth, maxDepth } = grid;
  const depthRange = maxDepth - minDepth || 1;
  const lonRange = grid.maxLon - grid.minLon || 1;
  const latRange = grid.maxLat - grid.minLat || 1;
  const col = Math.round(((lon - grid.minLon) / lonRange) * (N - 1));
  const row = Math.round(((lat - grid.minLat) / latRange) * (N - 1));
  const ci = Math.max(0, Math.min(N - 1, col));
  const ri = Math.max(0, Math.min(N - 1, row));
  const depth = depths[ri * N + ci] ?? minDepth;
  const t = Math.max(0, Math.min(1, (depth - minDepth) / depthRange));
  return -t * MAX_DEPTH_WORLD + 1.5; // float 1.5 units above surface
}

export const MarkerSprite: React.FC<Props> = ({ marker, terrain }) => {
  // Depth poles are rendered by DepthPoleLayer, not as sprites
  if (marker.type === "depth_pole") return null;

  const { x, z } = lonLatToWorldXZ(marker.lon, marker.lat, terrain);
  const y = terrainWorldY(marker.lon, marker.lat, terrain);
  const color = MARKER_COLOR[marker.type] ?? "#e2e8f0";
  const icon = MARKER_ICON[marker.type] ?? "●";

  return (
    <Billboard position={[x, y, z]}>
      {/* Glowing disc */}
      <mesh>
        <circleGeometry args={[0.4, 20]} />
        <meshBasicMaterial
          color={color}
          side={THREE.DoubleSide}
          transparent
          opacity={0.85}
        />
      </mesh>
      {/* Icon text */}
      <Text
        position={[0, 0, 0.01]}
        fontSize={0.3}
        color="#000"
        anchorX="center"
        anchorY="middle"
      >
        {icon}
      </Text>
      {/* Label */}
      <Text
        position={[0, -0.65, 0]}
        fontSize={0.28}
        color={color}
        outlineColor="#000000"
        outlineWidth={0.04}
        anchorX="center"
        anchorY="top"
        maxWidth={5}
      >
        {marker.label}
      </Text>
    </Billboard>
  );
};
