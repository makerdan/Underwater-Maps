import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  computeWheelDolly,
  computePinchDolly,
  isTouchpadWheel,
  WHEEL_DOLLY_SCALE,
} from "@/lib/zoomMath";

describe("zoomMath", () => {
  it("classifies mouse wheel notches vs. trackpad swipes", () => {
    expect(isTouchpadWheel(120, 0)).toBe(false); // classic mouse notch
    expect(isTouchpadWheel(-100, 1)).toBe(false); // line mode = mouse
    expect(isTouchpadWheel(8, 0)).toBe(true); // small pixel-mode = trackpad
    expect(isTouchpadWheel(-3.5, 0)).toBe(true);
  });

  it("plain mouse wheel produces a forward/backward dolly with the right sign", () => {
    // Scrolling up (negative deltaY) → forward dolly (positive return).
    expect(computeWheelDolly(-100, 0, 1, 1)).toBeCloseTo(100 * WHEEL_DOLLY_SCALE);
    // Scrolling down → backward dolly.
    expect(computeWheelDolly(100, 0, 1, 1)).toBeCloseTo(-100 * WHEEL_DOLLY_SCALE);
  });

  it("mouseZoomSensitivity multiplier scales the mouse-notch dolly distance", () => {
    const a = computeWheelDolly(-100, 0, 1, 1);
    const b = computeWheelDolly(-100, 0, 2, 1);
    const c = computeWheelDolly(-100, 0, 0.5, 1);
    expect(b).toBeCloseTo(a * 2);
    expect(c).toBeCloseTo(a * 0.5);
  });

  it("touchpadZoomSensitivity scales trackpad swipes but not mouse notches", () => {
    // Small delta → trackpad path → touchpad sens applies.
    const tp1 = computeWheelDolly(-8, 0, 1, 1);
    const tp2 = computeWheelDolly(-8, 0, 1, 3);
    expect(tp2).toBeCloseTo(tp1 * 3);

    // Large delta → mouse path → touchpad sens is ignored.
    const mouseA = computeWheelDolly(-120, 0, 1, 1);
    const mouseB = computeWheelDolly(-120, 0, 1, 3);
    expect(mouseB).toBeCloseTo(mouseA);
  });

  it("pinch delta scales with pinchZoomSensitivity", () => {
    const d1 = computePinchDolly(20, 1);
    const d2 = computePinchDolly(20, 2);
    expect(d2).toBeCloseTo(d1 * 2);
    // Spreading apart (positive delta) zooms IN (positive dolly).
    expect(computePinchDolly(15, 1)).toBeGreaterThan(0);
    expect(computePinchDolly(-15, 1)).toBeLessThan(0);
  });

  it("dolly applied along view direction moves a camera forward when scrolling up", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0); // looking down -Z
    const dolly = computeWheelDolly(-100, 0, 1, 1);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    camera.position.addScaledVector(dir, dolly);
    // Forward dolly along -Z → z should decrease.
    expect(camera.position.z).toBeLessThan(10);
  });
});
