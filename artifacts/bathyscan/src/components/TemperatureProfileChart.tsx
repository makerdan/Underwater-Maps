/**
 * TemperatureProfileChart — small SVG mini-chart showing the
 * temperature-vs-depth profile (°C on X, depth on Y, deeper = lower).
 *
 * Pure presentational; samples + attribution are provided by the caller via
 * `sampleTemperatureProfile` in lib/waterTemp.ts. Designed to slot in below
 * the HUD's temperature chip as a popover.
 */
import React from "react";
import type { TemperatureProfile } from "@/lib/waterTemp";
import { formatTemperature, formatDepth, temperatureSuffix } from "@/lib/units";
import type { useSettingsStore } from "@/lib/settingsStore";

type Units = ReturnType<typeof useSettingsStore.getState>["units"];

const WIDTH = 200;
const HEIGHT = 180;
const PAD_LEFT = 38;
const PAD_RIGHT = 10;
const PAD_TOP = 8;
const PAD_BOTTOM = 24;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

export interface TemperatureProfileChartProps {
  profile: TemperatureProfile;
  units: Units;
  /** Optional depth (m) to mark on the curve — e.g. the crosshair / camera depth. */
  highlightDepthM?: number | null;
  /**
   * True when the profile samples come from a real measurement source
   * (bundled CTD, Argo, reanalysis) rather than the local thermocline
   * model. Controls the source badge label.
   */
  measured?: boolean;
  onClose?: () => void;
}

