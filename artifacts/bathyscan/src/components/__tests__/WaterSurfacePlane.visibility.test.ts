/**
 * WaterSurfacePlane visibility — component-level tests.
 *
 * Tests the exported `applyWaterPlaneVisibility` function, which is the
 * exact function called inside the component's useFrame callback.  Using a
 * plain `{ visible: boolean }` object as the mesh stub lets us assert real
 * mesh.visible transitions without needing a WebGL / R3F Canvas context.
 *
 * Hysteresis rules (mirrored from the implementation comment):
 *  1. Gap zone (surfY > 0 && 0 < camY < surfY): always hide, reset belowSurface=false.
 *  2. Exit "below surface" (hide): camY > surfY + 0.5
 *  3. Enter "below surface" (show): camY < surfY - 0.5
 */
import { describe, it, expect } from "vitest";
import { applyWaterPlaneVisibility } from "../WaterSurfacePlane";

/** Create a minimal mesh stub with a mutable visible property. */
function makeMesh(visible = true): { visible: boolean } {
  return { visible };
}

/** Create a hysteresis ref, mirroring the useRef in the component. */
function makeState(initial = true): { current: boolean } {
  return { current: initial };
}

describe("applyWaterPlaneVisibility — gap zone (surfY > 0)", () => {
  it("camera in gap (camY=2, surfY=5) → mesh.visible = false", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, 2, 5);
    expect(mesh.visible).toBe(false);
    expect(state.current).toBe(false);
  });

  it("camera at low end of gap (camY=0.1, surfY=5) → mesh.visible = false", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, 0.1, 5);
    expect(mesh.visible).toBe(false);
  });

  it("camera at high end of gap (camY=4.9, surfY=5) → mesh.visible = false", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, 4.9, 5);
    expect(mesh.visible).toBe(false);
  });

  it("no gap when surfY=0 — camY=0.1 falls through to hysteresis, stays visible from initial state", () => {
    // surfY=0 → gap check is 0 > 0 which is false, so no forced hide
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, 0.1, 0);
    // 0.1 < surfY + 0.5 = 0.5 → does not trigger exit → stays visible
    expect(mesh.visible).toBe(true);
  });
});

describe("applyWaterPlaneVisibility — just below surface", () => {
  it("camera at -0.1 (just below surface, surfY=0) → mesh.visible = true (initial state)", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, -0.1, 0);
    expect(mesh.visible).toBe(true);
  });

  it("camera underwater at -5 (surfY=0) → mesh.visible = true", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, -5, 0);
    expect(mesh.visible).toBe(true);
  });

  it("camera at surfY - 0.6 re-enters visible after having exited (surfY=5)", () => {
    const mesh = makeMesh(false);
    const state = makeState(false); // was above surface
    applyWaterPlaneVisibility(mesh, state, 5 - 0.6, 5); // camY=4.4 → in gap zone!
    // 4.4 is in gap (0 < 4.4 < 5) → forced hidden
    expect(mesh.visible).toBe(false);
  });

  it("camera at -1 (underwater, surfY=5) re-enters visible after gap zone", () => {
    // Simulate: camera was hidden in gap, now goes underwater
    const mesh = makeMesh(false);
    const state = makeState(false);
    applyWaterPlaneVisibility(mesh, state, -1, 5);
    // -1 < surfY - 0.5 = 4.5 → enter below-surface → visible
    expect(mesh.visible).toBe(true);
    expect(state.current).toBe(true);
  });
});

describe("applyWaterPlaneVisibility — above surface (exit)", () => {
  it("camera at surfY + 0.6 → mesh.visible = false (exits visible state)", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, 5 + 0.6, 5);
    expect(mesh.visible).toBe(false);
    expect(state.current).toBe(false);
  });

  it("camera well above (surfY=0, camY=10) → mesh.visible = false", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    applyWaterPlaneVisibility(mesh, state, 10, 0);
    expect(mesh.visible).toBe(false);
  });
});

describe("applyWaterPlaneVisibility — hysteresis dead-band", () => {
  it("oscillating between surfY-0.4 and surfY+0.4 does not flip state (surfY=0)", () => {
    // Dead-band: -0.4 to +0.4 — neither exit (+0.5) nor enter (-0.5) threshold crossed
    const mesh = makeMesh(true);
    const state = makeState(true);
    for (const camY of [-0.4, 0.3, -0.3, 0.4, -0.4, 0.4]) {
      applyWaterPlaneVisibility(mesh, state, camY, 0);
    }
    expect(mesh.visible).toBe(true);
  });

  it("oscillating in dead-band from hidden state also does not flip", () => {
    const mesh = makeMesh(false);
    const state = makeState(false);
    for (const camY of [0.4, -0.4, 0.3, -0.3]) {
      applyWaterPlaneVisibility(mesh, state, camY, 0);
    }
    expect(mesh.visible).toBe(false);
  });
});

describe("applyWaterPlaneVisibility — full transition sequence", () => {
  it("underwater → gap → above surface shows correct visibility at each step", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);
    const surfY = 5;

    // Underwater: visible
    applyWaterPlaneVisibility(mesh, state, -10, surfY);
    expect(mesh.visible).toBe(true);

    // Rising into gap zone: forced hidden
    applyWaterPlaneVisibility(mesh, state, 2, surfY);
    expect(mesh.visible).toBe(false);

    // Still in gap: hidden
    applyWaterPlaneVisibility(mesh, state, 4, surfY);
    expect(mesh.visible).toBe(false);

    // Above surface: hidden
    applyWaterPlaneVisibility(mesh, state, 6, surfY);
    expect(mesh.visible).toBe(false);

    // Descend back through gap: hidden
    applyWaterPlaneVisibility(mesh, state, 3, surfY);
    expect(mesh.visible).toBe(false);

    // Back underwater: visible again
    applyWaterPlaneVisibility(mesh, state, -1, surfY);
    expect(mesh.visible).toBe(true);
  });

  it("surfY=0 standard case: below → exit at 0.6 → re-enter at -0.6", () => {
    const mesh = makeMesh(true);
    const state = makeState(true);

    applyWaterPlaneVisibility(mesh, state, -5, 0);
    expect(mesh.visible).toBe(true);

    applyWaterPlaneVisibility(mesh, state, 0.6, 0);
    expect(mesh.visible).toBe(false);

    applyWaterPlaneVisibility(mesh, state, -0.6, 0);
    expect(mesh.visible).toBe(true);
  });
});
