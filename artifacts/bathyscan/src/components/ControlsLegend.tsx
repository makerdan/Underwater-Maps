import React, { useState } from "react";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

const BINDINGS = [
  { key: "Click", action: "Lock mouse / enter fly mode" },
  { key: "W A S D", action: "Move forward / strafe" },
  { key: "Space", action: "Ascend" },
  { key: "Shift", action: "Descend" },
  { key: "Scroll", action: "Zoom in / out" },
  { key: "Shift + Scroll", action: "Change speed tier" },
  { key: "+ / −", action: "Change speed tier" },
  { key: "Pinch", action: "Zoom in / out (touch)" },
  { key: "Tab", action: "Toggle orbit / fly mode" },
  { key: "G / R-click", action: "Drop GPS pin" },
  { key: "Esc", action: "Release mouse" },
  { key: "O", action: "Toggle overview map" },
];

export const ControlsLegend: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="controls-legend relative pointer-events-auto select-none">
      {open && (
        <div
          className="absolute bottom-10 left-0 w-64 rounded border text-xs font-mono z-30 p-3 space-y-1.5"
          style={{
            background: "rgba(0,10,20,0.90)",
            borderColor: "rgba(0,229,255,0.2)",
            color: "#94a3b8",
          }}
        >
          <div className="text-[10px] uppercase tracking-widest mb-2"
            style={{ color: "#00e5ff" }}>
            Controls
          </div>
          {BINDINGS.map(({ key, action }) => (
            <div key={key} className="flex gap-2 items-start">
              <span
                className="shrink-0 rounded px-1 py-0.5 text-[9px] uppercase tracking-wider"
                style={{
                  background: "rgba(0,229,255,0.08)",
                  border: "1px solid rgba(0,229,255,0.2)",
                  color: "#00e5ff",
                  minWidth: 60,
                }}
              >
                {key}
              </span>
              <span className="text-[10px] leading-tight">{action}</span>
            </div>
          ))}
        </div>
      )}

      <ViewscreenTooltip label="Show keyboard and mouse controls" side="right">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle controls help"
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-colors"
          style={{
            background: open ? "rgba(0,229,255,0.15)" : "rgba(0,10,20,0.80)",
            border: "1px solid rgba(0,229,255,0.3)",
            color: open ? "#00e5ff" : "#475569",
            boxShadow: open ? "0 0 8px rgba(0,229,255,0.2)" : "none",
          }}
        >
          ?
        </button>
      </ViewscreenTooltip>
    </div>
  );
};
