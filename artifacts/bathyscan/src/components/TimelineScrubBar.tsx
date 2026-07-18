/**
 * TimelineScrubBar — global time scrubber pinned to the bottom of the 3D view.
 *
 * Visible when at least one time-sensitive overlay (tide, currents, weather
 * stations, wind) is active. Drives useTimelineStore which all time-sensitive
 * overlays will read (wired in the next task).
 *
 * Layout:
 *   - Fixed to the bottom of the viewport (z-index 34).
 *   - When the depth-profile panel is active (a profile exists at its default
 *     bottom position), the bar slides up so it sits above the profile chart
 *     rather than overlapping it. Depth-profile z-index (36) is still above
 *     the bar (34) as a second safety net for the dragged-panel case.
 *
 * Play mode advances currentTime by 1 real minute per second of wall-clock
 * time, pausing automatically when the end of the range is reached.
 */
import React, { useEffect, useRef, useCallback, useMemo } from "react";
import { useUiStore } from "@/lib/uiStore";
import { useTimelineStore } from "@/lib/timelineStore";
import { useDepthProfileStore } from "@/lib/depthProfileStore";
import { useTidalStore } from "@/lib/tidalStore";
import { findTideExtremes, extremesInRange } from "@/lib/tidePrediction";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

const BAR_HEIGHT = 48;

/**
 * Approximate height of the depth-profile panel (SVG chart + header + padding)
 * plus its default `bottom: 16` offset. The bar shifts up by this amount when
 * a profile is active so the two panels don't overlap.
 */
const DEPTH_PROFILE_CLEARANCE = 230;

/** 1 wall-clock second = 1 timeline minute (60 000 ms). */
const MS_PER_WALL_SEC = 60_000;
const TICK_INTERVAL_MS = 100;
const MS_PER_TICK = (MS_PER_WALL_SEC * TICK_INTERVAL_MS) / 1000;

