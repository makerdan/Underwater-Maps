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
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { useQueryClient } from "@tanstack/react-query";
import { useHabitatStore } from "@/lib/habitatStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useUiStore } from "@/lib/uiStore";
import { HelpIcon } from "@/components/help/HelpButton";
import { useAppState } from "@/lib/context";
import { useSettingsStore } from "@/lib/settingsStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import {
  SPECIES_CONFIGS,
  SALTWATER_SPECIES_IDS,
  FRESHWATER_SPECIES_IDS,
  getHabitatSummary,
} from "@/lib/habitat";
import type { SpeciesId, FreshwaterSpeciesId, SaltwaterSpeciesId, HotspotCandidate } from "@/lib/habitat";
import {
  usePostMarkers,
  getGetMarkersQueryKey,
} from "@workspace/api-client-react";
import { formatDepth } from "@/lib/units";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { ShoreZoneCredit } from "@/components/ShoreZoneCredit";
import { useTidalSchedule } from "@/hooks/useTidalSchedule";
import {
  computeFishingWindowsByDay,
  formatWindowRange,
  isWindowActive,
  type FishingWindow,
} from "@/lib/fishingWindows";

// ---------------------------------------------------------------------------
// Style constants (match ZoneOverlay.tsx)
// ---------------------------------------------------------------------------

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,18,0.94)",
  border: "1px solid rgba(0,229,255,0.28)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#e2e8f0",
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
// StarRating — renders 1–3 filled/empty stars
// ---------------------------------------------------------------------------
const StarRating: React.FC<{ stars: 1 | 2 | 3 }> = ({ stars }) => (
  <span aria-label={`${stars} out of 3 stars`} style={{ letterSpacing: 1 }}>
    {[1, 2, 3].map((n) => (
      <span
        key={n}
        style={{ color: n <= stars ? "#fb923c" : "rgba(251,146,60,0.22)", fontSize: 11 }}
      >
        ★
      </span>
    ))}
  </span>
);

// ---------------------------------------------------------------------------
// FishingWindowCard
// ---------------------------------------------------------------------------
interface FishingWindowCardProps {
  window: FishingWindow;
  onSnap: (d: Date) => void;
  isActive: boolean;
}

const FishingWindowCard: React.FC<FishingWindowCardProps> = ({ window: w, onSnap, isActive }) => (
  <ViewscreenTooltip label="Snap tidal scrubber to this window" side="right">
    <button
      onClick={() => onSnap(w.scrubTarget)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: isActive ? "rgba(251,146,60,0.12)" : "rgba(251,146,60,0.05)",
        border: isActive
          ? "1px solid rgba(251,146,60,0.75)"
          : "1px solid rgba(251,146,60,0.22)",
        borderRadius: 3,
        padding: "5px 7px",
        marginBottom: 4,
        cursor: "pointer",
        fontFamily: "inherit",
        letterSpacing: "0.04em",
        animation: isActive ? "fishwin-pulse 2s ease-in-out infinite" : "none",
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 2 }}>
        <span style={{ color: "#fb923c", fontSize: 10, fontWeight: 600 }}>
          {formatWindowRange(w.start, w.end)}
        </span>
        <span className="flex items-center gap-1">
          {isActive && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "#fb923c",
                letterSpacing: "0.06em",
                textShadow: "0 0 6px rgba(251,146,60,0.7)",
              }}
            >
              ● NOW
            </span>
          )}
          <StarRating stars={w.stars} />
        </span>
      </div>
      <div style={{ color: "#cbd5e1", fontSize: 9, letterSpacing: "0.06em" }}>
        {w.phaseLabel}
      </div>
    </button>
  </ViewscreenTooltip>
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
        <div style={{ color: "#f1f5f9", fontSize: 11, marginBottom: 1 }}>
          <span style={{ color: "#cbd5e1", fontSize: 10 }}>#{index + 1} </span>
          <span style={{ color: "#fb923c", fontWeight: 600 }}>{Math.round(hotspot.score * 100)}%</span>
          <span style={{ color: "#e2e8f0", fontSize: 10 }}> match</span>
        </div>
        <ScoreBar score={hotspot.score} />
        <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 3 }}>
          <span>{formatDepth(hotspot.depth, { units })}</span>
          <span style={{ color: "#e2e8f0", margin: "0 4px" }}>·</span>
          <span style={{ color: "#cbd5e1" }}>
            {hotspot.zoneLabel.replace(/_/g, " ")}
          </span>
        </div>
      </div>
    </div>
    <div className="flex gap-1 mt-2">
      <ViewscreenTooltip label="Move the camera to this hotspot" side="top">
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
      </ViewscreenTooltip>
      <ViewscreenTooltip label="Save this hotspot as a marker" side="top">
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
            color: dropping ? "#e2e8f0" : "#fb923c",
            cursor: dropping ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {dropping ? "..." : "DROP PIN"}
        </button>
      </ViewscreenTooltip>
    </div>
  </div>
  );
};

