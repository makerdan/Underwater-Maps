import { formatKeyCode, formatGamepadButton } from "@/lib/keyLabel";

export interface ShortcutBinding {
  key: string;
  action: string;
}

export function getKeyboardShortcuts(
  crosshairMenuKey: string,
  crosshairMenuGamepadButton: number | null,
): ShortcutBinding[] {
  const crosshairActionLabel =
    crosshairMenuGamepadButton !== null
      ? `${formatKeyCode(crosshairMenuKey).toUpperCase()} / ${formatGamepadButton(crosshairMenuGamepadButton)}`
      : formatKeyCode(crosshairMenuKey).toUpperCase();

  return [
    { key: "Click", action: "Lock mouse / enter fly mode" },
    { key: "W A S D", action: "Move forward / strafe" },
    { key: "Space", action: "Ascend" },
    { key: "Shift", action: "Descend" },
    { key: "Scroll", action: "Change speed tier" },
    { key: "R-drag / Ctrl-drag", action: "Orbit around point" },
    { key: "G", action: "Drop GPS pin at crosshair" },
    { key: crosshairActionLabel, action: "Action menu at crosshair" },
    { key: "R-click", action: "Context menu (pin, measure, …)" },
    { key: "Esc", action: "Release mouse" },
    { key: "O", action: "Toggle overview map" },
    { key: "?", action: "Show this shortcuts reference" },
    { key: ",", action: "Open settings" },
  ];
}
