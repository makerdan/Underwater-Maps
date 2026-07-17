/**
 * IntertidalHotspotCard — Score-card popup for a clicked intertidal hotspot.
 *
 * Shows the tidepool score (teal) and beachcombing score (amber) side-by-side
 * as circular badge dials. The active intertidalScoreMode determines which dial
 * is visually emphasized and which signals / whySummary are shown below.
 *
 * Mounted unconditionally in App.tsx — renders nothing when selectedHotspot
 * is null. Positioned bottom-center overlapping the HUD stack, z-60.
 */
import React from "react";
import { useUiStore } from "@/lib/uiStore";

const CARD: React.CSSProperties = {
  position: "fixed",
  bottom: 96,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 60,
  minWidth: 310,
  maxWidth: 420,
  background: "rgba(2,8,18,0.96)",
  border: "1px solid rgba(0,229,255,0.28)",
  borderRadius: 8,
  fontFamily: "'JetBrains Mono','Fira Code',monospace",
  color: "#cbd5e1",
  fontSize: 18,
  padding: "14px 16px 12px",
  backdropFilter: "blur(8px)",
  boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
  pointerEvents: "auto",
};

const SCORE_DIAL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
};

interface ScoreCircleProps {
  score: number;
  color: string;
  label: string;
  active: boolean;
}

const ScoreCircle: React.FC<ScoreCircleProps> = ({ score, color, label, active }) => {
  const radius = 22;
  const stroke = 4;
  const norm = radius - stroke / 2;
  const circ = 2 * Math.PI * norm;
  const dash = (score / 100) * circ;
  return (
    <div
      style={{
        ...SCORE_DIAL,
        opacity: active ? 1 : 0.35,
        transition: "opacity 0.2s ease",
      }}
    >
      <svg width={52} height={52} viewBox="0 0 52 52">
        <circle cx={26} cy={26} r={norm} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={26} cy={26} r={norm}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 26 26)"
          style={{ filter: active ? `drop-shadow(0 0 4px ${color}88)` : "none" }}
        />
        <text x={26} y={31} textAnchor="middle" fill={color} fontSize={14} fontFamily="inherit" fontWeight="bold">
          {score}
        </text>
      </svg>
      <span style={{ fontSize: 13.5, letterSpacing: "0.1em", color: color, textTransform: "uppercase" }}>
        {label}
      </span>
      {active && (
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>
          ▲ active
        </span>
      )}
    </div>
  );
};

interface SignalChipProps {
  text: string;
  dim?: boolean;
}
const SignalChip: React.FC<SignalChipProps> = ({ text, dim }) => (
  <span
    style={{
      display: "inline-block",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 3,
      padding: "1px 7px",
      fontSize: 15,
      color: dim ? "#64748b" : "#94a3b8",
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </span>
);

export const IntertidalHotspotCard: React.FC = () => {
  const selectedHotspot = useUiStore((s) => s.selectedHotspot);
  const setSelectedHotspot = useUiStore((s) => s.setSelectedHotspot);
  const intertidalScoreMode = useUiStore((s) => s.intertidalScoreMode);

  if (!selectedHotspot) return null;

  const { tidepoolScore, beachcombingScore, signals, shoreZoneClass, sourceName } = selectedHotspot;

  const sig = signals[intertidalScoreMode];
  const chips = [
    sig.bioband,
    sig.debris,
    sig.energy,
    sig.humanUse,
  ].filter(Boolean) as string[];

  const modeColor = intertidalScoreMode === "tidepool" ? "#0d9488" : "#d97706";
  const modeBorderColor = intertidalScoreMode === "tidepool"
    ? "rgba(13,148,136,0.3)"
    : "rgba(217,119,6,0.3)";

  return (
    <div style={CARD} data-testid="intertidal-hotspot-card">
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13.5, letterSpacing: "0.14em", color: "#00e5ff", textTransform: "uppercase", marginBottom: 2 }}>
            Intertidal Hotspot
          </div>
          <div style={{ fontSize: 16.5, color: "#e2e8f0", fontWeight: "bold", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {shoreZoneClass}
          </div>
          <div style={{ fontSize: 15, color: "#64748b", marginTop: 1 }}>{sourceName}</div>
        </div>
        <button
          aria-label="Close hotspot card"
          onClick={() => setSelectedHotspot(null)}
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: 24,
            padding: "0 0 0 8px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Score dials — active mode is emphasized */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, marginBottom: 10 }}>
        <ScoreCircle
          score={tidepoolScore}
          color="#0d9488"
          label="Tidepool"
          active={intertidalScoreMode === "tidepool"}
        />
        <ScoreCircle
          score={beachcombingScore}
          color="#d97706"
          label="Beachcombing"
          active={intertidalScoreMode === "beachcombing"}
        />
      </div>

      {/* Why this spot? — driven by active mode */}
      <div
        style={{
          background: `rgba(${intertidalScoreMode === "tidepool" ? "13,148,136" : "217,119,6"},0.06)`,
          border: `1px solid ${modeBorderColor}`,
          borderRadius: 4,
          padding: "6px 9px",
          fontSize: 16.5,
          color: "#94a3b8",
          marginBottom: 8,
          lineHeight: 1.5,
        }}
      >
        {sig.whySummary || (
          <span style={{ color: "#475569", fontStyle: "italic" }}>No summary available.</span>
        )}
      </div>

      {/* Signal chips for the active mode */}
      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {chips.map((c) => <SignalChip key={c} text={c} />)}
        </div>
      )}

      {/* Substrate label */}
      <div style={{ fontSize: 15, color: "#475569", marginTop: 2 }}>
        Substrate: {sig.substrate}
      </div>

      {/* Active mode label */}
      <div style={{ fontSize: 13.5, color: modeColor, marginTop: 6, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        ● {intertidalScoreMode === "tidepool" ? "Tidepool" : "Beachcombing"} mode active
      </div>
    </div>
  );
};