function formatTime(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const day = days[d.getDay()];
  const mon = months[d.getMonth()];
  const date = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${date}  ${hh}:${mm}`;
}

export const TimelineScrubBar: React.FC = () => {
  const tideOverlayActive = useUiStore((s) => s.tideOverlayActive);
  const currentOverlayActive = useUiStore((s) => s.currentOverlayActive);
  const windOverlayActive = useUiStore((s) => s.windOverlayActive);
  const weatherStationsActive = useUiStore((s) => s.weatherStationsActive);
  const rawsOverlayActive = useUiStore((s) => s.rawsOverlayActive);

  // Must exactly mirror useTimelineVisible() in uiStore.ts so the scrubber bar
  // is always visible whenever any overlay drives timeline-dependent behavior.
  const visible =
    tideOverlayActive || currentOverlayActive || windOverlayActive || weatherStationsActive || rawsOverlayActive;

  // Depth-profile panel clearance: when a profile is active and at its default
  // bottom position, push the scrubber bar upward so it sits above the chart.
  const profileActive = useDepthProfileStore((s) => s.profile !== null);
  const bottomOffset = profileActive ? DEPTH_PROFILE_CLEARANCE : 0;

  const currentTime = useTimelineStore((s) => s.currentTime);
  const timeRange = useTimelineStore((s) => s.timeRange);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const setTime = useTimelineStore((s) => s.setTime);
  const setPlaying = useTimelineStore((s) => s.setPlaying);

  // High/low tide extremes falling inside the trip window, so anglers can
  // line their outing up with slack water. Same detection + colours as the
  // tide-station panel (green = high, amber = low).
  const tideSamples = useTidalStore((s) => s.samples);
  const allExtremes = useMemo(
    () => (tideSamples ? findTideExtremes(tideSamples) : []),
    [tideSamples],
  );
  const windowExtremes = useMemo(
    () =>
      extremesInRange(
        allExtremes,
        timeRange.start.getTime(),
        timeRange.end.getTime(),
      ),
    [allExtremes, timeRange],
  );

  const rangeMs = timeRange.end.getTime() - timeRange.start.getTime();
  const currentMs = currentTime.getTime() - timeRange.start.getTime();
  const rangeValue = rangeMs > 0 ? Math.max(0, Math.min(1, currentMs / rangeMs)) : 0;

  const setTimeRef = useRef(setTime);
  setTimeRef.current = setTime;
  const setPlayingRef = useRef(setPlaying);
  setPlayingRef.current = setPlaying;
  const timeRangeRef = useRef(timeRange);
  timeRangeRef.current = timeRange;

  // Stop playback when the scrubber becomes hidden (overlay deactivated mid-play).
  // This prevents the interval from silently advancing time while no overlay is visible.
  useEffect(() => {
    if (!visible && isPlaying) {
      setPlaying(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      const { currentTime: ct } = useTimelineStore.getState();
      const range = timeRangeRef.current;
      const next = new Date(ct.getTime() + MS_PER_TICK);
      if (next.getTime() >= range.end.getTime()) {
        setTimeRef.current(range.end);
        setPlayingRef.current(false);
      } else {
        setTimeRef.current(next);
      }
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPlaying]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fraction = Number(e.target.value) / 10_000;
      const ms = timeRange.start.getTime() + fraction * rangeMs;
      setTime(new Date(ms));
      if (isPlaying) setPlaying(false);
    },
    [timeRange, rangeMs, setTime, isPlaying, setPlaying],
  );

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setPlaying(false);
    } else {
      if (currentTime.getTime() >= timeRange.end.getTime()) {
        setTime(timeRange.start);
      }
      setPlaying(true);
    }
  }, [isPlaying, setPlaying, currentTime, timeRange, setTime]);

  const barStyle: React.CSSProperties = {
    position: "fixed",
    bottom: bottomOffset,
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    zIndex: 34,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0 16px",
    background: "rgba(2,8,18,0.90)",
    borderTop: "1px solid rgba(0,229,255,0.18)",
    backdropFilter: "blur(8px)",
    fontFamily: FONT,
    userSelect: "none",
    pointerEvents: visible ? "auto" : "none",
    transition: "bottom 0.2s ease, transform 0.2s ease, opacity 0.2s ease",
    transform: visible ? "translateY(0)" : "translateY(100%)",
    opacity: visible ? 1 : 0,
  };

  const playBtnStyle: React.CSSProperties = {
    flexShrink: 0,
    width: 32,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: isPlaying ? "rgba(0,229,255,0.14)" : "rgba(15,23,42,0.6)",
    border: `1px solid ${isPlaying ? "rgba(0,229,255,0.55)" : "rgba(0,229,255,0.18)"}`,
    borderRadius: 4,
    color: isPlaying ? "#00e5ff" : "#94a3b8",
    cursor: "pointer",
    fontSize: 19.5,
    lineHeight: 1,
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
  };

  const rangeStyle: React.CSSProperties = {
    flex: 1,
    accentColor: "#00e5ff",
    cursor: "pointer",
    height: 4,
  };

  const timeLabel: React.CSSProperties = {
    flexShrink: 0,
    fontSize: 16.5,
    letterSpacing: "0.07em",
    color: "#00e5ff",
    textShadow: "0 0 6px rgba(0,229,255,0.4)",
    minWidth: 148,
    textAlign: "right",
  };

  const rangeLabel: React.CSSProperties = {
    flexShrink: 0,
    fontSize: 13.5,
    letterSpacing: "0.1em",
    color: "#475569",
    minWidth: 60,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 1,
  };

  return (
    <div
      data-testid="timeline-scrub-bar"
      style={barStyle}
      aria-hidden={!visible}
    >
      <button
        data-testid="timeline-play-pause"
        style={playBtnStyle}
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause timeline" : "Play timeline"}
        title={isPlaying ? "Pause" : "Play (1 min / sec)"}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>

      <div style={rangeLabel}>
        <span>
          {formatTime(timeRange.start).slice(4, 9)}
        </span>
      </div>

      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
        {/* High/low tide markers along the trip window — green = high, amber = low */}
        {rangeMs > 0 &&
          windowExtremes.map((e) => {
            const fraction = (e.tMs - timeRange.start.getTime()) / rangeMs;
            const pct = Math.max(0, Math.min(100, fraction * 100));
            const color = e.kind === "high" ? "#4ade80" : "#fbbf24";
            const label = `${e.kind === "high" ? "High" : "Low"} tide ${formatTime(new Date(e.tMs))} (${e.v >= 0 ? "+" : ""}${e.v.toFixed(2)} ft)`;
            return (
              <span
                key={e.tMs}
                data-testid={`timeline-tide-marker-${e.kind}`}
                title={label}
                aria-label={label}
                role="img"
                style={{
                  position: "absolute",
                  left: `${pct}%`,
                  top: -7,
                  transform: "translateX(-50%)",
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: color,
                  border: "1px solid #0f172a",
                  boxShadow: `0 0 4px ${color}`,
                  pointerEvents: "auto",
                  zIndex: 1,
                }}
              />
            );
          })}
        <input
          data-testid="timeline-scrubber"
          type="range"
          min={0}
          max={10_000}
          step={1}
          value={Math.round(rangeValue * 10_000)}
          onChange={handleScrub}
          style={{ ...rangeStyle, width: "100%" }}
          aria-label="Timeline position"
          aria-valuetext={formatTime(currentTime)}
        />
      </div>

      <div style={rangeLabel}>
        <span>
          {formatTime(timeRange.end).slice(4, 9)}
        </span>
      </div>

      <div style={timeLabel}>
        {formatTime(currentTime)}
      </div>
    </div>
  );
};
