import React, { useMemo, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { buildTerrainGeometry } from "@/lib/terrain";

interface TerrainMeshProps {
  grid: TerrainData;
}

/**
 * Renders a 3D seafloor terrain mesh from a TerrainData grid.
 *
 * - Builds BufferGeometry via buildTerrainGeometry (memoised per grid object).
 * - Uses MeshStandardMaterial with vertexColors and low roughness for a
 *   slightly wet look.
 * - Disposes old geometry when the grid prop changes to prevent GPU leaks.
 * - Exposes a ref to the underlying THREE.Mesh so callers can use it for
 *   raycasting (e.g. GPS crosshair).
 * - Fades in (opacity 0→1 over 400 ms) whenever the terrain grid swaps.
 */
export const TerrainMesh = React.forwardRef<THREE.Mesh, TerrainMeshProps>(
  ({ grid }, ref) => {
    const prevGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const matRef = useRef<THREE.MeshStandardMaterial>(null);
    const fadeRef = useRef({ opacity: 1, fading: false });

    const geometry = useMemo(() => {
      return buildTerrainGeometry(grid);
    }, [grid]);

    useEffect(() => {
      const prev = prevGeometryRef.current;
      if (prev && prev !== geometry) {
        prev.dispose();
      }
      prevGeometryRef.current = geometry;
      return () => {
        geometry.dispose();
      };
    }, [geometry]);

    // Trigger fade-in whenever the grid (and thus geometry) changes
    useEffect(() => {
      const mat = matRef.current;
      if (mat) {
        mat.opacity = 0;
      }
      fadeRef.current.opacity = 0;
      fadeRef.current.fading = true;
    }, [grid]);

    // Animate opacity 0 → 1 (≈ 400 ms at 60 fps)
    useFrame((_, delta) => {
      const f = fadeRef.current;
      const mat = matRef.current;
      if (!f.fading || !mat) return;
      f.opacity = Math.min(1, f.opacity + delta * 2.5);
      mat.opacity = f.opacity;
      if (f.opacity >= 1) {
        f.fading = false;
      }
    });

    return (
      <mesh ref={ref} geometry={geometry}>
        <meshStandardMaterial
          ref={matRef}
          vertexColors
          roughness={0.25}
          metalness={0.05}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>
    );
  },
);
TerrainMesh.displayName = "TerrainMesh";
