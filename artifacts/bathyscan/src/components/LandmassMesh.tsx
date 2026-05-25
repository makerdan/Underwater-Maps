import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { MAX_DEPTH_WORLD, WORLD_SIZE } from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

interface LandmassMeshProps {
  grid: TerrainData;
}

// Elevation-based colour ramp stops (in metres above sea level).
// Below SAND_TOP we blend from wet sand to dry sand; above SNOW_LINE we are pure snow.
const SHORE_BAND_M = 1.5;      // wet-sand strip right at the waterline
const SAND_TOP_M = 12;         // dry beach upper edge
const GRASS_TOP_M = 250;       // lowland vegetation
const ROCK_TOP_M = 900;        // exposed rock / alpine
const SNOW_LINE_M = 1600;      // permanent snow

const C_WET_SAND = new THREE.Color("#c2b48a");
const C_DRY_SAND = new THREE.Color("#e6d6a8");
const C_GRASS = new THREE.Color("#5a7d3a");
const C_FOREST = new THREE.Color("#3d5a2a");
const C_ROCK = new THREE.Color("#7a6b5c");
const C_SNOW = new THREE.Color("#f4f4f0");

const _tmp = new THREE.Color();

function elevationColor(elev: number, out: THREE.Color): THREE.Color {
  if (elev <= SHORE_BAND_M) {
    const t = THREE.MathUtils.clamp(elev / SHORE_BAND_M, 0, 1);
    return out.copy(C_WET_SAND).lerp(C_DRY_SAND, t);
  }
  if (elev <= SAND_TOP_M) {
    const t = (elev - SHORE_BAND_M) / (SAND_TOP_M - SHORE_BAND_M);
    return out.copy(C_DRY_SAND).lerp(C_GRASS, t);
  }
  if (elev <= GRASS_TOP_M) {
    const t = (elev - SAND_TOP_M) / (GRASS_TOP_M - SAND_TOP_M);
    return out.copy(C_GRASS).lerp(C_FOREST, t);
  }
  if (elev <= ROCK_TOP_M) {
    const t = (elev - GRASS_TOP_M) / (ROCK_TOP_M - GRASS_TOP_M);
    return out.copy(C_FOREST).lerp(C_ROCK, t);
  }
  if (elev <= SNOW_LINE_M) {
    const t = (elev - ROCK_TOP_M) / (SNOW_LINE_M - ROCK_TOP_M);
    return out.copy(C_ROCK).lerp(C_SNOW, t);
  }
  return out.copy(C_SNOW);
}

/**
 * Builds a PlaneGeometry whose vertex Y is driven by the topography array
 * (positive elevation in metres). Water cells (elevation = 0) sit at y = 0,
 * which is the same plane the bathymetry mesh reaches when depth = 0, so the
 * shoreline joins seamlessly. Land cells rise above sea level using the same
 * vertical scale (depthRange → MAX_DEPTH_WORLD) as the bathymetry mesh.
 *
 * Per-vertex colours are sampled from an elevation ramp (sand → grass → rock →
 * snow). Vertices at or below sea level also receive a reduced alpha so the
 * land/water seam fades into a soft shoreline instead of a hard line.
 */
function buildLandmassGeometry(grid: TerrainData, topography: number[]): THREE.BufferGeometry {
  const N = grid.resolution;
  const depthRange = (grid.maxDepth - grid.minDepth) || 1;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, N - 1, N - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes["position"] as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const colors = new Float32Array(N * N * 4); // RGBA so we can fade the shoreline.

  for (let i = 0; i < N * N; i++) {
    const elev = topography[i] ?? 0;
    arr[i * 3 + 1] = (elev / depthRange) * MAX_DEPTH_WORLD;

    elevationColor(elev, _tmp);
    colors[i * 4 + 0] = _tmp.r;
    colors[i * 4 + 1] = _tmp.g;
    colors[i * 4 + 2] = _tmp.b;
    // Fade the very edge of the coast (0..SHORE_BAND_M) so the seam against
    // the water plane reads as a softened shoreline rather than a clean cut.
    const a = elev <= 0 ? 0 : THREE.MathUtils.smoothstep(elev, 0, SHORE_BAND_M);
    colors[i * 4 + 3] = a;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 4));
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
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.FrontSide,
      flatShading: false,
      transparent: true,
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
