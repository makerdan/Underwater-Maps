import React, { useMemo, useEffect, useRef } from "react";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { buildContourLines } from "@/lib/overviewRenderer";
import { getColormap } from "@/lib/colormap";
import { useSettingsStore, deriveEffectiveColormapTheme } from "@/lib/settingsStore";
import { WORLD_SIZE, MAX_DEPTH_WORLD } from "@/lib/terrain";

/**
 * Tiny Y offset (world units) applied on top of the terrain surface so
 * contour lines do not z-fight with the mesh faces they lie on.
 */
const LINE_Y_OFFSET = 0.08;

interface TerrainContourLinesProps {
  grid: TerrainData;
}

/**
 * Renders iso-depth contour lines draped over the 3D terrain mesh.
 *
 * - Reuses the same marching-squares builder (`buildContourLines`) as the
 *   2D overview map so both views share identical contour geometry.
 * - Lines are coloured by sampling the active colormap at each iso-depth,
 *   matching the nautical-chart look of the 2D overlay.
 * - Controlled by the same `contoursEnabled` / `contourInterval` settings
 *   that govern the 2D overview contours.
 * - Applies the same terrain-exaggeration Y-scale as TerrainMesh so lines
 *   sit flush on the surface regardless of the exaggeration slider.
 * - Disposes GPU geometry on grid change and on unmount.
 */
const TerrainContourLines: React.FC<TerrainContourLinesProps> = ({ grid }) => {
  const contoursEnabled = useSettingsStore((s) => s.contoursEnabled);
  const contourInterval = useSettingsStore((s) => s.contourInterval);
  const units = useSettingsStore((s) => s.units);
  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const brightDaylight = useSettingsStore((s) => s.brightDaylight);
  const colormapUserSet = useSettingsStore((s) => s.colormapUserSet);
  const terrainExaggeration = useSettingsStore((s) => s.terrainExaggeration);

  const effectiveColormapTheme = deriveEffectiveColormapTheme(
    brightDaylight,
    colormapUserSet,
    colormapTheme,
  );

  const yScale = Math.max(0.1, terrainExaggeration || 1);

  /**
   * Convert the user-unit contour interval to metres for buildContourLines.
   *   metric   → metres (pass through)
   *   imperial → feet ÷ 3.28084
   *   nautical → fathoms × 1.8288
   */
  const intervalMetres = useMemo(() => {
    if (units === "metric") return contourInterval;
    if (units === "nautical") return contourInterval * 1.8288;
    return contourInterval / 3.28084;
  }, [contourInterval, units]);

  const geometry = useMemo(() => {
    if (!contoursEnabled || intervalMetres <= 0) return null;

    const segments = buildContourLines(grid, intervalMetres);
    if (segments.length === 0) return null;

    const { minDepth, maxDepth } = grid;
    const depthRange = (maxDepth - minDepth) || 1;

    const W = (grid as { width?: number }).width ?? grid.resolution;
    const H = (grid as { height?: number }).height ?? grid.resolution;
    const wSegs = Math.max(W - 1, 1);
    const hSegs = Math.max(H - 1, 1);

    const toColor = getColormap(effectiveColormapTheme);

    const vertexCount = segments.length * 2;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const { depth, x0, y0, x1, y1 } = seg;

      const t01 = Math.max(0, Math.min(1, (depth - minDepth) / depthRange));
      const worldY = -t01 * MAX_DEPTH_WORLD + LINE_Y_OFFSET;

      // Keep colors in linear space — Three.js vertex colors are stored and
      // rendered in linear-sRGB, matching how applyColormapToVertexColors
      // works for the terrain mesh. convertLinearToSRGB() must NOT be called
      // here (that is only for CSS/2D-canvas output).
      const col = toColor(t01);

      const base = i * 6;

      positions[base]     = (x0 / wSegs - 0.5) * WORLD_SIZE;
      positions[base + 1] = worldY;
      positions[base + 2] = (y0 / hSegs - 0.5) * WORLD_SIZE;

      positions[base + 3] = (x1 / wSegs - 0.5) * WORLD_SIZE;
      positions[base + 4] = worldY;
      positions[base + 5] = (y1 / hSegs - 0.5) * WORLD_SIZE;

      colors[base]     = col.r;
      colors[base + 1] = col.g;
      colors[base + 2] = col.b;

      colors[base + 3] = col.r;
      colors[base + 4] = col.g;
      colors[base + 5] = col.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [contoursEnabled, intervalMetres, effectiveColormapTheme, grid]);

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
        opacity: 0.65,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => () => { material.dispose(); }, [material]);

  if (!geometry) return null;

  return (
    <group scale={[1, yScale, 1]}>
      <lineSegments geometry={geometry} material={material} />
    </group>
  );
};

export { TerrainContourLines };
