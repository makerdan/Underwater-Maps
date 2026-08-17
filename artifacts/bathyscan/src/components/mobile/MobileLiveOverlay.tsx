/**
 * MobileLiveOverlay — MOBILE-ONLY: glanceable chart-plotter readout shown on
 * the Live tab. Big depth-under-you number interpolated from the loaded
 * overview grid (via depthAtGpsMetres — null over survey gaps / outside the
 * chart, rendered as "—"), plus heading and speed rows when the GPS fix
 * provides them.
 *
 * Depth honours the user's Units setting; speed is shown in knots (the app's
 * boating convention); heading in degrees true with a cardinal letter.
 * GPS acquisition, retries, and error messaging stay in LivePanel (bottom
 * sheet) — this overlay only mirrors the current fix.
 */
import React from "react";
import { useGpsStore } from "@/lib/gpsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { depthAtGpsMetres } from "@/lib/mobileMapFollow";
import { formatDepth } from "@/lib/units";

const MONO = "'JetBrains Mono', monospace";
/** Metres/second → knots (speed convention used across the app). */
const MS_TO_KN = 1.94384;

/** Compass cardinal for a heading in degrees (0° = N). */
function cardinal(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

export const MobileLiveOverlay: React.FC = () => {
  const position = useGpsStore((s) => s.position);
  const gpsActive = useGpsStore((s) => s.active);
  const overviewGrid = useTerrainStore((s) => s.overviewGrid);
  const units = useSettingsStore((s) => s.units);

  const depthM =
    gpsActive && position
      ? depthAtGpsMetres(overviewGrid, position.longitude, position.latitude)
      : null;
  const heading = gpsActive && position ? position.heading : null;
  const speedKn =
    gpsActive && position && position.speed !== null
      ? position.speed * MS_TO_KN
      : null;

  return (
    <div
      data-testid="mobile-live-overlay"
      style={{
        background: "rgba(2,8,18,0.85)",
        border: "1px solid rgba(0,229,255,0.25)",
        borderRadius: 8,
        padding: "8px 14px",
        pointerEvents: "none", // MOBILE-ONLY: never block chart gestures
        fontFamily: MONO,
        width: "fit-content",
      }}
    >
      <div
        style={{
          color: "#94a3b8",
          fontSize: "calc(10px * var(--bs-font-scale, 1))",
          letterSpacing: "0.2em",
        }}
      >
        DEPTH
      </div>
      <div
        data-testid="mobile-live-depth"
        style={{
          color: depthM !== null ? "#00e5ff" : "#475569",
          textShadow: depthM !== null ? "0 0 10px rgba(0,229,255,0.5)" : "none",
          fontSize: "calc(34px * var(--bs-font-scale, 1))",
          fontWeight: 700,
          lineHeight: 1.1,
        }}
      >
        {depthM !== null ? formatDepth(depthM, { units, decimals: 1 }) : "—"}
      </div>
      {(heading !== null || speedKn !== null) && (
        <div
          style={{
            display: "flex",
            gap: 14,
            marginTop: 4,
            color: "#94a3b8",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
          }}
        >
          {heading !== null && (
            <span data-testid="mobile-live-heading" style={{ color: "#e2e8f0" }}>
              HDG {Math.round(heading)}° {cardinal(heading)}
            </span>
          )}
          {speedKn !== null && (
            <span data-testid="mobile-live-speed" style={{ color: "#e2e8f0" }}>
              SPD {speedKn.toFixed(1)} kn
            </span>
          )}
        </div>
      )}
      {(!gpsActive || !position) && (
        <div
          data-testid="mobile-live-nofix"
          style={{
            marginTop: 4,
            color: "#94a3b8",
            fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
            letterSpacing: "0.1em",
          }}
        >
          WAITING FOR GPS FIX…
        </div>
      )}
    </div>
  );
};
