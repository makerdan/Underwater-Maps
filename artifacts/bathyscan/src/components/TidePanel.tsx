import React, { useState, useMemo } from "react";
import type { TidalDataResult } from "@/hooks/useTidalData";
import type { DepthLayer } from "@/components/TidalCurrentArrows";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatDistance, formatDepth } from "@/lib/units";

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.3)",
  borderRadius: 4,
  backdropFilter: "blur(6px)",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 12,
  color: "#cbd5e1",
  letterSpacing: "0.07em",
  userSelect: "none",
  pointerEvents: "auto",
  minWidth: 230,
  maxWidth: 260,
};

const CYAN: React.CSSProperties = { color: "#00e5ff", textShadow: "0 0 6px rgba(0,229,255,0.5)" };
const DIM: React.CSSProperties = { color: "#94a3b8" };
const LABEL: React.CSSProperties = { color: "#94a3b8", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 600 };

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
  const units = useSettingsStore((s) => s.units);

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
            <div style={{ ...DIM, fontSize: 11 }}>Fetching tidal data…</div>
          )}

          {!data.available && !loading && (
            <div style={{ color: "#cbd5e1", fontSize: 11 }}>
              No tidal station within {formatDistance(100_000, { units })} of this area.
            </div>
          )}

          {data.available && (
            <>
              {/* Station */}
              <div>
                <div style={LABEL}>Station</div>
                <div style={{ color: "#7dd3fc", fontSize: 11 }}>{data.stationName}</div>
              </div>

              {/* Tide height */}
              <div className="flex gap-4 items-end">
                <div>
                  <div style={LABEL}>Tide height</div>
                  <span style={{ ...CYAN, fontSize: 15, fontWeight: 700 }}>
                    {data.tideHeight >= 0 ? "+" : ""}
                    {formatDepth(data.tideHeight, { units, decimals: 2 })}
                  </span>
                  <span style={{ ...DIM, fontSize: 10, marginLeft: 4 }}>MLLW</span>
                  {data.isPredicted && (
                    <span
                      style={{
                        marginLeft: 5,
                        fontSize: 9,
                        background: "rgba(251,191,36,0.18)",
                        border: "1px solid rgba(251,191,36,0.5)",
                        color: "#fcd34d",
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

              {/* Slack tide status */}
              {data.slack && (
                <div
                  style={{
                    padding: "4px 6px",
                    borderRadius: 3,
                    background: data.slack.isSlack
                      ? "rgba(168,85,247,0.12)"
                      : "rgba(0,229,255,0.06)",
                    border: `1px solid ${
                      data.slack.isSlack
                        ? "rgba(168,85,247,0.4)"
                        : "rgba(0,229,255,0.15)"
                    }`,
                  }}
                >
                  {data.slack.isSlack ? (
                    <div style={{ color: "#c084fc", fontSize: 10 }}>
                      ◐ Slack tide — current reversing
                      <div style={{ ...DIM, fontSize: 9, marginTop: 1 }}>
                        Next flow in {data.slack.minutesToSlack} min
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: "#7dd3fc", fontSize: 10 }}>
                      {data.slack.phase === "flooding" ? "Flooding" : "Ebbing"}{" "}
                      {compassLabel(data.currentDirection)} · slack in{" "}
                      {data.slack.minutesToSlack} min
                    </div>
                  )}
                </div>
              )}

              {/* Next event */}
              {data.nextEvent && (
                <div>
                  <div style={LABEL}>
                    Next {data.nextEvent.type === "high" ? "High" : "Low"}
                    {data.isPredicted ? " (predicted)" : ""}
                  </div>
                  <div style={{ color: "#f0abfc", fontSize: 11 }}>
                    {formatDepth(data.nextEvent.height, { units, decimals: 2 })} — in{" "}
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
                        fontSize: 10,
                        padding: "3px 7px",
                        borderRadius: 2,
                        border: `1px solid ${l === depthLayer ? "rgba(0,229,255,0.6)" : "rgba(0,229,255,0.3)"}`,
                        background: l === depthLayer ? "rgba(0,229,255,0.15)" : "transparent",
                        color: l === depthLayer ? "#00e5ff" : "#cbd5e1",
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
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 2,
                      border: `1px solid ${offset === selectedDayOffset ? "rgba(56,189,248,0.6)" : "rgba(0,229,255,0.25)"}`,
                      background:
                        offset === selectedDayOffset
                          ? "rgba(56,189,248,0.15)"
                          : "transparent",
                      color: offset === selectedDayOffset ? "#38bdf8" : "#cbd5e1",
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
                <span style={{ ...DIM, fontSize: 10, minWidth: 20 }}>00</span>
                <input
                  type="range"
                  min={0}
                  max={23}
                  value={scrubHour}
                  onChange={(e) => setHour(parseInt(e.target.value, 10))}
                  style={{ flex: 1, accentColor: "#00e5ff", height: 4 }}
                />
                <span style={{ ...DIM, fontSize: 10, minWidth: 20 }}>23</span>
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
