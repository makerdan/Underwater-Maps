import React, { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { useZoneOverlayStore, DEFAULT_SLOTS } from "@/lib/zoneOverlayStore";
import {
  SLOT_NAMES_SALTWATER,
  SLOT_NAMES_FRESHWATER,
} from "@/lib/zoneMap";
import { FONT, S } from "../styles";
import { Toggle } from "./Toggle";

/** How long a first Reset click stays "armed" before it reverts to idle. */
const RESET_CONFIRM_TIMEOUT_MS = 3000;

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

  // Reset button: disabled when the palette already matches defaults, and a
  // first click only "arms" the button — a second click within the timeout
  // performs the actual wipe.
  const isAtDefaults = slots.every((slot, i) => {
    const def = DEFAULT_SLOTS[i]!;
    return (
      slot.color.toLowerCase() === def.color.toLowerCase() &&
      slot.visible === def.visible
    );
  });
  const [confirmArmed, setConfirmArmed] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearConfirmTimer = () => {
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
  };
  useEffect(() => clearConfirmTimer, []);

  const handleResetClick = () => {
    if (isAtDefaults) return;
    if (!confirmArmed) {
      setConfirmArmed(true);
      clearConfirmTimer();
      confirmTimer.current = setTimeout(
        () => setConfirmArmed(false),
        RESET_CONFIRM_TIMEOUT_MS,
      );
      return;
    }
    clearConfirmTimer();
    setConfirmArmed(false);
    resetToDefaults();
  };

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
        <h3 style={{ margin: 0, fontSize: "inherit", fontWeight: "inherit", letterSpacing: "inherit" }}>ZONE COLOURS</h3>
        <button
          type="button"
          data-testid="settings-zone-colours-reset"
          onClick={handleResetClick}
          disabled={isAtDefaults}
          aria-disabled={isAtDefaults}
          title={
            isAtDefaults
              ? "Zone colours are already at their defaults"
              : confirmArmed
                ? "Click again to confirm resetting zone colours"
                : "Reset zone colours to defaults"
          }
          style={{
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            color: confirmArmed ? "#fbbf24" : "#64748b",
            background: "transparent",
            border: `1px solid ${confirmArmed ? "rgba(251,191,36,0.5)" : "rgba(100,116,139,0.3)"}`,
            borderRadius: 3,
            padding: "1px 6px",
            cursor: isAtDefaults ? "default" : "pointer",
            opacity: isAtDefaults ? 0.5 : 1,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontFamily: FONT,
          }}
        >
          {confirmArmed ? "Tap again to reset" : "Reset"}
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
              aria-label={`Show zone ${name}`}
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
                aria-label={`Colour for zone ${name}`}
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
