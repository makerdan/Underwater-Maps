/**
 * TripWindowPanel — lists contiguous go / marginal / no-go stretches from the
 * 48-hour surface forecast, filtered by the user's minimum trip length.
 *
 * The trip-length control (Any / 2 h / 4 h / 6 h) persists via settingsStore
 * (tripMinDurationH) so the preference syncs across devices like the other
 * trip-window limits. Windows shorter than the chosen duration are dimmed
 * rather than hidden so users still see why a stretch was excluded. The best
 * qualifying stretch is highlighted. Clicking a window snaps the Drift
 * Planner scrubber to the window's first hour (same as ForecastStrip slots).
 *
 * Boat-size presets (Small craft / Mid-size / Large) let users quickly set
 * all four thresholds at once. Individual threshold sliders let them fine-tune
 * beyond the presets. All four threshold values are server-synced settings.
 */

import React from "react";
import { useSurfaceConditions } from "@/hooks/useSurfaceConditions";
import { useDriftStore } from "@/lib/driftStore";
import { useSettingsStore } from "@/lib/settingsStore";
import {
  computeTripWindows,
  findBestTripWindow,
  formatTripRange,
  meetsMinDuration,
  TRIP_LENGTH_OPTIONS_H,
  type TripThresholds,
  type TripVerdict,
  type TripWindow,
} from "@/lib/tripWindow";

const VERDICT_LABEL: Record<TripVerdict, string> = {
  go: "GO",
  marginal: "MARGINAL",
  "no-go": "NO-GO",
};

const VERDICT_COLOR: Record<TripVerdict, string> = {
  go: "#22c55e",
  marginal: "#facc15",
  "no-go": "#f87171",
};

const mono = "'JetBrains Mono', 'Fira Code', monospace";

/** Preset boat-size threshold bundles. */
interface BoatPreset {
  label: string;
  goWindKn: number;
  goWaveM: number;
  noGoWindKn: number;
  noGoWaveM: number;
}

const BOAT_PRESETS: BoatPreset[] = [
  { label: "Small craft", goWindKn: 10, goWaveM: 0.5, noGoWindKn: 16, noGoWaveM: 1.0 },
  { label: "Mid-size",    goWindKn: 12, goWaveM: 0.8, noGoWindKn: 22, noGoWaveM: 1.5 },
  { label: "Large",       goWindKn: 18, goWaveM: 1.2, noGoWindKn: 30, noGoWaveM: 2.5 },
];

function matchesPreset(thresholds: TripThresholds, preset: BoatPreset): boolean {
  return (
    thresholds.goWindKn === preset.goWindKn &&
    thresholds.goWaveM === preset.goWaveM &&
    thresholds.noGoWindKn === preset.noGoWindKn &&
    thresholds.noGoWaveM === preset.noGoWaveM
  );
}

