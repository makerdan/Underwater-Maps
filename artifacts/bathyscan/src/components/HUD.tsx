import React from "react";
import { useAppState } from "@/lib/context";
import { useCameraStore } from "@/lib/cameraStore";
import { useGpsStore } from "@/lib/gpsStore";
import { useUiStore } from "@/lib/uiStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useOfflineStore } from "@/lib/offlineStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { getBoundKey } from "@/lib/keyBindings";
import { formatKeyCode } from "@/lib/keyLabel";
import { useDriftStore } from "@/lib/driftStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import { formatDepth, formatTemperature } from "@/lib/units";
import {
  estimateWaterTemperature,
  resolveTemperatureProfile,
} from "@/lib/waterTemp";
import { useSurfaceTemperature } from "@/hooks/useSurfaceTemperature";
import { useTemperatureProfile } from "@/hooks/useTemperatureProfile";
import { HelpIcon } from "@/components/help/HelpButton";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { TemperatureProfileChart } from "@/components/TemperatureProfileChart";
import { openCrosshairContextMenu } from "@/lib/terrainContextMenu";

const IS_TOUCH_DEVICE =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || (navigator?.maxTouchPoints ?? 0) > 0);


// NOTE: legacy module-scope panel style. The component below derives
// accessibility-aware overrides (`CYAN`, `PANEL`) from settings and uses
// those locally instead of this base.
const PANEL_BASE: React.CSSProperties = {
  background: "rgba(0,10,20,0.75)",
  border: "1px solid rgba(0,229,255,0.15)",
  borderRadius: 4,
  padding: "6px 10px",
  backdropFilter: "blur(4px)",
};

