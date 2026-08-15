/**
 * KeyBindingCapture / CrosshairMenuGamepadCapture regression tests.
 *
 * Covers the task-3800 done-looks-like scenarios:
 *   (a) unknown action ID → fallback render, no crash
 *   (b) modifier key captured correctly
 *   (c) DISABLE/RESET cancel active gamepad capture
 *   (d) RESET cancels active keyboard capture
 *   (e) gamepad API absent → immediate inline error message
 *   (f) non-standard gamepad → not accepted (before and during capture)
 * Plus: window blur cancels keyboard capture, Escape cancels capture,
 * and empty-string bindings display as the default (unset ≡ default).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Plain module-level mutable state; the mock factory only closes over it
// (never dereferences it at module init), so no vi.hoisted needed.
const storeState = {
  keyBindings: {} as Record<string, string>,
  crosshairMenuGamepadButton: 3 as number | null,
  setKeyBinding: vi.fn(),
  resetKeyBinding: vi.fn(),
  setCrosshairMenuGamepadButton: vi.fn(),
};

vi.mock("@/lib/settingsStore", () => {
  const useSettingsStore = Object.assign(
    <T,>(sel: (s: typeof storeState) => T): T => sel(storeState),
    {
      getState: () => storeState,
      setState: vi.fn(),
      subscribe: () => () => {},
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
    },
  );
  return { useSettingsStore, DEFAULT_CROSSHAIR_MENU_GAMEPAD_BUTTON: 3 };
});

import {
  KeyBindingCapture,
  CrosshairMenuGamepadCapture,
} from "../components/KeyBindingCapture";

type MutableButton = { pressed: boolean; touched: boolean; value: number };

function makePad(mapping: string, buttonCount = 8): Gamepad & { buttons: MutableButton[] } {
  return {
    id: `test-pad-${mapping || "nonstandard"}`,
    index: 0,
    connected: true,
    timestamp: 0,
    mapping,
    axes: [],
    buttons: Array.from({ length: buttonCount }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    })),
  } as unknown as Gamepad & { buttons: MutableButton[] };
}

function stubGetGamepads(pads: (Gamepad | null)[] | undefined) {
  Object.defineProperty(navigator, "getGamepads", {
    value: pads === undefined ? undefined : () => pads,
    configurable: true,
    writable: true,
  });
}

// Manual rAF harness so gamepad polling frames can be stepped deterministically.
let rafCbs: Map<number, FrameRequestCallback>;
let nextRafId: number;

function runFrame() {
  const cbs = Array.from(rafCbs.values());
  rafCbs.clear();
  act(() => {
    cbs.forEach((cb) => cb(0));
  });
}

beforeEach(() => {
  storeState.keyBindings = {};
  storeState.crosshairMenuGamepadButton = 3;
  storeState.setKeyBinding.mockClear();
  storeState.resetKeyBinding.mockClear();
  storeState.setCrosshairMenuGamepadButton.mockClear();

  rafCbs = new Map();
  nextRafId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    const id = nextRafId++;
    rafCbs.set(id, cb);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
    rafCbs.delete(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).getGamepads;
});

describe("KeyBindingCapture", () => {
  it("(a) renders a safe fallback row for an unknown action id instead of crashing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <KeyBindingCapture action={"bogusAction" as never} conflictWith={[]} />,
    );
    expect(screen.getByText("Unknown action")).toBeInTheDocument();
    expect(screen.getByTestId("shortcut-unknown-bogusAction")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown shortcut action id: bogusAction"),
    );
  });

  it("(b) captures a modifier key (ShiftRight) instead of filtering it out", () => {
    render(<KeyBindingCapture action="descend" conflictWith={[]} />);
    const btn = screen.getByTestId("shortcut-descend-key");
    fireEvent.click(btn);
    expect(btn).toHaveTextContent(/PRESS A KEY/);
    fireEvent.keyDown(window, { code: "ShiftRight" });
    expect(storeState.setKeyBinding).toHaveBeenCalledWith("descend", "ShiftRight");
    // capture closed after the modifier press
    expect(btn).not.toHaveTextContent(/PRESS A KEY/);
  });

  it("captures ControlLeft and MetaLeft too", () => {
    render(<KeyBindingCapture action="dropGpsPin" conflictWith={[]} />);
    const btn = screen.getByTestId("shortcut-drop-gps-pin-key");
    fireEvent.click(btn);
    fireEvent.keyDown(window, { code: "ControlLeft" });
    expect(storeState.setKeyBinding).toHaveBeenCalledWith("dropGpsPin", "ControlLeft");
    fireEvent.click(btn);
    fireEvent.keyDown(window, { code: "MetaLeft" });
    expect(storeState.setKeyBinding).toHaveBeenCalledWith("dropGpsPin", "MetaLeft");
  });

  it("Escape cancels capture without binding", () => {
    render(<KeyBindingCapture action="moveForward" conflictWith={[]} />);
    const btn = screen.getByTestId("shortcut-move-forward-key");
    fireEvent.click(btn);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(storeState.setKeyBinding).not.toHaveBeenCalled();
    expect(btn).not.toHaveTextContent(/PRESS A KEY/);
  });

  it("(d) RESET cancels active keyboard capture before writing the reset value", () => {
    storeState.keyBindings = { descend: "KeyX" }; // non-default so RESET is enabled
    render(<KeyBindingCapture action="descend" conflictWith={[]} />);
    const captureBtn = screen.getByTestId("shortcut-descend-key");
    fireEvent.click(captureBtn);
    expect(captureBtn).toHaveTextContent(/PRESS A KEY/);

    fireEvent.click(screen.getByTestId("shortcut-descend-reset"));
    expect(storeState.resetKeyBinding).toHaveBeenCalledWith("descend");
    expect(captureBtn).not.toHaveTextContent(/PRESS A KEY/);

    // The keydown listener must be gone: the next key press does NOT bind.
    fireEvent.keyDown(window, { code: "KeyZ" });
    expect(storeState.setKeyBinding).not.toHaveBeenCalled();
  });

  it("window blur cancels keyboard capture; next key after refocus is not consumed", () => {
    render(<KeyBindingCapture action="moveForward" conflictWith={[]} />);
    const btn = screen.getByTestId("shortcut-move-forward-key");
    fireEvent.click(btn);
    fireEvent.blur(window);
    expect(btn).not.toHaveTextContent(/PRESS A KEY/);
    fireEvent.keyDown(window, { code: "KeyZ" });
    expect(storeState.setKeyBinding).not.toHaveBeenCalled();
  });

  it("an empty-string binding displays as the default (unset ≡ default)", () => {
    storeState.keyBindings = { moveForward: "" };
    render(<KeyBindingCapture action="moveForward" conflictWith={[]} />);
    // default for moveForward is KeyW → label "W", not "—"
    expect(screen.getByTestId("shortcut-move-forward-key")).toHaveTextContent("W");
    // and it counts as default, so RESET is disabled
    expect(screen.getByTestId("shortcut-move-forward-reset")).toBeDisabled();
  });
});

describe("CrosshairMenuGamepadCapture", () => {
  it("(e) shows an inline error and exits capture immediately when the Gamepad API is absent", () => {
    stubGetGamepads(undefined);
    render(<CrosshairMenuGamepadCapture />);
    const btn = screen.getByTestId("shortcut-crosshair-menu-gamepad");
    fireEvent.click(btn);
    expect(screen.getByTestId("gamepad-capture-error")).toHaveTextContent(
      "Gamepad not supported in this browser",
    );
    // not stuck on the capture prompt
    expect(btn).not.toHaveTextContent("PRESS A BUTTON…");
  });

  it("(f) refuses to enter capture mode when no standard-mapping gamepad is connected", () => {
    stubGetGamepads([makePad("")]);
    render(<CrosshairMenuGamepadCapture />);
    const btn = screen.getByTestId("shortcut-crosshair-menu-gamepad");
    fireEvent.click(btn);
    expect(screen.getByTestId("gamepad-capture-error")).toHaveTextContent(
      "Connect a standard gamepad controller",
    );
    expect(btn).not.toHaveTextContent("PRESS A BUTTON…");
    // no polling loop was started
    expect(rafCbs.size).toBe(0);
  });

  it("shows the connect prompt when no gamepad is connected at all", () => {
    stubGetGamepads([null, null, null, null]);
    render(<CrosshairMenuGamepadCapture />);
    fireEvent.click(screen.getByTestId("shortcut-crosshair-menu-gamepad"));
    expect(screen.getByTestId("gamepad-capture-error")).toHaveTextContent(
      "Connect a standard gamepad controller",
    );
  });

  it("(f) ignores presses from a non-standard pad but accepts the standard pad", () => {
    const nonStandard = makePad("");
    const standard = makePad("standard");
    stubGetGamepads([nonStandard, standard]);
    render(<CrosshairMenuGamepadCapture />);
    const btn = screen.getByTestId("shortcut-crosshair-menu-gamepad");
    fireEvent.click(btn);
    expect(btn).toHaveTextContent("PRESS A BUTTON…");

    runFrame(); // take initial snapshot

    // Press on the NON-standard pad: must not be accepted.
    nonStandard.buttons[4]!.pressed = true;
    runFrame();
    expect(storeState.setCrosshairMenuGamepadButton).not.toHaveBeenCalled();
    expect(btn).toHaveTextContent("PRESS A BUTTON…");

    // Press on the standard pad: accepted, capture ends.
    standard.buttons[2]!.pressed = true;
    runFrame();
    expect(storeState.setCrosshairMenuGamepadButton).toHaveBeenCalledWith(2);
    expect(btn).not.toHaveTextContent("PRESS A BUTTON…");
  });

  it("(c) DISABLE cancels active gamepad capture before writing", () => {
    const standard = makePad("standard");
    stubGetGamepads([standard]);
    render(<CrosshairMenuGamepadCapture />);
    const btn = screen.getByTestId("shortcut-crosshair-menu-gamepad");
    fireEvent.click(btn);
    runFrame(); // polling active, snapshot taken
    expect(rafCbs.size).toBe(1);

    fireEvent.click(screen.getByText("DISABLE"));
    expect(storeState.setCrosshairMenuGamepadButton).toHaveBeenCalledWith(null);
    expect(btn).not.toHaveTextContent("PRESS A BUTTON…");
    // polling loop cancelled — a later press cannot re-apply a binding
    expect(rafCbs.size).toBe(0);
    standard.buttons[5]!.pressed = true;
    runFrame();
    expect(storeState.setCrosshairMenuGamepadButton).toHaveBeenCalledTimes(1);
  });

  it("(c) RESET cancels active gamepad capture before writing", () => {
    const standard = makePad("standard");
    stubGetGamepads([standard]);
    render(<CrosshairMenuGamepadCapture />);
    const btn = screen.getByTestId("shortcut-crosshair-menu-gamepad");
    fireEvent.click(btn);
    runFrame();
    expect(rafCbs.size).toBe(1);

    fireEvent.click(screen.getByText("RESET"));
    expect(storeState.setCrosshairMenuGamepadButton).toHaveBeenCalledWith(3);
    expect(btn).not.toHaveTextContent("PRESS A BUTTON…");
    expect(rafCbs.size).toBe(0);
    standard.buttons[1]!.pressed = true;
    runFrame();
    expect(storeState.setCrosshairMenuGamepadButton).toHaveBeenCalledTimes(1);
  });

  it("clicking capture again clears a previous error", () => {
    stubGetGamepads([makePad("")]);
    render(<CrosshairMenuGamepadCapture />);
    const btn = screen.getByTestId("shortcut-crosshair-menu-gamepad");
    fireEvent.click(btn);
    expect(screen.getByTestId("gamepad-capture-error")).toBeInTheDocument();

    // A standard pad is connected now; retry should clear the error and capture.
    stubGetGamepads([makePad("standard")]);
    fireEvent.click(btn);
    expect(screen.queryByTestId("gamepad-capture-error")).not.toBeInTheDocument();
    expect(btn).toHaveTextContent("PRESS A BUTTON…");
  });
});
