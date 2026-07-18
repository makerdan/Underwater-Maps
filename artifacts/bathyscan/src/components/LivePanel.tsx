/**
 * LivePanel — the focused on-the-water panel shown in the 'live' sidebar mode.
 *
 * Shows:
 *  - GPS status (acquiring / active / error) and horizontal accuracy.
 *  - Seafloor depth directly below the current GPS position (when in bounds
 *    of the loaded dataset).
 *  - Trail recording indicator with point count and sampling interval.
 *  - Two big touch-friendly action buttons: Follow Me (camera follow toggle)
 *    and Dive to GPS (drop the first-person camera at the GPS location).
 *
 * All orchestration (starting GPS / recording on entering Live mode) lives in
 * lib/liveMode.ts — this component is a pure view over the stores.
 */
import React from "react";
import { useGpsStore } from "@/lib/gpsStore";
import { useTrailStore } from "@/lib/trailStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useUiStore } from "@/lib/uiStore";
import {
  lonLatToWorldXZ,
  getTerrainSurfaceY,
  worldYToMetres,
} from "@/lib/terrain";
import { formatDepth } from "@/lib/units";

const MONO = "'JetBrains Mono', 'Fira Code', monospace";

/** Sampling interval options — mirrors TrailRecorder's selector. */
const INTERVALS = [
  { label: "5 s", ms: 5_000 },
  { label: "10 s", ms: 10_000 },
  { label: "30 s", ms: 30_000 },
  { label: "60 s", ms: 60_000 },
];

const cardStyle: React.CSSProperties = {
  minWidth: 230,
  maxWidth: 260,
  width: "100%",
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.22)",
  borderRadius: 6,
  padding: "10px 12px",
  fontFamily: MONO,
  backdropFilter: "blur(6px)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12.5,
  letterSpacing: "0.2em",
  color: "#475569",
  textTransform: "uppercase",
};

