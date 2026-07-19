/**
 * useFlyControls — arrow key movement integration tests.
 *
 * Verifies that:
 * 1. ArrowUp/Down/Left/Right move the camera in the same direction as
 *    their WASD equivalents.
 * 2. Releasing an arrow key stops the movement.
 * 3. Diagonal simultaneous presses (ArrowUp + ArrowRight) produce both
 *    forward and rightward velocity components.
 * 4. preventDefault is called for each arrow code but NOT for unrelated keys.
 * 5. Arrow keys are additive — rebinding WASD does not disable the arrows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import * as THREE from "three";

// ── Capture the useFrame callback so tests can drive the frame loop ────────
let capturedFrameCb: ((state: unknown, delta: number) => void) | null = null;

const fakeCamera = new THREE.PerspectiveCamera();
const fakeCanvas = document.createElement("canvas");
document.body.appendChild(fakeCanvas);

vi.mock("@react-three/fiber", () => ({
  useThree: () => ({ camera: fakeCamera, gl: { domElement: fakeCanvas } }),
  useFrame: (cb: (state: unknown, delta: number) => void) => {
    capturedFrameCb = cb;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () => makeApiClientMock());

vi.mock("@/lib/context", () => ({
  FLY_SPEEDS_MPH: [30, 100, 250, 700, 2000],
  useAppState: () => ({
    speedIndex: 1,
    setSpeedIndex: vi.fn(),
    terrain: null,
    setCameraPos: vi.fn(),
    realisticMode: false,
    boatSpeedMph: 5,
  }),
}));

vi.mock("@/lib/markerGroupRef", () => ({
  markerGroupRef: { current: null },
}));

vi.mock("@/components/VirtualJoystick", () => ({
  useJoystickStore: { getState: () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0 }) },
}));

vi.mock("@/lib/markerActions", () => ({
  runMarkerDelete: vi.fn(),
}));

vi.mock("@/lib/resetCameraRegistry", () => ({
  registerResetCameraFn: vi.fn(),
  callRegisteredResetCamera: vi.fn(() => false),
}));

vi.mock("@/lib/terrainContextMenu", () => ({
  openCrosshairContextMenu: vi.fn(() => true),
  buildTerrainMenuItems: vi.fn(() => []),
}));

import { useFlyControls } from "@/hooks/useFlyControls";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

function mountHook() {
  const terrainMeshRef = React.createRef<THREE.Mesh | null>();
  const lightRef = React.createRef<THREE.PointLight | null>();
  return renderHook(() =>
    useFlyControls({
      terrainMeshRef: terrainMeshRef as React.RefObject<THREE.Mesh | null>,
      lightRef: lightRef as React.RefObject<THREE.PointLight | null>,
    }),
  );
}

/** Pump a single animation frame through the captured callback. */
function pumpFrame(delta = 0.016) {
  act(() => {
    capturedFrameCb?.({}, delta);
  });
}

beforeEach(() => {
  capturedFrameCb = null;
  fakeCamera.position.set(0, 0, 0);
  fakeCamera.rotation.set(0, 0, 0);
  fakeCamera.quaternion.set(0, 0, 0, 1);
  fakeCamera.updateMatrixWorld(true);
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers: sample camera displacement over one frame with a key held
// ---------------------------------------------------------------------------

function displacementForKey(code: string, delta = 0.5): THREE.Vector3 {
  const { unmount } = mountHook();
  const before = fakeCamera.position.clone();

  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
  });
  pumpFrame(delta);
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
  });

  const displacement = fakeCamera.position.clone().sub(before);
  unmount();
  return displacement;
}

