/**
 * Pure helpers for translating raw input events into camera-dolly distances.
 *
 * Extracted so the fly-mode wheel/pinch handlers can be unit-tested without
 * needing a real three.js Canvas + R3F environment.
 */

/** Base scale factor: 1 wheel notch (deltaY ≈ 100) ≈ 2 world units of dolly. */
export const WHEEL_DOLLY_SCALE = 0.02;

/** Base scale factor for pinch: 1 px of pinch-distance change ≈ 0.05 units. */
export const PINCH_DOLLY_SCALE = 0.05;

/**
 * Heuristic: a `WheelEvent` whose deltaMode is pixels (0) AND whose magnitude
 * is small / fractional is almost certainly a trackpad two-finger swipe.
 * Classic mouse wheel notches arrive as multiples of ~100 in pixel mode, or
 * with deltaMode === 1 (lines).
 */
export function isTouchpadWheel(deltaY: number, deltaMode: number): boolean {
  return deltaMode === 0 && Math.abs(deltaY) < 50;
}

/**
 * Compute how far to dolly the camera along its view direction in response to
 * a wheel event. Positive return = forward (zoom in), negative = backward.
 *
 * Scrolling up (negative deltaY) zooms IN by convention, matching MapControls.
 */
export function computeWheelDolly(
  deltaY: number,
  deltaMode: number,
  mouseZoomSens: number,
  touchpadZoomSens: number,
): number {
  const sens = isTouchpadWheel(deltaY, deltaMode) ? touchpadZoomSens : mouseZoomSens;
  return -deltaY * WHEEL_DOLLY_SCALE * sens;
}

/**
 * Compute dolly distance from a pinch-distance delta (current − previous, in
 * pixels). Spreading fingers apart (positive delta) zooms IN.
 */
export function computePinchDolly(pinchDelta: number, pinchSens: number): number {
  return pinchDelta * PINCH_DOLLY_SCALE * pinchSens;
}
