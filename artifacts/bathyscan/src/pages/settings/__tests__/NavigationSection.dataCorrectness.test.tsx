/**
 * NavigationSection data-correctness regression tests.
 *
 * Covers: out-of-range and NaN slider values are clamped before reaching the
 * range input so the HTML never renders invalid state.
 *
 * One test per slider field:
 *   mouseSensitivity, mouseZoomSensitivity, touchpadZoomSensitivity,
 *   pinchZoomSensitivity, fieldOfView, renderDistance
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => {
  const data = {
    mouseSensitivity: 1.0,
    mouseZoomSensitivity: 1.0,
    touchpadZoomSensitivity: 1.0,
    pinchZoomSensitivity: 1.0,
    fieldOfView: 45,
    renderDistance: 400,
    defaultSpeedTier: 2,
  };
  return { data };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    defaultSpeedTier: h.data.defaultSpeedTier,
    setDefaultSpeedTier: vi.fn(),
    mouseSensitivity: h.data.mouseSensitivity,
    setMouseSensitivity: vi.fn(),
    invertMouseY: false,
    setInvertMouseY: vi.fn(),
    mouseZoomSensitivity: h.data.mouseZoomSensitivity,
    setMouseZoomSensitivity: vi.fn(),
    touchpadZoomSensitivity: h.data.touchpadZoomSensitivity,
    setTouchpadZoomSensitivity: vi.fn(),
    pinchZoomSensitivity: h.data.pinchZoomSensitivity,
    setPinchZoomSensitivity: vi.fn(),
    fieldOfView: h.data.fieldOfView,
    setFieldOfView: vi.fn(),
    renderDistance: h.data.renderDistance,
    setRenderDistance: vi.fn(),
    cameraSpawnBehaviour: "last" as const,
    setCameraSpawnBehaviour: vi.fn(),
    joystickMode: "auto" as const,
    setJoystickMode: vi.fn(),
    showJoystickInOrbit: false,
    setShowJoystickInOrbit: vi.fn(),
    keyBindings: {} as Record<string, string>,
    resetAllKeyBindings: vi.fn(),
    syncedSnapshot: null,
    lastSyncedAt: null,
    resetSection: vi.fn(),
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => state(),
      setState: vi.fn(),
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

vi.mock("@/components/AdvancedDisclosure", () => ({
  AdvancedDisclosure: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="advanced-disclosure">{children}</div>
  ),
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/pages/settings/components/SyncContext", () => ({
  SectionActionsRow: () => null,
}));

vi.mock("@/pages/settings/components/KeyBindingCapture", () => ({
  KeyBindingCapture: ({ action }: { action: string }) => (
    <div data-testid={`key-binding-${action}`} />
  ),
  CrosshairMenuGamepadCapture: () => <div data-testid="crosshair-gamepad-capture" />,
}));

vi.mock("@/lib/keyBindings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/keyBindings")>();
  return {
    ...actual,
    SHORTCUT_ACTIONS: [],
    SHORTCUT_GROUPS: [],
    DEFAULT_KEY_BINDINGS: {},
    findBindingConflicts: () => new Map(),
  };
});

import { NavigationSection } from "../NavigationSection";

beforeEach(() => {
  h.data.mouseSensitivity = 1.0;
  h.data.mouseZoomSensitivity = 1.0;
  h.data.touchpadZoomSensitivity = 1.0;
  h.data.pinchZoomSensitivity = 1.0;
  h.data.fieldOfView = 45;
  h.data.renderDistance = 400;
  h.data.defaultSpeedTier = 2;
});

describe("NavigationSection — mouse sensitivity slider clamping", () => {
  it("clamps an out-of-range mouseSensitivity above max to 3.0", () => {
    h.data.mouseSensitivity = 99;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Mouse Sensitivity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(3.0);
  });

  it("replaces NaN mouseSensitivity with the field default (1.0)", () => {
    h.data.mouseSensitivity = NaN;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Mouse Sensitivity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1.0);
  });

  it("clamps an out-of-range mouseSensitivity below min to 0.1", () => {
    h.data.mouseSensitivity = -5;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Mouse Sensitivity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(0.1);
  });
});

describe("NavigationSection — mouseZoomSensitivity slider clamping", () => {
  it("clamps an out-of-range mouseZoomSensitivity above max to 3.0", () => {
    h.data.mouseZoomSensitivity = 50;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Mouse Wheel Zoom Sensitivity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(3.0);
  });

  it("replaces NaN mouseZoomSensitivity with the field default (1.0)", () => {
    h.data.mouseZoomSensitivity = NaN;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Mouse Wheel Zoom Sensitivity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1.0);
  });
});

describe("NavigationSection — touchpadZoomSensitivity slider clamping", () => {
  it("clamps an out-of-range touchpadZoomSensitivity above max to 3.0", () => {
    h.data.touchpadZoomSensitivity = 100;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Touchpad Zoom Sensitivity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(3.0);
  });

  it("replaces NaN touchpadZoomSensitivity with the field default (1.0)", () => {
    h.data.touchpadZoomSensitivity = NaN;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Touchpad Zoom Sensitivity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1.0);
  });
});

describe("NavigationSection — pinchZoomSensitivity slider clamping", () => {
  it("clamps an out-of-range pinchZoomSensitivity above max to 3.0", () => {
    h.data.pinchZoomSensitivity = 999;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Mobile Pinch Zoom Sensitivity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(3.0);
  });

  it("replaces NaN pinchZoomSensitivity with the field default (1.0)", () => {
    h.data.pinchZoomSensitivity = NaN;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Mobile Pinch Zoom Sensitivity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1.0);
  });
});

describe("NavigationSection — fieldOfView slider clamping", () => {
  it("clamps an out-of-range fieldOfView above max to 90", () => {
    h.data.fieldOfView = 180;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Field of View") as HTMLInputElement;
    expect(Number(slider.value)).toBe(90);
  });

  it("clamps an out-of-range fieldOfView below min to 30", () => {
    h.data.fieldOfView = 5;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Field of View") as HTMLInputElement;
    expect(Number(slider.value)).toBe(30);
  });

  it("replaces NaN fieldOfView with the field default (45)", () => {
    h.data.fieldOfView = NaN;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Field of View") as HTMLInputElement;
    expect(Number(slider.value)).toBe(45);
  });
});

describe("NavigationSection — renderDistance slider clamping", () => {
  it("clamps an out-of-range renderDistance above max to 2000", () => {
    h.data.renderDistance = 9999;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Render Distance") as HTMLInputElement;
    expect(Number(slider.value)).toBe(2000);
  });

  it("clamps an out-of-range renderDistance below min to 100", () => {
    h.data.renderDistance = 0;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Render Distance") as HTMLInputElement;
    expect(Number(slider.value)).toBe(100);
  });

  it("replaces NaN renderDistance with the field default (400)", () => {
    h.data.renderDistance = NaN;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Render Distance") as HTMLInputElement;
    expect(Number(slider.value)).toBe(400);
  });
});

describe("NavigationSection — defaultSpeedTier inline slider clamping", () => {
  it("clamps defaultSpeedTier above max to 4", () => {
    h.data.defaultSpeedTier = 99;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Default Speed Tier") as HTMLInputElement;
    expect(Number(slider.value)).toBe(4);
  });

  it("clamps defaultSpeedTier below min to 0", () => {
    h.data.defaultSpeedTier = -5;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Default Speed Tier") as HTMLInputElement;
    expect(Number(slider.value)).toBe(0);
  });

  it("replaces NaN defaultSpeedTier with the field default (2)", () => {
    h.data.defaultSpeedTier = NaN;
    render(<NavigationSection />);
    const slider = screen.getByLabelText("Default Speed Tier") as HTMLInputElement;
    expect(Number(slider.value)).toBe(2);
  });
});
