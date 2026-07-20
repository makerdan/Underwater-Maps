/**
 * DriftPlannerPanel — persistent manual-conditions indicator for the
 * Drift & Route sidebar section.
 *
 * Shows a compact summary row whenever manual conditions are active for the
 * current dataset (either a session apply or persisted with source=manual).
 * The row displays the active wind speed, current speed, and the computed
 * 1-hour drift estimate. A clear button removes the session conditions and
 * resets the active source so the indicator disappears.
 *
 * The indicator is independent of driftPlannerActive; it persists after the
 * user closes the WeatherPanel and disappears only when conditions are cleared.
 */

import React, { useMemo } from "react";
import { useAppState } from "@/lib/context";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { computeManualDriftPreview } from "@/components/ManualConditionsForm";

// ── Styles ───────────────────────────────────────────────────────────────────

const INDICATOR_WRAP: React.CSSProperties = {
  background: "rgba(0,229,255,0.06)",
  border: "1px solid rgba(0,229,255,0.22)",
  borderRadius: 4,
  padding: "6px 10px",
  margin: "0 0 8px 0",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const INDICATOR_HEADER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
};

const INDICATOR_BADGE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
};

const BADGE_DOT: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "#00e5ff",
  flexShrink: 0,
  boxShadow: "0 0 5px rgba(0,229,255,0.6)",
};

const BADGE_LABEL: React.CSSProperties = {
  color: "#00e5ff",
  fontSize: 11,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  letterSpacing: "0.14em",
  fontWeight: 700,
  textTransform: "uppercase",
};

const CLEAR_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#475569",
  fontSize: 11,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  cursor: "pointer",
  letterSpacing: "0.08em",
  padding: "1px 4px",
  lineHeight: 1,
};

const INDICATOR_DETAILS: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const DETAIL_CHIP: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 11,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

const DETAIL_VALUE: React.CSSProperties = {
  color: "#7dd3fc",
};

const DRIFT_ESTIMATE: React.CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  letterSpacing: "0.06em",
};

const DRIFT_ESTIMATE_VALUE: React.CSSProperties = {
  color: "#7dd3fc",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const EIGHT_POINT: readonly string[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function bearingToCompass(deg: number): string {
  const idx = Math.round(deg / 45) % 8;
  return EIGHT_POINT[idx < 0 ? idx + 8 : idx] ?? "N";
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Renders the persistent manual-conditions indicator.
 * Must be placed inside a component tree that has access to useAppState.
 */
export const DriftPlannerPanel: React.FC = () => {
  const { terrain } = useAppState();
  const datasetId = terrain?.datasetId ?? "";

  const sessionConditions = useUiStore((s) => s.sessionManualConditions[datasetId]);
  const persistedConditions = useSettingsStore((s) => s.datasetManualConditions[datasetId]);
  const activeSource = useSettingsStore(
    (s) => s.manualConditionsActiveSource[datasetId] ?? "manual",
  );

  const clearSessionManualConditions = useUiStore((s) => s.clearSessionManualConditions);
  const clearDatasetManualConditions = useSettingsStore((s) => s.clearDatasetManualConditions);
  const setManualConditionsActiveSource = useSettingsStore(
    (s) => s.setManualConditionsActiveSource,
  );

  // Show indicator when session conditions exist, or when persisted conditions
  // are being used as the active source.
  const activeConditions =
    sessionConditions ??
    (activeSource === "manual" ? persistedConditions : undefined);

  const driftPreview = useMemo(
    () => (activeConditions ? computeManualDriftPreview(activeConditions) : null),
    [activeConditions],
  );

  if (!activeConditions || !driftPreview) return null;

  function handleClear() {
    if (datasetId) {
      clearSessionManualConditions(datasetId);
      clearDatasetManualConditions(datasetId);
      setManualConditionsActiveSource(datasetId, "real");
    }
  }

  const distStr =
    driftPreview.distKm < 0.1
      ? "<0.1"
      : driftPreview.distKm.toFixed(1);
  const bearing = bearingToCompass(driftPreview.bearingDeg);

  return (
    <div
      style={INDICATOR_WRAP}
      data-testid="drift-planner-manual-indicator"
    >
      <div style={INDICATOR_HEADER}>
        <div style={INDICATOR_BADGE}>
          <div style={BADGE_DOT} />
          <span style={BADGE_LABEL}>Manual conditions active</span>
        </div>
        <button
          type="button"
          style={CLEAR_BTN}
          onClick={handleClear}
          data-testid="drift-planner-clear-conditions"
          title="Clear manual conditions"
        >
          ✕ clear
        </button>
      </div>

      <div style={INDICATOR_DETAILS}>
        <span style={DETAIL_CHIP}>
          Wind:{" "}
          <span style={DETAIL_VALUE} data-testid="drift-planner-indicator-wind">
            {activeConditions.windSpeedKnots} kn
          </span>
        </span>
        <span style={DETAIL_CHIP}>
          Current:{" "}
          <span style={DETAIL_VALUE} data-testid="drift-planner-indicator-current">
            {activeConditions.currentSpeedKnots} kn
          </span>
        </span>
      </div>

      <div style={DRIFT_ESTIMATE} data-testid="drift-planner-indicator-estimate">
        1 h drift:{" "}
        <span style={DRIFT_ESTIMATE_VALUE}>
          ~{distStr} km {bearing}
        </span>
      </div>
    </div>
  );
};