export const TemperatureProfileChart: React.FC<TemperatureProfileChartProps> = ({
  profile,
  units,
  highlightDepthM,
  measured = false,
  onClose,
}) => {
  const { samples, surfaceC, deepC, maxDepthM, source, sourceUrl, timestamp, live } = profile;

  // X axis: temperature. Pad the range so the line never kisses the edge.
  const tMin = Math.min(surfaceC, deepC);
  const tMax = Math.max(surfaceC, deepC);
  const tPad = Math.max(0.5, (tMax - tMin) * 0.1);
  const xMin = tMin - tPad;
  const xMax = tMax + tPad;

  const xOf = (c: number): number =>
    PAD_LEFT + ((c - xMin) / (xMax - xMin || 1)) * PLOT_W;
  const yOf = (d: number): number =>
    PAD_TOP + (d / (maxDepthM || 1)) * PLOT_H;

  let path = "";
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!;
    const cmd = i === 0 ? "M" : "L";
    path += `${cmd}${xOf(p.celsius).toFixed(1)},${yOf(p.depthM).toFixed(1)} `;
  }

  // Highlight point (interpolate °C at the requested depth so it sits exactly on the line)
  let hi: { x: number; y: number; depthM: number; celsius: number } | null = null;
  if (
    typeof highlightDepthM === "number" &&
    Number.isFinite(highlightDepthM) &&
    highlightDepthM >= 0 &&
    highlightDepthM <= maxDepthM &&
    samples.length > 0
  ) {
    // Linear interp between adjacent samples
    let lo = samples[0]!;
    let hiS = samples[samples.length - 1]!;
    for (let i = 0; i < samples.length - 1; i++) {
      if (samples[i]!.depthM <= highlightDepthM && samples[i + 1]!.depthM >= highlightDepthM) {
        lo = samples[i]!;
        hiS = samples[i + 1]!;
        break;
      }
    }
    const span = hiS.depthM - lo.depthM || 1;
    const t = (highlightDepthM - lo.depthM) / span;
    const celsius = lo.celsius + (hiS.celsius - lo.celsius) * t;
    hi = { x: xOf(celsius), y: yOf(highlightDepthM), depthM: highlightDepthM, celsius };
  }

  // Y-axis ticks: 0, mid, max
  const yTicks = [0, maxDepthM / 2, maxDepthM];
  // X-axis ticks: min, max (and mid if there's room)
  const xTicks = xMax - xMin > 4 ? [tMin, (tMin + tMax) / 2, tMax] : [tMin, tMax];

  const axisColor = "#334155";
  const lineColor = "#fb923c";
  const fillColor = "rgba(251,146,60,0.15)";

  const areaPath =
    `M${xOf(samples[0]!.celsius).toFixed(1)},${PAD_TOP} ` +
    path +
    `L${xOf(samples[samples.length - 1]!.celsius).toFixed(1)},${(PAD_TOP + PLOT_H).toFixed(1)} ` +
    `L${PAD_LEFT.toFixed(1)},${(PAD_TOP + PLOT_H).toFixed(1)} ` +
    `L${PAD_LEFT.toFixed(1)},${PAD_TOP.toFixed(1)} Z`;

  return (
    <div
      data-testid="hud-temp-profile"
      role="dialog"
      aria-label="Temperature profile chart"
      style={{
        background: "rgba(0,10,20,0.96)",
        border: "1px solid rgba(251,146,60,0.4)",
        borderRadius: 4,
        padding: "8px 10px 6px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        backdropFilter: "blur(8px)",
        color: "#cbd5e1",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 10,
        letterSpacing: "0.05em",
        minWidth: WIDTH + 20,
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ color: "#fb923c", fontWeight: 700, letterSpacing: "0.15em" }}>
          🌡 TEMP PROFILE
        </span>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close temperature profile"
            style={{
              background: "none",
              border: "1px solid rgba(251,146,60,0.3)",
              color: "#94a3b8",
              padding: "0 6px",
              borderRadius: 2,
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "inherit",
            }}
          >
            ✕
          </button>
        )}
      </div>

      <svg
        width={WIDTH}
        height={HEIGHT}
        style={{ display: "block" }}
        role="img"
        aria-label={`Temperature profile from 0 m to ${maxDepthM.toFixed(0)} m`}
      >
        {/* Axes */}
        <line
          x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={PAD_TOP + PLOT_H}
          stroke={axisColor} strokeWidth={1}
        />
        <line
          x1={PAD_LEFT} y1={PAD_TOP + PLOT_H} x2={PAD_LEFT + PLOT_W} y2={PAD_TOP + PLOT_H}
          stroke={axisColor} strokeWidth={1}
        />

        {/* Gridlines + Y-axis depth labels */}
        {yTicks.map((d, i) => (
          <g key={`y-${i}`}>
            <line
              x1={PAD_LEFT} y1={yOf(d)} x2={PAD_LEFT + PLOT_W} y2={yOf(d)}
              stroke="rgba(51,65,85,0.4)" strokeWidth={1} strokeDasharray="2 3"
            />
            <text
              x={PAD_LEFT - 4} y={yOf(d) + 3}
              textAnchor="end" fontSize={9} fill="#64748b"
              fontFamily="'JetBrains Mono', monospace"
            >
              {formatDepth(d, { units })}
            </text>
          </g>
        ))}

        {/* X-axis temperature labels */}
        {xTicks.map((c, i) => (
          <text
            key={`x-${i}`}
            x={xOf(c)} y={PAD_TOP + PLOT_H + 12}
            textAnchor="middle" fontSize={9} fill="#64748b"
            fontFamily="'JetBrains Mono', monospace"
          >
            {formatTemperature(c)}
          </text>
        ))}

        {/* Profile area + line */}
        <path d={areaPath} fill={fillColor} />
        <path d={path} fill="none" stroke={lineColor} strokeWidth={1.5} />

        {/* Highlight point */}
        {hi && (
          <g data-testid="hud-temp-profile-highlight">
            <line
              x1={PAD_LEFT} y1={hi.y} x2={hi.x} y2={hi.y}
              stroke="#7dd3fc" strokeWidth={1} strokeDasharray="2 2"
            />
            <line
              x1={hi.x} y1={PAD_TOP + PLOT_H} x2={hi.x} y2={hi.y}
              stroke="#7dd3fc" strokeWidth={1} strokeDasharray="2 2"
            />
            <circle cx={hi.x} cy={hi.y} r={3} fill="#7dd3fc" stroke="#0c4a6e" strokeWidth={1} />
          </g>
        )}

        {/* Axis titles */}
        <text
          x={PAD_LEFT + PLOT_W / 2} y={HEIGHT - 2}
          textAnchor="middle" fontSize={8} fill="#475569" letterSpacing="0.2em"
        >
          TEMPERATURE ({temperatureSuffix()})
        </text>
        <text
          x={10} y={PAD_TOP + PLOT_H / 2}
          textAnchor="middle" fontSize={8} fill="#475569" letterSpacing="0.2em"
          transform={`rotate(-90 10 ${PAD_TOP + PLOT_H / 2})`}
        >
          DEPTH
        </text>
      </svg>

      {/* Attribution */}
      <div
        data-testid="hud-temp-profile-source"
        style={{
          marginTop: 4,
          paddingTop: 4,
          borderTop: "1px solid rgba(51,65,85,0.4)",
          fontSize: 9,
          color: "#94a3b8",
          lineHeight: 1.4,
        }}
      >
        <div>
          <span
            data-testid="hud-temp-profile-badge"
            style={{
              fontSize: 8,
              letterSpacing: "0.15em",
              color: measured ? "#34d399" : live ? "#22d3ee" : "#f59e0b",
              background: measured
                ? "rgba(52,211,153,0.10)"
                : live
                  ? "rgba(0,229,255,0.08)"
                  : "rgba(245,158,11,0.10)",
              border: `1px solid ${
                measured
                  ? "rgba(52,211,153,0.4)"
                  : live
                    ? "rgba(0,229,255,0.25)"
                    : "rgba(245,158,11,0.4)"
              }`,
              borderRadius: 2,
              padding: "1px 4px",
              marginRight: 6,
            }}
          >
            {measured ? "MEASURED" : live ? "LIVE SST" : "EST"}
          </span>
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#94a3b8", textDecoration: "underline" }}
            >
              {source}
            </a>
          ) : (
            <span>{source}</span>
          )}
        </div>
        {timestamp && (
          <div style={{ color: "#64748b", marginTop: 2 }}>
            sampled {new Date(timestamp).toUTCString()}
          </div>
        )}
      </div>
    </div>
  );
};
