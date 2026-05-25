/**
 * ConditionsLegend — HUD-corner panel summarising every active overlay.
 *
 * Lists Wind / Tide / Current with colour swatch, current sampled value,
 * cardinal heading, and timestamp of the data. Shows an "Estimated" badge
 * when Open-Meteo data is unavailable and exposes manual sliders that share
 * the Drift Planner's fallback values via `useDriftStore`.
 */
import React from "react";
import { useUiStore } from "@/lib/uiStore";
import { useDriftStore } from "@/lib/driftStore";
import { useSurfaceConditions } from "@/hooks/useSurfaceConditions";
import { windColor } from "@/components/ConditionsOverlays";

const PANEL: React.CSSProperties = {
  background: "rgba(0,10,20,0.88)",
  border: "1px solid rgba(0,229,255,0.2)",
  borderRadius: 4,
  padding: "8px 10px",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 10,
  color: "#94a3b8",
  letterSpacing: "0.05em",
  minWidth: 210,
  maxWidth: 240,
  backdropFilter: "blur(6px)",
  pointerEvents: "auto",
  userSelect: "none",
};

const LABEL: React.CSSProperties = {
  color: "#475569",
  fontSize: 8,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
};

function cardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]!;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

interface RowProps {
  swatch: string;
  label: string;
  value: string;
  detail?: string;
}

const Row: React.FC<RowProps> = ({ swatch, label, value, detail }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
    <span
      style={{
        width: 10, height: 10, borderRadius: 2,
        background: swatch, flexShrink: 0,
        boxShadow: `0 0 4px ${swatch}`,
      }}
    />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={LABEL}>{label}</div>
      <div style={{ color: "#e2e8f0", fontSize: 10 }}>
        {value}
        {detail && (
          <span style={{ color: "#64748b", marginLeft: 4 }}>{detail}</span>
        )}
      </div>
    </div>
  </div>
);

export const ConditionsLegend: React.FC = () => {
  const wind = useUiStore((s) => s.windOverlayActive);
  const tide = useUiStore((s) => s.tideOverlayActive);
  const cur = useUiStore((s) => s.currentOverlayActive);

  const anyActive = wind || tide || cur;
  const { snapshot, estimated, timestamp, fallback } = useSurfaceConditions(anyActive);

  const {
    manualWindSpeedKnots, setManualWindSpeedKnots,
    manualWindDegrees, setManualWindDegrees,
    manualTidalSpeedKnots, setManualTidalSpeedKnots,
    manualTidalDegrees, setManualTidalDegrees,
  } = useDriftStore();

  if (!anyActive) return null;

  const windSpd = snapshot?.windSpeedKnots ?? fallback.windSpeedKnots;
  const windFrom = snapshot?.windDegrees ?? fallback.windDegrees;
  const windToward = (windFrom + 180) % 360;
  const tidSpd = snapshot?.tidalSpeedKnots ?? fallback.tidalSpeedKnots;
  const tidDeg = snapshot?.tidalDegrees ?? fallback.tidalDegrees;
  const rising = snapshot?.tideRising ?? true;

  const sliderStyle: React.CSSProperties = {
    width: "100%", accentColor: "#00e5ff", cursor: "pointer", height: 4,
  };

  return (
    <div style={PANEL} data-testid="conditions-legend">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: "#00e5ff", fontSize: 10, letterSpacing: "0.18em", textShadow: "0 0 6px rgba(0,229,255,0.5)" }}>
          ◉ CONDITIONS
        </span>
        {estimated && (
          <span
            style={{
              fontSize: 8, letterSpacing: "0.15em",
              background: "rgba(251,191,36,0.12)",
              border: "1px solid rgba(251,191,36,0.4)",
              color: "#fbbf24",
              borderRadius: 2, padding: "0 4px",
            }}
          >
            ESTIMATED
          </span>
        )}
      </div>

      {wind && (
        <Row
          swatch={windColor(windSpd)}
          label="Wind"
          value={`${windSpd.toFixed(1)} kn ${cardinal(windToward)}`}
          detail={`from ${cardinal(windFrom)}`}
        />
      )}
      {tide && (
        <Row
          swatch={rising ? "#34d399" : "#fbbf24"}
          label="Tide"
          value={`${rising ? "Rising" : "Falling"} ${tidSpd.toFixed(2)} kn ${cardinal(tidDeg)}`}
          detail={`${rising ? "flood" : "ebb"}`}
        />
      )}
      {cur && (
        <Row
          swatch="#22d3ee"
          label="Current"
          value={`${tidSpd.toFixed(2)} kn ${cardinal(tidDeg)}`}
          detail={`${Math.round(tidDeg)}°`}
        />
      )}

      <div style={{ marginTop: 6, paddingTop: 4, borderTop: "1px solid rgba(0,229,255,0.1)" }}>
        <div style={{ ...LABEL, marginBottom: 2 }}>Sampled · {fmtTime(timestamp)}</div>
      </div>

      {estimated && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(251,191,36,0.18)" }}>
          <div style={{ ...LABEL, color: "#fbbf24", marginBottom: 4 }}>Manual Override</div>
          {wind && (
            <div style={{ marginBottom: 4 }}>
              <div style={LABEL}>Wind {manualWindSpeedKnots} kn @ {manualWindDegrees}°</div>
              <input type="range" min={0} max={40}
                value={manualWindSpeedKnots}
                onChange={(e) => setManualWindSpeedKnots(Number(e.target.value))}
                style={sliderStyle} />
              <input type="range" min={0} max={359}
                value={manualWindDegrees}
                onChange={(e) => setManualWindDegrees(Number(e.target.value))}
                style={sliderStyle} />
            </div>
          )}
          {(tide || cur) && (
            <div>
              <div style={LABEL}>Tidal {manualTidalSpeedKnots} kn @ {manualTidalDegrees}°</div>
              <input type="range" min={0} max={6} step={0.1}
                value={manualTidalSpeedKnots}
                onChange={(e) => setManualTidalSpeedKnots(Number(e.target.value))}
                style={sliderStyle} />
              <input type="range" min={0} max={359}
                value={manualTidalDegrees}
                onChange={(e) => setManualTidalDegrees(Number(e.target.value))}
                style={sliderStyle} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