export const LivePanel: React.FC = () => {
  const gpsActive = useGpsStore((s) => s.active);
  const gpsPosition = useGpsStore((s) => s.position);
  const gpsError = useGpsStore((s) => s.error);
  const gpsWatchId = useGpsStore((s) => s.watchId);

  const recording = useTrailStore((s) => s.recording);
  const pointCount = useTrailStore((s) => s.currentPoints.length);

  const gpsFollowMode = useCameraStore((s) => s.gpsFollowMode);
  const setGpsFollowMode = useCameraStore((s) => s.setGpsFollowMode);

  const overviewGrid = useTerrainStore((s) => s.overviewGrid);
  const units = useSettingsStore((s) => s.units);
  const gpsRecordingInterval = useSettingsStore((s) => s.gpsRecordingInterval);

  const gpsInBounds = Boolean(
    gpsActive && gpsPosition && overviewGrid &&
    gpsPosition.latitude >= overviewGrid.minLat &&
    gpsPosition.latitude <= overviewGrid.maxLat &&
    gpsPosition.longitude >= overviewGrid.minLon &&
    gpsPosition.longitude <= overviewGrid.maxLon,
  );

  // Seafloor depth directly below the GPS position (metres, positive = down).
  let depthBelowM: number | null = null;
  if (gpsInBounds && gpsPosition && overviewGrid) {
    const { x, z } = lonLatToWorldXZ(
      gpsPosition.longitude,
      gpsPosition.latitude,
      overviewGrid,
    );
    depthBelowM = worldYToMetres(getTerrainSurfaceY(overviewGrid, x, z), overviewGrid);
  }

  const statusText = gpsError
    ? "ERROR"
    : gpsActive
      ? "ACTIVE"
      : gpsWatchId !== null
        ? "ACQUIRING…"
        : "OFF";
  const statusColor = gpsError ? "#f87171" : gpsActive ? "#34d399" : "#fbbf24";

  const setGpsRecordingInterval = useSettingsStore((s) => s.setGpsRecordingInterval);

  /**
   * Persist the new sampling interval and, when a recording session is
   * active, retime it in place so the change takes effect immediately.
   */
  const handleSetInterval = (ms: number) => {
    setGpsRecordingInterval(ms);
    useTrailStore.getState().setSamplingInterval(ms);
  };

  const handleDiveToGps = () => {
    if (!gpsPosition || !overviewGrid) return;
    const { x: worldX, z: worldZ } = lonLatToWorldXZ(
      gpsPosition.longitude,
      gpsPosition.latitude,
      overviewGrid,
    );
    useUiStore.getState().setPendingDropIn({ worldX, worldZ });
  };

  const bigButtonStyle = (active: boolean, enabled: boolean): React.CSSProperties => ({
    width: "100%",
    padding: "13px 12px",
    borderRadius: 6,
    border: `1px solid ${active ? "rgba(52,211,153,0.6)" : "rgba(0,229,255,0.35)"}`,
    background: active ? "rgba(52,211,153,0.14)" : "rgba(0,229,255,0.07)",
    color: enabled ? (active ? "#34d399" : "#00e5ff") : "#475569",
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.55,
    textShadow: active ? "0 0 6px rgba(52,211,153,0.5)" : "none",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  });

  return (
    <div
      data-testid="live-panel"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {/* ── GPS status ── */}
      <div data-testid="live-gps-status" style={cardStyle}>
        <div style={labelStyle}>GPS Status</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
              animation: !gpsActive && !gpsError && gpsWatchId !== null
                ? "pulse 1.2s ease-in-out infinite"
                : undefined,
            }}
          />
          <span
            data-testid="live-gps-status-text"
            style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: "0.14em", color: statusColor }}
          >
            {statusText}
          </span>
          {gpsActive && gpsPosition && (
            <span
              data-testid="live-gps-accuracy"
              style={{ fontSize: 13.5, color: "#94a3b8", letterSpacing: "0.1em" }}
            >
              ±{Math.round(gpsPosition.accuracy)} m
            </span>
          )}
        </div>
        {gpsError && (
          <div
            data-testid="live-gps-error"
            style={{ fontSize: 13, color: "#f87171", lineHeight: 1.5, letterSpacing: "0.06em" }}
          >
            {gpsError}
          </div>
        )}
      </div>

      {/* ── Depth below position ── */}
      <div data-testid="live-depth-card" style={cardStyle}>
        <div style={labelStyle}>Depth Below You</div>
        <div
          data-testid="live-depth-value"
          style={{
            fontSize: 25,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: depthBelowM !== null ? "#00e5ff" : "#475569",
            textShadow: depthBelowM !== null ? "0 0 8px rgba(0,229,255,0.5)" : "none",
          }}
        >
          {depthBelowM !== null ? formatDepth(depthBelowM, { units }) : "—"}
        </div>
        {gpsActive && !gpsInBounds && (
          <div style={{ fontSize: 12.5, color: "#64748b", letterSpacing: "0.1em" }}>
            Outside loaded dataset area
          </div>
        )}
        {!gpsActive && (
          <div style={{ fontSize: 12.5, color: "#64748b", letterSpacing: "0.1em" }}>
            Waiting for GPS fix…
          </div>
        )}
      </div>

      {/* ── Trail recording indicator ── */}
      <div data-testid="live-trail-indicator" style={cardStyle}>
        <div style={labelStyle}>Trail Recording</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: recording ? "#ef4444" : "#475569",
              boxShadow: recording ? "0 0 6px rgba(239,68,68,0.7)" : "none",
            }}
          />
          <span
            data-testid="live-trail-status-text"
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: recording ? "#ef4444" : "#64748b",
            }}
          >
            {recording ? "RECORDING" : "STOPPED"}
          </span>
          <span
            data-testid="live-trail-point-count"
            style={{ fontSize: 13.5, color: "#94a3b8", letterSpacing: "0.1em" }}
          >
            {pointCount} pts
          </span>
        </div>
        {/* Sampling interval control */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "#64748b", letterSpacing: "0.1em" }}>
            Interval
          </span>
          <div
            data-testid="live-interval-control"
            style={{ display: "flex", gap: 3, marginLeft: 4 }}
          >
            {INTERVALS.map((iv) => {
              const selected = gpsRecordingInterval === iv.ms;
              return (
                <button
                  key={iv.ms}
                  type="button"
                  data-testid={`live-interval-${iv.ms}`}
                  aria-pressed={selected}
                  onClick={() => handleSetInterval(iv.ms)}
                  style={{
                    background: selected ? "rgba(0,229,255,0.15)" : "none",
                    border: `1px solid ${selected ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.1)"}`,
                    borderRadius: 3,
                    color: selected ? "#00e5ff" : "#94a3b8",
                    fontSize: 13.5,
                    padding: "4px 8px",
                    cursor: "pointer",
                    fontFamily: MONO,
                  }}
                >
                  {iv.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Big action buttons ── */}
      <button
        type="button"
        data-testid="live-follow-toggle"
        aria-pressed={gpsFollowMode}
        disabled={!gpsActive}
        onClick={() => setGpsFollowMode(!gpsFollowMode)}
        style={bigButtonStyle(gpsFollowMode, gpsActive)}
      >
        {gpsFollowMode ? "◉ Following You" : "○ Follow Me"}
      </button>

      <button
        type="button"
        data-testid="live-dive-to-gps"
        disabled={!gpsInBounds}
        onClick={handleDiveToGps}
        style={bigButtonStyle(false, gpsInBounds)}
      >
        📍 Dive to GPS
      </button>
    </div>
  );
};
