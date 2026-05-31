import React, { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD_SIZE, MAX_DEPTH_WORLD } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

interface TidalWaterPlaneProps {
  tideHeight: number;
  terrain: TerrainData;
}

function computeSurfaceY(terrain: TerrainData, tideHeightM: number): number {
  const depthRange = (terrain.maxDepth - terrain.minDepth) || 1;
  const seaSurfaceY = (terrain.minDepth / depthRange) * MAX_DEPTH_WORLD;
  const tideOffsetY = (tideHeightM / depthRange) * MAX_DEPTH_WORLD;
  return seaSurfaceY + tideOffsetY;
}

export const TidalWaterPlane: React.FC<TidalWaterPlaneProps> = ({ tideHeight, terrain }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const targetY = useRef(computeSurfaceY(terrain, tideHeight));
  const currentY = useRef(targetY.current);
  const uvOffsetRef = useRef(0);

  useMemo(() => {
    targetY.current = computeSurfaceY(terrain, tideHeight);
  }, [tideHeight, terrain]);

  useFrame((_, delta) => {
    currentY.current += (targetY.current - currentY.current) * Math.min(1, delta * 2);

    if (meshRef.current) {
      meshRef.current.position.y = currentY.current;
    }

    uvOffsetRef.current += delta * 0.04;
    if (matRef.current) {
      matRef.current.map?.offset.set(uvOffsetRef.current, uvOffsetRef.current * 0.6);
    }
  });

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.1, WORLD_SIZE * 1.1, 1, 1);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={[0, currentY.current, 0]}
      renderOrder={8}
    >
      <meshStandardMaterial
        ref={matRef}
        color="#0ea5e9"
        emissive="#0369a1"
        emissiveIntensity={0.15}
        transparent
        opacity={0.42}
        side={THREE.DoubleSide}
        depthWrite={false}
        roughness={0.1}
        metalness={0.2}
      />
    </mesh>
  );
};
