/**
 * ManualConditionsChip — persistent "conditions active" indicator for the
 * sidebar, visible from ANY tab (rendered directly below the mode tabs).
 *
 * Shows a compact chip whenever manual conditions are active for the current
 * dataset (session apply, or persisted with source=manual), even when the
 * Drift & Route section / Plan tab is not open. Clicking the chip body jumps
 * to the Plan tab; the ✕ button clears the conditions entirely.
 */

import React from "react";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useIsMobile } from "@/hooks/use-mobile";

// ── Styles ───────────────────────────────────────────────────────────────────

const CHIP_WRAP: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
  width: "100%",
  minWidth: 230,
  maxWidth: 260,
  padding: "4px 8px",
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.30)",
  borderRadius: 5,
  backdropFilter: "blur(6px)",
};

const CHIP_WRAP_MOBILE: React.CSSProperties = {
  ...CHIP_WRAP,
  minWidth: 0,
  maxWidth: "100%",
  padding: "3px 6px",
};

const CHIP_BODY: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  flex: 1,
  minWidth: 0,
};

const CHIP_DOT: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "#00e5ff",
  flexShrink: 0,
  boxShadow: "0 0 5px rgba(0,229,255,0.6)",
};

const CHIP_LABEL: React.CSSProperties = {
  color: "#00e5ff",
  fontSize: 11,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  letterSpacing: "0.13em",
  fontWeight: 700,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const CHIP_CLEAR: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#475569",
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  cursor: "pointer",
  padding: "1px 4px",
  lineHeight: 1,
  flexShrink: 0,
};

// ── Component ────────────────────────────────────────────────────────────────

function formatConditionsSummary(c: {
  windSpeedKnots: number;
  windDirectionDeg: number;
  currentSpeedKnots: number;
  currentDirectionDeg: number;
}): string {
  return `Wind ${c.windSpeedKnots} kn @ ${c.windDirectionDeg}° · Current ${c.currentSpeedKnots} kn @ ${c.currentDirectionDeg}°`;
}

export const ManualConditionsChip: React.FC = () => {
  const { terrain } = useAppState();
  const isMobile = useIsMobile();
  const datasetId = terrain?.datasetId ?? "";
  const lakeName = typeof terrain?.name === "string" ? terrain.name.trim() : "";

  const sessionConditions = useUiStore((s) => s.sessionManualConditions[datasetId]);
  const persistedConditions = useSettingsStore((s) => s.datasetManualConditions[datasetId]);
  const activeSource = useSettingsStore(
    (s) => s.manualConditionsActiveSource[datasetId] ?? "manual",
  );

  const setSidebarMode = useUiStore((s) => s.setSidebarMode);
  const clearSessionManualConditions = useUiStore((s) => s.clearSessionManualConditions);
  const clearDatasetManualConditions = useSettingsStore((s) => s.clearDatasetManualConditions);
  const setManualConditionsActiveSource = useSettingsStore(
    (s) => s.setManualConditionsActiveSource,
  );

  const activeConditions =
    sessionConditions ??
    (activeSource === "manual" ? persistedConditions : undefined);

  if (!datasetId || !activeConditions) return null;

  function handleClear() {
    if (!datasetId) return;
    clearSessionManualConditions(datasetId);
    clearDatasetManualConditions(datasetId);
    setManualConditionsActiveSource(datasetId, "real");
  }

  const summary = formatConditionsSummary(activeConditions);
  const label = isMobile
    ? lakeName
      ? `Manual · ${lakeName}`
      : "Manual conditions"
    : lakeName
      ? `Manual conditions · ${lakeName}`
      : "Manual conditions active";
  const tooltip = `Manual conditions are overriding live data${
    lakeName ? ` for ${lakeName}` : ""
  } — ${summary}. Click to view in Plan.`;

  return (
    <div
      style={isMobile ? CHIP_WRAP_MOBILE : CHIP_WRAP}
      data-testid="manual-conditions-chip"
    >
      <button
        type="button"
        style={CHIP_BODY}
        onClick={() => setSidebarMode("plan")}
        data-testid="manual-conditions-chip-jump"
        title={tooltip}
      >
        <span style={CHIP_DOT} aria-hidden="true" />
        <span style={CHIP_LABEL} data-testid="manual-conditions-chip-label">
          {label}
        </span>
      </button>
      <button
        type="button"
        style={CHIP_CLEAR}
        onClick={handleClear}
        data-testid="manual-conditions-chip-clear"
        title="Clear manual conditions"
        aria-label="Clear manual conditions"
      >
        ✕
      </button>
    </div>
  );
};
