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
import { useAppState } from "@/lib/context";
import { formatDistance, formatDepth } from "@/lib/units";
import { HelpIcon } from "@/components/help/HelpButton";

// Friendly zone labels for the hover tooltip — matches SLOT_NAMES.
const ZONE_LABEL = ["Sand", "Sediment", "Silt", "Basalt"] as const;

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


function timestampForFilename(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64) || "dataset";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick to give the browser time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const DepthProfilePanel: React.FC = () => {
  const profile = useDepthProfileStore((s) => s.profile);
  const clearProfile = useDepthProfileStore((s) => s.clearProfile);
  const hoverIndex = useDepthProfileStore((s) => s.hoverIndex);
  const setHoverIndex = useDepthProfileStore((s) => s.setHoverIndex);
  const units = useSettingsStore((s) => s.units);
  const { datasetId } = useAppState();
  const svgRef = React.useRef<SVGSVGElement | null>(null);

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

  const filenameBase = `bathyscan-profile_${sanitizeForFilename(
    datasetId ?? "dataset",
  )}_${timestampForFilename(profile.at)}`;

  const exportCsv = () => {
    const header = "distance_m,depth_m,slot,lon,lat";
    const dx = end.lon - start.lon;
    const dy = end.lat - start.lat;
    const lines = points.map((p) => {
      const t = totalDistanceM > 0 ? p.distanceM / totalDistanceM : 0;
      const lon = start.lon + dx * t;
      const lat = start.lat + dy * t;
      const slot = p.slot === null ? "" : String(p.slot);
      return `${p.distanceM.toFixed(3)},${p.depthM.toFixed(4)},${slot},${lon.toFixed(7)},${lat.toFixed(7)}`;
    });
    const csv = [header, ...lines].join("\n") + "\n";
    triggerDownload(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `${filenameBase}.csv`,
    );
  };

  const exportPng = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(WIDTH));
    clone.setAttribute("height", String(HEIGHT));
    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob(
      ['<?xml version="1.0" standalone="no"?>\n', xml],
      { type: "image/svg+xml;charset=utf-8" },
    );
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH * scale;
      canvas.height = HEIGHT * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }
      ctx.fillStyle = "#000a14";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) triggerDownload(blob, `${filenameBase}.png`);
      }, "image/png");
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const exportBtnStyle: React.CSSProperties = {
    background: "rgba(0,229,255,0.08)",
    border: "1px solid rgba(0,229,255,0.35)",
    color: "#cbd5e1",
    cursor: "pointer",
    fontSize: 9,
    letterSpacing: "0.12em",
    padding: "3px 8px",
    borderRadius: 3,
    fontFamily: "inherit",
  };

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
        <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "#00e5ff", display: "flex", alignItems: "center" }}>
          ▼ DEPTH PROFILE
          <HelpIcon articleId="depth-profile" label="Depth profile" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            data-testid="depth-profile-export-csv"
            aria-label="Download depth profile as CSV"
            onClick={exportCsv}
            style={exportBtnStyle}
          >
            CSV
          </button>
          <button
            data-testid="depth-profile-export-png"
            aria-label="Download depth profile as PNG"
            onClick={exportPng}
            style={exportBtnStyle}
          >
            PNG
          </button>
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
      </div>

      {/* Stats row */}
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span>LEN <span style={{ color: "#e2e8f0" }}>{formatDistance(totalDistanceM, { units })}</span></span>
        <span>MIN <span style={{ color: "#e2e8f0" }}>{formatDepth(minDepthM, { units, decimals: 1 })}</span></span>
        <span>MAX <span style={{ color: "#e2e8f0" }}>{formatDepth(maxDepthM, { units, decimals: 1 })}</span></span>
        <span>Δ <span style={{ color: "#e2e8f0" }}>{formatDepth(maxDepthM - minDepthM, { units, decimals: 1 })}</span></span>
      </div>

      {/* Chart */}
      <svg
        ref={svgRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label="Depth cross-section"
        style={{ display: "block" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const localX = ((e.clientX - rect.left) * WIDTH) / rect.width;
          // Map cursor X to fractional distance, then to nearest sample idx.
          const t = Math.max(0, Math.min(1, (localX - PAD_LEFT) / PLOT_W));
          const idx = Math.max(
            0,
            Math.min(points.length - 1, Math.round(t * (points.length - 1))),
          );
          if (idx !== hoverIndex) setHoverIndex(idx);
        }}
        onMouseLeave={() => setHoverIndex(null)}
      >
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

        {/* Hover indicator — vertical guide + dot + tooltip */}
        {hoverIndex !== null && points[hoverIndex] ? (() => {
          const hp = points[hoverIndex]!;
          const hx = xOf(hp.distanceM);
          const hy = yOf(hp.depthM);
          const zoneName = hp.slot !== null ? (ZONE_LABEL[hp.slot] ?? "Zone") : "—";
          // Keep the tooltip inside the plot horizontally.
          const tipW = 132;
          const tipH = 46;
          let tipX = hx + 8;
          if (tipX + tipW > PAD_LEFT + PLOT_W) tipX = hx - tipW - 8;
          const tipY = Math.max(PAD_TOP + 2, hy - tipH - 6);
          return (
            <g pointerEvents="none" data-testid="depth-profile-hover">
              <line
                x1={hx}
                x2={hx}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_H}
                stroke="rgba(0,229,255,0.6)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <circle
                cx={hx}
                cy={hy}
                r={4}
                fill="#00e5ff"
                stroke="#001018"
                strokeWidth={1}
              />
              <g transform={`translate(${tipX.toFixed(1)},${tipY.toFixed(1)})`}>
                <rect
                  width={tipW}
                  height={tipH}
                  rx={3}
                  fill="rgba(0,15,25,0.96)"
                  stroke="rgba(0,229,255,0.45)"
                />
                <text x={6} y={13} fontSize={9} fill="#94a3b8" fontFamily="'JetBrains Mono', monospace">
                  D <tspan fill="#e2e8f0">{formatDistance(hp.distanceM, { units })}</tspan>
                </text>
                <text x={6} y={25} fontSize={9} fill="#94a3b8" fontFamily="'JetBrains Mono', monospace">
                  Z <tspan fill="#e2e8f0">{formatDepth(hp.depthM, { units, decimals: 1 })}</tspan>
                </text>
                <text x={6} y={37} fontSize={9} fill="#94a3b8" fontFamily="'JetBrains Mono', monospace">
                  ZN <tspan fill="#e2e8f0">{zoneName}</tspan>
                </text>
              </g>
            </g>
          );
        })() : null}

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
