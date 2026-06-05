/**
 * useGpsFollowCamera — GPS Follow Mode camera tracking hook.
 *
 * While `gpsFollowMode` is true in cameraStore, this hook lerps the camera
 * each frame to a fixed offset above the user's live GPS world position,
 * looking down at the terrain surface below that point.
 *
 * Behaviour:
 * - Bounds-checks GPS lon/lat against ALL visible dataset grids each frame.
 *   Follow mode stays active as long as the position is within ANY one of them;
 *   it is only disabled when the position falls outside every visible grid.
 * - Clears follow mode whenever the set of visible dataset IDs changes.
 * - Must be mounted inside a <Canvas> (uses useFrame).
 */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGpsStore } from "@/lib/gpsStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { lonLatToWorldXZ, getTerrainSurfaceY } from "@/lib/terrain";
import { toast } from "@/hooks/use-toast";

/** World units above terrain surface the camera hovers in follow mode. */
const FOLLOW_HEIGHT = 8;

/** Lerp factor per frame (higher = snappier, lower = smoother). */
const LERP_FACTOR = 0.05;

export function useGpsFollowCamera(): void {
  const { camera } = useThree();

  const targetPos = useRef(new THREE.Vector3());
  const targetLook = useRef(new THREE.Vector3());
  const targetQuat = useRef(new THREE.Quaternion());
  const lookMatrix = useRef(new THREE.Matrix4());
  const upVec = useRef(new THREE.Vector3(0, 1, 0));
  const euler = useRef(new THREE.Euler());
  const outOfBoundsToastFired = useRef(false);

  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);

  useEffect(() => {
    useCameraStore.getState().setGpsFollowMode(false);
    outOfBoundsToastFired.current = false;
  }, [primaryDatasetId]);

  useFrame(() => {
    const followMode = useCameraStore.getState().gpsFollowMode;
    if (!followMode) {
      outOfBoundsToastFired.current = false;
      return;
    }

    const gpsActive = useGpsStore.getState().active;
    const position = useGpsStore.getState().position;
    const activeGrid = useTerrainStore.getState().activeGrid;

    if (!gpsActive || !position || !activeGrid) {
      useCameraStore.getState().setGpsFollowMode(false);
      return;
    }

    const { longitude: lon, latitude: lat } = position;

    // Multi-primary: stay in follow mode if the GPS position is within ANY
    // visible dataset's bounds. Only deactivate when outside all of them.
    // Fallback: if visibleDatasets is empty (e.g. legacy setState path), check
    // against activeGrid directly so the single-dataset path keeps working.
    const visibleDatasets = useTerrainStore.getState().visibleDatasets;
    const gridsToCheck = visibleDatasets.length > 0
      ? visibleDatasets.filter((v) => v.activeGrid).map((v) => v.activeGrid!)
      : [activeGrid];
    const insideAny = gridsToCheck.some((g) =>
      lat >= g.minLat &&
      lat <= g.maxLat &&
      lon >= g.minLon &&
      lon <= g.maxLon,
    );

    if (!insideAny) {
      useCameraStore.getState().setGpsFollowMode(false);
      if (!outOfBoundsToastFired.current) {
        outOfBoundsToastFired.current = true;
        toast({
          title: "Follow mode paused",
          description: "GPS position left the dataset — follow mode paused.",
          duration: 4000,
        });
      }
      return;
    }

    outOfBoundsToastFired.current = false;

    const { x, z } = lonLatToWorldXZ(lon, lat, activeGrid);
    const surfaceY = getTerrainSurfaceY(activeGrid, x, z);
    const camY = surfaceY + FOLLOW_HEIGHT;

    targetPos.current.set(x, camY, z);
    targetLook.current.set(x, surfaceY, z);

    camera.position.lerp(targetPos.current, LERP_FACTOR);

    lookMatrix.current.lookAt(camera.position, targetLook.current, upVec.current);
    targetQuat.current.setFromRotationMatrix(lookMatrix.current);
    camera.quaternion.slerp(targetQuat.current, LERP_FACTOR * 4);

    euler.current.setFromQuaternion(camera.quaternion, "YXZ");
    const MAX_PITCH = -Math.PI * 0.1;
    if (euler.current.x > MAX_PITCH) {
      euler.current.x = MAX_PITCH;
      camera.quaternion.setFromEuler(euler.current);
    }
  });
}
