import React, { useMemo, useEffect, useRef } from "react";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { buildNodataBoundarySegments } from "@/lib/overviewRenderer";
import { WORLD_SIZE } from "@/lib/terrain";

/**
 * Tiny Y offset (world units) applied above the water surface so boundary
 * lines do not z-fight with the flat no-data mesh faces at Y=0.
 */
const BOUNDARY_Y_OFFSET = 0.12;

/**
 * Dark-grey boundary ring colour (linear-sRGB), matching the subtle dark-grey
 * used by `renderNodataBoundary` on the 2D overview canvas.
 */
const BOUNDARY_COLOR = new THREE.Color(0.09, 0.11, 0.13);

interface TerrainNodataBoundaryProps {
  grid: TerrainData;
}

/**
 * Renders a dashed-look boundary ring at the edges of no-data (null depth)
 * zones in the 3D terrain mesh.
 *
 * - Uses the same `buildNodataBoundarySegments` function as the 2D overview
 *   map so both views show identical coverage limits.
 * - Lines sit at Y = BOUNDARY_Y_OFFSET (just above the water surface / no-data
 *   flat tiles at Y=0) so they float clearly above the mesh without z-fighting.
 * - Coloured a subtle dark grey to read as "data ends here" without clashing
 *   with the colourmap contour lines.
 * - Disposes GPU geometry on grid change and on unmount.
 */
const TerrainNodataBoundary: React.FC<TerrainNodataBoundaryProps> = ({ grid }) => {
  const geometry = useMemo(() => {
    const segments = buildNodataBoundarySegments(grid);
    if (segments.length === 0) return null;

    const W = (grid as { width?: number }).width ?? grid.resolution;
    const H = (grid as { height?: number }).height ?? grid.resolution;
    const wSegs = Math.max(W, 1);
    const hSegs = Math.max(H, 1);

    const vertexCount = segments.length * 2;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const base = i * 6;

      // Map fractional grid coords → world XZ.
      // Grid X (col fraction) → world X: (gx/W - 0.5) * WORLD_SIZE
      // Grid Y (row fraction) → world Z: (gy/H - 0.5) * WORLD_SIZE
      positions[base]     = (seg.x0 / wSegs - 0.5) * WORLD_SIZE;
      positions[base + 1] = BOUNDARY_Y_OFFSET;
      positions[base + 2] = (seg.y0 / hSegs - 0.5) * WORLD_SIZE;

      positions[base + 3] = (seg.x1 / wSegs - 0.5) * WORLD_SIZE;
      positions[base + 4] = BOUNDARY_Y_OFFSET;
      positions[base + 5] = (seg.y1 / hSegs - 0.5) * WORLD_SIZE;

      colors[base]     = BOUNDARY_COLOR.r;
      colors[base + 1] = BOUNDARY_COLOR.g;
      colors[base + 2] = BOUNDARY_COLOR.b;

      colors[base + 3] = BOUNDARY_COLOR.r;
      colors[base + 4] = BOUNDARY_COLOR.g;
      colors[base + 5] = BOUNDARY_COLOR.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [grid]);

  const prevGeoRef = useRef<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    const prev = prevGeoRef.current;
    if (prev && prev !== geometry) prev.dispose();
    prevGeoRef.current = geometry;
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => () => { material.dispose(); }, [material]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry} material={material} renderOrder={1} />
  );
};

export { TerrainNodataBoundary };