const CrosshairKeyHint: React.FC = () => {
  const code = useSettingsStore((s) => getBoundKey(s.keyBindings, "crosshairMenu"));
  const label = formatKeyCode(code).toUpperCase();
  return (
    <span
      data-testid="hud-crosshair-q-hint"
      style={{
        background: "rgba(0,229,255,0.08)",
        border: "1px solid rgba(0,229,255,0.25)",
        borderRadius: 3,
        color: "#00e5ff",
        padding: "0 4px",
        fontSize: 8,
      }}
      title={`Press ${label} to open the action menu at the crosshair`}
    >
      {label} · ACTIONS
    </span>
  );
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

export const HUD: React.FC = () => {
  const [tempProfileOpen, setTempProfileOpen] = React.useState(false);
  const crosshairGps = useCameraStore((s) => s.crosshairGps);
  const lastClickedGps = useCameraStore((s) => s.lastClickedGps);
  const cameraDepth = useCameraStore((s) => s.cameraDepth);
  const heading = useCameraStore((s) => s.heading);

  const gpsActive = useGpsStore((s) => s.active);
  const gpsPosition = useGpsStore((s) => s.position);
  const overviewGrid = useTerrainStore((s) => s.overviewGrid);
  const isOnline = useOfflineStore((s) => s.isOnline);

  const showCrosshairGps = useSettingsStore((s) => s.showCrosshairGps);
  const showHeading = useSettingsStore((s) => s.showHeading);
  const coordinateFormat = useSettingsStore((s) => s.coordinateFormat);
  const units = useSettingsStore((s) => s.units);
  // Subscribe so the TEMP chip / profile chart re-render when the user
  // flips the per-temperature override without touching the global units.
  useSettingsStore((s) => s.temperatureUnit);
  const hudOpacity = useSettingsStore((s) => s.hudOpacity);
  const largeHudText = useSettingsStore((s) => s.largeHudText);
  const highContrastHud = useSettingsStore((s) => s.highContrastHud);
  const colorBlindSafePalette = useSettingsStore((s) => s.colorBlindSafePalette);
  const smoothTerrainSpikes = useSettingsStore((s) => s.smoothTerrainSpikes);

  // Resolve accent + base text colours from the accessibility prefs. The
  // colour-blind safe palette swaps cyan for a deuteranopia-safe amber-yellow
  // that remains distinguishable against the dark HUD background. High-contrast
  // mode brightens secondary text and adds a darker text-shadow for legibility.
  const accent = colorBlindSafePalette ? "#fbbf24" : "#00e5ff";
  const accentGlow = colorBlindSafePalette
    ? "0 0 8px rgba(251,191,36,0.65)"
    : "0 0 8px rgba(0,229,255,0.6)";
  const baseText = highContrastHud ? "#ffffff" : "#94a3b8";
  const fontScale = largeHudText ? 1.35 : 1;

  const driftPlannerActive = useDriftStore((s) => s.driftPlannerActive);
  const driftMode = useDriftStore((s) => s.driftMode);
  const boatHeadingDeg = useDriftStore((s) => s.boatHeadingDeg);
  const boatSpeedKnots = useDriftStore((s) => s.boatSpeedKnots);
  const driftWaypoints = useDriftStore((s) => s.driftWaypoints);
  const driftPath = useDriftStore((s) => s.driftPath);
  const driftHour = useDriftStore((s) => s.driftHour);

  // The substrate detail card lives in <SubstrateDetailPanel /> at the App
  // root so it sits above both the HUD and the OverviewMap (z-40).
  const { terrain } = useAppState();

  // Live sea-surface temperature for the dataset centre — used as the
  // surface anchor of the thermocline model below.
  const hudCenterLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : null;
  const hudCenterLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : null;
  const { anchor: sstAnchor } = useSurfaceTemperature(
    hudCenterLat,
    hudCenterLon,
    !!terrain,
  );
  // Real per-location depth profile (bundled CTD / Argo / reanalysis). When
  // available we plot the measured samples; otherwise we fall back to the
  // surface-anchored thermocline model via `resolveTemperatureProfile`.
  const { profile: realProfile } = useTemperatureProfile(
    hudCenterLat,
    hudCenterLon,
    !!terrain,
    terrain?.datasetId ?? null,
  );

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

  // Accessibility-aware local overrides for the module-scope CYAN_BASE /
  // PANEL_BASE constants — these are what the JSX below actually consumes.
  const CYAN: React.CSSProperties = {
    color: accent,
    textShadow: accentGlow,
  };
  const PANEL: React.CSSProperties = {
    ...PANEL_BASE,
    border: `1px solid ${colorBlindSafePalette ? "rgba(251,191,36,0.25)" : "rgba(0,229,255,0.15)"}`,
    background: highContrastHud ? "rgba(0,4,12,0.92)" : PANEL_BASE.background,
  };

  const HUD_STYLE: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    color: baseText,
    letterSpacing: "0.08em",
    pointerEvents: "none",
    opacity: hudOpacity,
    textShadow: highContrastHud ? "0 0 2px #000, 0 0 6px #000" : undefined,
  };

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ ...HUD_STYLE, fontSize: Math.round(11 * fontScale), userSelect: "none" }}
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

      {/* ── Top-left: heading ──
          Positioned to sit directly to the right of the global Help
          button (which is anchored to top:8 / left:8 outside this HUD
          overlay). The overlay container adds 80px top / 16px side
          padding, so we offset out of it with negative top + an x
          offset that clears the help button's ~80px width plus an 8px
          gap. */}
      <div
        className="hud-top-left absolute flex items-center gap-2"
        style={{ top: -72, left: 80 }}
      >
        {showHeading && (
          <div style={{ ...PANEL, fontSize: 11 }}>
            <span style={{ color: "#475569" }}>HDG </span>
            <span style={CYAN}>{Math.round(heading).toString().padStart(3, "0")}°</span>
          </div>
        )}
        <div style={{ pointerEvents: "auto" }}>
          <HelpIcon articleId="interface-tour" label="Help: HUD overlay" />
        </div>

        {/* Synthetic / simulated data warning badge */}
        {terrain?.synthetic && (
          <ViewscreenTooltip
            label="Real bathymetry sources were unreachable. Depths shown are procedurally generated, not actual sonar measurements."
            side="bottom"
          >
            <div
              data-testid="synthetic-data-badge"
              style={{
                ...PANEL,
                fontSize: 10,
                border: "1px solid rgba(245,158,11,0.5)",
                background: "rgba(245,158,11,0.10)",
                color: "#f59e0b",
                letterSpacing: "0.18em",
                fontWeight: 700,
                textShadow: "0 0 6px rgba(245,158,11,0.4)",
              }}
            >
              ⚠ SIMULATED DATA
            </div>
          </ViewscreenTooltip>
        )}

        {/* Raw bathymetry badge — shown when terrain smoothing is disabled
            so users can tell at a glance that on-screen noise is the real
            sounder data, not a rendering bug. */}
        {!smoothTerrainSpikes && (
          <ViewscreenTooltip
            label="Terrain smoothing is off. You're viewing the raw sounder grid — spikes and dropouts are real data, not rendering glitches."
            side="bottom"
          >
            <div
              data-testid="raw-bathymetry-badge"
              style={{
                ...PANEL,
                fontSize: 10,
                border: "1px solid rgba(148,163,184,0.5)",
                background: "rgba(148,163,184,0.10)",
                color: "#cbd5e1",
                letterSpacing: "0.18em",
                fontWeight: 700,
                textShadow: highContrastHud ? "0 0 2px #000, 0 0 6px #000" : "0 0 6px rgba(148,163,184,0.4)",
              }}
            >
              ◆ RAW BATHYMETRY
            </div>
          </ViewscreenTooltip>
        )}

        {/* Drift / Trolling mode badge */}
        {driftPlannerActive && (
          <div
            data-testid="hud-drift-mode-badge"
            style={{
              ...PANEL,
              fontSize: 10,
              border: `1px solid ${driftMode === "trolling" ? "rgba(251,191,36,0.5)" : "rgba(0,229,255,0.3)"}`,
              background: driftMode === "trolling" ? "rgba(251,191,36,0.08)" : "rgba(0,229,255,0.06)",
              color: driftMode === "trolling" ? "#fbbf24" : "#00e5ff",
              letterSpacing: "0.18em",
              fontWeight: 700,
            }}
          >
            {driftMode === "trolling"
              ? (() => {
                  if (driftWaypoints.length > 0) {
                    const wp = driftPath?.[driftHour];
                    const target = wp?.targetWaypointIndex;
                    const targetLabel = target === -1 ? "START" : typeof target === "number" ? `WP${target + 1}` : "—";
                    const remaining = wp?.legRemainingKm;
                    return `🎣 TROLL → ${targetLabel}${typeof remaining === "number" ? ` · ${remaining.toFixed(2)} km` : ""}`;
                  }
                  return `🎣 TROLL ${Math.round(boatHeadingDeg).toString().padStart(3, "0")}° / ${boatSpeedKnots.toFixed(1)} KT`;
                })()
              : "⛵ DRIFT"}
          </div>
        )}

        {/* GPS dive button in HUD */}
        {gpsInBounds && (
          <ViewscreenTooltip label="Jump the camera to your current GPS position" side="bottom">
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
          </ViewscreenTooltip>
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
            <div
              style={{
                color: "#475569",
                fontSize: 9,
                letterSpacing: "0.2em",
                marginBottom: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <span>CROSSHAIR TARGET</span>
              {crosshairGps && (
                IS_TOUCH_DEVICE ? (
                  <ViewscreenTooltip label="Open action menu at crosshair" side="bottom">
                    <button
                      data-testid="hud-crosshair-actions"
                      type="button"
                      aria-label="Open crosshair action menu"
                      onClick={() => {
                        const w = window.innerWidth;
                        const h = window.innerHeight;
                        openCrosshairContextMenu({
                          centerX: w / 2,
                          centerY: h / 2,
                          getTerrainGrid: () => terrain,
                        });
                      }}
                      style={{
                        pointerEvents: "auto",
                        background: "rgba(0,229,255,0.10)",
                        border: "1px solid rgba(0,229,255,0.35)",
                        borderRadius: 3,
                        color: "#00e5ff",
                        font: "inherit",
                        letterSpacing: "inherit",
                        padding: "1px 5px",
                        cursor: "pointer",
                      }}
                    >
                      ⋯ ACTIONS
                    </button>
                  </ViewscreenTooltip>
                ) : (
                  <CrosshairKeyHint />
                )
              )}
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
                {(() => {
                  const sample = estimateWaterTemperature(crosshairGps.depth, sstAnchor);
                  const tooltip = sample.live
                    ? `${sample.source}${sample.timestamp ? ` · sampled ${new Date(sample.timestamp).toUTCString()}` : ""} — click for full depth profile`
                    : "No live ocean feed available — showing an estimated thermocline. Click for full depth profile.";
                  const profileDepth = Math.max(
                    crosshairGps.depth ?? 0,
                    cameraDepth ?? 0,
                    200,
                  );
                  const { profile, measured } = resolveTemperatureProfile(
                    realProfile,
                    sstAnchor,
                    profileDepth,
                  );
                  return (
                    <div style={{ marginTop: 2, fontSize: 10 }}>
                      <button
                        data-testid="hud-water-temp"
                        type="button"
                        title={tooltip}
                        aria-expanded={tempProfileOpen}
                        aria-label="Show temperature profile"
                        onClick={() => setTempProfileOpen((v) => !v)}
                        style={{
                          pointerEvents: "auto",
                          background: tempProfileOpen ? "rgba(251,146,60,0.10)" : "transparent",
                          border: `1px solid ${tempProfileOpen ? "rgba(251,146,60,0.4)" : "transparent"}`,
                          borderRadius: 3,
                          padding: "1px 4px",
                          cursor: "pointer",
                          color: "inherit",
                          font: "inherit",
                          letterSpacing: "inherit",
                        }}
                      >
                        <span style={{ color: "#475569" }}>TEMP </span>
                        <span style={{ color: "#fb923c", textShadow: "0 0 6px rgba(251,146,60,0.4)" }}>
                          {formatTemperature(sample.celsius).toUpperCase()}
                        </span>
                        <span
                          data-testid="hud-water-temp-source"
                          style={{
                            marginLeft: 4,
                            fontSize: 8,
                            letterSpacing: "0.15em",
                            color: sample.live ? "#22d3ee" : "#f59e0b",
                            background: sample.live ? "rgba(0,229,255,0.08)" : "rgba(245,158,11,0.10)",
                            border: `1px solid ${sample.live ? "rgba(0,229,255,0.25)" : "rgba(245,158,11,0.4)"}`,
                            borderRadius: 2,
                            padding: "1px 4px",
                          }}
                        >
                          {sample.live ? "LIVE" : "EST"}
                        </span>
                        <span
                          aria-hidden="true"
                          style={{
                            marginLeft: 4,
                            color: "#64748b",
                            fontSize: 18,
                            lineHeight: 1,
                          }}
                        >
                          {tempProfileOpen ? "▴" : "▾"}
                        </span>
                      </button>
                      {tempProfileOpen && (
                        <div style={{ marginTop: 6, display: "flex", justifyContent: "center" }}>
                          <TemperatureProfileChart
                            profile={profile}
                            units={units}
                            highlightDepthM={crosshairGps.depth}
                            measured={measured}
                            onClose={() => setTempProfileOpen(false)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : (
              <div style={{ color: "#1e3a5f" }}>— NO TERRAIN —</div>
            )}
          </div>
        </div>
      )}

      {/* Bottom-right overlay/command toggle stack has moved into the
          left sidebar's "Overlays & Tools" panel (see OverlaysToolsPanel).
          The Substrate Legend also lives inline within that panel now. */}

      {/* ── Bottom-left: pin readout only ──
          The "CAMERA POSITION" LON/LAT panel was renamed to
          "YOUR CURRENT COORDINATES" and moved into the left side pane
          (rendered via <CameraCoordsReadout /> in App.tsx). The SPD
          readout was removed entirely. */}
      <div className="absolute bottom-3 left-3 space-y-1">
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

      {/* The substrate detail card was moved to <SubstrateDetailPanel /> at
          the App root (z-60) so it sits above both the HUD and the
          OverviewMap (z-40). Clicking a substrate polygon in either view
          now shows the same card. */}
    </div>
  );
};
