/**
 * WaterTypeToggle — compact segmented control for switching between
 * saltwater and freshwater exploration modes.
 */
import React from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import type { WaterType } from "@/lib/settingsStore";
import { usePutSettings } from "@workspace/api-client-react";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

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
  const putSettings = usePutSettings();

  const handleSelect = (v: WaterType) => {
    if (v === waterType) return;
    // Store update triggers App.tsx subscription which clears derived
    // state (terrain/classification/habitat) and auto-loads the first
    // preset of the new water type.
    setWaterType(v);
    // Persist immediately so the choice survives a reload even if the
    // user never visits the Settings page (which also persists on save).
    try {
      putSettings.mutate({ data: { waterType: v } as never });
    } catch {
      /* best-effort; settings store still has the value locally */
    }
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
        const tip = opt.value === "saltwater"
          ? "Ocean / sea exploration mode"
          : "Lake / river exploration mode";
        return (
          <ViewscreenTooltip key={opt.value} label={tip} side="bottom">
          <button
            data-testid={`water-type-${opt.value}`}
            onClick={() => handleSelect(opt.value)}
            style={{
              flex: 1,
              fontSize: 8,
              letterSpacing: "0.15em",
              padding: "4px 8px",
              border: "none",
              borderRight: opt.value === "saltwater" ? "1px solid rgba(0,229,255,0.12)" : "none",
              background: active ? `${opt.color}14` : "transparent",
              color: active ? opt.color : "#94a3b8",
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
          </ViewscreenTooltip>
        );
      })}
    </div>
  );
};
