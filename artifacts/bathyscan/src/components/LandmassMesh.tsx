import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { MAX_DEPTH_WORLD, WORLD_SIZE } from "@/lib/terrain";
import { useSettingsStore } from "@/lib/settingsStore";
import type { TerrainData } from "@workspace/api-client-react";

interface LandmassMeshProps {
  grid: TerrainData;
  depthBias?: boolean;
}

/** Neutral mid-grey used when the user selects the "flat" landmass style. */
const FLAT_LANDMASS_COLOR = "#9ca3a3";

// Elevation-based colour ramp stops (in metres above sea level).
// These are calibrated for island-scale terrain (2000 m peaks).  For shorter
// terrain the thresholds are scaled proportionally via the `maxTopoM` arg so
// the full sand → grass → rock → snow ramp is always visible.
const SHORE_BAND_M = 1.5;      // wet-sand strip right at the waterline
const SAND_TOP_M = 12;         // dry beach upper edge
const GRASS_TOP_M = 250;       // lowland vegetation
const ROCK_TOP_M = 900;        // exposed rock / alpine
const SNOW_LINE_M = 1600;      // permanent snow (reference scale)

const C_WET_SAND = new THREE.Color("#c2b48a");
const C_DRY_SAND = new THREE.Color("#e6d6a8");
const C_GRASS = new THREE.Color("#5a7d3a");
const C_FOREST = new THREE.Color("#3d5a2a");
const C_ROCK = new THREE.Color("#7a6b5c");
const C_SNOW = new THREE.Color("#f4f4f0");

const _tmp = new THREE.Color();

/**
 * Returns an elevation-based biome colour into `out`.
 *
 * `maxTopoM` is the tallest elevation present in the current terrain (metres).
 * When it is less than SNOW_LINE_M (the reference scale for ocean islands) the
 * band thresholds are scaled proportionally so the full sand → grass → rock →
 * snow gradient is used regardless of how modest the surrounding hills are.
 * Island-scale presets (maxTopoM >= SNOW_LINE_M) get factor = 1, preserving
 * the original behaviour exactly.
 */
function elevationColor(elev: number, out: THREE.Color, maxTopoM = SNOW_LINE_M): THREE.Color {
  // Proportional scale factor: ≤1 for short terrain, 1 for tall terrain.
  const factor = Math.min(1, maxTopoM / SNOW_LINE_M);

  const shoreBand = SHORE_BAND_M * factor;
  const sandTop   = SAND_TOP_M   * factor;
  const grassTop  = GRASS_TOP_M  * factor;
  const rockTop   = ROCK_TOP_M   * factor;
  const snowLine  = SNOW_LINE_M  * factor; // equals maxTopoM when factor < 1

  if (elev <= shoreBand) {
    const t = THREE.MathUtils.clamp(shoreBand > 0 ? elev / shoreBand : 1, 0, 1);
    return out.copy(C_WET_SAND).lerp(C_DRY_SAND, t);
  }
  if (elev <= sandTop) {
    const span = sandTop - shoreBand;
    const t = span > 0 ? (elev - shoreBand) / span : 1;
    return out.copy(C_DRY_SAND).lerp(C_GRASS, t);
  }
  if (elev <= grassTop) {
    const span = grassTop - sandTop;
    const t = span > 0 ? (elev - sandTop) / span : 1;
    return out.copy(C_GRASS).lerp(C_FOREST, t);
  }
  if (elev <= rockTop) {
    const span = rockTop - grassTop;
    const t = span > 0 ? (elev - grassTop) / span : 1;
    return out.copy(C_FOREST).lerp(C_ROCK, t);
  }
  if (elev <= snowLine) {
    const span = snowLine - rockTop;
    const t = span > 0 ? (elev - rockTop) / span : 1;
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
export function buildLandmassGeometry(
  grid: TerrainData,
  topography: number[],
  style: "realistic" | "flat",
): THREE.BufferGeometry {
  const N = grid.resolution;
  const depthRange = (grid.maxDepth - grid.minDepth) || 1;

  // Find the tallest topography cell so we can scale it to MAX_DEPTH_WORLD.
  // When terrain rises higher than the underwater depth range (e.g. 50–100 m
  // hills around a 28 m deep lake) using depthRange alone causes elev/depthRange
  // > 1, pushing vertices above MAX_DEPTH_WORLD and producing visible spikes.
  let maxTopoM = 0;
  for (let i = 0; i < topography.length; i++) {
    const v = topography[i] ?? 0;
    if (v > maxTopoM) maxTopoM = v;
  }
  const scale = Math.max(depthRange, maxTopoM) || 1;

  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, N - 1, N - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes["position"] as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const colors = new Float32Array(N * N * 4); // RGBA so we can fade the shoreline.
  const flatColor = new THREE.Color(FLAT_LANDMASS_COLOR);

  for (let i = 0; i < N * N; i++) {
    const elev = topography[i] ?? 0;
    arr[i * 3 + 1] = Math.max(0, Math.min(1, elev / scale)) * MAX_DEPTH_WORLD;

    if (style === "flat") {
      colors[i * 4 + 0] = flatColor.r;
      colors[i * 4 + 1] = flatColor.g;
      colors[i * 4 + 2] = flatColor.b;
    } else {
      elevationColor(elev, _tmp, maxTopoM);
      colors[i * 4 + 0] = _tmp.r;
      colors[i * 4 + 1] = _tmp.g;
      colors[i * 4 + 2] = _tmp.b;
    }
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
export const LandmassMesh: React.FC<LandmassMeshProps> = ({ grid, depthBias = false }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const prevGeoRef = useRef<THREE.BufferGeometry | null>(null);

  const topography = grid.topography;
  const landmassStyle = useSettingsStore((s) => s.landmassStyle);
  const geometry = useMemo(() => {
    if (!topography || topography.length !== grid.resolution * grid.resolution) return null;
    return buildLandmassGeometry(grid, topography, landmassStyle);
  }, [grid, topography, landmassStyle]);

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
    material.polygonOffset = depthBias;
    material.polygonOffsetFactor = depthBias ? 1 : 0;
    material.polygonOffsetUnits = depthBias ? 1 : 0;
  }, [depthBias, material]);

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
