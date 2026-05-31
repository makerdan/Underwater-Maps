/**
 * ForecastStrip — 48-hour horizontally scrollable forecast panel.
 *
 * Shows hourly wind speed + direction, wave height, and a condition icon
 * for each of the next 48 hours. Hours that qualify as good fishing windows
 * (wind < 12 kn AND wave < 0.8 m) are highlighted with a green accent.
 * Clicking any hour slot snaps the Drift Planner scrubber to that hour.
 * "Now" (relHour 0) is scrolled into view on mount.
 */

import React, { useEffect, useRef } from "react";
import { useSurfaceConditions, type ForecastHour } from "@/hooks/useSurfaceConditions";
import { useDriftStore } from "@/lib/driftStore";
import { useAppState } from "@/lib/context";
import { LocationBadge } from "@/components/LocationBadge";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOD_WIND_KN = 12;
const GOOD_WAVE_M = 0.8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isGoodFishing(h: ForecastHour): boolean {
  return h.windSpeedKnots < GOOD_WIND_KN && h.waveHeightM < GOOD_WAVE_M;
}

function conditionLabel(avgWind: number, maxWave: number): string {
  if (avgWind < 10 && maxWave < 0.5) return "Calm";
  if (avgWind < 22 && maxWave < 1.5) return "Moderate";
  return "Rough";
}

function conditionColor(label: string): string {
  if (label === "Calm") return "#22c55e";
  if (label === "Moderate") return "#facc15";
  return "#f87171";
}

