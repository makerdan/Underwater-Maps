/**
 * ThermalCursorTracker — R3F Canvas component that tracks the pointer
 * position over the 3D scene and publishes the inferred water depth (metres)
 * to uiStore.thermalCursorDepthM while the TEMP LAYER is active.
 *
 * Strategy:
 *   1. On pointermove, cast a ray from the camera through the cursor NDC.
 *   2. If the ray hits the terrain mesh, use that intersection's world Y.
 *   3. Otherwise fall back to the camera's current world Y (the camera is
 *      always somewhere in the water column while exploring).
 *   4. Convert world Y → depth in metres using the same formula as
 *      WaterTempSceneContents / seaSurfaceY in TourScene.
 *   5. Clear the store value on pointerleave and on unmount.
 *
 * Renders nothing — purely a side-effect component.
 */
import React, { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useUiStore } from "@/lib/uiStore";
import { MAX_DEPTH_WORLD } from "@/lib/terrain";

interface ThermalCursorTrackerProps {
  terrain: TerrainData;
  terrainMeshRef: React.RefObject<THREE.Mesh | null>;
}

export const ThermalCursorTracker: React.FC<ThermalCursorTrackerProps> = ({
  terrain,
  terrainMeshRef,
}) => {
  const { camera, gl } = useThree();
  const raycasterRef = useRef(new THREE.Raycaster());
  const setThermalCursorDepthM = useUiStore((s) => s.setThermalCursorDepthM);

  // Stable terrain-derived constants (recomputed only when terrain changes).
  const terrainRef = useRef(terrain);
  terrainRef.current = terrain;

  useEffect(() => {
    const canvas = gl.domElement;
    const ndc = new THREE.Vector2();

    function worldYToDepthM(worldY: number, t: TerrainData): number {
      const depthRange = Math.max(1, t.maxDepth - t.minDepth);
      const surfY = (t.minDepth / depthRange) * MAX_DEPTH_WORLD;
      const seafloorY = -MAX_DEPTH_WORLD;
      const ySpan = surfY - seafloorY;
      if (ySpan <= 0) return t.minDepth;
      const frac = (surfY - worldY) / ySpan;
      return Math.max(0, t.minDepth + frac * depthRange);
    }

    function handleMove(e: PointerEvent) {
      if (!useSettingsStore.getState().showWaterTempLayer) return;

      const t = terrainRef.current;
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(ndc, camera);

      const mesh = terrainMeshRef.current;
      if (mesh) {
        const hits = raycasterRef.current.intersectObject(mesh, false);
        if (hits.length > 0) {
          setThermalCursorDepthM(worldYToDepthM(hits[0]!.point.y, t));
          return;
        }
      }

      // Fallback: use camera Y — camera always sits in the water column.
      setThermalCursorDepthM(worldYToDepthM(camera.position.y, t));
    }

    function handleLeave() {
      setThermalCursorDepthM(null);
    }

    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerleave", handleLeave);

    return () => {
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerleave", handleLeave);
      setThermalCursorDepthM(null);
    };
  }, [camera, gl.domElement, terrainMeshRef, setThermalCursorDepthM]);

  return null;
};
