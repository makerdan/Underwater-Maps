/**
 * HabitatPanel — collapsible HUD panel for habitat suitability scoring.
 *
 * Features:
 *  • Species selector dropdown (filtered by current waterType)
 *  • Enable/disable toggle that drives the terrain shader + overview map overlay
 *  • Suggested Hotspots list: score bar, depth, substrate, "Fly there" / "Drop pin" buttons
 *
 * Rendered inside App.tsx alongside ZoneOverlay in the top-left column.
 */
import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHabitatStore } from "@/lib/habitatStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useUiStore } from "@/lib/uiStore";
import { useAppState } from "@/lib/context";
import { useSettingsStore } from "@/lib/settingsStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import {
  SPECIES_CONFIGS,
  SALTWATER_SPECIES_IDS,
  FRESHWATER_SPECIES_IDS,
} from "@/lib/habitat";
import type { SpeciesId, FreshwaterSpeciesId, SaltwaterSpeciesId, HotspotCandidate } from "@/lib/habitat";
import {
  usePostMarkers,
  getGetMarkersQueryKey,
} from "@workspace/api-client-react";
import { formatDepth } from "@/lib/units";

// ---------------------------------------------------------------------------
// Style constants (match ZoneOverlay.tsx)
// ---------------------------------------------------------------------------

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.28)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#cbd5e1",
  fontSize: 12,
  backdropFilter: "blur(6px)",
  pointerEvents: "auto",
  minWidth: 200,
  maxWidth: 250,
};

const AMBER: React.CSSProperties = {
  color: "#fb923c",
  textShadow: "0 0 6px rgba(251,146,60,0.5)",
};

// ---------------------------------------------------------------------------
// ScoreBar — filled amber bar representing a 0–1 score
// ---------------------------------------------------------------------------
const ScoreBar: React.FC<{ score: number }> = ({ score }) => (
  <div
    style={{
      height: 4,
      borderRadius: 2,
      background: "rgba(255,255,255,0.08)",
      overflow: "hidden",
      marginTop: 3,
    }}
  >
    <div
      style={{
        width: `${Math.round(score * 100)}%`,
        height: "100%",
        background: `rgba(251,146,60,${0.4 + score * 0.6})`,
        borderRadius: 2,
      }}
    />
  </div>
);

// ---------------------------------------------------------------------------
// HotspotCard
// ---------------------------------------------------------------------------
interface HotspotCardProps {
  hotspot: HotspotCandidate;
  index: number;
  onFly: (h: HotspotCandidate) => void;
  onDrop: (h: HotspotCandidate) => void;
  dropping: boolean;
}

