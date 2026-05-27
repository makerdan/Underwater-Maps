import React, { useMemo, useState } from "react";
import type { TidalDataResult } from "@/hooks/useTidalData";
import type { DepthLayer } from "@/components/TidalCurrentArrows";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { formatDistance, formatDepth, formatSpeedFromKnots } from "@/lib/units";
import { useTidalSchedule, type TidalScheduleEvent } from "@/hooks/useTidalSchedule";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { HelpIcon } from "@/components/help/HelpButton";
import { Spinner } from "@/components/ui/spinner";

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
const DIM: React.CSSProperties = { color: "#cbd5e1" };
const LABEL: React.CSSProperties = { color: "#cbd5e1", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 600 };

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
  lat: number | null;
  lon: number | null;
  embedded?: boolean;
}

function compassLabelLocal(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8] ?? "N";
}

interface StationSourceBadgeProps {
  source?: "noaa" | "estimated";
  stationId?: string;
  stationName?: string;
}

const StationSourceBadge: React.FC<StationSourceBadgeProps> = ({
  source,
  stationId,
  stationName,
}) => {
  const isNoaa = source === "noaa";
  const label = isNoaa
    ? `From NOAA station${stationName ? ` ${stationName}` : ""}`
    : "Estimated (no nearby station)";
  const tooltip = isNoaa
    ? stationId
      ? `Real observations from NOAA station ${stationId}`
      : "Real observations from a nearby NOAA station"
    : "Synthetic fallback — no NOAA station was in range, slack windows are approximate";
  const style: React.CSSProperties = isNoaa
    ? {
        marginTop: 3,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 9,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        padding: "1px 5px",
        borderRadius: 2,
        background: "rgba(52,211,153,0.12)",
        border: "1px solid rgba(52,211,153,0.5)",
        color: "#34d399",
      }
    : {
        marginTop: 3,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 9,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        padding: "1px 5px",
        borderRadius: 2,
        background: "rgba(148,163,184,0.08)",
        border: "1px dashed rgba(148,163,184,0.4)",
        color: "#94a3b8",
      };
  const content = (
    <span data-testid="tide-source-badge" data-source={isNoaa ? "noaa" : "estimated"} style={style} title={tooltip}>
      <span aria-hidden="true">{isNoaa ? "●" : "◌"}</span>
      <span>{label}</span>
      {isNoaa && stationId && (
        <span style={{ opacity: 0.85, letterSpacing: 0 }}>#{stationId}</span>
      )}
    </span>
  );
  if (isNoaa && stationId) {
    return (
      <a
        href={`https://tidesandcurrents.noaa.gov/stationhome.html?id=${encodeURIComponent(stationId)}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: "none" }}
      >
        {content}
      </a>
    );
  }
  return content;
};

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
  lat,
  lon,
  embedded = false,
}) => {
  const storeCollapsed = usePanelCollapseStore((s) => s.collapsed.tide);
  const collapsed = embedded ? false : storeCollapsed;
  const togglePanel = usePanelCollapseStore((s) => s.toggle);
  const [hoveredEvent, setHoveredEvent] = useState<TidalScheduleEvent | null>(null);
  const units = useSettingsStore((s) => s.units);
  const { schedule } = useTidalSchedule(lat, lon, 7);

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

  // Sorted slack event center-times across the full loaded window, used for
  // Prev/Next slack jump buttons.
  const slackTimesMs = useMemo(() => {
    if (!schedule) return [] as number[];
    return schedule.events
      .map((e) => new Date(e.time).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
  }, [schedule]);

  const referenceMs = (scrubDatetime ?? new Date()).getTime();
  const prevSlackMs = useMemo<number | null>(() => {
    for (let i = slackTimesMs.length - 1; i >= 0; i--) {
      const t = slackTimesMs[i];
      if (t !== undefined && t < referenceMs) return t;
    }
    return null;
  }, [slackTimesMs, referenceMs]);
  const nextSlackMs = useMemo<number | null>(() => {
    for (const t of slackTimesMs) {
      if (t > referenceMs) return t;
    }
    return null;
  }, [slackTimesMs, referenceMs]);

  function jumpToSlack(ms: number | null) {
    if (ms === null) return;
    onScrubChange(new Date(ms));
  }

  const selectedDayOffset = useMemo(() => {
    if (!scrubDay) return 0;
    return Math.round((scrubDay.getTime() - today.getTime()) / 86_400_000);
  }, [scrubDay, today]);

  // Bucket schedule events by day-offset for badge counts.
  const slackCountsByDay = useMemo(() => {
    const counts: Record<number, number> = {};
    if (!schedule) return counts;
    for (const e of schedule.events) {
      const t = new Date(e.time);
      const dayStart = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
      const offset = Math.round((dayStart - today.getTime()) / 86_400_000);
      if (offset < 0 || offset > 6) continue;
      counts[offset] = (counts[offset] ?? 0) + 1;
    }
    return counts;
  }, [schedule, today]);

  // Slack windows that intersect the currently-selected day, projected
  // onto the 0–24h slider range as percentages.
  const slackBandsForSelectedDay = useMemo(() => {
    if (!schedule) return [] as Array<{
      leftPct: number;
      widthPct: number;
      centerPct: number;
      event: TidalScheduleEvent;
    }>;
    const dayStartMs = (scrubDay ?? today).getTime();
    const dayEndMs = dayStartMs + 86_400_000;
    const out: Array<{
      leftPct: number;
      widthPct: number;
      centerPct: number;
      event: TidalScheduleEvent;
    }> = [];
    for (const e of schedule.events) {
      const wsMs = new Date(e.windowStart).getTime();
      const weMs = new Date(e.windowEnd).getTime();
      if (weMs < dayStartMs || wsMs > dayEndMs) continue;
      const clampedStart = Math.max(wsMs, dayStartMs);
      const clampedEnd = Math.min(weMs, dayEndMs);
      const leftPct = ((clampedStart - dayStartMs) / 86_400_000) * 100;
      const widthPct = ((clampedEnd - clampedStart) / 86_400_000) * 100;
      const centerMs = new Date(e.time).getTime();
      const centerPct = Math.max(0, Math.min(100, ((centerMs - dayStartMs) / 86_400_000) * 100));
      out.push({ leftPct, widthPct, centerPct, event: e });
    }
    return out;
  }, [schedule, scrubDay, today]);

  return (
    <div style={embedded ? { width: "100%" } : PANEL}>
      {/* Header — hidden when embedded inside a SidebarSection */}
      {!embedded && (
      <ViewscreenTooltip label={collapsed ? "Expand tide panel" : "Collapse tide panel"} side="left">
        <div
          className="flex items-center justify-between px-2 py-1.5 cursor-pointer"
          style={{ borderBottom: collapsed ? "none" : "1px solid rgba(0,229,255,0.1)" }}
          onClick={() => togglePanel("tide")}
        >
          <span style={{ ...CYAN, fontSize: 10, letterSpacing: "0.2em", display: "inline-flex", alignItems: "center", gap: 6 }}>
            ◉ TIDAL OVERLAY
            {loading && (
              <Spinner className="size-3 text-cyan-400" aria-label="Fetching tidal data" />
            )}
            <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
              <HelpIcon articleId="tidal-overlay" label="Tidal overlay" />
            </span>
          </span>
          <span style={{ ...DIM, fontSize: 20, lineHeight: 1 }}>{collapsed ? "▲" : "▼"}</span>
        </div>
      </ViewscreenTooltip>
      )}

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
                <StationSourceBadge
                  source={data.source}
                  stationId={data.stationId}
                  stationName={data.stationName}
                />
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
                  <div style={CYAN}>{formatSpeedFromKnots(data.currentSpeed, { units, decimals: 2 })}</div>
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
                    <ViewscreenTooltip
                      key={l}
                      label={`Show ${LAYER_LABELS[l].toLowerCase()} current layer`}
                      side="bottom"
                    >
                    <button
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
                    </ViewscreenTooltip>
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
                const slackCount = slackCountsByDay[offset] ?? 0;
                const dayTip = slackCount > 0
                  ? `${slackCount} slack window${slackCount === 1 ? "" : "s"} this day`
                  : "Jump to this day";
                return (
                  <ViewscreenTooltip key={offset} label={dayTip} side="bottom">
                  <button
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
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>{label}</span>
                    {slackCount > 0 && (
                      <span
                        style={{
                          color: "#c084fc",
                          fontSize: 9,
                          letterSpacing: 0,
                          opacity: 0.9,
                        }}
                      >
                        ◐{slackCount}
                      </span>
                    )}
                  </button>
                  </ViewscreenTooltip>
                );
              })}
            </div>

            {/* Slack jump buttons */}
            <div className="flex items-center justify-between mt-1.5 gap-1">
              <ViewscreenTooltip
                label={
                  prevSlackMs
                    ? `Jump to previous slack (${new Date(prevSlackMs).toLocaleString("en-US", {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "UTC",
                      })} UTC)`
                    : "No earlier slack in loaded window"
                }
                side="bottom"
              >
                <button
                  onClick={() => jumpToSlack(prevSlackMs)}
                  disabled={prevSlackMs === null}
                  data-testid="slack-prev"
                  style={{
                    fontSize: 10,
                    padding: "2px 7px",
                    borderRadius: 2,
                    border: `1px solid ${prevSlackMs === null ? "rgba(168,85,247,0.15)" : "rgba(168,85,247,0.5)"}`,
                    background: prevSlackMs === null ? "transparent" : "rgba(168,85,247,0.1)",
                    color: prevSlackMs === null ? "#475569" : "#c084fc",
                    cursor: prevSlackMs === null ? "not-allowed" : "pointer",
                    letterSpacing: "0.1em",
                    whiteSpace: "nowrap",
                  }}
                >
                  ◀ slack
                </button>
              </ViewscreenTooltip>
              <ViewscreenTooltip
                label={
                  nextSlackMs
                    ? `Jump to next slack (${new Date(nextSlackMs).toLocaleString("en-US", {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "UTC",
                      })} UTC)`
                    : "No upcoming slack in loaded window"
                }
                side="bottom"
              >
                <button
                  onClick={() => jumpToSlack(nextSlackMs)}
                  disabled={nextSlackMs === null}
                  data-testid="slack-next"
                  style={{
                    fontSize: 10,
                    padding: "2px 7px",
                    borderRadius: 2,
                    border: `1px solid ${nextSlackMs === null ? "rgba(168,85,247,0.15)" : "rgba(168,85,247,0.5)"}`,
                    background: nextSlackMs === null ? "transparent" : "rgba(168,85,247,0.1)",
                    color: nextSlackMs === null ? "#475569" : "#c084fc",
                    cursor: nextSlackMs === null ? "not-allowed" : "pointer",
                    letterSpacing: "0.1em",
                    whiteSpace: "nowrap",
                  }}
                >
                  slack ▶
                </button>
              </ViewscreenTooltip>
            </div>

            {/* Hour slider */}
            <div className="mt-1.5">
              <div className="flex items-center gap-2">
                <span style={{ ...DIM, fontSize: 10, minWidth: 20 }}>00</span>
                <div style={{ flex: 1, position: "relative", height: 18 }}>
                  {/* Slack window band overlay (purple shading) */}
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 6,
                      height: 6,
                      pointerEvents: "none",
                    }}
                  >
                    {slackBandsForSelectedDay.map((b, i) => (
                      <div
                        key={`band-${i}`}
                        style={{
                          position: "absolute",
                          left: `${b.leftPct}%`,
                          width: `${Math.max(0.4, b.widthPct)}%`,
                          top: 0,
                          height: "100%",
                          background:
                            "linear-gradient(90deg, rgba(168,85,247,0) 0%, rgba(168,85,247,0.55) 50%, rgba(168,85,247,0) 100%)",
                          borderRadius: 2,
                        }}
                      />
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={23}
                    value={scrubHour}
                    onChange={(e) => setHour(parseInt(e.target.value, 10))}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 0,
                      width: "100%",
                      accentColor: "#00e5ff",
                      height: 18,
                      background: "transparent",
                      zIndex: 1,
                    }}
                  />
                  {/* Slack center ticks (hoverable). Rendered AFTER the
                      range input and with a higher z-index so the tick's
                      8px hit-target sits on top of the input track and
                      actually receives mouseenter/leave from real pointers.
                      The thumb still drags everywhere else along the track.
                      Clicking a tick snaps the scrubber to that slack hour. */}
                  {slackBandsForSelectedDay.map((b, i) => {
                    const tickHour = new Date(b.event.time).getUTCHours();
                    return (
                      <div
                        key={`tick-${i}`}
                        onMouseEnter={() => setHoveredEvent(b.event)}
                        onMouseLeave={() =>
                          setHoveredEvent((cur) => (cur === b.event ? null : cur))
                        }
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setHour(tickHour);
                        }}
                        style={{
                          position: "absolute",
                          left: `calc(${b.centerPct}% - 4px)`,
                          top: 1,
                          width: 8,
                          height: 16,
                          cursor: "pointer",
                          zIndex: 2,
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: 3,
                            top: 0,
                            width: 2,
                            height: "100%",
                            background:
                              b.event.type === "high" ? "#c084fc" : "#f0abfc",
                            boxShadow: "0 0 4px rgba(192,132,252,0.7)",
                            borderRadius: 1,
                            pointerEvents: "none",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <span style={{ ...DIM, fontSize: 10, minWidth: 20 }}>23</span>
              </div>
              <div style={{ textAlign: "center", ...CYAN, fontSize: 10, marginTop: 2 }}>
                {String(scrubHour).padStart(2, "0")}:00 UTC
                {scrubDatetime ? "" : " (Live)"}
              </div>
              {hoveredEvent && (
                <div
                  style={{
                    marginTop: 4,
                    padding: "3px 6px",
                    borderRadius: 2,
                    background: "rgba(168,85,247,0.12)",
                    border: "1px solid rgba(168,85,247,0.4)",
                    color: "#e9d5ff",
                    fontSize: 10,
                    lineHeight: 1.4,
                  }}
                >
                  <div>
                    <span style={{ color: "#c084fc", fontWeight: 600 }}>
                      {hoveredEvent.type === "high" ? "Slack ↑ High" : "Slack ↓ Low"}
                    </span>{" "}
                    <span style={DIM}>
                      {new Date(hoveredEvent.time).toLocaleString("en-US", {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </span>
                  </div>
                  <div style={{ ...DIM, fontSize: 9 }}>
                    Reverses to{" "}
                    <span style={{ color: "#7dd3fc" }}>
                      {hoveredEvent.type === "high" ? "ebb" : "flood"}
                    </span>{" "}
                    → {compassLabelLocal(hoveredEvent.nextDirectionDeg)} (
                    {hoveredEvent.nextDirectionDeg}°) · height{" "}
                    {formatDepth(hoveredEvent.height, { units, decimals: 2 })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
