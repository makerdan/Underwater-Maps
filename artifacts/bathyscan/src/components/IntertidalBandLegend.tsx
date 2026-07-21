/**
 * IntertidalBandLegend — compact floating key for the intertidal band shading
 * on the 3D terrain mesh.
 *
 * Renders two colour swatches (teal = lower intertidal MLLW→MHW, amber =
 * upper intertidal MHW→MHHW) with boundary elevations formatted in the
 * user's active units setting (metric → metres, imperial/nautical → feet).
 *
 * Renders nothing when neither MHW nor MHHW datum is resolved.
 */
import React from "react";
import { useIntertidal } from "@/lib/useIntertidal";
import { useSettingsStore } from "@/lib/settingsStore";

const FT_TO_M = 0.3048;
const M_TO_FM = 1 / 1.8288;

interface IntertidalBandLegendProps {
  /**
   * When true, renders without absolute positioning so the parent can place
   * it (e.g. inside an OverviewMap overlay). Defaults to false (floating).
   */
  embedded?: boolean;
}

function formatElevation(ft: number | null, units: string): string {
  if (ft === null) return "—";
  if (units === "metric") {
    const m = ft * FT_TO_M;
    return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
  }
  if (units === "nautical") {
    const fm = ft * FT_TO_M * M_TO_FM;
    return `${fm < 10 ? fm.toFixed(1) : Math.round(fm)} fm`;
  }
  return `${ft % 1 === 0 ? ft.toFixed(0) : ft.toFixed(1)} ft`;
}

export const IntertidalBandLegend: React.FC<IntertidalBandLegendProps> = ({
  embedded = false,
}) => {
  const { mhwFt, mhhwFt } = useIntertidal();
  const units = useSettingsStore((s) => s.units);

  if (mhwFt === null && mhhwFt === null) return null;

  const hasMhhw = mhhwFt !== null && mhhwFt !== mhwFt;

  const wrapperStyle: React.CSSProperties = embedded
    ? {
        pointerEvents: "auto",
        background: "rgba(2,8,18,0.88)",
        border: "1px solid rgba(0,229,255,0.22)",
        borderRadius: 4,
        padding: "6px 8px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#e2e8f0",
        backdropFilter: "blur(6px)",
        minWidth: 148,
      }
    : {
        position: "absolute",
        left: 16,
        bottom: 56,
        zIndex: 25,
        pointerEvents: "auto",
        background: "rgba(2,8,18,0.88)",
        border: "1px solid rgba(0,229,255,0.22)",
        borderRadius: 4,
        padding: "6px 8px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#e2e8f0",
        backdropFilter: "blur(6px)",
        minWidth: 148,
      };

  const headerStyle: React.CSSProperties = {
    fontSize: "calc(9px * var(--bs-font-scale, 1))",
    color: "#00e5ff",
    letterSpacing: "0.18em",
    marginBottom: 5,
    textShadow: "0 0 6px rgba(0,229,255,0.35)",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
    fontSize: "calc(10px * var(--bs-font-scale, 1))",
    letterSpacing: "0.05em",
  };

  const swatchStyle = (color: string): React.CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: 2,
    flexShrink: 0,
    background: color,
    border: "1px solid rgba(255,255,255,0.18)",
  });

  const labelStyle: React.CSSProperties = {
    color: "#94a3b8",
    flex: 1,
  };

  const valueStyle: React.CSSProperties = {
    color: "#e2e8f0",
    textAlign: "right",
    whiteSpace: "nowrap",
  };

  return (
    <div
      data-testid="intertidal-band-legend"
      role="img"
      aria-label="Intertidal band elevation key"
      style={wrapperStyle}
    >
      <div style={headerStyle}>◈ INTERTIDAL</div>

      {hasMhhw && (
        <div style={rowStyle}>
          <div style={swatchStyle("rgba(224,165,51,0.72)")} />
          <span style={labelStyle}>MHW → MHHW</span>
          <span style={valueStyle}>{formatElevation(mhhwFt, units)}</span>
        </div>
      )}

      <div style={rowStyle}>
        <div style={swatchStyle("rgba(46,200,158,0.72)")} />
        <span style={labelStyle}>MLLW → MHW</span>
        <span style={valueStyle}>{formatElevation(mhwFt, units)}</span>
      </div>

      <div style={{ ...rowStyle, marginBottom: 0 }}>
        <div style={{ width: 10, height: 10, flexShrink: 0 }} />
        <span style={{ ...labelStyle, fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "#475569" }}>
          above MLLW
        </span>
      </div>
    </div>
  );
};
