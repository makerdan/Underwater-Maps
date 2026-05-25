import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { applyOrbitDrag, applyOrbitDolly, ORBIT_DRAG_SCALE } from "@/lib/orbitMath";

function makeCamera(pos: [number, number, number]) {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(...pos);
  cam.lookAt(0, 0, 0);
  return cam;
}

describe("applyOrbitDrag", () => {
  it("rotates the camera around the target by the expected yaw without changing distance", () => {
    const target = new THREE.Vector3(0, 0, 0);
    const cam = makeCamera([0, 0, 10]);
    const startDist = cam.position.distanceTo(target);

    // Drag dx=100, dy=0 with sensitivity 1 → yaw = -100 * 0.005 = -0.5 rad.
    applyOrbitDrag(cam, target, 100, 0, { sensitivity: 1, invertY: false });

    const endDist = cam.position.distanceTo(target);
    expect(endDist).toBeCloseTo(startDist, 5);

    // Expected position: rotate (0,0,10) around Y by -0.5 rad.
    const expected = new THREE.Vector3(0, 0, 10).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -100 * ORBIT_DRAG_SCALE * 1,
    );
    expect(cam.position.x).toBeCloseTo(expected.x, 4);
    expect(cam.position.y).toBeCloseTo(expected.y, 4);
    expect(cam.position.z).toBeCloseTo(expected.z, 4);
  });

  it("keeps the camera looking at the target after a drag", () => {
    const target = new THREE.Vector3(2, -3, 5);
    const cam = makeCamera([12, 4, 5]);
    applyOrbitDrag(cam, target, 30, -20, { sensitivity: 1.5, invertY: false });

    const look = new THREE.Vector3();
    cam.getWorldDirection(look);
    const toTarget = new THREE.Vector3().subVectors(target, cam.position).normalize();
    expect(look.x).toBeCloseTo(toTarget.x, 3);
    expect(look.y).toBeCloseTo(toTarget.y, 3);
    expect(look.z).toBeCloseTo(toTarget.z, 3);
  });

  it("vertical drag inverts when invertY is set", () => {
    const target = new THREE.Vector3(0, 0, 0);
    const camA = makeCamera([0, 0, 10]);
    const camB = makeCamera([0, 0, 10]);
    applyOrbitDrag(camA, target, 0, 50, { sensitivity: 1, invertY: false });
    applyOrbitDrag(camB, target, 0, -50, { sensitivity: 1, invertY: true });
    expect(camA.position.y).toBeCloseTo(camB.position.y, 5);
    expect(camA.position.z).toBeCloseTo(camB.position.z, 5);
  });

  it("clamps pitch so the camera does not flip past vertical", () => {
    const target = new THREE.Vector3(0, 0, 0);
    const cam = makeCamera([0, 0, 10]);
    // Huge downward drag — would otherwise rotate past the south pole.
    applyOrbitDrag(cam, target, 0, 100000, { sensitivity: 5, invertY: false });
    // Still above the target (camera y > target.y - epsilon).
    expect(Math.abs(cam.position.y)).toBeLessThan(10);
    // Distance preserved.
    expect(cam.position.distanceTo(target)).toBeCloseTo(10, 4);
  });
});

describe("applyOrbitDolly", () => {
  it("moves the camera closer to the target on positive factor", () => {
    const target = new THREE.Vector3(0, 0, 0);
    const cam = makeCamera([0, 0, 10]);
    applyOrbitDolly(cam, target, 0.5);
    expect(cam.position.distanceTo(target)).toBeCloseTo(5, 4);
  });

  it("moves the camera away from the target on negative factor", () => {
    const target = new THREE.Vector3(0, 0, 0);
    const cam = makeCamera([0, 0, 10]);
    applyOrbitDolly(cam, target, -1);
    expect(cam.position.distanceTo(target)).toBeCloseTo(20, 4);
  });

  it("clamps minimum distance so the camera never crosses through the target", () => {
    const target = new THREE.Vector3(0, 0, 0);
    const cam = makeCamera([0, 0, 1]);
    applyOrbitDolly(cam, target, 5);
    expect(cam.position.distanceTo(target)).toBeGreaterThanOrEqual(0.5);
  });
});
