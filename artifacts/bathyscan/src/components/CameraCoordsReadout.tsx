import React from "react";
import { useCameraStore } from "@/lib/cameraStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { formatDepth } from "@/lib/units";

const COORDS_TOOLTIP =
  "Longitude and latitude of your viewpoint in the 3D scene — where you're looking from, not where your cursor is.";

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 8px rgba(0,229,255,0.6)",
};

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.3)",
  borderRadius: 6,
  backdropFilter: "blur(6px)",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: "calc(18px * var(--bs-font-scale, 1))",
  color: "#e2e8f0",
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
  const cameraPosition = useCameraStore((s) => s.cameraPosition);
  // Stale-value transition guard: subscribe to cameraDepth directly so the
  // readout re-renders in the same commit that `setCameraGeo` publishes a
  // null depth. Deriving the SURFACE/number branch purely from this store
  // snapshot (no local state, no memoized formatted string) guarantees a
  // stale numeric depth can never flash after the camera surfaces —
  // `setCameraGeo` updates position and depth atomically in one set().
  const cameraDepth = useCameraStore((s) => s.cameraDepth);
  const coordinateFormat = useSettingsStore((s) => s.coordinateFormat);
  const showCameraPosition = useSettingsStore((s) => s.showCameraPosition);
  const units = useSettingsStore((s) => s.units);
  const hudOpacity = useSettingsStore((s) => s.hudOpacity);
  const collapsed = usePanelCollapseStore((s) => s.collapsed.cameraCoords);
  const togglePanel = usePanelCollapseStore((s) => s.toggle);

  if (!showCameraPosition) return null;

  const fmtCoord = (n: number): string =>
    coordinateFormat === "dms" ? toDMS(n) : fmt(n, 4);

  const lonStr = cameraPosition.known ? fmtCoord(cameraPosition.lon) : "—";
  const latStr = cameraPosition.known ? fmtCoord(cameraPosition.lat) : "—";

  return (
    <div style={{ ...PANEL, opacity: hudOpacity, userSelect: "none" }}>
      <ViewscreenTooltip label={COORDS_TOOLTIP} side="right">
        <button
          type="button"
          onClick={() => togglePanel("cameraCoords")}
          aria-expanded={!collapsed}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors rounded-t"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            color: "#cbd5e1",
            fontFamily: "inherit",
            fontSize: "calc(15px * var(--bs-font-scale, 1))",
            letterSpacing: "0.2em",
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          <span>YOUR CURRENT COORDINATES</span>
          <span style={{ color: "#cbd5e1", fontSize: "calc(36px * var(--bs-font-scale, 1))", lineHeight: 1 }}>{collapsed ? "▸" : "▾"}</span>
        </button>
      </ViewscreenTooltip>
      {!collapsed && (
        <div style={{ padding: "4px 12px 8px" }}>
          <div>
            <span style={{ color: "#cbd5e1" }}>LON </span>
            <span style={CYAN}>{lonStr}</span>
          </div>
          <div>
            <span style={{ color: "#cbd5e1" }}>LAT </span>
            <span style={CYAN}>{latStr}</span>
          </div>
          <div>
            <span style={{ color: "#cbd5e1" }}>DEP </span>
            {cameraDepth === null ? (
              <span
                data-testid="camera-depth-surface"
                style={CYAN}
              >
                SURFACE
              </span>
            ) : (
              <span style={CYAN}>
                {formatDepth(cameraDepth, { units }).toUpperCase()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
