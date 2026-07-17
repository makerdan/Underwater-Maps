import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/lib/settingsStore";
import { S } from "./styles";
import { SectionActionsRow } from "./components/SyncContext";
import { ToggleRow } from "./components/RowWidgets";
import { Select } from "./components/Toggle";

export function AccessibilitySection() {
  const s = useSettingsStore(useShallow((s) => s));
  return (
    <>
      <h2 style={S.sectionTitle}>◈ ACCESSIBILITY</h2>
      <SectionActionsRow section="accessibility" />
      <div style={S.card}>
        <div style={S.cardHeader}>DISPLAY</div>
        <ToggleRow
          label="Reduce Motion"
          value={s.reducedMotion}
          onChange={s.setReducedMotion}
          sublabel="Disable non-essential animations &amp; particles"
        />
        <ToggleRow
          label="Color-Blind Safe Palette"
          value={s.colorBlindSafePalette}
          onChange={s.setColorBlindSafePalette}
          sublabel="Switch markers to a high-contrast palette"
        />
        <div style={S.row}>
          <div>
            <div style={S.label}>Text Size</div>
            <div style={S.sublabel}>Scales all panel and HUD text</div>
          </div>
          <Select
            value={s.globalFontSize}
            onChange={s.setGlobalFontSize}
            options={[
              { value: "smallest", label: "Smallest" },
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
              { value: "x-large", label: "X-Large" },
              { value: "largest", label: "Largest" },
            ]}
          />
        </div>
        <ToggleRow
          label="High-Contrast HUD"
          value={s.highContrastHud}
          onChange={s.setHighContrastHud}
          sublabel="Stronger text/background contrast"
        />
        <ToggleRow
          label="Bright Daylight"
          value={s.brightDaylight}
          onChange={s.setBrightDaylight}
          sublabel="Opaque panels, bold text, and high contrast for outdoor use in direct sunlight — automatically switches the terrain to Grayscale for maximum depth contrast while active"
        />
      </div>
    </>
  );
}