// ---------------------------------------------------------------------------
// HabitatPanel
// ---------------------------------------------------------------------------
interface HabitatPanelProps {
  embedded?: boolean;
}

export const HabitatPanel: React.FC<HabitatPanelProps> = ({ embedded = false }) => {
  const { terrain } = useAppState();
  const zoneMap = useClassificationStore((s) => s.zoneMap);
  const activeSpecies = useHabitatStore((s) => s.activeSpecies);
  const scores = useHabitatStore((s) => s.scores);
  const hotspots = useHabitatStore((s) => s.hotspots);
  const settingsWaterType = useSettingsStore((s) => s.waterType);
  const defaultHabitatSpecies = useSettingsStore((s) => s.defaultHabitatSpecies);
  const autoShowZoneOverlay = useSettingsStore((s) => s.autoShowZoneOverlay);
  const habitatOverlayIntensity = useSettingsStore((s) => s.habitatOverlayIntensity);
  const setHabitatOverlayIntensity = useSettingsStore((s) => s.setHabitatOverlayIntensity);
  const setScrubDatetime = useUiStore((s) => s.setScrubDatetime);
  const scrubDatetime = useUiStore((s) => s.scrubDatetime);

  const storeCollapsed = usePanelCollapseStore((s) => s.collapsed.habitat);
  const collapsed = embedded ? false : storeCollapsed;
  const togglePanel = usePanelCollapseStore((s) => s.toggle);
  const [droppingIdx, setDroppingIdx] = useState<number | null>(null);

  const centerLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : null;
  const centerLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : null;
  const { schedule } = useTidalSchedule(centerLat, centerLon, 3);

  const tidalPreference = activeSpecies
    ? (SPECIES_CONFIGS[activeSpecies]?.tidalPreference ?? "any")
    : "any";

  const fishingWindowsByDay = useMemo(
    () => computeFishingWindowsByDay(schedule, tidalPreference, 3),
    [schedule, tidalPreference],
  );

  const hasFishingWindows = fishingWindowsByDay.some((d) => d.windows.length > 0);

  const [collapsedDays, setCollapsedDays] = useState<Set<number>>(
    () => new Set([1, 2]),
  );

  const toggleDay = useCallback((offset: number) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(offset)) next.delete(offset);
      else next.add(offset);
      return next;
    });
  }, []);

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

  // Apply user defaults once terrain is loaded — pre-select the user's
  // preferred default species (if any & compatible with current water type)
  // and auto-enable the substrate-zone overlay if they've asked for it.
  useEffect(() => {
    if (!terrain) return;
    if (autoShowZoneOverlay && !useUiStore.getState().zoneOverlayEnabled) {
      useUiStore.getState().setZoneOverlayEnabled(true);
    }
    if (
      defaultHabitatSpecies &&
      !activeSpecies &&
      (speciesIds as readonly string[]).includes(defaultHabitatSpecies)
    ) {
      useHabitatStore
        .getState()
        .setSpecies(defaultHabitatSpecies as SpeciesId, terrain, zoneMap);
    }
  // Only run on terrain swap / water-type change — not every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain?.datasetId, waterType]);

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
    <div style={embedded ? { width: "100%" } : PANEL} className="habitat-panel">
      {/* Header — hidden when embedded inside a SidebarSection */}
      {!embedded && (
      <ViewscreenTooltip label={collapsed ? "Expand habitat panel" : "Collapse habitat panel"} side="right">
      <button
        onClick={() => togglePanel("habitat")}
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
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <HelpIcon articleId="ai-assistant" label="Habitat layer" />
          <span style={{ fontSize: 22, lineHeight: 1, color: "#cbd5e1" }}>
            {collapsed ? "▶" : "▼"}
          </span>
        </span>
      </button>
      </ViewscreenTooltip>
      )}

      {!collapsed && (
        <div className="px-3 py-2">
          {/* Species selector */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#cbd5e1", letterSpacing: "0.08em", marginBottom: 4 }}>
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
                <option key={id} value={id} title={getHabitatSummary(id)}>
                  {SPECIES_CONFIGS[id]?.label ?? id}
                </option>
              ))}
            </select>

            {/* Inline habitat summary — shown when a species is selected.
                Updates on selection so it works on both desktop and mobile. */}
            {activeSpecies && (
              <div
                aria-label={`Habitat: ${getHabitatSummary(activeSpecies)}`}
                style={{
                  marginTop: 5,
                  padding: "4px 6px",
                  background: "rgba(251,146,60,0.06)",
                  border: "1px solid rgba(251,146,60,0.18)",
                  borderRadius: 3,
                  fontSize: 9.5,
                  color: "#94a3b8",
                  letterSpacing: "0.04em",
                  lineHeight: 1.4,
                }}
              >
                <span style={{ color: "rgba(251,146,60,0.7)", marginRight: 4 }}>◈</span>
                {getHabitatSummary(activeSpecies)}
              </div>
            )}
          </div>

          {/* Overlay intensity slider */}
          {showOverlay && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 10,
                  color: "#cbd5e1",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                <span>OVERLAY INTENSITY</span>
                <span style={{ ...AMBER, fontWeight: 600 }}>
                  {Math.round(habitatOverlayIntensity * 100)}%
                </span>
              </div>
              <input
                className="habitat-overlay-intensity"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={habitatOverlayIntensity}
                onChange={(e) => setHabitatOverlayIntensity(parseFloat(e.target.value))}
                aria-label="Habitat overlay intensity"
                style={{
                  width: "100%",
                  accentColor: "#fb923c",
                  cursor: "pointer",
                }}
              />
            </div>
          )}

          {/* Status */}
          {showOverlay && (
            <div style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 6, letterSpacing: "0.04em" }}>
              Amber overlay active on terrain
            </div>
          )}

          {/* Suitability legend — gradient matches the shader's amber tint */}
          {showOverlay && (
            <div
              className="habitat-legend"
              role="img"
              aria-label="Habitat suitability legend: low to high"
              style={{ marginBottom: 8 }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "#cbd5e1",
                  letterSpacing: "0.08em",
                  marginBottom: 3,
                }}
              >
                SUITABILITY
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
                  fontSize: 9,
                  color: "#e2e8f0",
                  marginTop: 2,
                  letterSpacing: "0.06em",
                }}
              >
                <span>LOW</span>
                <span>HIGH</span>
              </div>
            </div>
          )}

          {/* Hotspot list */}
          {showOverlay && (
            <div className="hotspot-list">
              {hotspots.length === 0 ? (
                <div style={{ fontSize: 11, color: "#e2e8f0" }}>
                  No hotspots above 75% threshold
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 10, color: "#cbd5e1", letterSpacing: "0.08em", marginBottom: 4 }}>
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

          {/* Best fishing windows — 3-day view, only shown when tidal data is
              available and the active species has a non-"any" preference. */}
          {showOverlay && hasFishingWindows && (() => {
            const refNow = scrubDatetime ?? new Date();
            return (
            <div
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: "1px solid rgba(251,146,60,0.18)",
              }}
            >
              <style>{`
                @keyframes fishwin-pulse {
                  0%, 100% { box-shadow: 0 0 0 0 rgba(251,146,60,0.0); }
                  50% { box-shadow: 0 0 0 3px rgba(251,146,60,0.35); }
                }
              `}</style>
              <div
                style={{
                  fontSize: 10,
                  color: "#fb923c",
                  letterSpacing: "0.08em",
                  fontWeight: 700,
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>⏱</span>
                <span>BEST WINDOWS</span>
              </div>
              {fishingWindowsByDay.map((day) => {
                if (day.windows.length === 0) return null;
                const isCollapsed = collapsedDays.has(day.dayOffset);
                return (
                  <div key={day.dayOffset} style={{ marginBottom: 6 }}>
                    <button
                      onClick={() => toggleDay(day.dayOffset)}
                      aria-expanded={!isCollapsed}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        background: "rgba(251,146,60,0.07)",
                        border: "1px solid rgba(251,146,60,0.18)",
                        borderRadius: 3,
                        padding: "4px 7px",
                        marginBottom: isCollapsed ? 0 : 4,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: "#fb923c",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                      }}
                    >
                      <span style={{ textTransform: "uppercase" }}>
                        {day.dayLabel}
                      </span>
                      <span style={{ fontSize: 9, opacity: 0.7 }}>
                        {isCollapsed ? "▶" : "▼"} {day.windows.length}
                      </span>
                    </button>
                    {!isCollapsed && day.windows.map((w, i) => (
                      <FishingWindowCard
                        key={i}
                        window={w}
                        onSnap={setScrubDatetime}
                        isActive={isWindowActive(w, refNow)}
                      />
                    ))}
                  </div>
                );
              })}
              <div
                style={{
                  fontSize: 9,
                  color: "#94a3b8",
                  letterSpacing: "0.05em",
                  marginTop: 2,
                }}
              >
                Click a window to snap the tidal scrubber
              </div>
            </div>
            );
          })()}

          {!activeSpecies && (
            <div style={{ fontSize: 11, color: "#e2e8f0", letterSpacing: "0.05em" }}>
              Select a species to score habitat
            </div>
          )}

          {/* Attribution for the ShoreZone substrate dataset feeding the
              habitat scoring. Only shown when substrate zone data is loaded. */}
          {zoneMap && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(0,229,255,0.08)" }}>
              <ShoreZoneCredit />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
