import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD_SIZE, MAX_DEPTH_WORLD } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";

interface WaterSurfacePlaneProps {
  terrain: TerrainData;
}

function seaSurfaceY(terrain: TerrainData): number {
  const depthRange = (terrain.maxDepth - terrain.minDepth) || 1;
  return (terrain.minDepth / depthRange) * MAX_DEPTH_WORLD;
}

/**
 * Static sea-level water surface plane.
 *
 * Rendered at the dataset's sea-surface Y (derived from terrain.minDepth) and
 * sized to WORLD_SIZE * 1.1 so it covers the full bathymetry and any landmass.
 * Colour and clarity are tied to the active water type: deep-ocean blue for
 * saltwater, clearer green-teal for freshwater lakes.
 *
 * This is the single, shared water plane for the scene. The tidal water plane
 * (TidalWaterPlane) replaces this one when tidal overlay is active.
 */
export const WaterSurfacePlane: React.FC<WaterSurfacePlaneProps> = ({ terrain }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const waterType = useSettingsStore((s) => s.waterType);
  const surfY = seaSurfaceY(terrain);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.1, WORLD_SIZE * 1.1, 1, 1);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  const isFresh = waterType === "freshwater";
  const color = isFresh ? "#3ec9a8" : "#0ea5e9";
  const emissive = isFresh ? "#0f5a4a" : "#0369a1";
  const opacity = isFresh ? 0.22 : 0.3;

  useFrame(({ camera }) => {
    if (meshRef.current) {
      // Hide when above the surface so we don't double-tint the sky.
      meshRef.current.visible = camera.position.y < surfY + 0.5;
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={[0, surfY, 0]}
      renderOrder={2}
      data-testid="water-surface-plane"
    >
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={0.12}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        roughness={0.15}
        metalness={0.2}
      />
    </mesh>
  );
};
