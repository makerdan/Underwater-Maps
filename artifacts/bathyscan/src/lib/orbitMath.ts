import * as THREE from "three";

/**
 * Base scale factor for orbit drag: 1 px of pointer movement ≈ this many
 * radians of rotation, before the user's mouseSensitivity multiplier is
 * applied. Matches the fly-mode mouse-look feel.
 */
export const ORBIT_DRAG_SCALE = 0.005;

/**
 * Pixel threshold below which a right-click drag is treated as a click
 * (and routed to the context menu) rather than committing to an orbit
 * gesture.
 */
export const ORBIT_CLICK_VS_DRAG_PX = 4;

/** Clamp pitch (polar angle) so we never flip past straight up/down. */
const PHI_MIN = 0.05;
const PHI_MAX = Math.PI - 0.05;

export interface OrbitDragOptions {
  /** Per-pixel sensitivity multiplier (typically `mouseSensitivity`). */
  sensitivity: number;
  /** If true, vertical drag is inverted (matches invertMouseY). */
  invertY: boolean;
}

/**
 * Rotate a camera around `target` by a pointer drag delta. Mutates the
 * camera's position and orientation: position becomes `target + rotated
 * offset`, orientation looks at `target`.
 *
 * - dx (horizontal drag) → yaw around world-up axis.
 * - dy (vertical drag)   → pitch around the camera's right vector.
 * Pitch is clamped so the camera never flips past vertical.
 *
 * Exported as a pure helper so it can be unit-tested without R3F.
 */
export function applyOrbitDrag(
  camera: THREE.Camera,
  target: THREE.Vector3,
  dx: number,
  dy: number,
  opts: OrbitDragOptions,
): void {
  const sens = opts.sensitivity * ORBIT_DRAG_SCALE;
  const dyEff = opts.invertY ? -dy : dy;

  const offset = new THREE.Vector3().subVectors(camera.position, target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta -= dx * sens;
  spherical.phi = Math.max(PHI_MIN, Math.min(PHI_MAX, spherical.phi + dyEff * sens));
  offset.setFromSpherical(spherical);

  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}

/**
 * Dolly the camera toward/away from `target` by `factor`. `factor > 0`
 * moves the camera closer (zoom in); `factor < 0` moves it away. The
 * camera continues to look at `target`. Camera never crosses through the
 * target — distance is clamped to a small minimum.
 */
export function applyOrbitDolly(
  camera: THREE.Camera,
  target: THREE.Vector3,
  factor: number,
): void {
  const offset = new THREE.Vector3().subVectors(camera.position, target);
  const dist = offset.length();
  if (dist < 1e-4) return;
  const newDist = Math.max(0.5, dist * (1 - factor));
  offset.multiplyScalar(newDist / dist);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}
