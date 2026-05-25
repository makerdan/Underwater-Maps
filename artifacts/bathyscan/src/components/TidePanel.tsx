import React, { useState, useMemo } from "react";
import type { TidalDataResult } from "@/hooks/useTidalData";
import type { DepthLayer } from "@/components/TidalCurrentArrows";

const PANEL: React.CSSProperties = {
  background: "rgba(0,10,20,0.88)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 4,
  backdropFilter: "blur(6px)",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 11,
  color: "#94a3b8",
  letterSpacing: "0.07em",
  userSelect: "none",
  pointerEvents: "auto",
  minWidth: 230,
  maxWidth: 260,
};

const CYAN: React.CSSProperties = { color: "#00e5ff", textShadow: "0 0 6px rgba(0,229,255,0.5)" };
const DIM: React.CSSProperties = { color: "#475569" };
const LABEL: React.CSSProperties = { color: "#475569", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase" };

function compassLabel(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8] ?? "N";
}

function timeToNext(isoStr: string, referenceTime: Date): string {
  const target = new Date(isoStr.replace(" ", "T") + (isoStr.includes("Z") ? "" : "Z"));
  const diffMs = target.getTime() - referenceTime.getTime();
  if (diffMs <= 0) return "now";
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function floodEbbLabel(direction: number, nextEventType?: "high" | "low"): string {
  if (nextEventType === "high") return "Flooding";
  if (nextEventType === "low") return "Ebbing";
  return compassLabel(direction);
}

interface TidePanelProps {
  data: TidalDataResult;
  loading: boolean;
  depthLayer: DepthLayer;
  onDepthLayerChange: (l: DepthLayer) => void;
  scrubDatetime: Date | null;
  onScrubChange: (d: Date | null) => void;
}

const DEPTH_LAYERS: DepthLayer[] = ["surface", "mid", "near-bottom"];
const LAYER_LABELS: Record<DepthLayer, string> = {
  surface: "Surface",
  mid: "Mid-col",
  "near-bottom": "Near-btm",
};

export const TidePanel: React.FC<TidePanelProps> = ({
  data,
  loading,
  depthLayer,
  onDepthLayerChange,
  scrubDatetime,
  onScrubChange,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const today = useMemo(() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }, []);

  const scrubDay = useMemo(() => {
    if (!scrubDatetime) return null;
    const d = new Date(scrubDatetime);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }, [scrubDatetime]);

  const scrubHour = scrubDatetime ? scrubDatetime.getUTCHours() : new Date().getUTCHours();

  const referenceTime = scrubDatetime ?? new Date();

  function setDay(offsetDays: number) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    d.setUTCHours(scrubHour, 0, 0, 0);
    if (offsetDays === 0) {
      const nowHour = new Date().getUTCHours();
      if (scrubHour === nowHour) {
        onScrubChange(null);
        return;
      }
    }
    onScrubChange(d);
  }

  function setHour(h: number) {
    const base = scrubDay ?? new Date(today);
    const d = new Date(base);
    d.setUTCHours(h, 0, 0, 0);
    const nowHour = new Date().getUTCHours();
    const isToday =
      d.getUTCFullYear() === today.getUTCFullYear() &&
      d.getUTCMonth() === today.getUTCMonth() &&
      d.getUTCDate() === today.getUTCDate();
    onScrubChange(isToday && h === nowHour ? null : d);
  }

  const selectedDayOffset = useMemo(() => {
    if (!scrubDay) return 0;
    return Math.round((scrubDay.getTime() - today.getTime()) / 86_400_000);
  }, [scrubDay, today]);

  return (
    <div style={PANEL}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-2 py-1.5 cursor-pointer"
        style={{ borderBottom: collapsed ? "none" : "1px solid rgba(0,229,255,0.1)" }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span style={{ ...CYAN, fontSize: 10, letterSpacing: "0.2em" }}>
          ◉ TIDAL OVERLAY
        </span>
        <span style={DIM}>{collapsed ? "▲" : "▼"}</span>
      </div>

      {!collapsed && (
        <div className="px-2 py-2 space-y-2">
          {loading && !data.available && (
            <div style={{ ...DIM, fontSize: 10 }}>Fetching tidal data…</div>
          )}

          {!data.available && !loading && (
            <div style={{ color: "#64748b", fontSize: 10 }}>
              No tidal station within 100 km of this area.
            </div>
          )}

          {data.available && (
            <>
              {/* Station */}
              <div>
                <div style={LABEL}>Station</div>
                <div style={{ color: "#7dd3fc", fontSize: 10 }}>{data.stationName}</div>
              </div>

              {/* Tide height */}
              <div className="flex gap-4 items-end">
                <div>
                  <div style={LABEL}>Tide height</div>
                  <span style={{ ...CYAN, fontSize: 15, fontWeight: 700 }}>
                    {data.tideHeight >= 0 ? "+" : ""}
                    {data.tideHeight.toFixed(2)} m
                  </span>
                  <span style={{ ...DIM, fontSize: 9, marginLeft: 4 }}>MLLW</span>
                  {data.isPredicted && (
                    <span
                      style={{
                        marginLeft: 5,
                        fontSize: 8,
                        background: "rgba(251,191,36,0.15)",
                        border: "1px solid rgba(251,191,36,0.4)",
                        color: "#fbbf24",
                        borderRadius: 2,
                        padding: "0 3px",
                        letterSpacing: "0.15em",
                      }}
                    >
                      PREDICTED
                    </span>
                  )}
                </div>
                <div>
                  <div style={LABEL}>Status</div>
                  <div style={{ color: "#34d399", fontSize: 11 }}>
                    {floodEbbLabel(data.currentDirection, data.nextEvent?.type)}{" "}
                    {compassLabel(data.currentDirection)}
                  </div>
                </div>
              </div>

              {/* Current */}
              <div className="flex gap-4">
                <div>
                  <div style={LABEL}>Direction</div>
                  <div style={CYAN}>
                    {Math.round(data.currentDirection)}° {compassLabel(data.currentDirection)}
                  </div>
                </div>
                <div>
                  <div style={LABEL}>Speed</div>
                  <div style={CYAN}>{data.currentSpeed.toFixed(2)} kn</div>
                </div>
              </div>

              {/* Next event */}
              {data.nextEvent && (
                <div>
                  <div style={LABEL}>
                    Next {data.nextEvent.type === "high" ? "High" : "Low"}
                    {data.isPredicted ? " (predicted)" : ""}
                  </div>
                  <div style={{ color: "#f0abfc", fontSize: 10 }}>
                    {data.nextEvent.height.toFixed(2)} m — in{" "}
                    {timeToNext(data.nextEvent.time, referenceTime)}
                  </div>
                </div>
              )}

              {/* Depth layer selector */}
              <div>
                <div style={LABEL}>Current layer</div>
                <div className="flex gap-1 mt-0.5">
                  {DEPTH_LAYERS.map((l) => (
                    <button
                      key={l}
                      onClick={() => onDepthLayerChange(l)}
                      style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        borderRadius: 2,
                        border: `1px solid ${l === depthLayer ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.15)"}`,
                        background: l === depthLayer ? "rgba(0,229,255,0.12)" : "transparent",
                        color: l === depthLayer ? "#00e5ff" : "#475569",
                        cursor: "pointer",
                        letterSpacing: "0.1em",
                      }}
                    >
                      {LAYER_LABELS[l]}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Time scrubber — always shown */}
          <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)", paddingTop: 6 }}>
            <div style={LABEL}>Time scrub</div>
            {/* Day selector */}
            <div className="flex gap-1 mt-1 flex-wrap">
              {[0, 1, 2, 3, 4, 5, 6].map((offset) => {
                const d = new Date(today);
                d.setUTCDate(d.getUTCDate() + offset);
                const label =
                  offset === 0
                    ? "Today"
                    : d.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "numeric",
                        day: "numeric",
                      });
                return (
                  <button
                    key={offset}
                    onClick={() => setDay(offset)}
                    style={{
                      fontSize: 8,
                      padding: "1px 5px",
                      borderRadius: 2,
                      border: `1px solid ${offset === selectedDayOffset ? "rgba(56,189,248,0.5)" : "rgba(0,229,255,0.12)"}`,
                      background:
                        offset === selectedDayOffset
                          ? "rgba(56,189,248,0.12)"
                          : "transparent",
                      color: offset === selectedDayOffset ? "#38bdf8" : "#475569",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Hour slider */}
            <div className="mt-1.5">
              <div className="flex items-center gap-2">
                <span style={{ ...DIM, fontSize: 9, minWidth: 20 }}>00</span>
                <input
                  type="range"
                  min={0}
                  max={23}
                  value={scrubHour}
                  onChange={(e) => setHour(parseInt(e.target.value, 10))}
                  style={{ flex: 1, accentColor: "#00e5ff", height: 4 }}
                />
                <span style={{ ...DIM, fontSize: 9, minWidth: 20 }}>23</span>
              </div>
              <div style={{ textAlign: "center", ...CYAN, fontSize: 10, marginTop: 2 }}>
                {String(scrubHour).padStart(2, "0")}:00 UTC
                {scrubDatetime ? "" : " (Live)"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
