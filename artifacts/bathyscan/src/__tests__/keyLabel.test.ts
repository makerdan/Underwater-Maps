import { describe, it, expect } from "vitest";
import { formatKeyCode, formatGamepadButton } from "@/lib/keyLabel";

describe("formatKeyCode", () => {
  it("returns an em-dash placeholder for an empty code", () => {
    expect(formatKeyCode("")).toBe("—");
  });

  it("strips the Key prefix from letter codes", () => {
    expect(formatKeyCode("KeyQ")).toBe("Q");
    expect(formatKeyCode("KeyZ")).toBe("Z");
  });

  it("strips the Digit prefix from number-row codes", () => {
    expect(formatKeyCode("Digit1")).toBe("1");
    expect(formatKeyCode("Digit0")).toBe("0");
  });

  it("renders Numpad codes with a friendly prefix", () => {
    expect(formatKeyCode("Numpad5")).toBe("Num 5");
    expect(formatKeyCode("NumpadAdd")).toBe("Num Add");
  });

  it("expands arrow codes to a readable label", () => {
    expect(formatKeyCode("ArrowLeft")).toBe("Left Arrow");
    expect(formatKeyCode("ArrowDown")).toBe("Down Arrow");
  });

  it("maps named keys to short labels", () => {
    expect(formatKeyCode("Space")).toBe("Space");
    expect(formatKeyCode("Enter")).toBe("Enter");
    expect(formatKeyCode("Escape")).toBe("Esc");
    expect(formatKeyCode("Backspace")).toBe("⌫");
  });

  it("collapses left/right modifier variants to a single label", () => {
    expect(formatKeyCode("ShiftLeft")).toBe("Shift");
    expect(formatKeyCode("ShiftRight")).toBe("Shift");
    expect(formatKeyCode("ControlLeft")).toBe("Ctrl");
    expect(formatKeyCode("AltRight")).toBe("Alt");
    expect(formatKeyCode("MetaLeft")).toBe("Meta");
  });

  it("maps punctuation codes to their printed character", () => {
    expect(formatKeyCode("Comma")).toBe(",");
    expect(formatKeyCode("Period")).toBe(".");
    expect(formatKeyCode("Slash")).toBe("/");
    expect(formatKeyCode("Backslash")).toBe("\\");
    expect(formatKeyCode("Semicolon")).toBe(";");
    expect(formatKeyCode("Quote")).toBe("'");
    expect(formatKeyCode("BracketLeft")).toBe("[");
    expect(formatKeyCode("BracketRight")).toBe("]");
    expect(formatKeyCode("Minus")).toBe("-");
    expect(formatKeyCode("Equal")).toBe("=");
    expect(formatKeyCode("Backquote")).toBe("`");
  });

  it("falls back to the raw code for unknown values", () => {
    expect(formatKeyCode("F1")).toBe("F1");
    expect(formatKeyCode("MediaPlayPause")).toBe("MediaPlayPause");
  });
});

describe("formatGamepadButton", () => {
  it("returns 'Off' for a null (disabled) binding", () => {
    expect(formatGamepadButton(null)).toBe("Off");
  });

  it("labels the face buttons with both vendor names", () => {
    expect(formatGamepadButton(0)).toBe("A / Cross");
    expect(formatGamepadButton(1)).toBe("B / Circle");
    expect(formatGamepadButton(2)).toBe("X / Square");
    expect(formatGamepadButton(3)).toBe("Y / Triangle");
  });

  it("labels shoulders, triggers, and meta buttons", () => {
    expect(formatGamepadButton(4)).toBe("LB / L1");
    expect(formatGamepadButton(5)).toBe("RB / R1");
    expect(formatGamepadButton(6)).toBe("LT / L2");
    expect(formatGamepadButton(7)).toBe("RT / R2");
    expect(formatGamepadButton(8)).toBe("Back / Share");
    expect(formatGamepadButton(9)).toBe("Start / Options");
    expect(formatGamepadButton(10)).toBe("L-Stick Press");
    expect(formatGamepadButton(11)).toBe("R-Stick Press");
  });

  it("labels d-pad buttons", () => {
    expect(formatGamepadButton(12)).toBe("D-pad Up");
    expect(formatGamepadButton(13)).toBe("D-pad Down");
    expect(formatGamepadButton(14)).toBe("D-pad Left");
    expect(formatGamepadButton(15)).toBe("D-pad Right");
  });

  it("falls back to 'Button N' for unknown indices", () => {
    expect(formatGamepadButton(16)).toBe("Button 16");
    expect(formatGamepadButton(99)).toBe("Button 99");
  });
});
