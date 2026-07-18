import React, { useMemo } from "react";
import { useTidalStore } from "@/lib/tidalStore";
import {
  interpolateTideHeightFt,
  findTideExtremes,
  extremesInRange,
  type TideSample,
} from "@/lib/tidePrediction";

const LABEL: React.CSSProperties = {
  color: "#cbd5e1",
  fontSize: 15,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  fontWeight: 600,
};
const DIM: React.CSSProperties = { color: "#cbd5e1" };
const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

/** Distance beyond which the prediction accuracy caveat is shown. */
export const STATION_DISTANCE_CAVEAT_MILES = 30;

const DAY_MS = 86_400_000;

interface TideStationPanelProps {
  /** Trip-planning scrub time (global timeline), or null for "now". */
  scrubDatetime: Date | null;
  onScrubChange: (d: Date | null) => void;
  /** Real-time clock tick (epoch ms), advanced every minute while visible. */
  nowMs: number;
}

/** Build an SVG polyline path for one day of samples. */
function buildCurvePath(
  daySamples: TideSample[],
  dayStartMs: number,
  width: number,
  height: number,
  minV: number,
  maxV: number,
): string {
  if (daySamples.length === 0) return "";
  const span = maxV - minV || 1;
  const pts = daySamples.map((s) => {
    const x = ((s.tMs - dayStartMs) / DAY_MS) * width;
    const y = height - ((s.v - minV) / span) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M${pts.join(" L")}`;
}

export const TideStationPanel: React.FC<TideStationPanelProps> = ({
  scrubDatetime,
  onScrubChange,
  nowMs,
}) => {
  const station = useTidalStore((s) => s.station);
  const stationStatus = useTidalStore((s) => s.stationStatus);
  const samples = useTidalStore((s) => s.samples);
  const predictionsStatus = useTidalStore((s) => s.predictionsStatus);
  const windowStartMs = useTidalStore((s) => s.windowStartMs);
  const windowEndMs = useTidalStore((s) => s.windowEndMs);

  const activeMs = scrubDatetime ? scrubDatetime.getTime() : nowMs;

  const heightFt = useMemo(
    () => (samples ? interpolateTideHeightFt(samples, activeMs) : null),
    [samples, activeMs],
  );

  // Day selection for the trip-planning curve.
  const dayStartMs = useMemo(() => {
    const d = new Date(activeMs);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }, [activeMs]);

  const dayOffset = useMemo(() => {
    if (windowStartMs === null) return 0;
    return Math.max(0, Math.round((dayStartMs - windowStartMs) / DAY_MS));
  }, [dayStartMs, windowStartMs]);

  const maxDayOffset = useMemo(() => {
    if (windowStartMs === null || windowEndMs === null) return 0;
    return Math.max(0, Math.floor((windowEndMs - windowStartMs) / DAY_MS) - 1);
  }, [windowStartMs, windowEndMs]);

  const daySamples = useMemo(() => {
    if (!samples) return [] as TideSample[];
    const end = dayStartMs + DAY_MS;
    return samples.filter((s) => s.tMs >= dayStartMs && s.tMs <= end);
  }, [samples, dayStartMs]);

  const allExtremes = useMemo(
    () => (samples ? findTideExtremes(samples) : []),
    [samples],
  );

  const dayExtremes = useMemo(
    () => extremesInRange(allExtremes, dayStartMs, dayStartMs + DAY_MS),
    [allExtremes, dayStartMs],
  );

  const [minV, maxV] = useMemo(() => {
    if (daySamples.length === 0) return [0, 1] as const;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of daySamples) {
      if (s.v < lo) lo = s.v;
      if (s.v > hi) hi = s.v;
    }
    return [lo, hi] as const;
  }, [daySamples]);

  const CURVE_W = 232;
  const CURVE_H = 64;
  const curvePath = useMemo(
    () => buildCurvePath(daySamples, dayStartMs, CURVE_W, CURVE_H, minV, maxV),
    [daySamples, dayStartMs, minV, maxV],
  );

  const cursorX = Math.max(
    0,
    Math.min(CURVE_W, ((activeMs - dayStartMs) / DAY_MS) * CURVE_W),
  );

  // Scrub within the selected day (0–1439 minutes).
  const minuteOfDay = Math.max(
    0,
    Math.min(1439, Math.floor((activeMs - dayStartMs) / 60_000)),
  );

  function setDayOffset(offset: number) {
    if (windowStartMs === null) return;
    const base = windowStartMs + offset * DAY_MS;
    const nowDayStart = (() => {
      const d = new Date(nowMs);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    })();
    if (base === nowDayStart) {
      onScrubChange(null);
      return;
    }
    onScrubChange(new Date(base + (minuteOfDay % 1440) * 60_000));
  }

  function setMinute(m: number) {
    onScrubChange(new Date(dayStartMs + m * 60_000));
  }

  if (stationStatus === "idle") return null;

  return (
    <div data-testid="tide-station-panel" style={{ width: "100%", pointerEvents: "auto" }}>
      <div style={{ ...LABEL, marginBottom: 2 }}>Tide station</div>

      {stationStatus === "loading" && (
        <div style={{ ...DIM, fontSize: 15 }}>Locating nearest station…</div>
      )}
      {stationStatus === "unavailable" && (
        <div data-testid="tide-station-unavailable" style={{ ...DIM, fontSize: 15 }}>
          No NOAA tide station could be resolved for this area.
        </div>
      )}

      {station && (
        <>
          <div data-testid="tide-station-name" style={{ color: "#7dd3fc", fontSize: 16.5 }}>
            {station.name}{" "}
            <span style={{ ...DIM, fontSize: 13.5 }}>#{station.id}</span>
          </div>
          <div style={{ ...DIM, fontSize: 13.5 }}>
            {station.distanceMiles.toFixed(1)} mi from dataset center
          </div>
          {station.distanceMiles > STATION_DISTANCE_CAVEAT_MILES && (
            <div
              data-testid="tide-station-distance-caveat"
              style={{
                marginTop: 3,
                padding: "2px 5px",
                borderRadius: 2,
                background: "rgba(251,191,36,0.1)",
                border: "1px solid rgba(251,191,36,0.45)",
                color: "#fbbf24",
                fontSize: 13,
                letterSpacing: "0.08em",
              }}
            >
              ⚠ Station is over {STATION_DISTANCE_CAVEAT_MILES} miles away —
              local tide timing and range may differ.
            </div>
          )}

          {predictionsStatus === "loading" && (
            <div style={{ ...DIM, fontSize: 14, marginTop: 4 }}>
              Loading 31-day predictions…
            </div>
          )}
          {predictionsStatus === "unavailable" && (
            <div data-testid="tide-predictions-unavailable" style={{ ...DIM, fontSize: 14, marginTop: 4 }}>
              NOAA predictions are unavailable for this station right now.
            </div>
          )}

          {predictionsStatus === "ready" && heightFt !== null && (
            <div style={{ marginTop: 5 }}>
              <div style={LABEL}>
                {scrubDatetime ? "Planned tide" : "Tide now"}
              </div>
              <span data-testid="tide-station-height" style={{ ...CYAN, fontSize: 21, fontWeight: 700 }}>
                {heightFt >= 0 ? "+" : ""}
                {heightFt.toFixed(2)} ft
              </span>
              <span style={{ ...DIM, fontSize: 14, marginLeft: 4 }}>MLLW</span>
              {scrubDatetime && (
                <button
                  data-testid="tide-station-back-to-now"
                  onClick={() => onScrubChange(null)}
                  style={{
                    marginLeft: 8,
                    fontSize: 12.5,
                    padding: "1px 6px",
                    borderRadius: 2,
                    border: "1px solid rgba(0,229,255,0.4)",
                    background: "transparent",
                    color: "#00e5ff",
                    cursor: "pointer",
                    letterSpacing: "0.1em",
                  }}
                >
                  NOW
                </button>
              )}
            </div>
          )}

          {predictionsStatus === "ready" && daySamples.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {/* Day picker */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  data-testid="tide-day-prev"
                  disabled={dayOffset <= 0}
                  onClick={() => setDayOffset(dayOffset - 1)}
                  style={{
                    fontSize: 14,
                    padding: "1px 6px",
                    border: "1px solid rgba(0,229,255,0.3)",
                    borderRadius: 2,
                    background: "transparent",
                    color: dayOffset <= 0 ? "#475569" : "#00e5ff",
                    cursor: dayOffset <= 0 ? "default" : "pointer",
                  }}
                >
                  ◀
                </button>
                <span data-testid="tide-day-label" style={{ ...DIM, fontSize: 13.5, flex: 1, textAlign: "center" }}>
                  {new Date(dayStartMs).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  })}
                </span>
                <button
                  data-testid="tide-day-next"
                  disabled={dayOffset >= maxDayOffset}
                  onClick={() => setDayOffset(dayOffset + 1)}
                  style={{
                    fontSize: 14,
                    padding: "1px 6px",
                    border: "1px solid rgba(0,229,255,0.3)",
                    borderRadius: 2,
                    background: "transparent",
                    color: dayOffset >= maxDayOffset ? "#475569" : "#00e5ff",
                    cursor: dayOffset >= maxDayOffset ? "default" : "pointer",
                  }}
                >
                  ▶
                </button>
              </div>

              {/* Tide curve */}
              <svg
                data-testid="tide-curve"
                width={CURVE_W}
                height={CURVE_H}
                style={{
                  display: "block",
                  marginTop: 4,
                  background: "rgba(0,229,255,0.04)",
                  border: "1px solid rgba(0,229,255,0.15)",
                  borderRadius: 3,
                }}
              >
                <path d={curvePath} fill="none" stroke="#00e5ff" strokeWidth={1.5} />
                <line
                  x1={cursorX}
                  x2={cursorX}
                  y1={0}
                  y2={CURVE_H}
                  stroke="#f0abfc"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />
                {dayExtremes.map((e) => {
                  const span = maxV - minV || 1;
                  const x = ((e.tMs - dayStartMs) / DAY_MS) * CURVE_W;
                  const y =
                    CURVE_H - ((e.v - minV) / span) * (CURVE_H - 8) - 4;
                  return (
                    <circle
                      key={e.tMs}
                      data-testid={`tide-extreme-marker-${e.kind}`}
                      cx={x}
                      cy={y}
                      r={3}
                      fill={e.kind === "high" ? "#4ade80" : "#fbbf24"}
                      stroke="#0f172a"
                      strokeWidth={1}
                    />
                  );
                })}
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#64748b" }}>
                <span>{maxV.toFixed(1)} ft max</span>
                <span>{minV.toFixed(1)} ft min</span>
              </div>

              {/* High/low times for the selected day */}
              {dayExtremes.length > 0 && (
                <div data-testid="tide-extremes-list" style={{ marginTop: 5 }}>
                  <div style={{ ...LABEL, fontSize: 12.5 }}>High / Low</div>
                  {dayExtremes.map((e) => (
                    <button
                      key={e.tMs}
                      data-testid={`tide-extreme-${e.kind}`}
                      onClick={() => onScrubChange(new Date(e.tMs))}
                      title="Jump planning time to this tide"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        width: "100%",
                        padding: "1px 2px",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        fontSize: 13.5,
                        color: "#cbd5e1",
                        textAlign: "left",
                      }}
                    >
                      <span
                        style={{
                          color: e.kind === "high" ? "#4ade80" : "#fbbf24",
                          fontWeight: 700,
                          width: 34,
                        }}
                      >
                        {e.kind === "high" ? "HIGH" : "LOW"}
                      </span>
                      <span style={{ color: "#7dd3fc" }}>
                        {new Date(e.tMs).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })}
                      </span>
                      <span style={{ marginLeft: "auto" }}>
                        {e.v >= 0 ? "+" : ""}
                        {e.v.toFixed(2)} ft
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Time scrubber */}
              <input
                data-testid="tide-time-scrubber"
                type="range"
                min={0}
                max={1439}
                step={6}
                value={minuteOfDay}
                onChange={(e) => setMinute(Number(e.target.value))}
                style={{ width: "100%", marginTop: 4, accentColor: "#00e5ff" }}
                aria-label="Scrub tide prediction time"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};
