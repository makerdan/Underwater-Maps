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

export const TripWindowPanel: React.FC = () => {
  const { forecast48h, loading } = useSurfaceConditions(true);
  const tripMinDurationH = useSettingsStore((s) => s.tripMinDurationH);
  const setTripMinDurationH = useSettingsStore((s) => s.setTripMinDurationH);
  const setDriftHour = useDriftStore((s) => s.setDriftHour);
  const setDriftPlannerActive = useDriftStore((s) => s.setDriftPlannerActive);

  const windows = React.useMemo(
    () => computeTripWindows(forecast48h),
    [forecast48h],
  );
  const best = React.useMemo(
    () => findBestTripWindow(windows, tripMinDurationH),
    [windows, tripMinDurationH],
  );

  const handleWindowClick = (w: TripWindow) => {
    setDriftHour(w.startRelHour % 24);
    setDriftPlannerActive(true);
  };

  return (
    <div
      data-testid="trip-window-panel"
      style={{ fontFamily: mono, fontSize: 14, color: "#e2e8f0", padding: "6px 10px 8px" }}
    >
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
