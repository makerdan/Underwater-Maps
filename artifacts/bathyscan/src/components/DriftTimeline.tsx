/**
 * DriftTimeline — HTML bottom panel showing 24 h drift timeline chips.
 *
 * Each chip shows local time (hour). Clicking advances the scrubber.
 * Below the chips, the selected hour shows drift speed, line angle,
 * hook depth, and a red/green indicator for bottom-reach.
 */

import React from "react";
import { useDriftStore } from "@/lib/driftStore";
import { useSettingsStore, type UnitsSystem } from "@/lib/settingsStore";
import { formatSpeedFromKnots } from "@/lib/units";

const PANEL_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: 60,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 50,
  background: "rgba(0,8,20,0.92)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 8,
  padding: "10px 14px 8px",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  color: "#94a3b8",
  letterSpacing: "0.06em",
  backdropFilter: "blur(8px)",
  pointerEvents: "auto",
  maxWidth: "calc(100vw - 80px)",
};

const CHIP_BASE: React.CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "3px 5px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 9,
  letterSpacing: "0.08em",
  border: "1px solid rgba(0,229,255,0.1)",
  minWidth: 28,
  userSelect: "none",
  transition: "all 0.1s ease",
};

function formatHour(h: number): string {
  return `${h.toString().padStart(2, "0")}:00`;
}

