import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { MAX_DEPTH_WORLD, WORLD_SIZE } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

interface LandmassMeshProps {
  grid: TerrainData;
}

/**
 * Builds a PlaneGeometry whose vertex Y is driven by the topography array
 * (positive elevation in metres). Water cells (elevation = 0) sit at y = 0,
 * which is the same plane the bathymetry mesh reaches when depth = 0, so the
 * shoreline joins seamlessly. Land cells rise above sea level using the same
 * vertical scale (depthRange → MAX_DEPTH_WORLD) as the bathymetry mesh.
 */
function buildLandmassGeometry(grid: TerrainData, topography: number[]): THREE.BufferGeometry {
  const N = grid.resolution;
  const depthRange = (grid.maxDepth - grid.minDepth) || 1;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, N - 1, N - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes["position"] as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < N * N; i++) {
    const elev = topography[i] ?? 0;
    arr[i * 3 + 1] = (elev / depthRange) * MAX_DEPTH_WORLD;
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Renders an above-water landmass surface from the terrain's `topography`
 * array. Coastline cells (elevation = 0) meet the bathymetry at y = 0 with
 * no seam. Only rendered when topography is present on the grid.
 */
export const LandmassMesh: React.FC<LandmassMeshProps> = ({ grid }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const prevGeoRef = useRef<THREE.BufferGeometry | null>(null);

  const topography = grid.topography;
  const geometry = useMemo(() => {
    if (!topography || topography.length !== grid.resolution * grid.resolution) return null;
    return buildLandmassGeometry(grid, topography);
  }, [grid, topography]);

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: 0x7a6a4f,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.FrontSide,
      flatShading: false,
    });
  }, []);

  useEffect(() => {
    const prev = prevGeoRef.current;
    if (prev && prev !== geometry) prev.dispose();
    prevGeoRef.current = geometry;
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  useEffect(() => () => material.dispose(), [material]);

  if (!geometry) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      raycast={() => null}
      data-testid="landmass-mesh"
    />
  );
};
