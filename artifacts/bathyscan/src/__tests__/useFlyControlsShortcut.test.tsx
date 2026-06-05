/**
 * useFlyControls — shortcut routing.
 *
 * Verifies that the configurable crosshair-menu key + gamepad-button
 * bindings actually drive `openCrosshairContextMenu`, and that disabling
 * (or unbinding) them stops the trigger from firing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import * as THREE from "three";

// ── Spy on the helper the hook ultimately calls ───────────────────────────
const openCrosshairContextMenuSpy = vi.fn((_opts: unknown) => true);
vi.mock("@/lib/terrainContextMenu", () => ({
  openCrosshairContextMenu: (opts: unknown) => openCrosshairContextMenuSpy(opts),
  buildTerrainMenuItems: vi.fn(() => []),
}));

// ── Mock @react-three/fiber to feed a real camera + a real DOM canvas ────
const fakeCamera = new THREE.PerspectiveCamera();
const fakeCanvas = document.createElement("canvas");
document.body.appendChild(fakeCanvas);

vi.mock("@react-three/fiber", () => ({
  useThree: () => ({ camera: fakeCamera, gl: { domElement: fakeCanvas } }),
  useFrame: () => {},
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

// App-state context: provide everything the hook destructures.
const appStateValue = {
  speedIndex: 0,
  setSpeedIndex: vi.fn(),
  terrain: null as unknown,
  setCameraPos: vi.fn(),
  realisticMode: false,
  boatSpeedMph: 5,
};
vi.mock("@/lib/context", () => ({
  SPEEDS: [0.05, 0.15, 0.5, 1.5, 5.0],
  useAppState: () => appStateValue,
}));

// MarkerLayer module imports R3F at runtime — replace with a stub.
vi.mock("@/components/MarkerLayer", () => ({
  markerGroupRef: { current: null },
}));

// VirtualJoystick contains a zustand store; provide a no-op stand-in.
vi.mock("@/components/VirtualJoystick", () => ({
  useJoystickStore: { getState: () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0 }) },
}));

// markerActions reaches into mutation libs we'd rather not pull in.
vi.mock("@/lib/markerActions", () => ({
  runMarkerDelete: vi.fn(),
}));

// resetCameraRegistry is a zero-dep module that useFlyControls uses to
// register its resetCamera callback with the test-helper bridge.
// Replace with a no-op so this test file does not transitively pull in
// testHelpers → queryClient → QueryClient (which is not in the RQ mock).
vi.mock("@/lib/resetCameraRegistry", () => ({
  registerResetCameraFn: vi.fn(),
  callRegisteredResetCamera: vi.fn(() => false),
}));

// ── Imports under test (after the mocks) ─────────────────────────────────
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

beforeEach(() => {
  openCrosshairContextMenuSpy.mockClear();
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFlyControls — keyboard shortcut", () => {
  it("opens the crosshair menu when the configured key is pressed", () => {
    useSettingsStore.getState().setKeyBinding("crosshairMenu", "KeyQ");
    const { unmount } = mountHook();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
    });

    expect(openCrosshairContextMenuSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not open the menu when an unrelated key is pressed", () => {
    useSettingsStore.getState().setKeyBinding("crosshairMenu", "KeyQ");
    const { unmount } = mountHook();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP" }));
    });

    expect(openCrosshairContextMenuSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("follows a rebound key after the store updates", () => {
    useSettingsStore.getState().setKeyBinding("crosshairMenu", "KeyQ");
    const { unmount } = mountHook();

    // Rebind to KeyT — the ref-sync useEffect should pick this up.
    act(() => {
      useSettingsStore.getState().setKeyBinding("crosshairMenu", "KeyT");
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
    });
    expect(openCrosshairContextMenuSpy).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyT" }));
    });
    expect(openCrosshairContextMenuSpy).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("useFlyControls — gamepad shortcut", () => {
  // Drive `requestAnimationFrame` deterministically. The hook re-schedules
  // itself on every frame, so we manually pump a handful of frames.
  function pumpFrames(n: number) {
    for (let i = 0; i < n; i++) {
      act(() => {
        vi.advanceTimersByTime(20);
      });
    }
  }

  function installGamepad(buttons: boolean[]) {
    const pad = {
      index: 0,
      buttons: buttons.map((pressed) => ({ pressed, value: pressed ? 1 : 0, touched: pressed })),
      axes: [0, 0, 0, 0],
      connected: true,
      mapping: "standard",
      timestamp: performance.now(),
      id: "test-pad",
    } as unknown as Gamepad;
    (navigator as unknown as { getGamepads: () => (Gamepad | null)[] }).getGamepads =
      () => [pad];
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("opens the menu when the configured gamepad button transitions to pressed", () => {
    useSettingsStore.getState().setCrosshairMenuGamepadButton(3);
    // Start with no buttons pressed so the polling effect can snapshot the
    // baseline.
    installGamepad([false, false, false, false]);
    const { unmount } = mountHook();
    pumpFrames(2);
    expect(openCrosshairContextMenuSpy).not.toHaveBeenCalled();

    // Press the bound button — the next frame should detect the rising edge.
    installGamepad([false, false, false, true]);
    pumpFrames(2);

    expect(openCrosshairContextMenuSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("ignores presses on buttons other than the bound one", () => {
    useSettingsStore.getState().setCrosshairMenuGamepadButton(3);
    installGamepad([false, false, false, false]);
    const { unmount } = mountHook();
    pumpFrames(2);

    // Press button 0 (A / Cross) — should be ignored because binding is 3.
    installGamepad([true, false, false, false]);
    pumpFrames(2);

    expect(openCrosshairContextMenuSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("does nothing when the gamepad binding is disabled (null)", () => {
    useSettingsStore.getState().setCrosshairMenuGamepadButton(null);
    installGamepad([false, false, false, false]);
    const { unmount } = mountHook();
    pumpFrames(2);

    // Press what *was* the default button — should not trigger.
    installGamepad([false, false, false, true]);
    pumpFrames(2);

    expect(openCrosshairContextMenuSpy).not.toHaveBeenCalled();
    unmount();
  });
});
