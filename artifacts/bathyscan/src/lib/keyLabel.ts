/**
 * keyLabel — convert a KeyboardEvent.code value (e.g. "KeyQ", "Digit1",
 * "Space", "ArrowLeft") into a short, human-readable label suitable for
 * HUD hints and the controls legends.
 */
export function formatKeyCode(code: string): string {
  if (!code) return "—";
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  if (code.startsWith("Arrow")) return `${code.slice(5)} Arrow`;
  switch (code) {
    case "Space": return "Space";
    case "Enter": return "Enter";
    case "Escape": return "Esc";
    case "Tab": return "Tab";
    case "Backspace": return "⌫";
    case "ShiftLeft":
    case "ShiftRight": return "Shift";
    case "ControlLeft":
    case "ControlRight": return "Ctrl";
    case "AltLeft":
    case "AltRight": return "Alt";
    case "MetaLeft":
    case "MetaRight": return "Meta";
    case "Comma": return ",";
    case "Period": return ".";
    case "Slash": return "/";
    case "Backslash": return "\\";
    case "Semicolon": return ";";
    case "Quote": return "'";
    case "BracketLeft": return "[";
    case "BracketRight": return "]";
    case "Minus": return "-";
    case "Equal": return "=";
    case "Backquote": return "`";
    default: return code;
  }
}

/**
 * Friendly label for a Standard-mapping gamepad button index. Falls back
 * to "Button N" for indices that don't have a well-known name.
 */
export function formatGamepadButton(index: number | null): string {
  if (index === null) return "Off";
  switch (index) {
    case 0: return "A / Cross";
    case 1: return "B / Circle";
    case 2: return "X / Square";
    case 3: return "Y / Triangle";
    case 4: return "LB / L1";
    case 5: return "RB / R1";
    case 6: return "LT / L2";
    case 7: return "RT / R2";
    case 8: return "Back / Share";
    case 9: return "Start / Options";
    case 10: return "L-Stick Press";
    case 11: return "R-Stick Press";
    case 12: return "D-pad Up";
    case 13: return "D-pad Down";
    case 14: return "D-pad Left";
    case 15: return "D-pad Right";
    default: return `Button ${index}`;
  }
}
