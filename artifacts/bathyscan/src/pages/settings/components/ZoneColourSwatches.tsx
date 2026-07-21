import React, { useEffect } from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useZoneOverlayStore } from "@/lib/zoneOverlayStore";
import {
  SLOT_NAMES_SALTWATER,
  SLOT_NAMES_FRESHWATER,
} from "@/lib/zoneMap";
import { FONT, S } from "../styles";
import { Toggle } from "./Toggle";

export function ZoneColourSwatches() {
  const waterType = useSettingsStore((s) => s.waterType);
  const slots = useZoneOverlayStore((s) => s.slots);
  const setSlotColor = useZoneOverlayStore((s) => s.setSlotColor);
  const setSlotVisible = useZoneOverlayStore((s) => s.setSlotVisible);
  const resetToDefaults = useZoneOverlayStore((s) => s.resetToDefaults);
  const setActiveWaterType = useZoneOverlayStore((s) => s.setActiveWaterType);
  const slotNames =
    waterType === "freshwater" ? SLOT_NAMES_FRESHWATER : SLOT_NAMES_SALTWATER;

  useEffect(() => {
    setActiveWaterType(waterType as "saltwater" | "freshwater");
  }, [waterType, setActiveWaterType]);

  return (
    <div style={S.card}>
      <div
        style={{
          ...S.cardHeader,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>ZONE COLOURS</span>
        <button
          type="button"
          data-testid="settings-zone-colours-reset"
          onClick={resetToDefaults}
          style={{
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            color: "#64748b",
            background: "transparent",
            border: "1px solid rgba(100,116,139,0.3)",
            borderRadius: 3,
            padding: "1px 6px",
            cursor: "pointer",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontFamily: FONT,
          }}
        >
          Reset
        </button>
      </div>
      {slotNames.map((name, i) => {
        const slot = slots[i as 0 | 1 | 2 | 3];
        const color = slot?.color ?? "#f5d58a";
        const visible = slot?.visible ?? true;
        return (
          <div
            key={i}
            data-testid={`settings-zone-row-${i}`}
            style={{ ...S.row }}
          >
            <Toggle
              value={visible}
              onChange={(v) => setSlotVisible(i as 0 | 1 | 2 | 3, v)}
            />
            <span
              data-testid={`settings-zone-swatch-${i}`}
              style={{
                display: "block",
                width: 24,
                height: 24,
                borderRadius: 4,
                background: color,
                border: "1.5px solid rgba(255,255,255,0.15)",
                boxShadow: `0 0 6px ${color}55`,
                position: "relative",
                flexShrink: 0,
                opacity: visible ? 1 : 0.35,
                transition: "opacity 0.15s",
              }}
            >
              <input
                data-testid={`settings-zone-colour-input-${i}`}
                title={`Click to change colour — ${name}`}
                type="color"
                value={color}
                onChange={(e) => setSlotColor(i as 0 | 1 | 2 | 3, e.target.value)}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  cursor: "pointer",
                  width: "100%",
                  height: "100%",
                  border: "none",
                  padding: 0,
                }}
              />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.label, opacity: visible ? 1 : 0.5 }}>{name}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
