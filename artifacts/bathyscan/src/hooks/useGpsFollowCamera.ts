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
import { useSettingsStore } from "@/lib/settingsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { lonLatToWorldXZ, getTerrainSurfaceY } from "@/lib/terrain";
import { runFollowBoundsCheck } from "@/lib/followBoundsCheck";

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
  const checkState = useRef({ toastFired: false });

  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);

  useEffect(() => {
    useCameraStore.getState().setGpsFollowMode(false);
    checkState.current.toastFired = false;
  }, [primaryDatasetId]);

  useFrame(() => {
    // GPS-loss / out-of-bounds checks (shared with the dev stub watcher);
    // disables follow mode itself and fires the handoff toast when needed.
    if (!runFollowBoundsCheck(checkState.current)) return;

    const position = useGpsStore.getState().position;
    const activeGrid = useTerrainStore.getState().activeGrid;
    if (!position || !activeGrid) return;
    const { longitude: lon, latitude: lat } = position;

    // Interaction pause: while the user is manually steering, skip the
    // camera lerp but keep the GPS-loss and out-of-bounds checks above
    // active (those fully disable follow mode). Once the configured
    // inactivity delay elapses, clear the pause — the lerp below then
    // glides the camera smoothly back onto the GPS position.
    const camStore = useCameraStore.getState();
    if (camStore.gpsFollowState === "paused") {
      const delayMs =
        useSettingsStore.getState().followResumeDelaySec * 1000;
      if (Date.now() - camStore.followLastInteractionAt < delayMs) {
        return;
      }
      camStore.resumeFollow();
    }

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
