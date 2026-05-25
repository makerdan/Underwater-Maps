import React, { useMemo, useEffect, useRef } from "react";
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
 */
export const TerrainMesh = React.forwardRef<THREE.Mesh, TerrainMeshProps>(
  ({ grid }, ref) => {
    const prevGeometryRef = useRef<THREE.BufferGeometry | null>(null);

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

    return (
      <mesh ref={ref} geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          roughness={0.25}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
    );
  },
);
TerrainMesh.displayName = "TerrainMesh";
