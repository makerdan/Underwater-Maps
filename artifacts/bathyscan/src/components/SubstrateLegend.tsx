/**
 * SubstrateLegend — small key explaining the substrate overlay colour ramp.
 *
 * Rendered next to the SUBSTRATE button while the overlay is on. Lists the
 * three CMECS broad classes that bathyscan currently renders (mud, sand,
 * gravel) plus an extra "gravel structure zones" note that calls out the
 * Texas-reservoir bundle's gravel sub-classes — dam riprap, surveyed humps,
 * standing-timber flats, and TPWD habitat-structure clusters — so anglers
 * can actually identify what they're looking at on the map.
 */
import React from "react";

interface LegendRow {
  label: string;
  color: string;
  hint: string;
}

const ROWS: LegendRow[] = [
  { label: "MUD",    color: "#8b7355", hint: "Fine basin / channel sediment" },
  { label: "SAND",   color: "#e2d5a0", hint: "Littoral / beach sand & loam" },
  { label: "GRAVEL", color: "#b0956a", hint: "Coarse structure (see below)"  },
];

const GRAVEL_SUBTYPES: string[] = [
  "Dam riprap",
  "Surveyed humps",
  "Standing-timber flats",
  "TPWD habitat-structure clusters",
];

export const SubstrateLegend: React.FC = () => {
  return (
    <div
      data-testid="substrate-legend"
      style={{
        background: "rgba(0,10,20,0.75)",
        border: "1px solid rgba(226,213,160,0.25)",
        borderRadius: 4,
        padding: "6px 10px",
        maxWidth: 260,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
        color: "#e2e8f0",
        letterSpacing: "0.04em",
        pointerEvents: "auto",
        textAlign: "left",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          color: "#e2d5a0",
          letterSpacing: "0.2em",
          marginBottom: 4,
          fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
        }}
      >
        SUBSTRATE LEGEND
      </div>
      {ROWS.map((r) => (
        <div
          key={r.label}
          style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: r.color,
              border: "1px solid rgba(255,255,255,0.25)",
              flex: "0 0 auto",
            }}
          />
          <span style={{ color: r.color, fontWeight: 700, minWidth: 46 }}>{r.label}</span>
          <span style={{ color: "#e2e8f0" }}>{r.hint}</span>
        </div>
      ))}
      <div
        style={{
          marginTop: 6,
          paddingTop: 4,
          borderTop: "1px solid rgba(148,163,184,0.2)",
          color: "#cbd5e1",
          fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
          lineHeight: 1.4,
        }}
      >
        <span style={{ color: "#b0956a", fontWeight: 700 }}>Gravel structure zones: </span>
        {GRAVEL_SUBTYPES.join(" · ")}.{" "}
        <span style={{ color: "#cbd5e1" }}>
          Click a polygon for the lake-survey citation and TPWD lake page.
        </span>
      </div>
    </div>
  );
};
