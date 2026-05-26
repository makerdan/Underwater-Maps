/**
 * MarkerSprite — a slim vertical pillar of light stretching from the water
 * surface (y=0) down to the seafloor, with a billboard icon + label at the top.
 *
 * Uses the same getTerrainSurfaceY helper as DepthPole for consistent
 * coordinate lookup. Depth poles are excluded (rendered by DepthPoleLayer).
 */
import React from "react";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import type { Marker, TerrainData } from "@workspace/api-client-react";
import { lonLatToWorldXZ, getTerrainSurfaceY } from "@/lib/terrain";
import { MARKER_COLOR, MARKER_ICON } from "@/lib/markerConstants";

interface Props {
  marker: Marker;
  terrain: TerrainData;
  showLabel?: boolean;
}

export const MarkerSprite: React.FC<Props> = ({ marker, terrain, showLabel = true }) => {
  if (marker.type === "depth_pole") return null;

  const { x, z } = lonLatToWorldXZ(marker.lon, marker.lat, terrain);
  const bottomY = getTerrainSurfaceY(terrain, x, z);
  const poleHeight = Math.abs(bottomY);

  if (poleHeight < 0.05) return null;

  const midY = bottomY / 2;
  const color = MARKER_COLOR[marker.type] ?? "#e2e8f0";
  const icon = MARKER_ICON[marker.type] ?? "●";

  return (
    <group userData={{ markerId: marker.id }}>
      {/* Outer glow cylinder — wide, very transparent, additive blending */}
      <mesh position={[x, midY, z]}>
        <cylinderGeometry args={[0.18, 0.18, poleHeight, 8]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.08}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Inner glow cylinder — slightly wider than the core, additive blending */}
      <mesh position={[x, midY, z]}>
        <cylinderGeometry args={[0.10, 0.10, poleHeight, 8]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Slim core cylinder (pillar) */}
      <mesh position={[x, midY, z]}>
        <cylinderGeometry args={[0.04, 0.04, poleHeight, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>

      {/* Invisible wider hit-box cylinder — improves click/tap targeting */}
      <mesh position={[x, midY, z]}>
        <cylinderGeometry args={[0.3, 0.3, poleHeight, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Billboard icon disc + label at the top of the pillar */}
      <Billboard position={[x, 0.05, z]}>
        {/* Glow halo disc behind the icon — wider, additive blending */}
        <mesh>
          <circleGeometry args={[0.55, 20]} />
          <meshBasicMaterial
            color={color}
            side={THREE.DoubleSide}
            transparent
            opacity={0.15}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        {/* Icon disc */}
        <mesh>
          <circleGeometry args={[0.3, 20]} />
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
          fontSize={0.22}
          color="#000"
          anchorX="center"
          anchorY="middle"
        >
          {icon}
        </Text>
        {/* Label */}
        {showLabel && (
          <Text
            position={[0, -0.5, 0]}
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
        )}
      </Billboard>
    </group>
  );
};
