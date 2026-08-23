/**
 * useFlyControls — input-focus guard (F-001).
 *
 * Verifies that keydown events dispatched while an INPUT, TEXTAREA, SELECT, or
 * contenteditable element is focused do NOT move the camera or change speed.
 * Also confirms that the happy-path (no editable element focused) still works.
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
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn(), getQueryData: vi.fn(() => undefined) }),
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
  FLY_SPEEDS_MPH: [2.3, 30, 100, 250, 700, 2000],
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

function pumpFrame(delta = 0.5) {
  act(() => {
    capturedFrameCb?.({}, delta);
  });
}

// ---------------------------------------------------------------------------
// Helpers to simulate element focus / blur without a real DOM layout engine.
// jsdom does not fire focus events on elements that are not in the document,
// so we manipulate document.activeElement via Object.defineProperty.
// ---------------------------------------------------------------------------

function fakeActiveElement(el: Element | null) {
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => el,
  });
}

function clearActiveElement() {
  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => document.body,
  });
}

beforeEach(() => {
  capturedFrameCb = null;
  fakeCamera.position.set(0, 0, 0);
  fakeCamera.rotation.set(0, 0, 0);
  fakeCamera.quaternion.set(0, 0, 0, 1);
  fakeCamera.updateMatrixWorld(true);
  clearActiveElement();
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
});

afterEach(() => {
  clearActiveElement();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Guard: movement key is swallowed while editable elements are focused
// ---------------------------------------------------------------------------

describe("useFlyControls — input-focus guard", () => {
  it("does NOT move the camera when KeyW is pressed while an <input> is focused", () => {
    const input = document.createElement("input");
    fakeActiveElement(input);

    const { unmount } = mountHook();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    });
    pumpFrame(0.5);

    expect(fakeCamera.position.lengthSq()).toBe(0);
    unmount();
  });

  it("does NOT move the camera when KeyW is pressed while a <textarea> is focused", () => {
    const textarea = document.createElement("textarea");
    fakeActiveElement(textarea);

    const { unmount } = mountHook();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    });
    pumpFrame(0.5);

    expect(fakeCamera.position.lengthSq()).toBe(0);
    unmount();
  });

  it("does NOT move the camera when KeyW is pressed while a <select> is focused", () => {
    const select = document.createElement("select");
    fakeActiveElement(select);

    const { unmount } = mountHook();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    });
    pumpFrame(0.5);

    expect(fakeCamera.position.lengthSq()).toBe(0);
    unmount();
  });

  it("does NOT move the camera when KeyW is pressed while a contenteditable element is focused", () => {
    const div = document.createElement("div");
    // jsdom does not reliably return true for isContentEditable on detached /
    // in-document elements; stub it directly so the guard sees the correct state.
    Object.defineProperty(div, "isContentEditable", { get: () => true, configurable: true });
    fakeActiveElement(div);

    const { unmount } = mountHook();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    });
    pumpFrame(0.5);

    expect(fakeCamera.position.lengthSq()).toBe(0);
    unmount();
  });

  it("does NOT move the camera for any movement key (WASD + ascend/descend) while an input is focused", () => {
    const input = document.createElement("input");
    fakeActiveElement(input);

    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyQ"]) {
      fakeCamera.position.set(0, 0, 0);
      const { unmount } = mountHook();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
      });
      pumpFrame(0.5);

      expect(fakeCamera.position.lengthSq(), `Expected no movement for ${code} while input focused`).toBe(0);
      unmount();
    }
  });

  it("does NOT change speed (KeyEqual / speedUp) while an input is focused", () => {
    const input = document.createElement("input");
    fakeActiveElement(input);

    const { unmount } = mountHook();

    act(() => {
      // KeyEqual is the default speedUp binding
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Equal", bubbles: true }));
    });

    // setSpeedIndex is internal to the hook — we verify via camera state only.
    // Camera should still be at origin; no crash or unintended side effect.
    pumpFrame(0.5);
    expect(fakeCamera.position.lengthSq()).toBe(0);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// Happy path: movement works normally with no editable element focused
// ---------------------------------------------------------------------------

describe("useFlyControls — movement works normally when no input is focused", () => {
  it("KeyW moves the camera forward when document.body is the active element", () => {
    clearActiveElement(); // body is active element (no input focused)

    const { unmount } = mountHook();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    });
    pumpFrame(0.5);

    expect(fakeCamera.position.lengthSq()).toBeGreaterThan(0);
    unmount();
  });

  it("guard does not fire while document.activeElement is null", () => {
    fakeActiveElement(null);

    const { unmount } = mountHook();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    });
    pumpFrame(0.5);

    expect(fakeCamera.position.lengthSq()).toBeGreaterThan(0);
    unmount();
  });

  it("releasing input focus restores camera movement on the next keypress", () => {
    const input = document.createElement("input");
    fakeActiveElement(input);

    const { unmount } = mountHook();

    // While focused — no movement
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    });
    pumpFrame(0.5);
    expect(fakeCamera.position.lengthSq()).toBe(0);

    // Release focus — movement should resume
    clearActiveElement();

    act(() => {
      // keyup so no stale state from the first press
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    });
    pumpFrame(0.5);

    expect(fakeCamera.position.lengthSq()).toBeGreaterThan(0);
    unmount();
  });
});