function formatUtcHour(isoTime: string): string {
  const d = new Date(isoTime);
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function daySummary(slots: ForecastHour[]) {
  if (!slots.length) return { avgWind: 0, maxWave: 0, label: "Calm" };
  const avgWind = slots.reduce((s, h) => s + h.windSpeedKnots, 0) / slots.length;
  const maxWave = Math.max(...slots.map((h) => h.waveHeightM));
  const label = conditionLabel(avgWind, maxWave);
  return { avgWind, maxWave, label };
}

// ---------------------------------------------------------------------------
// Tiny wind direction arrow (inline SVG)
// ---------------------------------------------------------------------------

const WindArrow: React.FC<{ degrees: number; speed: number }> = ({ degrees, speed }) => {
  // degrees = direction wind is FROM; we want to show where it blows TO
  const toward = (degrees + 180) % 360;
  const rad = ((toward - 90) * Math.PI) / 180;
  const cx = 10;
  const cy = 10;
  const r = 7;
  const tipX = cx + r * Math.cos(rad);
  const tipY = cy + r * Math.sin(rad);
  const tailX = cx - r * 0.5 * Math.cos(rad);
  const tailY = cy - r * 0.5 * Math.sin(rad);
  const perpX = -Math.sin(rad) * r * 0.28;
  const perpY = Math.cos(rad) * r * 0.28;

  const color =
    speed < 10 ? "#7dd3fc" :
    speed < 18 ? "#a3e635" :
    speed < 28 ? "#facc15" :
    "#f87171";

  return (
    <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0, display: "block", margin: "0 auto" }}>
      <polygon
        points={`${tipX},${tipY} ${tailX + perpX},${tailY + perpY} ${tailX - perpX},${tailY - perpY}`}
        fill={color}
        opacity={0.9}
      />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Condition icon (clear / moderate / rough)
// ---------------------------------------------------------------------------

const ConditionIcon: React.FC<{ avgWind: number; maxWave: number }> = ({ avgWind, maxWave }) => {
  const label = conditionLabel(avgWind, maxWave);
  if (label === "Calm") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: "block", margin: "2px auto 0" }}>
        <circle cx={7} cy={7} r={3.5} fill="#facc15" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
          const ar = (a * Math.PI) / 180;
          return (
            <line
              key={a}
              x1={7 + 4.5 * Math.cos(ar)}
              y1={7 + 4.5 * Math.sin(ar)}
              x2={7 + 6.5 * Math.cos(ar)}
              y2={7 + 6.5 * Math.sin(ar)}
              stroke="#facc15"
              strokeWidth={1.2}
            />
          );
        })}
      </svg>
    );
  }
  if (label === "Rough") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: "block", margin: "2px auto 0" }}>
        <path d="M1 9 Q3 6 5 9 Q7 12 9 9 Q11 6 13 9" stroke="#f87171" strokeWidth={1.5} fill="none" />
        <path d="M1 6 Q3 3 5 6 Q7 9 9 6 Q11 3 13 6" stroke="#fb923c" strokeWidth={1.2} fill="none" />
      </svg>
    );
  }
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: "block", margin: "2px auto 0" }}>
      <path d="M3 10 Q5 8 8 9 Q11 8 12 10 Q13 12 10 12 H5 Q2 12 3 10Z" fill="#94a3b8" />
      <circle cx={5} cy={7} r={2.5} fill="#94a3b8" />
      <circle cx={8} cy={6} r={3} fill="#94a3b8" />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const ForecastStrip: React.FC = () => {
  const { forecast48h, loading, isFetching, centerLat, centerLon } = useSurfaceConditions(true);
  const { terrain } = useAppState();
  const setDriftHour = useDriftStore((s) => s.setDriftHour);
  const setDriftPlannerActive = useDriftStore((s) => s.setDriftPlannerActive);
  const nowRef = useRef<HTMLDivElement>(null);

  // Scroll "now" into view on mount
  useEffect(() => {
    if (nowRef.current) {
      nowRef.current.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    }
  }, [forecast48h.length]);

  if (loading && !forecast48h.length) {
    return (
      <div style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
        Loading forecast…
      </div>
    );
  }

  if (!forecast48h.length) {
    return (
      <div style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
        No forecast data available
      </div>
    );
  }

  const today = forecast48h.slice(0, 24);
  const tomorrow = forecast48h.slice(24, 48);
  const todaySummary = daySummary(today);
  const tomorrowSummary = daySummary(tomorrow);

  const handleSlotClick = (relHour: number) => {
    setDriftHour(relHour % 24);
    setDriftPlannerActive(true);
  };

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 10,
        color: "#e2e8f0",
        paddingBottom: 6,
      }}
    >
      {/* Location context badge */}
      {terrain && (
        <div style={{ padding: "6px 10px 0" }}>
          <LocationBadge
            datasetName={terrain.name}
            lat={centerLat}
            lon={centerLon}
            isLoading={loading}
            isFetching={isFetching}
          />
        </div>
      )}

      {/* Day summary bar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 4,
          padding: "8px 10px 6px",
          borderBottom: "1px dashed rgba(0,229,255,0.10)",
        }}
      >
        {[
          { label: "TODAY", summary: todaySummary },
          { label: "TOMORROW", summary: tomorrowSummary },
        ].map(({ label, summary }) => {
          const cLabel = conditionLabel(summary.avgWind, summary.maxWave);
          return (
            <div
              key={label}
              style={{
                background: "rgba(0,229,255,0.04)",
                borderRadius: 4,
                padding: "5px 7px",
                border: "1px solid rgba(0,229,255,0.10)",
              }}
            >
              <div style={{ fontSize: 8, color: "#64748b", letterSpacing: "0.15em", marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                <ConditionIcon avgWind={summary.avgWind} maxWave={summary.maxWave} />
                <span style={{ color: conditionColor(cLabel), fontWeight: 700, fontSize: 10 }}>
                  {cLabel}
                </span>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 9 }}>
                {summary.avgWind.toFixed(0)} kn · {summary.maxWave.toFixed(1)} m
              </div>
            </div>
          );
        })}
      </div>

      {/* Good-fishing legend */}
      <div
        style={{
          padding: "4px 10px",
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 9,
          color: "#64748b",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 18,
            height: 2,
            background: "#22c55e",
            borderRadius: 1,
            flexShrink: 0,
          }}
        />
        Good fishing (&lt;{GOOD_WIND_KN} kn, &lt;{GOOD_WAVE_M}m)
      </div>

      {/* Horizontally scrollable hour strip */}
      <div
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: 4,
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(0,229,255,0.25) transparent",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 3,
            padding: "2px 10px 2px",
            width: "max-content",
          }}
        >
          {forecast48h.map((slot, i) => {
            const isNow = i === 0;
            const isTomorrow = slot.relHour >= 24;
            const fishing = isGoodFishing(slot);
            return (
              <div
                key={i}
                ref={isNow ? nowRef : undefined}
                onClick={() => handleSlotClick(slot.relHour)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSlotClick(slot.relHour); }}
                aria-label={`${isNow ? "Now" : formatUtcHour(slot.isoTime)} UTC — wind ${slot.windSpeedKnots.toFixed(0)} kn, wave ${slot.waveHeightM.toFixed(1)} m${fishing ? ", good fishing" : ""}`}
                style={{
                  width: 46,
                  flexShrink: 0,
                  padding: "5px 3px 4px",
                  borderRadius: 4,
                  cursor: "pointer",
                  background: isNow
                    ? "rgba(0,229,255,0.12)"
                    : isTomorrow
                    ? "rgba(0,0,0,0.15)"
                    : "transparent",
                  border: isNow
                    ? "1px solid rgba(0,229,255,0.40)"
                    : "1px solid transparent",
                  borderBottom: fishing
                    ? "2px solid #22c55e"
                    : isNow
                    ? "2px solid rgba(0,229,255,0.40)"
                    : "2px solid transparent",
                  textAlign: "center",
                  transition: "background 0.1s",
                }}
              >
                {/* Time label */}
                <div
                  style={{
                    fontSize: 9,
                    color: isNow ? "#00e5ff" : "#64748b",
                    fontWeight: isNow ? 700 : 400,
                    letterSpacing: "0.05em",
                    marginBottom: 2,
                  }}
                >
                  {isNow ? "NOW" : formatUtcHour(slot.isoTime)}
                </div>

                {/* Wind direction arrow */}
                <WindArrow degrees={slot.windDegrees} speed={slot.windSpeedKnots} />

                {/* Wind speed */}
                <div style={{ fontSize: 9, color: "#e2e8f0", marginTop: 1 }}>
                  {slot.windSpeedKnots.toFixed(0)} kn
                </div>

                {/* Wave height */}
                <div style={{ fontSize: 9, color: "#7dd3fc" }}>
                  {slot.waveHeightM.toFixed(1)} m
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* UTC note */}
      <div style={{ padding: "2px 10px 0", fontSize: 8, color: "#475569", textAlign: "right" }}>
        Times in UTC
      </div>
    </div>
  );
};