export const TripWindowPanel: React.FC = () => {
  const { forecast48h, loading } = useSurfaceConditions(true);
  const tripMinDurationH = useSettingsStore((s) => s.tripMinDurationH);
  const setTripMinDurationH = useSettingsStore((s) => s.setTripMinDurationH);
  const boatGoWindKn = useSettingsStore((s) => s.boatGoWindKn);
  const boatGoWaveM = useSettingsStore((s) => s.boatGoWaveM);
  const boatNoGoWindKn = useSettingsStore((s) => s.boatNoGoWindKn);
  const boatNoGoWaveM = useSettingsStore((s) => s.boatNoGoWaveM);
  const setBoatGoWindKn = useSettingsStore((s) => s.setBoatGoWindKn);
  const setBoatGoWaveM = useSettingsStore((s) => s.setBoatGoWaveM);
  const setBoatNoGoWindKn = useSettingsStore((s) => s.setBoatNoGoWindKn);
  const setBoatNoGoWaveM = useSettingsStore((s) => s.setBoatNoGoWaveM);
  const setDriftHour = useDriftStore((s) => s.setDriftHour);
  const setDriftPlannerActive = useDriftStore((s) => s.setDriftPlannerActive);

  const thresholds: TripThresholds = {
    goWindKn: boatGoWindKn,
    goWaveM: boatGoWaveM,
    noGoWindKn: boatNoGoWindKn,
    noGoWaveM: boatNoGoWaveM,
  };

  const windows = React.useMemo(
    () => computeTripWindows(forecast48h, thresholds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forecast48h, boatGoWindKn, boatGoWaveM, boatNoGoWindKn, boatNoGoWaveM],
  );
  const best = React.useMemo(
    () => findBestTripWindow(windows, tripMinDurationH),
    [windows, tripMinDurationH],
  );

  const handleWindowClick = (w: TripWindow) => {
    setDriftHour(w.startRelHour % 24);
    setDriftPlannerActive(true);
  };

  const applyPreset = (preset: BoatPreset) => {
    setBoatGoWindKn(preset.goWindKn);
    setBoatGoWaveM(preset.goWaveM);
    setBoatNoGoWindKn(preset.noGoWindKn);
    setBoatNoGoWaveM(preset.noGoWaveM);
  };

  return (
    <div
      data-testid="trip-window-panel"
      style={{ fontFamily: mono, fontSize: 14, color: "#e2e8f0", padding: "6px 10px 8px" }}
    >
      {/* Boat-size preset selector */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#64748b", letterSpacing: "0.12em", marginBottom: 4 }}>
          BOAT SIZE
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {BOAT_PRESETS.map((preset) => {
            const active = matchesPreset(thresholds, preset);
            return (
              <button
                key={preset.label}
                data-testid={`boat-preset-${preset.label.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => applyPreset(preset)}
                aria-pressed={active}
                style={{
                  fontFamily: mono,
                  fontSize: 12,
                  padding: "3px 8px",
                  borderRadius: 4,
                  cursor: "pointer",
                  flex: 1,
                  color: active ? "#00e5ff" : "#94a3b8",
                  background: active ? "rgba(0,229,255,0.12)" : "transparent",
                  border: active
                    ? "1px solid rgba(0,229,255,0.45)"
                    : "1px solid rgba(148,163,184,0.25)",
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Threshold sliders */}
      <div
        style={{
          background: "rgba(0,229,255,0.04)",
          border: "1px solid rgba(0,229,255,0.10)",
          borderRadius: 4,
          padding: "6px 8px",
          marginBottom: 8,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px 10px",
        }}
      >
        {([
          { label: "Go wind", value: boatGoWindKn, set: setBoatGoWindKn, min: 1, max: 50, step: 1, unit: "kn", testId: "boat-go-wind" },
          { label: "Go wave", value: boatGoWaveM, set: setBoatGoWaveM, min: 0.1, max: 5.0, step: 0.1, unit: "m", testId: "boat-go-wave" },
          { label: "No-go wind", value: boatNoGoWindKn, set: setBoatNoGoWindKn, min: 1, max: 70, step: 1, unit: "kn", testId: "boat-nogo-wind" },
          { label: "No-go wave", value: boatNoGoWaveM, set: setBoatNoGoWaveM, min: 0.1, max: 8.0, step: 0.1, unit: "m", testId: "boat-nogo-wave" },
        ] as const).map(({ label, value, set, min, max, step, unit, testId }) => (
          <div key={label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 2 }}>
              <span>{label}</span>
              <span style={{ color: "#94a3b8" }}>{value.toFixed(step < 1 ? 1 : 0)} {unit}</span>
            </div>
            <input
              data-testid={testId}
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => set(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#00e5ff" }}
              aria-label={`${label} threshold: ${value.toFixed(step < 1 ? 1 : 0)} ${unit}`}
            />
          </div>
        ))}
      </div>

      {/* Trip length selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#64748b", letterSpacing: "0.12em" }}>
          TRIP LENGTH
        </span>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {TRIP_LENGTH_OPTIONS_H.map((h) => {
            const active = tripMinDurationH === h;
            return (
              <button
                key={h}
                data-testid={`trip-length-${h}`}
                onClick={() => setTripMinDurationH(h)}
                aria-pressed={active}
                style={{
                  fontFamily: mono,
                  fontSize: 13,
                  padding: "3px 8px",
                  borderRadius: 4,
                  cursor: "pointer",
                  color: active ? "#00e5ff" : "#94a3b8",
                  background: active ? "rgba(0,229,255,0.12)" : "transparent",
                  border: active
                    ? "1px solid rgba(0,229,255,0.45)"
                    : "1px solid rgba(148,163,184,0.25)",
                }}
              >
                {h === 0 ? "Any" : `${h} h`}
              </button>
            );
          })}
        </div>
      </div>

      {loading && !windows.length ? (
        <div style={{ color: "#94a3b8", fontSize: 14 }}>Loading forecast…</div>
      ) : !windows.length ? (
        <div style={{ color: "#94a3b8", fontSize: 14 }}>No forecast data available</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {windows.map((w, i) => {
            const qualifies = meetsMinDuration(w, tripMinDurationH);
            const isBest = best !== null && w === best;
            return (
              <div
                key={i}
                data-testid={`trip-window-${i}`}
                role="button"
                tabIndex={0}
                onClick={() => handleWindowClick(w)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleWindowClick(w);
                }}
                aria-label={`${VERDICT_LABEL[w.verdict]} window ${formatTripRange(w)}, ${w.durationH} hours${
                  isBest ? ", best match" : ""
                }${!qualifies ? ", shorter than selected trip length" : ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  borderRadius: 4,
                  cursor: "pointer",
                  opacity: qualifies ? 1 : 0.35,
                  background: isBest ? "rgba(34,197,94,0.10)" : "rgba(0,229,255,0.04)",
                  border: isBest
                    ? "1px solid rgba(34,197,94,0.55)"
                    : "1px solid rgba(0,229,255,0.10)",
                }}
              >
                <span
                  style={{
                    color: VERDICT_COLOR[w.verdict],
                    fontWeight: 700,
                    fontSize: 12.5,
                    width: 66,
                    flexShrink: 0,
                    letterSpacing: "0.08em",
                  }}
                >
                  {VERDICT_LABEL[w.verdict]}
                </span>
                <span style={{ fontSize: 13.5, color: "#e2e8f0" }}>
                  {formatTripRange(w)}
                </span>
                <span style={{ fontSize: 13, color: "#94a3b8", marginLeft: "auto" }}>
                  {w.durationH} h · {w.maxWindKt.toFixed(0)} kn · {w.maxWaveM.toFixed(1)} m
                </span>
                {isBest && (
                  <span
                    data-testid="trip-window-best"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#22c55e",
                      border: "1px solid rgba(34,197,94,0.55)",
                      borderRadius: 3,
                      padding: "1px 4px",
                      letterSpacing: "0.1em",
                      flexShrink: 0,
                    }}
                  >
                    BEST
                  </span>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: 12, color: "#475569", textAlign: "right" }}>
            Times in UTC · dimmed = shorter than trip length
          </div>
        </div>
      )}
    </div>
  );
};
