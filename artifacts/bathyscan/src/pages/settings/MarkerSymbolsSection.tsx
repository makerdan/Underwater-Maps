/**
 * MarkerSymbolsSection — browsable catalogue of the marker symbol library.
 *
 * Mode-aware: the species group matching the current exploration mode is
 * shown prominently (alongside the always-available Natural World, Mariner,
 * and Special groups), while the other mode's species sit in a collapsed
 * panel. A Legacy group at the bottom lists retired symbols that existing
 * saved markers may still use. Purely informational — visibility toggles
 * live in the Map Layers section.
 *
 * Section headers are derived from MARKER_CATEGORY_LABELS via
 * getMarkerPickerSections (src/lib/markerConstants.ts — the canonical
 * source), so a rename there propagates here automatically.
 */
import React from "react";
import { useSettingsStore } from "@/lib/settingsStore";
import { S } from "./styles";
import { SectionTitle } from "./components/SectionTitle";
import {
  getMarkerPickerSections,
  FRESHWATER_MARKER_TYPES,
  SALTWATER_MARKER_TYPES,
  LEGACY_MARKER_TYPES,
  MARKER_CATEGORY_LABELS,
  type MarkerCategory,
  type MarkerTypeDef,
} from "@/lib/markerConstants";
import { MarkerIcon } from "@/lib/markerIcons";

/**
 * Per-category descriptions. Headers themselves come from
 * MARKER_CATEGORY_LABELS (markerConstants.ts); only these explanatory
 * sublabels are local to this catalogue view.
 */
const CATEGORY_SUBLABELS: Record<MarkerCategory, string> = {
  freshwater: "Freshwater species symbols",
  saltwater: "Saltwater species symbols",
  salmon: "Salmon, schools, and species variants",
  bottomfish: "Fishing targets: flatfish, rockfish, cod, and related species",
  natural: "Always available in both modes",
  mariner: "Standard mariner symbols — always available",
  special: "Basics available everywhere",
  legacy:
    "Retired symbols no longer offered when dropping new markers. Existing saved markers using them keep their icon and colour.",
};

const sectionTestId = (label: string) =>
  `marker-symbols-${label.toLowerCase().replace(/\s+/g, "-")}`;

function SymbolGrid({ types }: { types: ReadonlyArray<MarkerTypeDef> }) {
  return (
    <div style={{ overflowX: "auto" }}>
      {/* minmax(120px, 1fr) + overflow-x auto so the grid never overflows
          narrow settings panes. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6 }}>
        {types.map((t) => (
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
              minWidth: 0,
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
  );
}

function SymbolCard({
  label,
  sublabel,
  types,
}: {
  label: string;
  sublabel: string;
  types: ReadonlyArray<MarkerTypeDef>;
}) {
  return (
    <div style={S.card} data-testid={sectionTestId(label)}>
      <div style={S.cardHeader}>{label}</div>
      <div style={{ padding: "2px 16px 10px" }}>
        <div style={{ fontSize: "calc(12.5px * var(--bs-font-scale, 1))", color: "#64748b", padding: "6px 0 8px" }}>{sublabel}</div>
        <SymbolGrid types={types} />
      </div>
    </div>
  );
}

export function MarkerSymbolsSection() {
  const waterType = useSettingsStore((s) => s.waterType);
  const mode: "freshwater" | "saltwater" =
    waterType === "freshwater" ? "freshwater" : "saltwater";
  const otherMode: "freshwater" | "saltwater" =
    mode === "freshwater" ? "saltwater" : "freshwater";

  // Canonical section list (labels from MARKER_CATEGORY_LABELS) for the
  // current mode: species + Natural World + Mariner + Special.
  const sections = getMarkerPickerSections(mode);
  const otherModeTypes =
    otherMode === "freshwater" ? FRESHWATER_MARKER_TYPES : SALTWATER_MARKER_TYPES;
  const otherModeLabel = MARKER_CATEGORY_LABELS[otherMode];
  const modeLabel = mode === "freshwater" ? "~ FRESHWATER" : "≈ SALTWATER";
  const modeColor = mode === "freshwater" ? "#4ade80" : "#00e5ff";
  const otherModeName = otherMode === "freshwater" ? "Freshwater" : "Saltwater";

  return (
    <>
      <SectionTitle helpId="marker-symbols" helpLabel="Marker Symbols">◈ MARKER SYMBOLS</SectionTitle>
      <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", padding: "0 2px 6px", letterSpacing: "0.04em" }}>
        The symbols available when dropping markers in your current
        exploration mode, plus legacy symbols kept for older saved markers.
        Which types are shown on the map is controlled under Map Layers →
        Visible Types.
      </div>
      {/* Mode indicator — the species group below follows the Exploration
          Mode chosen under General. */}
      <div
        data-testid="marker-symbols-mode-indicator"
        style={{
          fontSize: "calc(11px * var(--bs-font-scale, 1))",
          letterSpacing: "0.12em",
          color: modeColor,
          padding: "0 2px 10px",
        }}
      >
        SHOWING SYMBOLS FOR {modeLabel} MODE
      </div>
      {sections.map((section) => (
        <SymbolCard
          key={section.category}
          label={section.label}
          sublabel={CATEGORY_SUBLABELS[section.category] ?? ""}
          types={section.types}
        />
      ))}
      {/* Other mode's species — collapsed until expanded. */}
      <details style={{ ...S.card }} data-testid="marker-symbols-other-mode">
        <summary
          style={{
            ...S.cardHeader,
            cursor: "pointer",
            listStyle: "none",
            display: "block",
          }}
        >
          ▸ {otherModeLabel} ({otherModeTypes.length})
        </summary>
        <div style={{ padding: "2px 16px 10px" }}>
          <div style={{ fontSize: "calc(12.5px * var(--bs-font-scale, 1))", color: "#64748b", padding: "6px 0 8px" }}>
            Switch to {otherModeName} mode (General → Exploration Mode) to use these.
          </div>
          <SymbolGrid types={otherModeTypes} />
        </div>
      </details>
      {/* Legacy symbols — kept so older saved markers still resolve. */}
      <SymbolCard
        label={`${MARKER_CATEGORY_LABELS.legacy} (SAVED MARKERS)`}
        sublabel={CATEGORY_SUBLABELS.legacy}
        types={LEGACY_MARKER_TYPES}
      />
    </>
  );
}
