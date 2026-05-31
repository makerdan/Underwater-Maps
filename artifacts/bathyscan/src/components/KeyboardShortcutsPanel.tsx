import React from "react";
import { HelpIcon } from "@/components/help/HelpButton";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatKeyCode, formatGamepadButton } from "@/lib/keyLabel";

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.28)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#cbd5e1",
  fontSize: 12,
  minWidth: 220,
  maxWidth: 260,
  backdropFilter: "blur(6px)",
};

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

export const KeyboardShortcutsPanel: React.FC = () => {
  const collapsed = usePanelCollapseStore((s) => s.collapsed.keyboardShortcuts);
  const toggle = usePanelCollapseStore((s) => s.toggle);
  const crosshairMenuKey = useSettingsStore((s) => s.keyBindings.crosshairMenu);
  const crosshairMenuGamepadButton = useSettingsStore((s) => s.crosshairMenuGamepadButton);

  const crosshairActionLabel =
    crosshairMenuGamepadButton !== null
      ? `${formatKeyCode(crosshairMenuKey).toUpperCase()} / ${formatGamepadButton(crosshairMenuGamepadButton)}`
      : formatKeyCode(crosshairMenuKey).toUpperCase();

  const BINDINGS: { key: string; action: string }[] = [
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
  ];

  return (
    <div style={{ ...PANEL, pointerEvents: "auto" }} className="select-none">
      {/*
       * asChild contract: ViewscreenTooltip's child must be a single focusable
       * element — the TooltipTrigger renders AS that element (no extra wrapper).
       * HelpIcon is a <button>, so it must live OUTSIDE the toggle <button> to
       * prevent a nested <button> HTML-validity violation.
       */}
      <div className="w-full flex items-center px-3 py-2 hover:bg-white/5 transition-colors rounded-t">
        <ViewscreenTooltip label={collapsed ? "Show keyboard shortcuts" : "Hide keyboard shortcuts"} side="right">
          <button
            onClick={() => toggle("keyboardShortcuts")}
            className="flex-1 flex items-center justify-between"
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontFamily: "inherit", padding: 0, textAlign: "left" }}
          >
            <span
              className="uppercase tracking-widest"
              style={{ fontSize: 11, ...CYAN, fontWeight: 700 }}
            >
              Keyboard
            </span>
            <span style={{ color: "#cbd5e1", fontSize: 24, lineHeight: 1 }}>
              {collapsed ? "▸" : "▾"}
            </span>
          </button>
        </ViewscreenTooltip>
        <HelpIcon articleId="keyboard-shortcuts" label="Keyboard shortcuts" />
      </div>

      {!collapsed && (
        <div
          className="px-3 py-2 space-y-1.5"
          style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}
        >
          {BINDINGS.map(({ key, action }) => (
            <div key={key} className="flex gap-2 items-start">
              <span
                className="shrink-0 rounded px-1 py-0.5 uppercase tracking-wider"
                style={{
                  background: "rgba(0,229,255,0.12)",
                  border: "1px solid rgba(0,229,255,0.35)",
                  color: "#00e5ff",
                  minWidth: 64,
                  fontSize: 10,
                  textAlign: "center",
                  fontWeight: 600,
                }}
              >
                {key}
              </span>
              <span style={{ fontSize: 11, lineHeight: 1.4, color: "#cbd5e1" }}>{action}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
