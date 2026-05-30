/**
 * DepthPole — a vertical luminous marker stretching from ocean surface (y=0)
 * to the seafloor at the marker's world XZ position.
 *
 * Renders:
 *  - Thin glowing cylinder (pole)
 *  - Pulsing transparent disc at y=0 (buoy)
 *  - Upward-pointing cone at the bottom (terrain contact)
 *  - Billboard depth label at mid-column
 */
import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, Billboard } from "@react-three/drei";
import * as THREE from "three";
import type { Marker, TerrainData } from "@workspace/api-client-react";
import { lonLatToWorldXZ, getTerrainSurfaceY } from "@/lib/terrain";
import { DEPTH_POLE_DEFAULT_COLOUR } from "@/lib/markerConstants";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatDepth } from "@/lib/units";

interface Props {
  marker: Marker;
  terrain: TerrainData;
}

function extractColour(marker: Marker): string {
  try {
    const parsed = JSON.parse(marker.notes ?? "{}") as Record<string, unknown>;
    if (typeof parsed["colour"] === "string") return parsed["colour"];
  } catch {
    /* ignored */
  }
  return DEPTH_POLE_DEFAULT_COLOUR;
}

export const DepthPole: React.FC<Props> = ({ marker, terrain }) => {
  const units = useSettingsStore((s) => s.units);
  const { x, z } = lonLatToWorldXZ(marker.lon, marker.lat, terrain);
  const bottomY = getTerrainSurfaceY(terrain, x, z);
  const colour = extractColour(marker);

  const poleHeight = Math.abs(bottomY);
  const midY = bottomY / 2;

  const discRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (discRef.current) {
      const s = 0.8 + 0.2 * Math.sin(clock.getElapsedTime() * 2);
      discRef.current.scale.setScalar(s);
    }
  });

  if (poleHeight < 0.05) return null;

  const depthLabel = `\u2212${formatDepth(Math.abs(marker.depth), { units })}`;

  return (
    <group>
      {/* Vertical glowing cylinder (pole) */}
      <mesh position={[x, midY, z]}>
        <cylinderGeometry args={[0.03, 0.03, poleHeight, 8]} />
        <meshBasicMaterial color={colour} transparent opacity={0.9} />
      </mesh>

      {/* Pulsing buoy disc at y=0 */}
      <mesh ref={discRef} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.5, 32]} />
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Upward-pointing cone at terrain contact */}
      <mesh position={[x, bottomY + 0.2, z]}>
        <coneGeometry args={[0.12, 0.25, 8]} />
        <meshBasicMaterial color={colour} />
      </mesh>

      {/* Billboard depth label + marker name at mid-column */}
      <Billboard position={[x + 0.7, midY, z]}>
        <Text
          fontSize={0.55}
          color={colour}
          outlineColor="#000000"
          outlineWidth={0.06}
          anchorX="left"
          anchorY="middle"
        >
          {depthLabel}
        </Text>
        <Text
          fontSize={0.32}
          color="#e2e8f0"
          outlineColor="#000000"
          outlineWidth={0.04}
          anchorX="left"
          anchorY="middle"
          position={[0, -0.65, 0]}
          maxWidth={6}
        >
          {marker.label}
        </Text>
      </Billboard>
    </group>
  );
};
