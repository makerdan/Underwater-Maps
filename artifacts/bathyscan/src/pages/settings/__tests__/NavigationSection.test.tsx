/**
 * NavigationSection unit tests.
 *
 * Covers:
 *   - Renders without crashing
 *   - Key controls present (mouse sensitivity, invert mouse Y, BASICS header)
 *   - Reset all key bindings button is present
 *   - Save and reset buttons (SectionActionsRow sections=["camera","shortcuts"]) are present
 *   - Clicking reset calls resetSection for "camera" and "shortcuts"
 *   - Fixed shortcuts section renders
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => {
  const resetSection = vi.fn();
  const resetAllKeyBindings = vi.fn();
  return { resetSection, resetAllKeyBindings };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    defaultSpeedTier: 2,
    setDefaultSpeedTier: vi.fn(),
    mouseSensitivity: 1.0,
    setMouseSensitivity: vi.fn(),
    invertMouseY: false,
    setInvertMouseY: vi.fn(),
    mouseZoomSensitivity: 1.0,
    setMouseZoomSensitivity: vi.fn(),
    touchpadZoomSensitivity: 1.0,
    setTouchpadZoomSensitivity: vi.fn(),
    pinchZoomSensitivity: 1.0,
    setPinchZoomSensitivity: vi.fn(),
    fieldOfView: 60,
    setFieldOfView: vi.fn(),
    renderDistance: 800,
    setRenderDistance: vi.fn(),
    cameraSpawnBehaviour: "last" as const,
    setCameraSpawnBehaviour: vi.fn(),
    joystickMode: "auto" as const,
    setJoystickMode: vi.fn(),
    showJoystickInOrbit: false,
    setShowJoystickInOrbit: vi.fn(),
    keyBindings: {} as Record<string, string>,
    resetAllKeyBindings: h.resetAllKeyBindings,
    syncedSnapshot: null,
    lastSyncedAt: null,
    resetSection: h.resetSection,
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
    SHORTCUT_ACTIONS: [
      { id: "moveForward", label: "Move forward", description: "", defaultCode: "KeyW", group: "movement" },
      { id: "moveBackward", label: "Move backward", description: "", defaultCode: "KeyS", group: "movement" },
    ],
    SHORTCUT_GROUPS: [
      { id: "movement", title: "MOVEMENT" },
    ],
    DEFAULT_KEY_BINDINGS: { moveForward: "KeyW", moveBackward: "KeyS" },
    findBindingConflicts: () => new Map(),
  };
});

import { NavigationSection } from "../NavigationSection";

describe("NavigationSection", () => {
  beforeEach(() => {
    h.resetSection.mockClear();
    h.resetAllKeyBindings.mockClear();
  });

  it("renders without crashing", () => {
    const { container } = render(<NavigationSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the NAVIGATION heading text", () => {
    render(<NavigationSection />);
    expect(screen.getByText(/NAVIGATION/i)).toBeInTheDocument();
  });

  it("renders the BASICS card header", () => {
    render(<NavigationSection />);
    expect(screen.getByText("BASICS")).toBeInTheDocument();
  });

  it("renders Mouse Sensitivity label", () => {
    render(<NavigationSection />);
    expect(screen.getByText("Mouse Sensitivity")).toBeInTheDocument();
  });

  it("renders Invert Mouse Y label", () => {
    render(<NavigationSection />);
    expect(screen.getByText("Invert Mouse Y")).toBeInTheDocument();
  });

  it("renders the KEYBOARD SHORTCUTS card header", () => {
    render(<NavigationSection />);
    expect(screen.getByText("KEYBOARD SHORTCUTS")).toBeInTheDocument();
  });

  it("renders FIXED CONTROLS card header", () => {
    render(<NavigationSection />);
    expect(screen.getByText("FIXED CONTROLS")).toBeInTheDocument();
  });

  it("renders RESET ALL KEY BINDINGS button", () => {
    render(<NavigationSection />);
    expect(screen.getByTestId("reset-all-bindings-btn")).toBeInTheDocument();
  });

  it("renders the save button for camera section", () => {
    render(<NavigationSection />);
    expect(screen.getByTestId("save-section-camera-btn")).toBeInTheDocument();
  });

  it("renders the reset button for camera section", () => {
    render(<NavigationSection />);
    expect(screen.getByTestId("reset-section-camera-btn")).toBeInTheDocument();
  });

  it("clicking the reset button calls resetSection for camera and shortcuts", () => {
    render(<NavigationSection />);
    fireEvent.click(screen.getByTestId("reset-section-camera-btn"));
    expect(h.resetSection).toHaveBeenCalledWith("camera");
    expect(h.resetSection).toHaveBeenCalledWith("shortcuts");
  });

  it("renders movement shortcut group header", () => {
    render(<NavigationSection />);
    expect(screen.getByText("MOVEMENT")).toBeInTheDocument();
  });

  it("renders key binding capture for moveForward action", () => {
    render(<NavigationSection />);
    expect(screen.getByTestId("key-binding-moveForward")).toBeInTheDocument();
  });
});
