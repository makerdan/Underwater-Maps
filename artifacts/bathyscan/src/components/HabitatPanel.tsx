/**
 * HabitatPanel — collapsible HUD panel for habitat suitability scoring.
 *
 * Features:
 *  • Species selector dropdown (Dungeness Crab, Demersal Fish, Rockfish, Halibut, Salmon)
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
import { lonLatToWorldXZ } from "@/lib/terrain";
import {
  SPECIES_CONFIGS,
  SPECIES_IDS,
} from "@/lib/habitat";
import type { SpeciesId, HotspotCandidate } from "@/lib/habitat";
import {
  usePostMarkers,
  getGetMarkersQueryKey,
} from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Style constants (match ZoneOverlay.tsx)
// ---------------------------------------------------------------------------

const PANEL: React.CSSProperties = {
  background: "rgba(0,10,20,0.82)",
  border: "1px solid rgba(0,229,255,0.18)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#94a3b8",
  fontSize: 11,
  backdropFilter: "blur(6px)",
  pointerEvents: "auto",
  minWidth: 172,
  maxWidth: 240,
};

const _CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};
void _CYAN;

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
}) => (
  <div
    style={{
      borderTop: "1px solid rgba(0,229,255,0.06)",
      paddingTop: 6,
      marginTop: 6,
    }}
  >
    <div className="flex items-start justify-between gap-1">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#e2e8f0", fontSize: 10, marginBottom: 1 }}>
          <span style={{ color: "#475569", fontSize: 9 }}>#{index + 1} </span>
          <span style={{ color: "#fb923c" }}>{Math.round(hotspot.score * 100)}%</span>
          <span style={{ color: "#334155", fontSize: 9 }}> match</span>
        </div>
        <ScoreBar score={hotspot.score} />
        <div style={{ fontSize: 9, color: "#64748b", marginTop: 3 }}>
          <span>{Math.round(hotspot.depth)} m</span>
          <span style={{ color: "#1e293b", margin: "0 4px" }}>·</span>
          <span style={{ color: "#475569" }}>
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
          fontSize: 8,
          letterSpacing: "0.1em",
          padding: "3px 0",
          border: "1px solid rgba(0,229,255,0.2)",
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
          fontSize: 8,
          letterSpacing: "0.1em",
          padding: "3px 0",
          border: "1px solid rgba(251,146,60,0.25)",
          borderRadius: 3,
          background: "transparent",
          color: dropping ? "#475569" : "#fb923c",
          cursor: dropping ? "default" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {dropping ? "..." : "DROP PIN"}
      </button>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// HabitatPanel
// ---------------------------------------------------------------------------
export const HabitatPanel: React.FC = () => {
  const { terrain } = useAppState();
  const zoneMap = useClassificationStore((s) => s.zoneMap);
  const activeSpecies = useHabitatStore((s) => s.activeSpecies);
  const scores = useHabitatStore((s) => s.scores);
  const hotspots = useHabitatStore((s) => s.hotspots);

  const [collapsed, setCollapsed] = useState(false);
  const [droppingIdx, setDroppingIdx] = useState<number | null>(null);

  const qc = useQueryClient();
  const postMarkers = usePostMarkers();

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
    const markerType = (activeSpecies === "dungeness_crab") ? "custom" : "fish";

    setDroppingIdx(index);
    postMarkers.mutate(
      {
        data: {
          datasetId: terrain.datasetId,
          type: markerType as "fish" | "custom",
          label: `${speciesLabel} Hotspot #${index + 1}`,
          notes: `Score ${Math.round(h.score * 100)}% · ${Math.round(h.depth)} m · ${h.zoneLabel.replace(/_/g, " ")}`,
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
          style={{ fontSize: 10, ...AMBER, fontWeight: 700 }}
        >
          ◈ Habitat Layer
        </span>
        <span style={{ fontSize: 9, color: "#334155" }}>
          {collapsed ? "▶" : "▼"}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 py-2">
          {/* Species selector */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.08em", marginBottom: 4 }}>
              SPECIES
            </div>
            <select
              className="habitat-overlay-toggle"
              value={activeSpecies ?? ""}
              onChange={(e) => handleSpeciesChange(e.target.value as SpeciesId | "")}
              style={{
                width: "100%",
                background: "rgba(0,10,30,0.85)",
                border: `1px solid ${showOverlay ? "rgba(251,146,60,0.45)" : "rgba(0,229,255,0.15)"}`,
                borderRadius: 3,
                color: showOverlay ? "#fb923c" : "#64748b",
                fontFamily: "inherit",
                fontSize: 10,
                padding: "4px 6px",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="">— disabled —</option>
              {SPECIES_IDS.map((id) => (
                <option key={id} value={id}>
                  {SPECIES_CONFIGS[id]?.label ?? id}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          {showOverlay && (
            <div style={{ fontSize: 9, color: "#475569", marginBottom: 6, letterSpacing: "0.04em" }}>
              Amber overlay active on terrain
            </div>
          )}

          {/* Hotspot list */}
          {showOverlay && (
            <div className="hotspot-list">
              {hotspots.length === 0 ? (
                <div style={{ fontSize: 9, color: "#1e293b" }}>
                  No hotspots above 75% threshold
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.08em", marginBottom: 4 }}>
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
            <div style={{ fontSize: 9, color: "#1e293b", letterSpacing: "0.05em" }}>
              Select a species to score habitat
            </div>
          )}
        </div>
      )}
    </div>
  );
};
