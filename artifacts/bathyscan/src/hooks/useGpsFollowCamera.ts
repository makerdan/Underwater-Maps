/**
 * useGpsFollowCamera — GPS Follow Mode camera tracking hook.
 *
 * While `gpsFollowMode` is true in cameraStore, this hook lerps the camera
 * each frame to a fixed offset above the user's live GPS world position,
 * looking down at the terrain surface below that point.
 *
 * Behaviour:
 * - Bounds-checks GPS lon/lat against the active grid every frame. If the
 *   position leaves the dataset, follow mode is automatically disabled and
 *   a toast is shown.
 * - Clears follow mode whenever the primary dataset ID changes.
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

    if (
      lat < activeGrid.minLat ||
      lat > activeGrid.maxLat ||
      lon < activeGrid.minLon ||
      lon > activeGrid.maxLon
    ) {
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

    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(camera.position, targetLook.current, new THREE.Vector3(0, 1, 0)),
    );
    camera.quaternion.slerp(targetQuat, LERP_FACTOR * 4);

    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    const MAX_PITCH = -Math.PI * 0.1;
    if (euler.x > MAX_PITCH) {
      euler.x = MAX_PITCH;
      camera.quaternion.setFromEuler(euler);
    }
  });
}
