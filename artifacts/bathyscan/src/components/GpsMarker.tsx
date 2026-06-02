/**
 * GpsMarker — a 3D cone at y=0 marking the user's current GPS position.
 *
 * Visible only when GPS is active and the position falls within the
 * active terrain's bounding box. Shows a "YOU" label and depth below.
 */
import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, Billboard } from "@react-three/drei";
import * as THREE from "three";
import { useGpsStore } from "@/lib/gpsStore";
import { useAppState } from "@/lib/context";
import { lonLatToWorldXZ, getTerrainSurfaceY } from "@/lib/terrain";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatDepth } from "@/lib/units";

export const GpsMarker: React.FC = () => {
  const position = useGpsStore((s) => s.position);
  const active = useGpsStore((s) => s.active);
  const { terrain } = useAppState();
  const units = useSettingsStore((s) => s.units);
  const ringRef = useRef<THREE.Mesh>(null);
  const elapsedRef = useRef<number>(0);

  useFrame((_state, delta) => {
    elapsedRef.current += delta;
    if (ringRef.current) {
      const s = 0.9 + 0.1 * Math.sin(elapsedRef.current * 3);
      ringRef.current.scale.setScalar(s);
    }
  });

  if (!active || !position || !terrain) return null;

  // Check bounds
  if (
    position.latitude < terrain.minLat ||
    position.latitude > terrain.maxLat ||
    position.longitude < terrain.minLon ||
    position.longitude > terrain.maxLon
  ) {
    return null;
  }

  const { x, z } = lonLatToWorldXZ(position.longitude, position.latitude, terrain);
  const bottomY = getTerrainSurfaceY(terrain, x, z);
  const depthM = Math.abs(Math.round(bottomY * (terrain.maxDepth - terrain.minDepth) / 50));

  return (
    <group>
      {/* Downward-pointing cone at surface */}
      <mesh position={[x, 0.5, z]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.3, 0.8, 8]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.85} />
      </mesh>

      {/* Pulsing accuracy ring at y=0 */}
      <mesh ref={ringRef} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial
          color="#3b82f6"
          transparent
          opacity={0.25}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Vertical line to seafloor */}
      <mesh position={[x, bottomY / 2, z]}>
        <cylinderGeometry args={[0.015, 0.015, Math.abs(bottomY), 6]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.4} />
      </mesh>

      {/* Billboard label */}
      <Billboard position={[x + 0.8, 1.2, z]}>
        <Text
          fontSize={0.55}
          color="#3b82f6"
          outlineColor="#000000"
          outlineWidth={0.06}
          anchorX="left"
          anchorY="middle"
          fontWeight={700}
        >
          YOU
        </Text>
        <Text
          fontSize={0.32}
          color="#93c5fd"
          outlineColor="#000000"
          outlineWidth={0.04}
          anchorX="left"
          anchorY="middle"
          position={[0, -0.65, 0]}
        >
          {`\u2212${formatDepth(depthM, { units })} below`}
        </Text>
      </Billboard>
    </group>
  );
};