const HotspotCard: React.FC<HotspotCardProps> = ({
  hotspot,
  index,
  onFly,
  onDrop,
  dropping,
}) => {
  const units = useSettingsStore((s) => s.units);
  return (
  <div
    style={{
      borderTop: "1px solid rgba(0,229,255,0.06)",
      paddingTop: 6,
      marginTop: 6,
    }}
  >
    <div className="flex items-start justify-between gap-1">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#e2e8f0", fontSize: 11, marginBottom: 1 }}>
          <span style={{ color: "#94a3b8", fontSize: 10 }}>#{index + 1} </span>
          <span style={{ color: "#fb923c", fontWeight: 600 }}>{Math.round(hotspot.score * 100)}%</span>
          <span style={{ color: "#94a3b8", fontSize: 10 }}> match</span>
        </div>
        <ScoreBar score={hotspot.score} />
        <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 3 }}>
          <span>{formatDepth(hotspot.depth, { units })}</span>
          <span style={{ color: "#64748b", margin: "0 4px" }}>·</span>
          <span style={{ color: "#94a3b8" }}>
            {hotspot.zoneLabel.replace(/_/g, " ")}
          </span>
        </div>
      </div>
    </div>
    <div className="flex gap-1 mt-2">
      <button
        onClick={() => onFly(hotspot)}
        style={{
          flex: 1,
          fontSize: 10,
          letterSpacing: "0.1em",
          padding: "4px 0",
          border: "1px solid rgba(0,229,255,0.35)",
          borderRadius: 3,
          background: "transparent",
          color: "#00e5ff",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        FLY THERE
      </button>
      <button
        onClick={() => onDrop(hotspot)}
        disabled={dropping}
        style={{
          flex: 1,
          fontSize: 10,
          letterSpacing: "0.1em",
          padding: "4px 0",
          border: "1px solid rgba(251,146,60,0.4)",
          borderRadius: 3,
          background: "transparent",
          color: dropping ? "#94a3b8" : "#fb923c",
          cursor: dropping ? "default" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {dropping ? "..." : "DROP PIN"}
      </button>
    </div>
  </div>
  );
};

// ---------------------------------------------------------------------------
// HabitatPanel
// ---------------------------------------------------------------------------
export const HabitatPanel: React.FC = () => {
  const { terrain } = useAppState();
  const zoneMap = useClassificationStore((s) => s.zoneMap);
  const activeSpecies = useHabitatStore((s) => s.activeSpecies);
  const scores = useHabitatStore((s) => s.scores);
  const hotspots = useHabitatStore((s) => s.hotspots);
  const settingsWaterType = useSettingsStore((s) => s.waterType);

  const [collapsed, setCollapsed] = useState(false);
  const [droppingIdx, setDroppingIdx] = useState<number | null>(null);

  const qc = useQueryClient();
  const postMarkers = usePostMarkers();

  // Determine active water type from terrain (authoritative) or settings fallback
  const waterType = (terrain?.waterType as "saltwater" | "freshwater" | undefined) ?? settingsWaterType;
  const speciesIds: SpeciesId[] = waterType === "freshwater"
    ? (FRESHWATER_SPECIES_IDS as unknown as FreshwaterSpeciesId[])
    : (SALTWATER_SPECIES_IDS as unknown as SaltwaterSpeciesId[]);

  // Recompute whenever terrain or zoneMap changes
  useEffect(() => {
    if (!terrain) {
      useHabitatStore.getState().clear();
      return;
    }
    if (activeSpecies) {
      // Bust cache and recompute for current species
      useHabitatStore.getState().clear();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain?.datasetId]);

  // Clear species selection when waterType changes so stale overlays don't persist
  useEffect(() => {
    useHabitatStore.getState().clear();
  }, [waterType]);

  // Recompute when species or zoneMap changes
  useEffect(() => {
    if (terrain && activeSpecies) {
      useHabitatStore.getState().compute(terrain, zoneMap);
    }
  }, [terrain, activeSpecies, zoneMap]);

  const handleSpeciesChange = (id: SpeciesId | "") => {
    if (!id) {
      useHabitatStore.getState().setSpecies(null);
      return;
    }
    useHabitatStore.getState().setSpecies(id, terrain ?? undefined, zoneMap);
  };

  const handleFly = (h: HotspotCandidate) => {
    if (!terrain) return;
    const { x: worldX, z: worldZ } = lonLatToWorldXZ(h.lon, h.lat, terrain);
    useUiStore.getState().setPendingDropIn({ worldX, worldZ });
  };

  const handleDrop = (h: HotspotCandidate, index: number) => {
    if (!terrain || droppingIdx !== null) return;

    const speciesLabel = activeSpecies ? (SPECIES_CONFIGS[activeSpecies]?.label ?? "Hotspot") : "Hotspot";
    const markerType = "fish";

    setDroppingIdx(index);
    postMarkers.mutate(
      {
        data: {
          datasetId: terrain.datasetId,
          type: markerType as "fish",
          label: `${speciesLabel} Hotspot #${index + 1}`,
          notes: `Score ${Math.round(h.score * 100)}% · ${formatDepth(h.depth, { units: "metric" })} · ${h.zoneLabel.replace(/_/g, " ")}`,
          lon: h.lon,
          lat: h.lat,
          depth: h.depth,
        },
      },
      {
        onSettled: () => {
          setDroppingIdx(null);
          void qc.invalidateQueries({
            queryKey: getGetMarkersQueryKey({ datasetId: terrain.datasetId }),
          });
        },
      },
    );
  };

  if (!terrain) return null;

  const showOverlay = !!activeSpecies && !!scores;

  return (
    <div style={PANEL} className="habitat-panel">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-3 py-2"
        style={{
          cursor: "pointer",
          background: "none",
          border: "none",
          borderBottom: collapsed ? "none" : "1px solid rgba(0,229,255,0.08)",
          borderRadius: 0,
          textAlign: "left",
          width: "100%",
          padding: "8px 12px",
        }}
        aria-expanded={!collapsed}
      >
        <span
          className="uppercase tracking-widest"
          style={{ fontSize: 11, ...AMBER, fontWeight: 700 }}
        >
          ◈ Habitat Layer
        </span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          {collapsed ? "▶" : "▼"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 py-2">
          {/* Species selector */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.08em", marginBottom: 4 }}>
              SPECIES ({waterType === "freshwater" ? "freshwater" : "marine"})
            </div>
            <select
              className="habitat-overlay-toggle"
              value={activeSpecies ?? ""}
              onChange={(e) => handleSpeciesChange(e.target.value as SpeciesId | "")}
              style={{
                width: "100%",
                background: "rgba(0,10,30,0.9)",
                border: `1px solid ${showOverlay ? "rgba(251,146,60,0.55)" : "rgba(0,229,255,0.3)"}`,
                borderRadius: 3,
                color: showOverlay ? "#fb923c" : "#cbd5e1",
                fontFamily: "inherit",
                fontSize: 11,
                padding: "5px 6px",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="">— disabled —</option>
              {speciesIds.map((id) => (
                <option key={id} value={id}>
                  {SPECIES_CONFIGS[id]?.label ?? id}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          {showOverlay && (
            <div style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 6, letterSpacing: "0.04em" }}>
              Amber overlay active on terrain
            </div>
          )}

          {/* Hotspot list */}
          {showOverlay && (
            <div className="hotspot-list">
              {hotspots.length === 0 ? (
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  No hotspots above 75% threshold
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: "0.08em", marginBottom: 4 }}>
                    SUGGESTED HOTSPOTS ({hotspots.length})
                  </div>
                  {hotspots.map((h, i) => (
                    <HotspotCard
                      key={`${h.row}-${h.col}`}
                      hotspot={h}
                      index={i}
                      onFly={handleFly}
                      onDrop={(hh) => handleDrop(hh, i)}
                      dropping={droppingIdx === i}
                    />
                  ))}
                </>
              )}
            </div>
          )}

          {!activeSpecies && (
            <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.05em" }}>
              Select a species to score habitat
            </div>
          )}
        </div>
      )}
    </div>
  );
};
