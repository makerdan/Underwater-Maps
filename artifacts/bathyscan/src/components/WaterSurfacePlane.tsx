import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WORLD_SIZE, type WaterSurface } from "@/lib/terrain";
import { useSettingsStore } from "@/lib/settingsStore";

interface WaterSurfacePlaneProps {
  waterSurface: WaterSurface;
}

/**
 * Static sea-level water surface plane.
 *
 * Accepts a pre-built WaterSurface discriminated union so that "visible but
 * Y is stale" is an unrepresentable state.  Returns null immediately when
 * `waterSurface.visible` is false (user toggled it off, or no terrain loaded).
 *
 * Colour and clarity are tied to the active water type: deep-ocean blue for
 * saltwater, clearer green-teal for freshwater lakes.
 *
 * This is the single, shared water plane for the scene. The tidal water plane
 * (TidalWaterPlane) replaces this one when tidal overlay is active.
 */
/**
 * Pure visibility helper — exported for unit tests.
 *
 * Applies hysteresis around the water-surface level (surfY) and explicitly
 * hides the plane when the camera is in the gap zone between terrain top
 * (Y=0) and the true water surface (Y=surfY > 0).  The gap zone is where
 * the camera can look up through the DoubleSide plane and see a bright
 * sky-blue face filling the viewport.
 *
 * Rules:
 *  1. Gap zone (surfY > 0 && 0 < camY < surfY): always hide + reset state.
 *  2. Exit "below surface" (hide) when camY > surfY + 0.5.
 *  3. Enter "below surface" (show) when camY < surfY - 0.5.
 */
export function applyWaterPlaneVisibility(
  mesh: { visible: boolean },
  belowSurface: { current: boolean },
  camY: number,
  surfY: number,
): void {
  if (surfY > 0 && camY > 0 && camY < surfY) {
    belowSurface.current = false;
    mesh.visible = false;
    return;
  }
  if (belowSurface.current) {
    if (camY > surfY + 0.5) belowSurface.current = false;
  } else {
    if (camY < surfY - 0.5) belowSurface.current = true;
  }
  mesh.visible = belowSurface.current;
}

export const WaterSurfacePlane: React.FC<WaterSurfacePlaneProps> = ({ waterSurface }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const waterType = useSettingsStore((s) => s.waterType);

  // Hysteresis ref: true = camera is "below surface" → plane visible.
  // Initial true so the very first frame (camera starts underwater) shows the plane.
  const belowSurface = useRef<boolean>(true);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.1, WORLD_SIZE * 1.1, 1, 1);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const isFresh = waterType === "freshwater";
  const color = isFresh ? "#3ec9a8" : "#0ea5e9";
  const emissive = isFresh ? "#0f5a4a" : "#0369a1";
  const opacity = isFresh ? 0.22 : 0.3;

  useFrame(({ camera }) => {
    if (!meshRef.current) return;
    if (!waterSurface.visible) {
      meshRef.current.visible = false;
      return;
    }
    applyWaterPlaneVisibility(meshRef.current, belowSurface, camera.position.y, waterSurface.y);
  });

  // Return null immediately when the surface is hidden — avoids mounting the
  // mesh at all, which is cheaper than mounting+hiding it every frame.
  if (!waterSurface.visible) return null;

  const surfY = waterSurface.y;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={[0, surfY, 0]}
      renderOrder={2}
      data-testid="water-surface-plane"
    >
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={0.12}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        roughness={0.15}
        metalness={0.2}
      />
    </mesh>
  );
};
