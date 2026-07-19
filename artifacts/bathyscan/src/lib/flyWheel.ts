/**
 * Pure wheel-event handler logic for fly mode. Extracted from
 * `useFlyControls` so it can be:
 *   1. Composed inside the React hook (so production behaviour is unchanged).
 *   2. Driven directly by Playwright e2e tests via `testHelpers`, since the
 *      Three.js Canvas can't initialise WebGL in our headless test runs.
 *
 * The function mutates `camera.position` for plain-wheel dolly, and returns
 * a result object describing what should happen to the speed tier (the
 * caller wires this up to the relevant store).
 */
import * as THREE from "three";
import { computeWheelDolly } from "./zoomMath";
import { FLY_SPEEDS_MPH } from "./context";

export interface FlyWheelConfig {
  mouseZoomSensitivity: number;
  touchpadZoomSensitivity: number;
  realisticMode: boolean;
}

export interface FlyWheelResult {
  /** World-units the camera was dollied along its view direction (0 for shift-wheel). */
  dollyApplied: number;
  /** New speed-tier index, or null if unchanged. */
  newSpeedIndex: number | null;
}

const tmpDir = new THREE.Vector3();

export function processFlyWheel(
  camera: THREE.Camera,
  event: Pick<WheelEvent, "deltaY" | "deltaMode" | "shiftKey">,
  currentSpeedIndex: number,
  config: FlyWheelConfig,
): FlyWheelResult {
  // Shift+wheel → step the speed tier. Disabled in realistic (boat-MPH) mode.
  if (event.shiftKey) {
    if (config.realisticMode) {
      return { dollyApplied: 0, newSpeedIndex: null };
    }
    if (event.deltaY > 0) {
      const next = Math.min(FLY_SPEEDS_MPH.length - 1, currentSpeedIndex + 1);
      return {
        dollyApplied: 0,
        newSpeedIndex: next === currentSpeedIndex ? null : next,
      };
    }
    const prev = Math.max(0, currentSpeedIndex - 1);
    return {
      dollyApplied: 0,
      newSpeedIndex: prev === currentSpeedIndex ? null : prev,
    };
  }

  // Plain wheel → dolly camera along its current view direction.
  const dolly = computeWheelDolly(
    event.deltaY,
    event.deltaMode,
    config.mouseZoomSensitivity,
    config.touchpadZoomSensitivity,
  );
  camera.getWorldDirection(tmpDir);
  camera.position.addScaledVector(tmpDir, dolly);
  return { dollyApplied: dolly, newSpeedIndex: null };
}
