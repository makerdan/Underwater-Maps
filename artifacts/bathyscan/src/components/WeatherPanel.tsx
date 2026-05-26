/**
 * WeatherPanel — HTML overlay for Drift Planner showing wind, tidal, and wave
 * conditions. Fetches 24 h of surface conditions from /api/surface-conditions
 * using the terrain centre as the query point.
 *
 * When conditions are unavailable (estimatedConditions=true) it shows manual
 * override sliders so the user can still plan a drift.
 */

import React, { useEffect, useCallback, useState } from "react";
import {
  useGetTrollingPresets,
  usePostTrollingPresets,
  useDeleteTrollingPresetsId,
  getGetTrollingPresetsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppState } from "@/lib/context";
import { useDriftStore, TROLL_MAX_KNOTS } from "@/lib/driftStore";
import { computeDrift } from "@/lib/computeDrift";
import { useSurfaceConditions } from "@/hooks/useSurfaceConditions";

interface CompassProps {
  degrees: number;
  size?: number;
  color?: string;
}

const Compass: React.FC<CompassProps> = ({ degrees, size = 40, color = "#00e5ff" }) => {
  const rad = ((degrees - 90) * Math.PI) / 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;
  const tipX = cx + r * Math.cos(rad);
  const tipY = cy + r * Math.sin(rad);
  const tailX = cx - r * 0.55 * Math.cos(rad);
  const tailY = cy - r * 0.55 * Math.sin(rad);
  const perpX = -Math.sin(rad) * r * 0.18;
  const perpY = Math.cos(rad) * r * 0.18;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={size * 0.44} stroke="rgba(0,229,255,0.15)" strokeWidth={1} fill="none" />
      {[0, 90, 180, 270].map((a, i) => {
        const ar = ((a - 90) * Math.PI) / 180;
        const label = ["N", "E", "S", "W"][i];
        return (
          <text
            key={a}
            x={cx + (size * 0.38) * Math.cos(ar)}
            y={cy + (size * 0.38) * Math.sin(ar) + 3}
            textAnchor="middle"
            fontSize={size * 0.14}
            fill="rgba(0,229,255,0.4)"
          >{label}</text>
        );
      })}
      <polygon
        points={`${tipX},${tipY} ${tailX + perpX},${tailY + perpY} ${tailX - perpX},${tailY - perpY}`}
        fill={color}
        opacity={0.9}
      />
    </svg>
  );
};

function degToCardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16]!;
}

const PANEL_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 56,
  right: 16,
  zIndex: 50,
  background: "rgba(0,8,20,0.92)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 8,
  padding: "12px 14px",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  color: "#94a3b8",
  letterSpacing: "0.06em",
  backdropFilter: "blur(8px)",
  minWidth: 220,
  maxWidth: 260,
  pointerEvents: "auto",
};

const LABEL: React.CSSProperties = { color: "#475569", fontSize: 9, letterSpacing: "0.18em" };
const VALUE: React.CSSProperties = { color: "#00e5ff", fontWeight: 700 };
const DIVIDER: React.CSSProperties = { borderTop: "1px solid rgba(0,229,255,0.1)", margin: "8px 0" };

interface WeatherPanelProps {
  onClose: () => void;
}

