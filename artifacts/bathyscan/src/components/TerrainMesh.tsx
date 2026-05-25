import React, { useMemo, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { buildTerrainGeometry, computeZoneWeights, WORLD_SIZE } from "@/lib/terrain";
import { getTerrainTextures } from "@/lib/textures";
import { createTerrainShaderMaterial } from "@/lib/terrainShader";

/**
 * Tiling scale — number of texture tile repeats across the full WORLD_SIZE.
 * Tune via VITE_TEXTURE_TILING env var; default gives ~8 world-unit tiles.
 */
const TILING_SCALE = (() => {
  const raw = (import.meta.env as Record<string, unknown>)["VITE_TEXTURE_TILING"];
  const parsed = typeof raw === "string" ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : WORLD_SIZE / 8;
})();

interface TerrainMeshProps {
  grid: TerrainData;
}

/**
 * Renders a 3D seafloor terrain mesh from a TerrainData grid.
 *
 * - Builds BufferGeometry via buildTerrainGeometry + zone weight attribute.
 * - Uses a custom GLSL ShaderMaterial (terrainShader.ts) that blends four
 *   procedural tiling textures (sand/sediment/silt/basalt) by per-vertex
 *   zone weights, then tints with the depth colormap colour.
 * - Fades in (opacity 0→1 over ~400 ms) whenever the terrain grid swaps.
 * - Updates a per-frame lamp-position uniform from the camera's world pos.
 * - Disposes old geometry when the grid prop changes to prevent GPU leaks.
 * - Exposes a ref to the underlying THREE.Mesh for raycasting.
 */
export const TerrainMesh = React.forwardRef<THREE.Mesh, TerrainMeshProps>(
  ({ grid }, ref) => {
    const prevGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const fadeRef = useRef({ opacity: 0, fading: false });

    // Textures are a lazy singleton — computed once, shared forever.
    const textures = useMemo(() => getTerrainTextures(), []);

    // Geometry rebuild whenever the grid changes.
    const geometry = useMemo(() => {
      const geo = buildTerrainGeometry(grid);
      const weights = computeZoneWeights(grid);
      geo.setAttribute("zoneWeight", new THREE.BufferAttribute(weights, 4));
      return geo;
    }, [grid]);

    // Material is created once (textures never change).
    const material = useMemo(() => {
      return createTerrainShaderMaterial(textures, TILING_SCALE);
    }, [textures]);

    // Dispose old geometry to free GPU memory.
    useEffect(() => {
      const prev = prevGeometryRef.current;
      if (prev && prev !== geometry) prev.dispose();
      prevGeometryRef.current = geometry;
      return () => {
        geometry.dispose();
      };
    }, [geometry]);

    // Dispose material when it changes (only happens if textures change, which
    // currently never happens — but guard for future correctness).
    useEffect(() => {
      return () => {
        material.dispose();
      };
    }, [material]);

    // Trigger fade-in whenever the loaded grid changes.
    useEffect(() => {
      material.uniforms["uOpacity"]!.value = 0;
      fadeRef.current.opacity = 0;
      fadeRef.current.fading = true;
    }, [grid, material]);

    // Animate opacity 0→1 (~400 ms at 60 fps) and keep lamp position in sync.
    useFrame((state, delta) => {
      const f = fadeRef.current;
      if (f.fading) {
        f.opacity = Math.min(1, f.opacity + delta * 2.5);
        material.uniforms["uOpacity"]!.value = f.opacity;
        if (f.opacity >= 1) f.fading = false;
      }
      // Lamp = camera (submersible viewpoint)
      material.uniforms["uLampPos"]!.value.copy(state.camera.position);
    });

    return <mesh ref={ref} geometry={geometry} material={material} />;
  },
);
TerrainMesh.displayName = "TerrainMesh";
