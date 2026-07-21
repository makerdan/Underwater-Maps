/**
 * MarkerSymbolsSection — browsable catalogue of the marker symbol library.
 *
 * Shows every symbol grouped by section (Freshwater, Saltwater, Natural World,
 * Mariner, Special) with its custom SVG icon, label, and colour. Purely
 * informational — visibility toggles live in the Map Layers section.
 */
import React from "react";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import {
  FRESHWATER_MARKER_TYPES,
  SALTWATER_MARKER_TYPES,
  NATURAL_WORLD_MARKER_TYPES,
  MARINER_MARKER_TYPES,
  SPECIAL_MARKER_TYPES,
  type MarkerTypeDef,
} from "@/lib/markerConstants";
import { MarkerIcon } from "@/lib/markerIcons";

const SECTIONS: { header: string; sublabel: string; types: ReadonlyArray<MarkerTypeDef> }[] = [
  { header: "FRESHWATER", sublabel: "Shown when exploring in freshwater mode", types: FRESHWATER_MARKER_TYPES },
  { header: "SALTWATER", sublabel: "Shown when exploring in saltwater mode", types: SALTWATER_MARKER_TYPES },
  { header: "NATURAL WORLD", sublabel: "Always available in both modes", types: NATURAL_WORLD_MARKER_TYPES },
  { header: "MARINER", sublabel: "Standard mariner symbols — always available", types: MARINER_MARKER_TYPES },
  { header: "SPECIAL", sublabel: "Basics available everywhere", types: SPECIAL_MARKER_TYPES },
];

export function MarkerSymbolsSection() {
  return (
    <>
      <SectionTitle helpId="marker-symbols" helpLabel="Marker Symbols">◈ MARKER SYMBOLS</SectionTitle>
      <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", padding: "0 2px 10px", letterSpacing: "0.04em" }}>
        The symbol library used when dropping markers. Which types are shown on
        the map is controlled under Map Layers → Visible Types.
      </div>
      {SECTIONS.map((section) => (
        <div key={section.header} style={S.card} data-testid={`marker-symbols-${section.header.toLowerCase().replace(/\s+/g, "-")}`}>
          <div style={S.cardHeader}>{section.header}</div>
          <div style={{ fontSize: "calc(12.5px * var(--bs-font-scale, 1))", color: "#64748b", padding: "2px 0 8px" }}>{section.sublabel}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
            {section.types.map((t) => (
              <div
                key={t.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  borderRadius: 4,
                  border: "1px solid rgba(0,229,255,0.10)",
                  background: "rgba(0,229,255,0.03)",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: "rgba(2,8,24,0.8)",
                    border: `1px solid ${t.color}66`,
                  }}
                >
                  <MarkerIcon type={t.value} size={16} color={t.color} />
                </span>
                <span style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
