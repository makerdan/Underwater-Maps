/**
 * FlyRouteAnimator — R3F canvas component that smoothly interpolates the
 * camera position through a sequence of waypoints stored in flyRouteStore.
 *
 * Lives inside <Canvas>. Reads flyRouteStore each frame and lerps the camera
 * toward the current target waypoint. When close enough it dwells for a short
 * pause, then advances to the next waypoint, until the route is complete.
 */
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useFlyRouteStore } from "@/lib/flyRouteStore";

const ARRIVE_THRESHOLD = 0.4;
const DWELL_SECONDS = 1.8;
const LERP_FACTOR = 0.045;

export const FlyRouteAnimator: React.FC = () => {
  const { camera } = useThree();
  const dwellingRef = useRef(false);
  const dwellStartRef = useRef(0);
  const prevTargetIndexRef = useRef(-1);
  const targetVecRef = useRef(new THREE.Vector3());

  useFrame((state) => {
    const store = useFlyRouteStore.getState();

    if (!store.active || store.waypoints.length === 0) {
      dwellingRef.current = false;
      prevTargetIndexRef.current = -1;
      return;
    }

    const { currentTargetIndex, waypoints } = store;

    if (prevTargetIndexRef.current !== currentTargetIndex) {
      prevTargetIndexRef.current = currentTargetIndex;
      dwellingRef.current = false;
      const wp = waypoints[currentTargetIndex];
      if (wp) targetVecRef.current.set(wp.x, wp.y, wp.z);
    }

    if (dwellingRef.current) {
      if (state.clock.elapsedTime - dwellStartRef.current > DWELL_SECONDS) {
        dwellingRef.current = false;
        store.nextWaypoint();
      }
      return;
    }

    const target = targetVecRef.current;
    const dist = camera.position.distanceTo(target);

    if (dist < ARRIVE_THRESHOLD) {
      dwellingRef.current = true;
      dwellStartRef.current = state.clock.elapsedTime;
      return;
    }

    camera.position.lerp(target, LERP_FACTOR);
  });

  return null;
};
