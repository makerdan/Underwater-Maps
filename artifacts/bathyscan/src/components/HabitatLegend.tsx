/**
 * HabitatLegend — compact floating gradient key for the amber habitat
 * suitability overlay. Mirrors the legend block inside HabitatPanel so it
 * remains visible alongside the 3D scene (and the 2D overview map) even when
 * the HabitatPanel is collapsed or hidden.
 *
 * Renders nothing unless a species is active and scores have been computed.
 */
import React from "react";
import { useHabitatStore } from "@/lib/habitatStore";
import { SPECIES_CONFIGS } from "@/lib/habitat";

interface HabitatLegendProps {
  /**
   * When true, renders without absolute positioning so the parent can place
   * it (e.g. inside the OverviewMap overlay). When false (default), the
   * legend pins itself to the bottom-left of its containing layer.
   */
  embedded?: boolean;
}

export const HabitatLegend: React.FC<HabitatLegendProps> = ({ embedded = false }) => {
  const activeSpecies = useHabitatStore((s) => s.activeSpecies);
  const scores = useHabitatStore((s) => s.scores);

  if (!activeSpecies || !scores) return null;

  const speciesLabel = SPECIES_CONFIGS[activeSpecies]?.label ?? activeSpecies;

  const wrapperStyle: React.CSSProperties = embedded
    ? {
        pointerEvents: "auto",
        background: "rgba(2,8,18,0.88)",
        border: "1px solid rgba(251,146,60,0.35)",
        borderRadius: 4,
        padding: "6px 8px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#e2e8f0",
        backdropFilter: "blur(6px)",
        minWidth: 130,
      }
    : {
        position: "absolute",
        left: 16,
        bottom: 16,
        zIndex: 25,
        pointerEvents: "auto",
        background: "rgba(2,8,18,0.88)",
        border: "1px solid rgba(251,146,60,0.35)",
        borderRadius: 4,
        padding: "6px 8px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#e2e8f0",
        backdropFilter: "blur(6px)",
        minWidth: 130,
      };

  return (
    <div
      className="habitat-legend-floating"
      role="img"
      aria-label={`Habitat suitability legend for ${speciesLabel}: low to high`}
      style={wrapperStyle}
    >
      <div
        style={{
          fontSize: 13.5,
          color: "#fb923c",
          letterSpacing: "0.12em",
          marginBottom: 3,
          textShadow: "0 0 6px rgba(251,146,60,0.4)",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        ◈ {speciesLabel}
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 2,
          border: "1px solid rgba(251,146,60,0.35)",
          background:
            "linear-gradient(to right, rgba(255,153,25,0.00), rgba(255,153,25,0.40))",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13.5,
          color: "#e2e8f0",
          marginTop: 2,
          letterSpacing: "0.06em",
        }}
      >
        <span>LOW</span>
        <span>HIGH</span>
      </div>
    </div>
  );
};
