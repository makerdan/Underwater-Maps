/**
 * DriftTimeline — HTML bottom panel showing 24 h drift timeline chips.
 *
 * Each chip shows local time (hour). Clicking advances the scrubber.
 * Below the chips, the selected hour shows drift speed, line angle,
 * hook depth, and a red/green indicator for bottom-reach.
 *
 * Backtroll indicators:
 *   - ⚓ HOLD badge on chips where isStalled is true
 *   - Stall speed detail in the expanded view when backtroll mode is active
 *   - Mode banner shows "⛵ BTROLL" when backtroll is enabled in trolling mode
 */

import React, { useEffect } from "react";
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
  fontSize: "calc(15px * var(--bs-font-scale, 1))",
  color: "#e2e8f0",
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
  fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
  letterSpacing: "0.08em",
  border: "1px solid rgba(0,229,255,0.1)",
  minWidth: 28,
  userSelect: "none",
  transition: "all 0.1s ease",
  outline: "none",
};

function formatHour(h: number): string {
  return `${h.toString().padStart(2, "0")}:00`;
}

const FOCUS_RING_STYLE = `
.drift-chip:focus-visible {
  outline: 2px solid #00e5ff;
  outline-offset: 2px;
}
`;

export const DriftTimeline: React.FC = () => {
  useEffect(() => {
    const id = "drift-chip-focus-style";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = FOCUS_RING_STYLE;
      document.head.appendChild(style);
    }
  }, []);
  const driftPath = useDriftStore((s) => s.driftPath);
  const driftHour = useDriftStore((s) => s.driftHour);
  const setDriftHour = useDriftStore((s) => s.setDriftHour);
  const driftConditions = useDriftStore((s) => s.driftConditions);
  const lineLengthM = useDriftStore((s) => s.lineLengthM);
  const driftMode = useDriftStore((s) => s.driftMode);
  const boatHeadingDeg = useDriftStore((s) => s.boatHeadingDeg);
  const boatSpeedKnots = useDriftStore((s) => s.boatSpeedKnots);
  const driftWaypoints = useDriftStore((s) => s.driftWaypoints);
  const backtroll = useDriftStore((s) => s.backtroll);
  const units = useSettingsStore((s) => s.units);

  if (!driftPath || driftPath.length === 0) return null;

  const wp = driftPath[driftHour];
  const cond = driftConditions?.[driftHour];

  const isTrolling = driftMode === "trolling";
  const isBacktrolling = isTrolling && backtroll;
  const usingWaypoints = isTrolling && driftWaypoints.length > 0;
  const activeLegIdx = wp?.activeLegIndex;
  const targetIdx = wp?.targetWaypointIndex;
  const legRemaining = wp?.legRemainingKm;
  const legLabel = targetIdx === -1 ? "→ START" : typeof targetIdx === "number" ? `→ WP${targetIdx + 1}` : "";

  return (
    <div className="drift-timeline" style={PANEL_STYLE}>
      {/* Mode banner */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
        <span
          data-testid="timeline-drift-mode-badge"
          style={{
            fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
            letterSpacing: "0.2em",
            padding: "2px 8px",
            borderRadius: 3,
            border: `1px solid ${isTrolling ? "rgba(251,191,36,0.5)" : "rgba(0,229,255,0.4)"}`,
            background: isTrolling ? "rgba(251,191,36,0.1)" : "rgba(0,229,255,0.08)",
            color: isTrolling ? "#fbbf24" : "#00e5ff",
            fontWeight: 700,
          }}
        >
          {isBacktrolling
            ? usingWaypoints
              ? `⛵ BTROLL · ${driftWaypoints.length}-WP COURSE @ ${boatSpeedKnots.toFixed(1)} KT`
              : `⛵ BTROLL · ${Math.round(boatHeadingDeg)}° @ ${boatSpeedKnots.toFixed(1)} KT`
            : isTrolling
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
          const stalled = !!w.isStalled;
          const contact = w.bottomContact;
          return (
            <button
              key={h}
              className="drift-chip"
              onClick={() => setDriftHour(h)}
              aria-label={`Hour ${h}${contact ? " — sinker drag warning" : stalled ? " — hold station" : bottom ? " — bottom in reach" : " — bottom too deep"}${w.isSlack ? ", slack tide" : ""}`}
              aria-pressed={isActive}
              title={contact ? "⚠ Sinker drag — sinker contacts seafloor" : undefined}
              style={{
                ...CHIP_BASE,
                background: isActive
                  ? contact
                    ? "rgba(251,113,133,0.18)"
                    : stalled
                      ? "rgba(251,191,36,0.15)"
                      : "rgba(0,229,255,0.15)"
                  : contact
                    ? "rgba(251,113,133,0.08)"
                    : stalled
                      ? "rgba(251,191,36,0.08)"
                      : "rgba(0,10,20,0.75)",
                border: `1px solid ${
                  contact
                    ? isActive
                      ? "rgba(251,113,133,0.7)"
                      : "rgba(251,113,133,0.35)"
                    : stalled
                      ? isActive
                        ? "rgba(251,191,36,0.6)"
                        : "rgba(251,191,36,0.3)"
                      : isActive
                        ? "rgba(0,229,255,0.5)"
                        : "rgba(0,229,255,0.08)"
                }`,
                color: isActive
                  ? contact
                    ? "#fb7185"
                    : stalled
                      ? "#fbbf24"
                      : "#00e5ff"
                  : "#94a3b8",
              }}
            >
              <span>{formatHour(h)}</span>
              {contact && (
                <span
                  title="Sinker drags seafloor"
                  style={{ fontSize: "calc(10.5px * var(--bs-font-scale, 1))", color: "#fb7185", marginTop: 1, letterSpacing: 0 }}
                >
                  ⚠ DRAG
                </span>
              )}
              {stalled && (
                <span
                  title="Backtroll hold — near-zero SOG at this hour"
                  style={{ fontSize: "calc(10.5px * var(--bs-font-scale, 1))", color: "#fbbf24", marginTop: 1, letterSpacing: 0 }}
                >
                  ⚓ HOLD
                </span>
              )}
              {!contact && !stalled && (
                <span style={{ fontSize: "calc(10.5px * var(--bs-font-scale, 1))", color: bottom ? "#4ade80" : "#ef4444", marginTop: 1 }}>
                  {bottom ? "●" : "○"}
                </span>
              )}
              {w.isSlack && (
                <span
                  title="Slack tide"
                  style={{ fontSize: "calc(10.5px * var(--bs-font-scale, 1))", color: "#c084fc", marginTop: 1, letterSpacing: 0 }}
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
            <div style={{ color: "#94a3b8", fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.18em" }}>
              {isTrolling ? "TOTAL SPEED" : "DRIFT SPEED"}
            </div>
            <div data-testid="drift-speed-value" style={{ color: wp.isStalled ? "#fbbf24" : "#00e5ff", fontWeight: 700 }}>
              {wp.isStalled ? "⚓ HOLD" : formatSpeedFromKnots(wp.driftSpeedKnots, { units })}
            </div>
            {isTrolling && typeof wp.boatContributionKnots === "number" && typeof wp.driftContributionKnots === "number" && (
              <div
                data-testid="drift-breakdown"
                title="Boat propulsion and wind+tide drift are vectors; the total combines their directions, so it may be less than the sum."
                style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#e2e8f0", marginTop: 2, letterSpacing: "0.04em", cursor: "help" }}
              >
                <span style={{ color: "#fbbf24" }}>boat: {formatSpeedFromKnots(wp.boatContributionKnots, { units })}</span>
                <span style={{ color: "#94a3b8" }}> + </span>
                <span style={{ color: "#7dd3fc" }}>drift: {formatSpeedFromKnots(wp.driftContributionKnots, { units })}</span>
              </div>
            )}
          </div>
          {isBacktrolling && typeof wp.stallSpeedKnots === "number" && (
            <div>
              <div style={{ color: "#94a3b8", fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.18em" }}>STALL SPEED</div>
              <div
                data-testid="stall-speed-value"
                title="Effective reverse speed needed to hold station against this hour's current"
                style={{ color: "#fbbf24", fontWeight: 700 }}
              >
                {formatSpeedFromKnots(wp.stallSpeedKnots, { units })}
              </div>
            </div>
          )}
          <div>
            <div style={{ color: "#94a3b8", fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.18em" }}>LINE ANGLE</div>
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
            <div style={{ color: "#94a3b8", fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.18em" }}>HOOK DEPTH</div>
            <div style={{ color: "#7dd3fc", fontWeight: 700 }}>{wp.hookDepthM.toFixed(0)} m</div>
          </div>
          <div>
            <div style={{ color: "#94a3b8", fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.18em" }}>LINE SCOPE</div>
            <div style={{ color: "#a78bfa", fontWeight: 700 }} data-testid="line-scope-value">
              {wp.lineScopeM.toFixed(0)} m
            </div>
          </div>
          <div>
            <div style={{ color: "#94a3b8", fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.18em" }}>BOTTOM {lineLengthM}m LINE</div>
            <div style={{ fontWeight: 700, color: wp.bottomReached ? "#4ade80" : "#ef4444" }}>
              {wp.bottomReached ? "✓ IN REACH" : "✗ TOO DEEP"}
            </div>
          </div>
          {wp.bottomContact && (
            <div
              data-testid="bottom-contact-warning"
              style={{
                alignSelf: "center",
                padding: "2px 7px",
                borderRadius: 3,
                border: "1px solid rgba(251,113,133,0.6)",
                background: "rgba(251,113,133,0.12)",
                color: "#fb7185",
                fontWeight: 700,
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                letterSpacing: "0.12em",
                whiteSpace: "nowrap",
              }}
            >
              ⚠ SINKER DRAG
            </div>
          )}
          {cond && (
            <div>
              <div style={{ color: "#94a3b8", fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.18em" }}>WIND</div>
              <div style={{ color: "#93c5fd", fontWeight: 700 }}>{formatSpeedFromKnots(cond.windSpeedKnots, { units })}</div>
            </div>
          )}
          {cond && typeof cond.tideHeightM === "number" && (
            <div>
              <div style={{ color: "#94a3b8", fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.18em" }}>TIDE HT</div>
              <div
                data-testid="tide-height-value"
                title="Predicted water level above chart datum (MLLW) — used to compute effective depth for tidal scaling"
                style={{ color: "#34d399", fontWeight: 700, cursor: "help" }}
              >
                {cond.tideHeightM >= 0 ? "+" : ""}{cond.tideHeightM.toFixed(1)} m
              </div>
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
            fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
            letterSpacing: "0.06em",
          }}
        >
          <LegendRow
            color="#fbbf24"
            label={isBacktrolling ? "Reverse" : "Boat"}
            ariaLabel={`Amber arrow: ${isBacktrolling ? "reverse engine thrust" : "boat propulsion"} direction`}
            valueKt={wp.boatContributionKnots}
            units={units}
          />
          <LegendRow
            color="#22d3ee"
            label="Drift"
            ariaLabel="Cyan arrow: wind and tidal drift direction"
            valueKt={wp.driftContributionKnots}
            units={units}
          />
          <LegendRow
            color="#e2e8f0"
            label="Resultant"
            ariaLabel="White arrow: net direction and speed combining all forces"
            valueKt={wp.driftSpeedKnots}
            units={units}
            faint
          />
        </div>
      )}

      {/* Probability cone legend */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 12,
          marginTop: 6,
          fontSize: "calc(12px * var(--bs-font-scale, 1))",
          color: "#64748b",
          letterSpacing: "0.1em",
        }}
        aria-label="Drift path legend"
      >
        <span>
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              background: "rgba(34,211,238,0.22)",
              borderRadius: 2,
              verticalAlign: "middle",
              marginRight: 4,
              border: "1px solid rgba(34,211,238,0.4)",
            }}
          />
          Cone = growing uncertainty
        </span>
        <span>● = bottom in reach</span>
        <span>○ = too deep</span>
        <span>⚠ = sinker drag</span>
        {isBacktrolling && <span>⚓ = station kept</span>}
      </div>
    </div>
  );
};

const LegendRow: React.FC<{
  color: string;
  label: string;
  ariaLabel?: string;
  valueKt?: number;
  units: UnitsSystem;
  faint?: boolean;
}> = ({ color, label, ariaLabel, valueKt, units, faint }) => (
  <span
    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
    aria-label={ariaLabel}
  >
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
    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{label}</span>
    {typeof valueKt === "number" && (
      <span style={{ color, opacity: faint ? 0.8 : 1, fontWeight: 700 }}>
        {formatSpeedFromKnots(valueKt, { units })}
      </span>
    )}
  </span>
);
