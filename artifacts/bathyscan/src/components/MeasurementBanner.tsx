/**
 * MeasurementBanner — HUD banner below the crosshair showing measurement state.
 *
 * Two states:
 *   1. Anchor set (first right-click "Measure from here"): shows hint.
 *   2. Result computed (second right-click "Measure to here"): shows distance
 *      and depth delta. Auto-dismisses after 8 seconds.
 */
import React, { useEffect } from "react";
import { useMeasureStore } from "@/lib/measureStore";

const AUTO_DISMISS_MS = 8000;

export const MeasurementBanner: React.FC = () => {
  const anchorGps = useMeasureStore((s) => s.anchorGps);
  const result = useMeasureStore((s) => s.result);
  const clearResult = useMeasureStore((s) => s.clearResult);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => clearResult(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [result, clearResult]);

  if (!anchorGps && !result) return null;

  return (
    <div
      data-testid="measurement-banner"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, 40px)",
        zIndex: 25,
        padding: "8px 14px",
        background: "rgba(0,10,20,0.92)",
        border: "1px solid rgba(0,229,255,0.35)",
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 11,
        color: "#cbd5e1",
        letterSpacing: "0.1em",
        pointerEvents: "none",
        backdropFilter: "blur(6px)",
        whiteSpace: "nowrap",
      }}
    >
      {anchorGps && !result && (
        <span style={{ color: "#00e5ff" }}>
          📏 ANCHOR SET — right-click another point to measure
        </span>
      )}
      {result && (
        <>
          <span>📏 DIST </span>
          <span style={{ color: "#00e5ff", fontWeight: 600 }}>
            {result.distanceKm < 1
              ? `${Math.round(result.distanceKm * 1000)} m`
              : `${result.distanceKm.toFixed(2)} km`}
          </span>
          <span style={{ color: "#475569" }}>{"   ·   "}</span>
          <span>Δ DEPTH </span>
          <span
            style={{
              color: result.depthDeltaM >= 0 ? "#fb923c" : "#60a5fa",
              fontWeight: 600,
            }}
          >
            {result.depthDeltaM >= 0 ? "+" : ""}
            {Math.round(result.depthDeltaM)} m
          </span>
        </>
      )}
    </div>
  );
};