export const DriftTimeline: React.FC = () => {
  const { driftPath, driftHour, setDriftHour, driftConditions, lineLengthM, driftMode, boatHeadingDeg, boatSpeedKnots, driftWaypoints } = useDriftStore();
  const units = useSettingsStore((s) => s.units);

  if (!driftPath || driftPath.length === 0) return null;

  const wp = driftPath[driftHour];
  const cond = driftConditions?.[driftHour];

  const isTrolling = driftMode === "trolling";
  const usingWaypoints = isTrolling && driftWaypoints.length > 0;
  const activeLegIdx = wp?.activeLegIndex;
  const targetIdx = wp?.targetWaypointIndex;
  const legRemaining = wp?.legRemainingKm;
  const legLabel = targetIdx === -1 ? "→ START" : typeof targetIdx === "number" ? `→ WP${targetIdx + 1}` : "";

  return (
    <div style={PANEL_STYLE}>
      {/* Mode banner */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
        <span
          data-testid="timeline-drift-mode-badge"
          style={{
            fontSize: 9,
            letterSpacing: "0.2em",
            padding: "2px 8px",
            borderRadius: 3,
            border: `1px solid ${isTrolling ? "rgba(251,191,36,0.5)" : "rgba(0,229,255,0.4)"}`,
            background: isTrolling ? "rgba(251,191,36,0.1)" : "rgba(0,229,255,0.08)",
            color: isTrolling ? "#fbbf24" : "#00e5ff",
            fontWeight: 700,
          }}
        >
          {isTrolling
            ? usingWaypoints
              ? `🎣 TROLLING · ${driftWaypoints.length}-WP COURSE @ ${boatSpeedKnots.toFixed(1)} KT`
              : `🎣 TROLLING · ${Math.round(boatHeadingDeg)}° @ ${boatSpeedKnots.toFixed(1)} KT`
            : "⛵ DRIFT"}
        </span>
        {usingWaypoints && typeof activeLegIdx === "number" && (
          <span
            data-testid="active-leg"
            style={{
              marginLeft: 8,
              fontSize: 9,
              letterSpacing: "0.18em",
              padding: "2px 8px",
              borderRadius: 3,
              border: "1px solid rgba(34,211,238,0.4)",
              background: "rgba(34,211,238,0.08)",
              color: "#22d3ee",
              fontWeight: 700,
            }}
          >
            LEG {activeLegIdx + 1} {legLabel}
            {typeof legRemaining === "number" ? ` · ${legRemaining.toFixed(2)} km left` : ""}
          </span>
        )}
      </div>

      {/* Hour chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 8, justifyContent: "center" }}>
        {driftPath.map((w, h) => {
          const isActive = h === driftHour;
          const bottom = w.bottomReached;
          return (
            <button
              key={h}
              onClick={() => setDriftHour(h)}
              style={{
                ...CHIP_BASE,
                background: isActive ? "rgba(0,229,255,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${isActive ? "rgba(0,229,255,0.5)" : "rgba(0,229,255,0.08)"}`,
                color: isActive ? "#00e5ff" : "#475569",
              }}
            >
              <span>{formatHour(h)}</span>
              <span style={{ fontSize: 7, color: bottom ? "#4ade80" : "#ef4444", marginTop: 1 }}>
                {bottom ? "●" : "○"}
              </span>
              {w.isSlack && (
                <span
                  title="Slack tide"
                  style={{ fontSize: 7, color: "#c084fc", marginTop: 1, letterSpacing: 0 }}
                >
                  ◐ SLK
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected hour detail */}
      {wp && (
        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#475569", fontSize: 8, letterSpacing: "0.18em" }}>
              {isTrolling ? "TOTAL SPEED" : "DRIFT SPEED"}
            </div>
            <div data-testid="drift-speed-value" style={{ color: "#00e5ff", fontWeight: 700 }}>{formatSpeedFromKnots(wp.driftSpeedKnots, { units })}</div>
            {isTrolling && typeof wp.boatContributionKnots === "number" && typeof wp.driftContributionKnots === "number" && (
              <div
                data-testid="drift-breakdown"
                title="Boat propulsion and wind+tide drift are vectors; the total combines their directions, so it may be less than the sum."
                style={{ fontSize: 8, color: "#94a3b8", marginTop: 2, letterSpacing: "0.04em", cursor: "help" }}
              >
                <span style={{ color: "#fbbf24" }}>boat: {formatSpeedFromKnots(wp.boatContributionKnots, { units })}</span>
                <span style={{ color: "#475569" }}> + </span>
                <span style={{ color: "#7dd3fc" }}>drift: {formatSpeedFromKnots(wp.driftContributionKnots, { units })}</span>
              </div>
            )}
          </div>
          <div>
            <div style={{ color: "#475569", fontSize: 8, letterSpacing: "0.18em" }}>LINE ANGLE</div>
            {wp.isSlack ? (
              <div style={{ color: "#c084fc", fontWeight: 700 }}>
                Line vertical — slack tide
              </div>
            ) : (
              <div style={{ color: "#fbbf24", fontWeight: 700 }}>
                {wp.lineAngleDeg.toFixed(0)}° from vertical
              </div>
            )}
          </div>
          <div>
            <div style={{ color: "#475569", fontSize: 8, letterSpacing: "0.18em" }}>HOOK DEPTH</div>
            <div style={{ color: "#7dd3fc", fontWeight: 700 }}>{wp.hookDepthM.toFixed(0)} m</div>
          </div>
          <div>
            <div style={{ color: "#475569", fontSize: 8, letterSpacing: "0.18em" }}>BOTTOM {lineLengthM}m LINE</div>
            <div style={{ fontWeight: 700, color: wp.bottomReached ? "#4ade80" : "#ef4444" }}>
              {wp.bottomReached ? "✓ IN REACH" : "✗ TOO DEEP"}
            </div>
          </div>
          {cond && (
            <div>
              <div style={{ color: "#475569", fontSize: 8, letterSpacing: "0.18em" }}>WIND</div>
              <div style={{ color: "#93c5fd", fontWeight: 700 }}>{formatSpeedFromKnots(cond.windSpeedKnots, { units })}</div>
            </div>
          )}
        </div>
      )}

      {/* Arrow legend — only in trolling mode, since drift mode has no boat arrow */}
      {isTrolling && wp && (
        <div
          data-testid="arrow-legend"
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: 8,
            paddingTop: 6,
            borderTop: "1px solid rgba(0,229,255,0.08)",
            fontSize: 9,
            letterSpacing: "0.06em",
          }}
        >
          <LegendRow
            color="#fbbf24"
            label="Boat"
            valueKt={wp.boatContributionKnots}
            units={units}
          />
          <LegendRow
            color="#22d3ee"
            label="Drift"
            valueKt={wp.driftContributionKnots}
            units={units}
          />
          <LegendRow
            color="#e2e8f0"
            label="Resultant"
            valueKt={wp.driftSpeedKnots}
            units={units}
            faint
          />
        </div>
      )}

      <div style={{ textAlign: "center", fontSize: 8, color: "#1e3a5f", marginTop: 6, letterSpacing: "0.1em" }}>
        CLICK A CHIP TO SCRUB · ● = BOTTOM IN REACH · ○ = TOO DEEP
      </div>
    </div>
  );
};

const LegendRow: React.FC<{
  color: string;
  label: string;
  valueKt?: number;
  units: UnitsSystem;
  faint?: boolean;
}> = ({ color, label, valueKt, units, faint }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 14,
        height: 3,
        background: color,
        opacity: faint ? 0.5 : 1,
        borderRadius: 1,
        boxShadow: faint ? "none" : `0 0 4px ${color}`,
      }}
    />
    <span style={{ color: "#94a3b8", fontWeight: 600 }}>{label}</span>
    {typeof valueKt === "number" && (
      <span style={{ color, opacity: faint ? 0.8 : 1, fontWeight: 700 }}>
        {formatSpeedFromKnots(valueKt, { units })}
      </span>
    )}
  </span>
);
