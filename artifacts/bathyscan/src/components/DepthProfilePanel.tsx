/**
 * DepthProfilePanel — DOM panel that renders the depth cross-section chart.
 *
 * Reads useDepthProfileStore.profile. Shows nothing when no profile is set.
 * Renders an SVG line chart of depth vs distance with a slim coloured strip
 * underneath each sample indicating the AI zone classification (when known).
 *
 * Independent of the marker system; dismiss via the × button.
 */
import React from "react";
import { useDepthProfileStore } from "@/lib/depthProfileStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatDistance, formatDepth } from "@/lib/units";

// Representative colours for the four terrain texture slots. Mirrors the
// dominant RGB used by lib/textures.ts so users can tie the strip back to
// what they see on the seafloor.
const SLOT_COLORS = [
  "#dabe91", // 0 sand
  "#5c4e3e", // 1 sediment
  "#a8afc0", // 2 silt
  "#262120", // 3 basalt
] as const;

const SLOT_NAMES = [
  "Sand",
  "Sediment",
  "Silt",
  "Basalt",
] as const;

const WIDTH = 420;
const HEIGHT = 180;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 28;
const STRIP_HEIGHT = 8;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM - STRIP_HEIGHT;


export const DepthProfilePanel: React.FC = () => {
  const profile = useDepthProfileStore((s) => s.profile);
  const clearProfile = useDepthProfileStore((s) => s.clearProfile);
  const units = useSettingsStore((s) => s.units);

  if (!profile) return null;

  const { points, totalDistanceM, minDepthM, maxDepthM, start, end } = profile;

  // Axis ranges — pad the depth range so the polyline doesn't kiss the edges.
  const depthRange = (maxDepthM - minDepthM) || 1;
  const padDepth = depthRange * 0.08;
  const yMin = minDepthM - padDepth;
  const yMax = maxDepthM + padDepth;

  const xOf = (distanceM: number): number =>
    PAD_LEFT + (totalDistanceM > 0 ? (distanceM / totalDistanceM) * PLOT_W : 0);
  // Deeper (= larger depth) plots LOWER, so invert.
  const yOf = (depthM: number): number =>
    PAD_TOP + ((depthM - yMin) / (yMax - yMin || 1)) * PLOT_H;

  // Polyline path
  let path = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const cmd = i === 0 ? "M" : "L";
    path += `${cmd}${xOf(p.distanceM).toFixed(1)},${yOf(p.depthM).toFixed(1)} `;
  }

  // Area under the curve for subtle fill
  const firstP = points[0]!;
  const lastP = points[points.length - 1]!;
  const areaPath =
    `M${xOf(firstP.distanceM).toFixed(1)},${(PAD_TOP + PLOT_H).toFixed(1)} ` +
    path +
    `L${xOf(lastP.distanceM).toFixed(1)},${(PAD_TOP + PLOT_H).toFixed(1)} Z`;

  // Y-axis labels (4 ticks)
  const ticks = [yMin, yMin + (yMax - yMin) * 0.33, yMin + (yMax - yMin) * 0.66, yMax];

  // Zone strip — one rect per sample (very thin, abuts neighbours)
  const stripY = PAD_TOP + PLOT_H + 2;
  const stripRects: React.ReactElement[] = [];
  if (points.length >= 2) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const x0 = xOf(a.distanceM);
      const x1 = xOf(b.distanceM);
      const color = a.slot !== null ? SLOT_COLORS[a.slot] ?? "#334155" : "#334155";
      stripRects.push(
        <rect
          key={i}
          x={x0}
          y={stripY}
          width={Math.max(1, x1 - x0 + 0.5)}
          height={STRIP_HEIGHT}
          fill={color}
        />,
      );
    }
  }

  const anyClassified = points.some((p) => p.slot !== null);
  const presentSlots = Array.from(
    new Set(points.map((p) => p.slot).filter((s): s is number => s !== null)),
  ).sort();

  return (
    <div
      data-testid="depth-profile-panel"
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 36,
        pointerEvents: "auto",
        background: "rgba(0,10,20,0.92)",
        border: "1px solid rgba(0,229,255,0.3)",
        borderRadius: 6,
        padding: 12,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#cbd5e1",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
        minWidth: WIDTH + 24,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "#00e5ff" }}>
          ▼ DEPTH PROFILE
        </div>
        <button
          aria-label="Close depth profile"
          onClick={clearProfile}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      {/* Stats row */}
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>LEN <span style={{ color: "#e2e8f0" }}>{formatDistance(totalDistanceM, { units })}</span></span>
        <span>MIN <span style={{ color: "#e2e8f0" }}>{formatDepth(minDepthM, { units, decimals: 1 })}</span></span>
        <span>MAX <span style={{ color: "#e2e8f0" }}>{formatDepth(maxDepthM, { units, decimals: 1 })}</span></span>
        <span>Δ <span style={{ color: "#e2e8f0" }}>{formatDepth(maxDepthM - minDepthM, { units, decimals: 1 })}</span></span>
      </div>

      {/* Chart */}
      <svg width={WIDTH} height={HEIGHT} role="img" aria-label="Depth cross-section">
        {/* Plot background */}
        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={PLOT_W}
          height={PLOT_H}
          fill="rgba(0,40,80,0.18)"
          stroke="rgba(0,229,255,0.12)"
        />

        {/* Y-axis gridlines + labels (depth, in metres) */}
        {ticks.map((d, i) => {
          const y = yOf(d);
          return (
            <g key={i}>
              <line
                x1={PAD_LEFT}
                x2={PAD_LEFT + PLOT_W}
                y1={y}
                y2={y}
                stroke="rgba(0,229,255,0.08)"
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 3}
                fontSize={9}
                fill="#64748b"
                textAnchor="end"
                fontFamily="'JetBrains Mono', monospace"
              >
                {formatDepth(d, { units, localize: false })}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill="rgba(0,229,255,0.12)" />

        {/* Depth polyline */}
        <path
          d={path}
          fill="none"
          stroke="#00e5ff"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Zone strip beneath the chart */}
        {stripRects}

        {/* X-axis labels: 0 and total distance */}
        <text
          x={PAD_LEFT}
          y={HEIGHT - 4}
          fontSize={9}
          fill="#64748b"
          textAnchor="start"
          fontFamily="'JetBrains Mono', monospace"
        >
          0 m
        </text>
        <text
          x={PAD_LEFT + PLOT_W}
          y={HEIGHT - 4}
          fontSize={9}
          fill="#64748b"
          textAnchor="end"
          fontFamily="'JetBrains Mono', monospace"
        >
          {formatDistance(totalDistanceM)}
        </text>
      </svg>

      {/* Endpoint coords + zone legend */}
      <div style={{ fontSize: 9, color: "#64748b", marginTop: 6, display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span>A {start.lat.toFixed(4)},{start.lon.toFixed(4)}</span>
        <span>B {end.lat.toFixed(4)},{end.lon.toFixed(4)}</span>
      </div>

      {anyClassified ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 9, color: "#94a3b8" }}>
          {presentSlots.map((slot) => (
            <span key={slot} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 8,
                  background: SLOT_COLORS[slot] ?? "#334155",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              />
              {SLOT_NAMES[slot] ?? "Zone"}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 9, color: "#475569" }}>
          Zone classification not yet available — strip shows neutral grey.
        </div>
      )}
    </div>
  );
};
