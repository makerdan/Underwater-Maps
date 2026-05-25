import React from "react";
import { SPEEDS, useAppState } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";
import { useGpsStore } from "@/lib/gpsStore";
import { useUiStore } from "@/lib/uiStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useOfflineStore } from "@/lib/offlineStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import { mphToKnots } from "@/lib/boatSpeed";
import { formatDepth, formatSpeed } from "@/lib/units";
import { HelpIcon } from "@/components/help/HelpButton";

const EFH_DATASETS = new Set(["thorne-bay"]);

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 8px rgba(0,229,255,0.6)",
};

const PANEL: React.CSSProperties = {
  background: "rgba(0,10,20,0.75)",
  border: "1px solid rgba(0,229,255,0.15)",
  borderRadius: 4,
  padding: "6px 10px",
  backdropFilter: "blur(4px)",
};

function fmt(n: number | null, decimals = 4): string {
  if (n === null) return "—";
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

function SpeedDots({ index, total }: { index: number; total: number }) {
  return (
    <span>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={i <= index ? CYAN : { color: "#1e3a5f" }}>
          {i <= index ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

export const HUD: React.FC = () => {
  const crosshairGps = useCameraStore((s) => s.crosshairGps);
  const lastClickedGps = useCameraStore((s) => s.lastClickedGps);
  const cameraDepth = useCameraStore((s) => s.cameraDepth);
  const heading = useCameraStore((s) => s.heading);
  const mode = useCameraStore((s) => s.mode);
  const speedIndex = useCameraStore((s) => s.speedIndex);
  const { realisticMode, boatSpeedMph } = useAppState();

  const gpsActive = useGpsStore((s) => s.active);
  const gpsPosition = useGpsStore((s) => s.position);
  const overviewGrid = useTerrainStore((s) => s.overviewGrid);
  const isOnline = useOfflineStore((s) => s.isOnline);

  const showCrosshairGps = useSettingsStore((s) => s.showCrosshairGps);
  const showCameraPosition = useSettingsStore((s) => s.showCameraPosition);
  const showSpeedIndicator = useSettingsStore((s) => s.showSpeedIndicator);
  const showHeading = useSettingsStore((s) => s.showHeading);
  const coordinateFormat = useSettingsStore((s) => s.coordinateFormat);
  const units = useSettingsStore((s) => s.units);
  const hudOpacity = useSettingsStore((s) => s.hudOpacity);

  const substrateColorMode = useUiStore((s) => s.substrateColorMode);
  const setSubstrateColorMode = useUiStore((s) => s.setSubstrateColorMode);
  const efhOverlayEnabled = useUiStore((s) => s.efhOverlayEnabled);
  const setEfhOverlayEnabled = useUiStore((s) => s.setEfhOverlayEnabled);
  const { terrain } = useAppState();
  const hasEfh = EFH_DATASETS.has(terrain?.datasetId ?? "");

  const speed = SPEEDS[speedIndex] ?? 0.15;
  const isFly = mode === "fly";

  const fmtCoord = (n: number | null): string => {
    if (n === null) return "—";
    return coordinateFormat === "dms" ? toDMS(n) : fmt(n, 4);
  };

  const fmtDepth = (metres: number | null): string => {
    if (metres === null) return "—";
    return formatDepth(metres, { units }).toUpperCase();
  };

  const gpsInBounds = gpsActive && gpsPosition && overviewGrid &&
    gpsPosition.latitude >= overviewGrid.minLat &&
    gpsPosition.latitude <= overviewGrid.maxLat &&
    gpsPosition.longitude >= overviewGrid.minLon &&
    gpsPosition.longitude <= overviewGrid.maxLon;

  const handleDiveToGps = () => {
    if (!gpsPosition || !overviewGrid) return;
    const { x: worldX, z: worldZ } = lonLatToWorldXZ(
      gpsPosition.longitude,
      gpsPosition.latitude,
      overviewGrid,
    );
    useUiStore.getState().setPendingDropIn({ worldX, worldZ });
  };

  const HUD_STYLE: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    color: "#94a3b8",
    letterSpacing: "0.08em",
    pointerEvents: "none",
    opacity: hudOpacity,
  };

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ ...HUD_STYLE, fontSize: 11, userSelect: "none" }}
    >
      {/* ── Offline indicator ── */}
      {!isOnline && (
        <div
          data-testid="offline-badge"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(239,68,68,0.15)",
            border: "1px solid rgba(239,68,68,0.5)",
            borderRadius: 4,
            padding: "3px 9px",
            fontSize: 9,
            letterSpacing: "0.2em",
            color: "#f87171",
            fontWeight: 700,
            textShadow: "0 0 6px rgba(239,68,68,0.5)",
          }}
        >
          ● OFFLINE
        </div>
      )}

      {/* ── Cached data badge (online but using stale data) ── */}
      {!isOnline && (
        <div
          style={{
            position: "absolute",
            top: 32,
            right: 8,
            fontSize: 8,
            letterSpacing: "0.12em",
            color: "#64748b",
          }}
        >
          ⚡ cached data
        </div>
      )}

      {/* ── Top-left: mode + heading ── */}
      <div className="hud-top-left absolute top-3 left-3 flex items-center gap-2">
        <div
          style={{
            ...PANEL,
            ...CYAN,
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.2em",
            padding: "4px 10px",
            border: `1px solid ${isFly ? "rgba(0,229,255,0.4)" : "rgba(100,116,139,0.4)"}`,
            background: isFly ? "rgba(0,229,255,0.08)" : "rgba(0,10,20,0.75)",
            color: isFly ? "#00e5ff" : "#64748b",
            textShadow: isFly ? "0 0 8px rgba(0,229,255,0.6)" : "none",
          }}
        >
          {isFly ? "● FLY" : "◎ ORBIT"}
        </div>
        {showHeading && (
          <div style={{ ...PANEL, fontSize: 11 }}>
            <span style={{ color: "#475569" }}>HDG </span>
            <span style={CYAN}>{Math.round(heading).toString().padStart(3, "0")}°</span>
          </div>
        )}
        <div style={{ pointerEvents: "auto" }}>
          <HelpIcon articleId="interface-tour" label="Help: HUD overlay" />
        </div>

        {/* GPS dive button in HUD */}
        {gpsInBounds && (
          <button
            onClick={handleDiveToGps}
            style={{
              ...PANEL,
              pointerEvents: "auto",
              background: "rgba(59,130,246,0.12)",
              border: "1px solid rgba(59,130,246,0.4)",
              color: "#60a5fa",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              padding: "4px 10px",
              borderRadius: 4,
              cursor: "pointer",
              letterSpacing: "0.1em",
            }}
          >
            📍 DIVE TO GPS
          </button>
        )}
      </div>

      {/* ── Centre: crosshair + GPS ── */}
      {showCrosshairGps && (
        <div
          className="absolute"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          {/* Reticle */}
          <div style={{ position: "relative", width: 40, height: 40 }}>
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: 0,
                right: 0,
                height: 1,
                background: "rgba(0,229,255,0.5)",
                transform: "translateY(-50%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                bottom: 0,
                width: 1,
                background: "rgba(0,229,255,0.5)",
                transform: "translateX(-50%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: "1px solid rgba(0,229,255,0.25)",
                borderRadius: "50%",
              }}
            />
          </div>

          {/* Crosshair GPS */}
          <div style={{ ...PANEL, textAlign: "center", minWidth: 160 }}>
            <div style={{ color: "#475569", fontSize: 9, letterSpacing: "0.2em", marginBottom: 2 }}>
              CROSSHAIR TARGET
            </div>
            {crosshairGps ? (
              <>
                <div>
                  <span style={{ color: "#475569" }}>LON </span>
                  <span style={CYAN}>{fmtCoord(crosshairGps.lon)}</span>
                  <span style={{ color: "#475569" }}> LAT </span>
                  <span style={CYAN}>{fmtCoord(crosshairGps.lat)}</span>
                </div>
                <div style={{ marginTop: 2 }}>
                  <span style={{ color: "#475569" }}>▼ </span>
                  <span style={{ ...CYAN, fontSize: 13, fontWeight: 700 }}>
                    {fmtDepth(crosshairGps.depth)}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ color: "#1e3a5f" }}>— NO TERRAIN —</div>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom-right: Find Data button + substrate + EFH overlay toggles ── */}
      {terrain && (
        <div
          className="absolute bottom-3 right-3 flex flex-col gap-1 items-end"
          style={{ pointerEvents: "auto" }}
        >
          {/* Find Data panel toggle */}
          <button
            onClick={() => {
              const { findDataPanelOpen, setFindDataPanelOpen } = useUiStore.getState();
              setFindDataPanelOpen(!findDataPanelOpen);
            }}
            style={{
              background: "rgba(0,10,20,0.75)",
              border: "1px solid rgba(0,229,255,0.2)",
              borderRadius: 4,
              color: "#00e5ff",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              padding: "3px 10px",
              cursor: "pointer",
              letterSpacing: "0.1em",
              backdropFilter: "blur(4px)",
              textShadow: "0 0 6px rgba(0,229,255,0.4)",
            }}
          >
            🔍 FIND DATA
          </button>
          {/* Substrate colour toggle */}
          <button
            aria-pressed={substrateColorMode}
            onClick={() => setSubstrateColorMode(!substrateColorMode)}
            style={{
              background: substrateColorMode ? "rgba(226,213,160,0.15)" : "rgba(0,10,20,0.75)",
              border: `1px solid ${substrateColorMode ? "rgba(226,213,160,0.5)" : "rgba(0,229,255,0.15)"}`,
              borderRadius: 4,
              color: substrateColorMode ? "#e2d5a0" : "#475569",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              padding: "3px 10px",
              cursor: "pointer",
              letterSpacing: "0.1em",
              backdropFilter: "blur(4px)",
            }}
          >
            ◼ SUBSTRATE
          </button>

          {/* EFH zone toggle — only for datasets with bundled EFH data */}
          {hasEfh && (
            <button
              aria-pressed={efhOverlayEnabled}
              onClick={() => setEfhOverlayEnabled(!efhOverlayEnabled)}
              style={{
                background: efhOverlayEnabled ? "rgba(34,197,94,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${efhOverlayEnabled ? "rgba(34,197,94,0.5)" : "rgba(0,229,255,0.15)"}`,
                borderRadius: 4,
                color: efhOverlayEnabled ? "#4ade80" : "#475569",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                padding: "3px 10px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                backdropFilter: "blur(4px)",
              }}
            >
              🐟 EFH ZONES
            </button>
          )}
        </div>
      )}

      {/* ── Bottom-left: camera position + speed ── */}
      <div className="absolute bottom-3 left-3 space-y-1">
        {showCameraPosition && (
          <div style={{ ...PANEL, minWidth: 200 }}>
            <div style={{ color: "#475569", fontSize: 9, letterSpacing: "0.2em", marginBottom: 3 }}>
              CAMERA POSITION
            </div>
            <div>
              <span style={{ color: "#475569" }}>DEPTH </span>
              <span style={CYAN}>{fmtDepth(cameraDepth)}</span>
            </div>
          </div>
        )}

        {showSpeedIndicator && (
          <div style={{ ...PANEL, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#475569" }}>SPD </span>
            {realisticMode ? (
              <>
                <span style={CYAN}>{formatSpeed(boatSpeedMph, { units }).toUpperCase()}</span>
                <span style={{ color: "#475569" }}>/</span>
                <span style={{ color: "#7dd3fc" }}>{mphToKnots(boatSpeedMph).toFixed(1)} KT</span>
                <span
                  style={{
                    fontSize: 8,
                    letterSpacing: "0.15em",
                    color: "#22d3ee",
                    background: "rgba(0,229,255,0.08)",
                    border: "1px solid rgba(0,229,255,0.25)",
                    borderRadius: 2,
                    padding: "1px 4px",
                    marginLeft: 2,
                  }}
                >
                  REAL
                </span>
              </>
            ) : (
              <>
                <SpeedDots index={speedIndex} total={SPEEDS.length} />
                <span style={{ color: "#475569", marginLeft: 4 }}>{speed.toFixed(2)} u/s</span>
              </>
            )}
          </div>
        )}

        {lastClickedGps && (
          <div style={{ ...PANEL, fontSize: 10 }}>
            <span style={{ color: "#475569" }}>PIN </span>
            <span style={{ color: "#22d3ee" }}>
              {fmtCoord(lastClickedGps.lon)}, {fmtCoord(lastClickedGps.lat)}
            </span>
            <span style={{ color: "#475569" }}> ▼ {fmtDepth(lastClickedGps.depth)}</span>
          </div>
        )}
      </div>
    </div>
  );
};
