/**
 * ZoneLegendChip — collapsed color legend anchored below the Help button.
 *
 * Visible only when the zone classification overlay is active and a zone map
 * has been loaded. Collapsed by default; clicking the chip expands a compact
 * list of zone labels and their current swatch colors (including any
 * user-customised colors). The expanded/collapsed state is persisted via
 * panelCollapseStore so it survives page reloads.
 *
 * Read-only: color editing stays in the Zone Analysis panel.
 */
import React, { useEffect } from "react";
import { useUiStore } from "@/lib/uiStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useZoneOverlayStore } from "@/lib/zoneOverlayStore";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { useAppState } from "@/lib/context";
import {
  SALTWATER_ZONES,
  FRESHWATER_ZONES,
  SALTWATER_ZONE_TO_SLOT,
  FRESHWATER_ZONE_TO_SLOT,
} from "@/lib/zoneMap";

function formatZoneLabel(key: string): string {
  return key.replace(/_/g, " ");
}

export const ZoneLegendChip: React.FC = () => {
  const { terrain } = useAppState();
  const overlayEnabled = useUiStore((s) => s.zoneOverlayEnabled);
  const zoneMap = useClassificationStore((s) => s.zoneMap);
  const zoneSlots = useZoneOverlayStore((s) => s.slots);
  const setActiveWaterType = useZoneOverlayStore((s) => s.setActiveWaterType);
  const collapsed = usePanelCollapseStore((s) => s.collapsed.zoneLegendChip);
  const toggle = usePanelCollapseStore((s) => s.toggle);

  // Keep the zone overlay store in sync with the current terrain water type.
  useEffect(() => {
    if (!terrain) return;
    setActiveWaterType(terrain.waterType as "saltwater" | "freshwater");
  }, [terrain, setActiveWaterType]);

  // Only show when the overlay is on and a zone map is loaded.
  if (!overlayEnabled || !zoneMap || !terrain) return null;

  const waterType = terrain.waterType as "saltwater" | "freshwater";
  const zones = waterType === "freshwater" ? FRESHWATER_ZONES : SALTWATER_ZONES;
  const zoneToSlot =
    waterType === "freshwater" ? FRESHWATER_ZONE_TO_SLOT : SALTWATER_ZONE_TO_SLOT;

  // The four unique slot colors, used as mini swatches in collapsed chip.
  const slotColors = zoneSlots.map((s) => s.color);

  return (
    <div
      data-testid="zone-legend-chip"
      className="zone-legend-chip"
    >
      {/* ── Chip header — always visible ─────────────────────────────── */}
      <button
        type="button"
        data-testid="zone-legend-chip-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand zone color legend" : "Collapse zone color legend"}
        onClick={() => toggle("zoneLegendChip")}
        className="zone-legend-chip-header"
      >
        <span className="zone-legend-chip-label">ZONES</span>

        {/* Mini swatches — visible in collapsed state so the chip still
            communicates what the legend is about at a glance */}
        <span className="zone-legend-chip-swatches" aria-hidden>
          {slotColors.map((color, i) => (
            <span
              key={i}
              className="zone-legend-chip-swatch"
              style={{ background: color }}
            />
          ))}
        </span>

        <span className="zone-legend-chip-caret" aria-hidden>
          {collapsed ? "▸" : "▾"}
        </span>
      </button>

      {/* ── Expanded body ─────────────────────────────────────────────── */}
      {!collapsed && (
        <ul
          data-testid="zone-legend-chip-list"
          className="zone-legend-chip-list"
          aria-label="Zone color legend"
        >
          {zones.map((zone, i) => {
            const slot = zoneToSlot[i] ?? 0;
            const color = zoneSlots[slot]?.color ?? "#f5d58a";
            return (
              <li key={zone} className="zone-legend-chip-row" data-testid={`zone-legend-row-${zone}`}>
                <span
                  className="zone-legend-chip-swatch zone-legend-chip-swatch--lg"
                  style={{ background: color }}
                  aria-hidden
                />
                <span className="zone-legend-chip-zone-label">
                  {formatZoneLabel(zone)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
