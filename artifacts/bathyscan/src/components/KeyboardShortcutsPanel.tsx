import React, { useState } from "react";

const BINDINGS: { key: string; action: string }[] = [
  { key: "Click", action: "Lock mouse / enter fly mode" },
  { key: "W A S D", action: "Move forward / strafe" },
  { key: "Space", action: "Ascend" },
  { key: "Shift", action: "Descend" },
  { key: "Scroll", action: "Change speed tier" },
  { key: "Tab", action: "Toggle orbit / fly mode" },
  { key: "G / R-click", action: "Drop GPS pin" },
  { key: "Esc", action: "Release mouse" },
  { key: "O", action: "Toggle overview map" },
];

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
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div style={{ ...PANEL, pointerEvents: "auto" }} className="select-none">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors rounded-t"
        style={{ cursor: "pointer" }}
      >
        <span
          className="uppercase tracking-widest"
          style={{ fontSize: 11, ...CYAN, fontWeight: 700 }}
        >
          ▼ Keyboard
        </span>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>
          {collapsed ? "▸" : "▾"}
        </span>
      </button>

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
