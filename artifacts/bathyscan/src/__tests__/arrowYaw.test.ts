import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  arrowYawForDirection,
  headingVector,
} from "@/components/DirectionArrowField";

/**
 * The arrow primitive's tip points along -Z by default (the 2D shape's +Y
 * tip rotated down to -Z by rotateX(-PI/2) inside buildArrowGeometry). For
 * any meteorological bearing the per-instance Y-rotation must rotate that
 * default tip onto the same heading vector used to advance the instances
 * each frame. If yaw and drift disagree the arrowhead visibly points the
 * opposite way from where the arrow is sliding — the bug this test guards.
 */
function rotatedTip(directionDeg: number): [number, number] {
  const tip = new THREE.Vector3(0, 0, -1);
  tip.applyAxisAngle(new THREE.Vector3(0, 1, 0), arrowYawForDirection(directionDeg));
  return [tip.x, tip.z];
}

describe("arrowYawForDirection", () => {
  const cases: Array<[string, number]> = [
    ["north", 0],
    ["east", 90],
    ["south", 180],
    ["west", 270],
    ["northeast", 45],
    ["southeast", 135],
    ["southwest", 225],
    ["northwest", 315],
  ];

  for (const [name, bearing] of cases) {
    it(`aligns rotated tip with the drift heading for ${name} (${bearing}°)`, () => {
      const [tipX, tipZ] = rotatedTip(bearing);
      const [hx, hz] = headingVector(bearing);
      expect(tipX).toBeCloseTo(hx, 6);
      expect(tipZ).toBeCloseTo(hz, 6);
    });
  }
});
