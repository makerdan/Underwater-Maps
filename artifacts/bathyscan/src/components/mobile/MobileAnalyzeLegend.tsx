/**
 * MobileAnalyzeLegend — MOBILE-ONLY: compact legend pill strip for the 2D
 * chart's Analyze overlays. The desktop map draws its legends onto the canvas
 * bottom-right, which the mobile bottom sheet would cover; this React strip
 * sits under the dataset chip (always-visible top-left region) instead.
 *
 * One pill per ACTIVE overlay, each with the overlay name and up to
 * MAX_SWATCHES colour swatches derived the same way the desktop canvas
 * legends derive theirs (first-seen unique species/class colours).
 */
import React from "react";
import { SPECIES_CONFIGS } from "@/lib/habitat";
import type { MobileChartOverlays } from "./useMobileChartOverlays";

const MONO = "'JetBrains Mono', monospace";
// MOBILE-ONLY: cap swatches per pill so the strip stays one thumb-width tall.
const MAX_SWATCHES = 4;

/** Unique first-seen (label → colour) pairs, capped for the compact pill. */
function uniqueColors(pairs: Array<[string, string]>): Array<[string, string]> {
  const seen = new Map<string, string>();
  for (const [label, color] of pairs) {
    if (label && !seen.has(label)) seen.set(label, color);
  }
  return [...seen.entries()].slice(0, MAX_SWATCHES);
}

const Pill: React.FC<{
  testid: string;
  label: string;
  swatches: Array<[string, string]>;
  extra?: number;
}> = ({ testid, label, swatches, extra = 0 }) => (
  <div
    data-testid={testid}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      background: "rgba(2,8,18,0.85)",
      border: "1px solid rgba(0,229,255,0.25)",
      borderRadius: 999,
      padding: "4px 10px",
      color: "#94a3b8",
      fontFamily: MONO,
      fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
      letterSpacing: "0.08em",
      whiteSpace: "nowrap",
    }}
  >
    <span style={{ color: "#cbd5e1" }}>{label}</span>
    {swatches.map(([name, color]) => (
      <span
        key={name}
        title={name}
        style={{
          width: 9,
          height: 9,
          borderRadius: 2,
          background: color,
          border: "1px solid rgba(255,255,255,0.25)",
          flex: "0 0 auto",
        }}
      />
    ))}
    {extra > 0 && <span style={{ color: "#64748b" }}>+{extra}</span>}
  </div>
);

export const MobileAnalyzeLegend: React.FC<{ overlays: MobileChartOverlays }> = ({
  overlays,
}) => {
  const {
    habitatScores,
    habitatSpecies,
    efhEnabled,
    efhFeatures,
    substrateEnabled,
    substrateFeatures,
    hiddenSubstrateClasses,
    intertidalEnabled,
    mhwFt,
  } = overlays;

  const habitatActive = habitatScores !== null && habitatSpecies !== null;
  const efhActive = efhEnabled && efhFeatures.length > 0;
  const substrateActive = substrateEnabled && substrateFeatures.length > 0;
  // Band shows when datums resolve; pins when the hotspots toggle is on.
  const intertidalActive = intertidalEnabled || mhwFt !== null;

  if (!habitatActive && !efhActive && !substrateActive && !intertidalActive) return null;

  const efhPairs = uniqueColors(
    efhFeatures.map((f) => [
      f.properties.commonName ?? f.properties.species ?? "",
      f.properties.color ?? "#00e5ff",
    ]),
  );
  const efhSpeciesCount = new Set(
    efhFeatures.map((f) => f.properties.commonName ?? f.properties.species ?? ""),
  ).size;

  const substratePairs = uniqueColors(
    substrateFeatures
      .filter((f) => !hiddenSubstrateClasses.has(f.properties.substrate))
      .map((f) => [f.properties.substrate, f.properties.color ?? "#e2d5a0"]),
  );
  const substrateClassCount = new Set(
    substrateFeatures
      .filter((f) => !hiddenSubstrateClasses.has(f.properties.substrate))
      .map((f) => f.properties.substrate),
  ).size;

  const habitatLabel =
    habitatSpecies !== null
      ? (SPECIES_CONFIGS[habitatSpecies as keyof typeof SPECIES_CONFIGS]?.label ?? habitatSpecies)
      : "";

  return (
    <div
      data-testid="mobile-analyze-legend"
      // MOBILE-ONLY layout: horizontal scroll keeps every pill reachable on
      // narrow phones without wrapping over the chart.
      style={{
        position: "absolute",
        left: 10,
        right: 64, // clear the density stepper column
        top: 62,
        zIndex: 40,
        display: "flex",
        gap: 6,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        paddingBottom: 2,
        pointerEvents: "auto",
      }}
    >
      {habitatActive && (
        <Pill
          testid="mobile-legend-habitat"
          label={`HABITAT · ${String(habitatLabel).toUpperCase()}`}
          swatches={[
            ["low", "#1e3a5f"],
            ["high", "#fbbf24"],
          ]}
        />
      )}
      {substrateActive && (
        <Pill
          testid="mobile-legend-substrate"
          label="SUBSTRATE"
          swatches={substratePairs}
          extra={Math.max(0, substrateClassCount - substratePairs.length)}
        />
      )}
      {efhActive && (
        <Pill
          testid="mobile-legend-efh"
          label="EFH"
          swatches={efhPairs}
          extra={Math.max(0, efhSpeciesCount - efhPairs.length)}
        />
      )}
      {intertidalActive && (
        <Pill
          testid="mobile-legend-intertidal"
          label="INTERTIDAL"
          swatches={[
            ["lower band", "#2ec89e"],
            ["upper band", "#e0a533"],
          ]}
        />
      )}
    </div>
  );
};
