/**
 * WaterTypeToggle — compact segmented control for switching between
 * saltwater and freshwater exploration modes.
 */
import React from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import type { WaterType } from "@/lib/settingsStore";

interface WaterTypeToggleProps {
  onChange?: (v: WaterType) => void;
}

const OPTIONS: { value: WaterType; label: string; icon: string; color: string }[] = [
  { value: "saltwater", label: "SALT",  icon: "≈", color: "#00e5ff" },
  { value: "freshwater", label: "FRESH", icon: "~", color: "#4ade80" },
];

export const WaterTypeToggle: React.FC<WaterTypeToggleProps> = ({ onChange }) => {
  const waterType = useSettingsStore((s) => s.waterType);
  const setWaterType = useSettingsStore((s) => s.setWaterType);

  const handleSelect = (v: WaterType) => {
    setWaterType(v);
    onChange?.(v);
  };

  return (
    <div
      data-testid="water-type-toggle"
      style={{
        display: "flex",
        borderRadius: 4,
        overflow: "hidden",
        border: "1px solid rgba(0,229,255,0.18)",
        flexShrink: 0,
      }}
    >
      {OPTIONS.map((opt) => {
        const active = waterType === opt.value;
        return (
          <button
            key={opt.value}
            data-testid={`water-type-${opt.value}`}
            onClick={() => handleSelect(opt.value)}
            title={opt.value === "saltwater" ? "Ocean / Sea exploration" : "Lake / River exploration"}
            style={{
              flex: 1,
              fontSize: 8,
              letterSpacing: "0.15em",
              padding: "4px 8px",
              border: "none",
              borderRight: opt.value === "saltwater" ? "1px solid rgba(0,229,255,0.12)" : "none",
              background: active ? `${opt.color}14` : "transparent",
              color: active ? opt.color : "#475569",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              transition: "background 0.12s, color 0.12s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 10 }}>{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};
