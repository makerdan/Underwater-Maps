import React from "react";
import { useCameraStore } from "@/lib/cameraStore";
import { useSettingsStore } from "@/lib/settingsStore";

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 8px rgba(0,229,255,0.6)",
};

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.3)",
  borderRadius: 6,
  padding: "8px 12px",
  backdropFilter: "blur(6px)",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 12,
  color: "#cbd5e1",
  letterSpacing: "0.08em",
  minWidth: 220,
  maxWidth: 260,
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
};

function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

function toDMS(decimal: number): string {
  const abs = Math.abs(decimal);
  const d = Math.floor(abs);
  const mFull = (abs - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60);
  const sign = decimal < 0 ? "-" : "";
  return `${sign}${d}°${m}'${s}"`;
}

export const CameraCoordsReadout: React.FC = () => {
  const cameraLon = useCameraStore((s) => s.cameraLon);
  const cameraLat = useCameraStore((s) => s.cameraLat);
  const coordinateFormat = useSettingsStore((s) => s.coordinateFormat);
  const showCameraPosition = useSettingsStore((s) => s.showCameraPosition);
  const hudOpacity = useSettingsStore((s) => s.hudOpacity);

  if (!showCameraPosition) return null;

  const fmtCoord = (n: number | null): string => {
    if (n === null) return "—";
    return coordinateFormat === "dms" ? toDMS(n) : fmt(n, 4);
  };

  return (
    <div style={{ ...PANEL, opacity: hudOpacity, userSelect: "none" }}>
      <div
        style={{
          color: "#94a3b8",
          fontSize: 10,
          letterSpacing: "0.2em",
          marginBottom: 4,
          fontWeight: 600,
        }}
      >
        CAMERA POSITION
      </div>
      <div>
        <span style={{ color: "#94a3b8" }}>LON </span>
        <span style={CYAN}>{fmtCoord(cameraLon)}</span>
      </div>
      <div>
        <span style={{ color: "#94a3b8" }}>LAT </span>
        <span style={CYAN}>{fmtCoord(cameraLat)}</span>
      </div>
    </div>
  );
};