describe("useFlyControls — arrow key camera movement", () => {
  it("ArrowUp moves the camera forward (same sign as KeyW)", () => {
    const viaWasd = displacementForKey("KeyW");
    fakeCamera.position.set(0, 0, 0);
    const viaArrow = displacementForKey("ArrowUp");

    expect(viaWasd.lengthSq()).toBeGreaterThan(0);
    expect(viaArrow.lengthSq()).toBeGreaterThan(0);
    expect(Math.sign(viaArrow.z)).toBe(Math.sign(viaWasd.z));
    expect(Math.sign(viaArrow.x)).toBe(Math.sign(viaWasd.x));
  });

  it("ArrowDown moves the camera backward (same sign as KeyS)", () => {
    const viaWasd = displacementForKey("KeyS");
    fakeCamera.position.set(0, 0, 0);
    const viaArrow = displacementForKey("ArrowDown");

    expect(viaWasd.lengthSq()).toBeGreaterThan(0);
    expect(viaArrow.lengthSq()).toBeGreaterThan(0);
    expect(Math.sign(viaArrow.z)).toBe(Math.sign(viaWasd.z));
  });

  it("ArrowLeft strafes the camera left (same sign as KeyA)", () => {
    const viaWasd = displacementForKey("KeyA");
    fakeCamera.position.set(0, 0, 0);
    const viaArrow = displacementForKey("ArrowLeft");

    expect(viaWasd.lengthSq()).toBeGreaterThan(0);
    expect(viaArrow.lengthSq()).toBeGreaterThan(0);
    expect(Math.sign(viaArrow.x)).toBe(Math.sign(viaWasd.x));
  });

  it("ArrowRight strafes the camera right (same sign as KeyD)", () => {
    const viaWasd = displacementForKey("KeyD");
    fakeCamera.position.set(0, 0, 0);
    const viaArrow = displacementForKey("ArrowRight");

    expect(viaWasd.lengthSq()).toBeGreaterThan(0);
    expect(viaArrow.lengthSq()).toBeGreaterThan(0);
    expect(Math.sign(viaArrow.x)).toBe(Math.sign(viaWasd.x));
  });

  it("releasing an arrow key stops camera movement", () => {
    const { unmount } = mountHook();
    fakeCamera.position.set(0, 0, 0);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true }));
    });
    pumpFrame(0.5);
    const posAfterPress = fakeCamera.position.clone();
    expect(posAfterPress.lengthSq()).toBeGreaterThan(0);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowUp", bubbles: true }));
    });
    pumpFrame(0.5);
    const posAfterRelease = fakeCamera.position.clone();

    expect(posAfterRelease.z).toBeCloseTo(posAfterPress.z, 5);
    unmount();
  });

  it("diagonal ArrowUp + ArrowRight produces both forward and rightward displacement", () => {
    const { unmount } = mountHook();
    fakeCamera.position.set(0, 0, 0);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true }));
    });
    pumpFrame(0.5);

    const d = fakeCamera.position.clone();
    expect(d.lengthSq()).toBeGreaterThan(0);

    const fwdOnly = displacementForKey("ArrowUp");
    const rightOnly = displacementForKey("ArrowRight");
    expect(Math.sign(d.z)).toBe(Math.sign(fwdOnly.z));
    expect(Math.sign(d.x)).toBe(Math.sign(rightOnly.x));

    unmount();
  });
});

describe("useFlyControls — arrow key preventDefault", () => {
  it("calls preventDefault on ArrowUp/Down/Left/Right keydown events", () => {
    const { unmount } = mountHook();

    for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      const ev = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true });
      const spy = vi.spyOn(ev, "preventDefault");
      act(() => {
        window.dispatchEvent(ev);
      });
      expect(spy, `expected preventDefault on ${code}`).toHaveBeenCalled();
    }

    unmount();
  });

  it("does NOT call preventDefault for unrelated keys (e.g. KeyT)", () => {
    const { unmount } = mountHook();

    const ev = new KeyboardEvent("keydown", { code: "KeyT", bubbles: true, cancelable: true });
    const spy = vi.spyOn(ev, "preventDefault");
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(spy).not.toHaveBeenCalled();

    unmount();
  });
});

describe("useFlyControls — arrow keys are additive (WASD rebind does not disable arrows)", () => {
  it("ArrowUp still moves forward when moveForward is rebound to KeyI", () => {
    useSettingsStore.getState().setKeyBinding("moveForward", "KeyI");

    fakeCamera.position.set(0, 0, 0);
    const viaArrow = displacementForKey("ArrowUp");
    expect(viaArrow.lengthSq()).toBeGreaterThan(0);
  });

  it("KeyI (rebound moveForward) still works alongside ArrowUp", () => {
    useSettingsStore.getState().setKeyBinding("moveForward", "KeyI");

    fakeCamera.position.set(0, 0, 0);
    const viaRebound = displacementForKey("KeyI");
    expect(viaRebound.lengthSq()).toBeGreaterThan(0);
  });
});