export const WeatherPanel: React.FC<WeatherPanelProps> = ({ onClose }) => {
  const { terrain } = useAppState();
  const {
    driftConditions,
    setDriftConditions,
    setDriftPath,
    setEstimatedConditions,
    estimatedConditions,
    driftHour,
    driftStartLat,
    driftStartLon,
    setDriftStart,
    lineLengthM,
    setLineLengthM,
    manualWindSpeedKnots,
    setManualWindSpeedKnots,
    manualWindDegrees,
    setManualWindDegrees,
    manualTidalSpeedKnots,
    setManualTidalSpeedKnots,
    manualTidalDegrees,
    setManualTidalDegrees,
    manualSlackNow,
    setManualSlackNow,
    driftMode,
    setDriftMode,
    boatHeadingDeg,
    setBoatHeadingDeg,
    boatSpeedKnots,
    setBoatSpeedKnots,
    driftWaypoints,
    removeDriftWaypoint,
    moveDriftWaypoint,
    clearDriftWaypoints,
    setDriftWaypoints,
  } = useDriftStore();

  const queryClient = useQueryClient();
  const presetsQueryKey = getGetTrollingPresetsQueryKey();
  const { data: trollingPresets } = useGetTrollingPresets({
    query: { queryKey: presetsQueryKey, staleTime: 60 * 1000 },
  });
  const postPresetMutation = usePostTrollingPresets();
  const deletePresetMutation = useDeleteTrollingPresetsId();
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);

  const handleSavePreset = useCallback(async () => {
    const trimmed = presetName.trim();
    if (!trimmed) {
      setPresetError("Name required");
      return;
    }
    setPresetError(null);
    try {
      await postPresetMutation.mutateAsync({
        data: {
          name: trimmed,
          headingDeg: Math.round(boatHeadingDeg),
          speedKnots: Math.max(0, Math.min(TROLL_MAX_KNOTS, boatSpeedKnots)),
          startLat: driftStartLat,
          startLon: driftStartLon,
          waypoints: driftWaypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon })),
        },
      });
      setPresetName("");
      await queryClient.invalidateQueries({ queryKey: presetsQueryKey });
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : "Save failed");
    }
  }, [presetName, postPresetMutation, boatHeadingDeg, boatSpeedKnots, driftStartLat, driftStartLon, driftWaypoints, queryClient, presetsQueryKey]);

  const handleLoadPreset = useCallback((presetId: string) => {
    const preset = trollingPresets?.find((p) => p.id === presetId);
    if (!preset) return;
    setBoatHeadingDeg(preset.headingDeg);
    setBoatSpeedKnots(preset.speedKnots);
    if (preset.startLat != null && preset.startLon != null) {
      setDriftStart(preset.startLat, preset.startLon);
    }
    setDriftWaypoints(
      Array.isArray(preset.waypoints)
        ? preset.waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon }))
        : [],
    );
    setDriftMode("trolling");
  }, [trollingPresets, setBoatHeadingDeg, setBoatSpeedKnots, setDriftStart, setDriftWaypoints, setDriftMode]);

  const handleDeletePreset = useCallback(async (presetId: string) => {
    try {
      await deletePresetMutation.mutateAsync({ id: presetId });
      await queryClient.invalidateQueries({ queryKey: presetsQueryKey });
    } catch {
      // no-op; query will refetch on next visit
    }
  }, [deletePresetMutation, queryClient, presetsQueryKey]);

  const centerLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : 0;
  const centerLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : 0;

  // Shared surface-conditions hook — same query key as the always-on overlays,
  // so React Query dedupes and Drift Planner stays in sync with WIND/TIDE/CURRENT.
  const { data, hours: sharedHours, loading: isLoading, error: isError, estimated, refetch } =
    useSurfaceConditions(!!terrain);

  // Single source of truth for the auto-drift recompute. Every input that
  // feeds computeDrift is captured in the dependency list so moving the
  // start point, changing line length, or any other driver retriggers the
  // calculation immediately — the timeline and "bottom in reach" readout
  // never trail the inputs.
  const recomputeAutoDrift = useCallback(() => {
    if (!sharedHours.length || !terrain) return;
    const hoursForStore = sharedHours.map(({ tideRising: _r, ...rest }) => rest) as
      import("@/lib/driftStore").HourlySurfaceCondition[];
    setDriftConditions(hoursForStore);
    setEstimatedConditions(estimated);

    const startLat = driftStartLat ?? centerLat;
    const startLon = driftStartLon ?? centerLon;
    if (driftStartLat === null) setDriftStart(centerLat, centerLon);

    const path = computeDrift({
      conditions: hoursForStore,
      startLat,
      startLon,
      lineLengthM,
      lineWeightG: 500,
      terrain,
      mode: driftMode,
      boatHeadingDeg,
      boatSpeedKnots,
      trollWaypoints: driftWaypoints,
    });
    setDriftPath(path);
  }, [
    sharedHours, estimated, terrain,
    driftStartLat, driftStartLon, centerLat, centerLon,
    lineLengthM, driftMode, boatHeadingDeg, boatSpeedKnots, driftWaypoints,
    setDriftConditions, setEstimatedConditions, setDriftStart, setDriftPath,
  ]);

  useEffect(() => {
    recomputeAutoDrift();
  }, [recomputeAutoDrift]);

  const recomputeWithManual = useCallback(() => {
    if (!terrain) return;
    const tidalSpeed = manualSlackNow ? 0 : manualTidalSpeedKnots;
    const manualConditions = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      windSpeedKnots: manualWindSpeedKnots,
      windDegrees: manualWindDegrees,
      tidalSpeedKnots: tidalSpeed,
      tidalDegrees: manualTidalDegrees,
      waveHeightM: 0.3,
      isSlack: manualSlackNow,
      phase: manualSlackNow ? ("slack-high" as const) : undefined,
    }));
    setDriftConditions(manualConditions);
    const startLat = driftStartLat ?? centerLat;
    const startLon = driftStartLon ?? centerLon;
    const path = computeDrift({
      conditions: manualConditions,
      startLat,
      startLon,
      lineLengthM,
      lineWeightG: 500,
      terrain,
      mode: driftMode,
      boatHeadingDeg,
      boatSpeedKnots,
      trollWaypoints: driftWaypoints,
    });
    setDriftPath(path);
  }, [terrain, manualWindSpeedKnots, manualWindDegrees, manualTidalSpeedKnots, manualTidalDegrees, driftStartLat, driftStartLon, lineLengthM, centerLat, centerLon, driftMode, boatHeadingDeg, boatSpeedKnots, driftWaypoints]);

  const cond = driftConditions?.[driftHour];

  const sliderStyle: React.CSSProperties = {
    width: "100%",
    accentColor: "#00e5ff",
    cursor: "pointer",
  };

  return (
    <div style={PANEL_STYLE}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ ...VALUE, fontSize: 11, letterSpacing: "0.15em" }}>⛵ DRIFT PLANNER</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
        >×</button>
      </div>

      {isLoading && (
        <div style={{ color: "#22d3ee", fontSize: 9, letterSpacing: "0.12em", marginBottom: 8 }}>
          ↻ Fetching conditions…
        </div>
      )}

      {(isError || estimatedConditions) && (
        <div style={{ color: "#fbbf24", fontSize: 9, letterSpacing: "0.1em", marginBottom: 8, padding: "4px 6px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 4 }}>
          ⚠ Using estimated conditions
        </div>
      )}

      {cond && !estimatedConditions && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Compass degrees={cond.windDegrees} size={42} color="#7dd3fc" />
            <div>
              <div style={LABEL}>WIND</div>
              <div style={{ ...VALUE, color: "#7dd3fc" }}>{cond.windSpeedKnots.toFixed(1)} kt</div>
              <div style={{ fontSize: 9, color: "#475569" }}>{degToCardinal(cond.windDegrees)} {Math.round(cond.windDegrees)}°</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Compass degrees={cond.tidalDegrees} size={42} color="#34d399" />
            <div>
              <div style={LABEL}>TIDAL CURRENT</div>
              <div style={{ ...VALUE, color: "#34d399" }}>{cond.tidalSpeedKnots.toFixed(1)} kt</div>
              <div style={{ fontSize: 9, color: "#475569" }}>{degToCardinal(cond.tidalDegrees)} {Math.round(cond.tidalDegrees)}°</div>
              {data?.tidalDataSource === "noaa-coops" && data.tidalStationName ? (
                <div
                  data-testid="tidal-source"
                  style={{ fontSize: 8, color: "#64748b", marginTop: 2, letterSpacing: "0.05em" }}
                  title={`NOAA CO-OPS station ${data.tidalStationId ?? ""}`}
                >
                  NOAA: {data.tidalStationName}
                  {typeof data.tidalStationDistanceKm === "number"
                    ? ` (${data.tidalStationDistanceKm.toFixed(1)} km away)`
                    : ""}
                </div>
              ) : (
                <div
                  data-testid="tidal-source"
                  style={{ fontSize: 8, color: "#64748b", marginTop: 2, letterSpacing: "0.05em", fontStyle: "italic" }}
                >
                  Estimated (no NOAA station nearby)
                </div>
              )}
            </div>
          </div>
          <div>
            <span style={LABEL}>WAVE HEIGHT </span>
            <span style={{ ...VALUE, color: "#60a5fa" }}>{cond.waveHeightM.toFixed(2)} m</span>
          </div>
        </div>
      )}

      <div style={DIVIDER} />

      {/* Mode toggle: Drift vs Trolling */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ ...LABEL, marginBottom: 4 }}>MODE</div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["drift", "trolling"] as const).map((m) => {
            const active = driftMode === m;
            return (
              <button
                key={m}
                onClick={() => setDriftMode(m)}
                style={{
                  flex: 1,
                  background: active ? "rgba(0,229,255,0.15)" : "rgba(0,10,20,0.8)",
                  border: `1px solid ${active ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.15)"}`,
                  color: active ? "#00e5ff" : "#475569",
                  fontFamily: "inherit",
                  fontSize: 9,
                  padding: "4px",
                  borderRadius: 3,
                  cursor: "pointer",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                {m === "drift" ? "⛵ DRIFT" : "🎣 TROLLING"}
              </button>
            );
          })}
        </div>
      </div>

      {driftMode === "trolling" && (
        <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 4 }}>
          {driftWaypoints.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <Compass degrees={boatHeadingDeg} size={42} color="#fbbf24" />
              <div style={{ flex: 1 }}>
                <div style={LABEL}>BOAT HEADING</div>
                <div style={{ ...VALUE, color: "#fbbf24" }}>{degToCardinal(boatHeadingDeg)} {Math.round(boatHeadingDeg)}°</div>
                <input
                  data-testid="boat-heading-slider"
                  type="range"
                  min={0}
                  max={359}
                  value={boatHeadingDeg}
                  onChange={(e) => setBoatHeadingDeg(Number(e.target.value))}
                  style={sliderStyle}
                />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 9, color: "#fbbf24", marginBottom: 6, letterSpacing: "0.1em" }}>
              ⇢ Heading auto-steered to waypoints
            </div>
          )}

          <div style={{ marginBottom: 6 }}>
            <div style={LABEL}>PRESETS</div>
            {trollingPresets && trollingPresets.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
                {trollingPresets.map((p) => (
                  <div key={p.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <button
                      onClick={() => handleLoadPreset(p.id)}
                      title={`Load ${p.name}: ${Math.round(p.headingDeg)}° @ ${p.speedKnots}kt`}
                      style={{
                        flex: 1,
                        textAlign: "left",
                        background: "rgba(0,10,20,0.8)",
                        border: "1px solid rgba(0,229,255,0.2)",
                        color: "#00e5ff",
                        fontFamily: "inherit",
                        fontSize: 9,
                        padding: "3px 6px",
                        borderRadius: 3,
                        cursor: "pointer",
                        letterSpacing: "0.1em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name} · {Math.round(p.headingDeg)}° @ {p.speedKnots}kt
                    </button>
                    <button
                      onClick={() => void handleDeletePreset(p.id)}
                      aria-label={`Delete preset ${p.name}`}
                      title="Delete preset"
                      style={{
                        background: "rgba(0,10,20,0.8)",
                        border: "1px solid rgba(248,113,113,0.3)",
                        color: "#f87171",
                        fontFamily: "inherit",
                        fontSize: 9,
                        padding: "3px 6px",
                        borderRadius: 3,
                        cursor: "pointer",
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 8, color: "#475569", marginTop: 2 }}>
                No saved presets yet
              </div>
            )}
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <input
                type="text"
                placeholder="Name this pass"
                value={presetName}
                maxLength={80}
                onChange={(e) => setPresetName(e.target.value)}
                style={{
                  flex: 1,
                  background: "rgba(0,10,20,0.8)",
                  border: "1px solid rgba(0,229,255,0.2)",
                  color: "#00e5ff",
                  fontFamily: "inherit",
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 3,
                }}
              />
              <button
                onClick={() => void handleSavePreset()}
                disabled={postPresetMutation.isPending}
                style={{
                  background: "rgba(0,229,255,0.1)",
                  border: "1px solid rgba(0,229,255,0.3)",
                  color: "#00e5ff",
                  fontFamily: "inherit",
                  fontSize: 9,
                  padding: "2px 8px",
                  borderRadius: 3,
                  cursor: postPresetMutation.isPending ? "wait" : "pointer",
                  letterSpacing: "0.15em",
                }}
              >SAVE</button>
            </div>
            {presetError && (
              <div style={{ fontSize: 8, color: "#f87171", marginTop: 2 }}>{presetError}</div>
            )}
          </div>

          <div>
            <div style={LABEL}>BOAT SPEED THROUGH WATER</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                data-testid="boat-speed-input"
                type="number"
                min={0}
                max={TROLL_MAX_KNOTS}
                step={0.1}
                value={boatSpeedKnots}
                onChange={(e) => setBoatSpeedKnots(Number(e.target.value))}
                style={{ width: 56, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 10, padding: "2px 4px", borderRadius: 3 }}
              />
              <span style={{ ...LABEL }}>kt</span>
              <input
                type="range"
                min={0}
                max={TROLL_MAX_KNOTS}
                step={0.1}
                value={boatSpeedKnots}
                onChange={(e) => setBoatSpeedKnots(Number(e.target.value))}
                style={{ ...sliderStyle, flex: 1 }}
              />
            </div>
            <div style={{ fontSize: 8, color: "#475569", marginTop: 2 }}>
              Max {TROLL_MAX_KNOTS} kt · 0 kt falls back to pure drift
            </div>
          </div>

          {/* Multi-leg waypoint list */}
          <div style={{ marginTop: 8, borderTop: "1px solid rgba(0,229,255,0.1)", paddingTop: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={LABEL}>WAYPOINTS ({driftWaypoints.length})</span>
              {driftWaypoints.length > 0 && (
                <button
                  onClick={clearDriftWaypoints}
                  data-testid="clear-waypoints"
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "#f87171",
                    fontFamily: "inherit",
                    fontSize: 8,
                    padding: "2px 6px",
                    borderRadius: 3,
                    cursor: "pointer",
                    letterSpacing: "0.12em",
                  }}
                >CLEAR ALL</button>
              )}
            </div>
            {driftWaypoints.length === 0 ? (
              <div style={{ fontSize: 9, color: "#475569", fontStyle: "italic" }}>
                Click the water to drop turn points. Boat loops Start → WP1 → … → Start.
              </div>
            ) : (
              <div data-testid="waypoint-list" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {driftWaypoints.map((wp, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "rgba(0,10,20,0.7)",
                      border: "1px solid rgba(0,229,255,0.12)",
                      borderRadius: 3,
                      padding: "2px 4px",
                      fontSize: 9,
                    }}
                  >
                    <span style={{ color: "#fbbf24", fontWeight: 700, minWidth: 24 }}>
                      WP{i + 1}
                    </span>
                    <span style={{ color: "#94a3b8", flex: 1, fontVariantNumeric: "tabular-nums" }}>
                      {wp.lat.toFixed(4)}, {wp.lon.toFixed(4)}
                    </span>
                    <button
                      title="Move up"
                      disabled={i === 0}
                      onClick={() => moveDriftWaypoint(i, -1)}
                      style={{
                        background: "none",
                        border: "1px solid rgba(0,229,255,0.2)",
                        color: i === 0 ? "#334155" : "#00e5ff",
                        cursor: i === 0 ? "default" : "pointer",
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 2,
                      }}
                    >▲</button>
                    <button
                      title="Move down"
                      disabled={i === driftWaypoints.length - 1}
                      onClick={() => moveDriftWaypoint(i, 1)}
                      style={{
                        background: "none",
                        border: "1px solid rgba(0,229,255,0.2)",
                        color: i === driftWaypoints.length - 1 ? "#334155" : "#00e5ff",
                        cursor: i === driftWaypoints.length - 1 ? "default" : "pointer",
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 2,
                      }}
                    >▼</button>
                    <button
                      title="Remove waypoint"
                      onClick={() => removeDriftWaypoint(i)}
                      style={{
                        background: "none",
                        border: "1px solid rgba(239,68,68,0.3)",
                        color: "#f87171",
                        cursor: "pointer",
                        fontSize: 9,
                        padding: "0 4px",
                        borderRadius: 2,
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 6 }}>
        <span style={LABEL}>LINE LENGTH </span>
        <input
          type="number"
          min={10}
          max={1000}
          step={10}
          value={lineLengthM}
          onChange={(e) => setLineLengthM(Number(e.target.value))}
          style={{ width: 60, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 10, padding: "2px 4px", borderRadius: 3, marginLeft: 4 }}
        />
        <span style={{ ...LABEL, marginLeft: 3 }}>m</span>
      </div>

      {(isError || estimatedConditions) && (
        <div style={{ marginTop: 6 }}>
          <div style={{ ...LABEL, marginBottom: 4 }}>MANUAL OVERRIDE</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>
              <div style={LABEL}>WIND {manualWindSpeedKnots} kt @ {manualWindDegrees}°</div>
              <input type="range" min={0} max={40} value={manualWindSpeedKnots} onChange={(e) => setManualWindSpeedKnots(Number(e.target.value))} style={sliderStyle} />
              <input type="range" min={0} max={359} value={manualWindDegrees} onChange={(e) => setManualWindDegrees(Number(e.target.value))} style={sliderStyle} />
            </div>
            <div>
              <div style={LABEL}>TIDAL {manualSlackNow ? "0.0 (slack)" : manualTidalSpeedKnots} kt @ {manualTidalDegrees}°</div>
              <input type="range" min={0} max={6} step={0.1} value={manualTidalSpeedKnots} disabled={manualSlackNow} onChange={(e) => setManualTidalSpeedKnots(Number(e.target.value))} style={{ ...sliderStyle, opacity: manualSlackNow ? 0.4 : 1 }} />
              <input type="range" min={0} max={359} value={manualTidalDegrees} onChange={(e) => setManualTidalDegrees(Number(e.target.value))} style={sliderStyle} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, color: manualSlackNow ? "#c084fc" : "#64748b", cursor: "pointer", fontSize: 9, letterSpacing: "0.1em" }}>
                <input
                  type="checkbox"
                  checked={manualSlackNow}
                  onChange={(e) => setManualSlackNow(e.target.checked)}
                  style={{ accentColor: "#c084fc" }}
                />
                SLACK NOW (force current to 0)
              </label>
            </div>
            <button
              onClick={recomputeWithManual}
              style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "4px 10px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.15em" }}
            >COMPUTE DRIFT</button>
          </div>
        </div>
      )}

      <div style={{ ...DIVIDER, marginTop: 8 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => void refetch()}
          style={{ flex: 1, background: "rgba(0,10,20,0.8)", border: "1px solid rgba(0,229,255,0.2)", color: "#00e5ff", fontFamily: "inherit", fontSize: 9, padding: "4px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.15em" }}
        >⟳ REFRESH</button>
        <div style={{ fontSize: 9, color: "#1e3a5f", alignSelf: "center" }}>Open-Meteo</div>
      </div>
    </div>
  );
};
