/**
 * useWhatsHere — aggregates crosshair data from all active overlays into a
 * single structured snapshot used by <WhatsHereCard>.
 *
 * Reads from:
 *   - cameraStore (crosshair lat/lon/depth)
 *   - habitatStore (active species + score at crosshair grid cell)
 *   - uiStore (substrate overlay active flag + last-selected substrate)
 *   - React Query cache via useGetSubstrate (live substrate polygon lookup)
 *   - waterTemp lib (temperature at depth)
 * Receives as params:
 *   - tidalData / tidalOverlay from App.tsx (already fetched there)
 *   - terrain (active TerrainData)
 */
import { useMemo } from "react";
import { useCameraStore } from "@/lib/cameraStore";
import { useHabitatStore } from "@/lib/habitatStore";
import { useUiStore } from "@/lib/uiStore";
import { estimateWaterTemperature } from "@/lib/waterTemp";
import { useSurfaceTemperature } from "@/hooks/useSurfaceTemperature";
import { SPECIES_CONFIGS } from "@/lib/habitat";
import { hitTestSubstrate } from "@/lib/overviewRenderer";
import {
  useGetSubstrate,
  getGetSubstrateQueryKey,
} from "@workspace/api-client-react";
import type { TidalDataResult } from "@/hooks/useTidalData";
import type { TerrainData } from "@workspace/api-client-react";

export interface WhatsHereData {
  depth: number | null;
  lat: number | null;
  lon: number | null;

  substrateActive: boolean;
  substrateName: string | null;

  habitatActive: boolean;
  habitatSpeciesLabel: string | null;
  habitatScore: number | null;

  tidalActive: boolean;
  tidalPhase: string | null;
  tidalHeight: number | null;

  tempC: number | null;
  tempLive: boolean;

  hasAnyData: boolean;
}

export function useWhatsHere(
  tidalData: TidalDataResult | null,
  tidalOverlay: boolean,
  terrain: TerrainData | null,
): WhatsHereData {
  const crosshairGps = useCameraStore((s) => s.crosshairGps);
  const activeSpecies = useHabitatStore((s) => s.activeSpecies);
  const scores = useHabitatStore((s) => s.scores);
  const substrateColorMode = useUiStore((s) => s.substrateColorMode);
  const hiddenSubstrateClasses = useUiStore((s) => s.hiddenSubstrateClasses);

  const datasetId = terrain?.datasetId ?? null;
  const { data: substrateCollection } = useGetSubstrate(datasetId as string, {
    query: {
      enabled: substrateColorMode && datasetId !== null,
      queryKey: getGetSubstrateQueryKey(datasetId as string),
      staleTime: 5 * 60_000,
    },
  });

  const hudCenterLat = terrain ? (terrain.minLat + terrain.maxLat) / 2 : null;
  const hudCenterLon = terrain ? (terrain.minLon + terrain.maxLon) / 2 : null;
  const { anchor: sstAnchor } = useSurfaceTemperature(
    hudCenterLat,
    hudCenterLon,
    !!terrain,
  );

  const depth = crosshairGps?.depth ?? null;
  const lat = crosshairGps?.lat ?? null;
  const lon = crosshairGps?.lon ?? null;

  const tempResult = useMemo(() => {
    if (depth === null) return { tempC: null as number | null, tempLive: false };
    const sample = estimateWaterTemperature(depth, sstAnchor);
    return { tempC: sample.celsius, tempLive: sample.live };
  }, [depth, sstAnchor]);

  const habitatScore = useMemo((): number | null => {
    if (!activeSpecies || scores.status !== "done" || !terrain || lat === null || lon === null) return null;
    const N = terrain.resolution;
    if (!N || N < 1) return null;
    const lonRange = terrain.maxLon - terrain.minLon;
    const latRange = terrain.maxLat - terrain.minLat;
    if (lonRange <= 0 || latRange <= 0) return null;
    const col = Math.max(0, Math.min(N - 1, Math.round(((lon - terrain.minLon) / lonRange) * (N - 1))));
    const row = Math.max(0, Math.min(N - 1, Math.round(((lat - terrain.minLat) / latRange) * (N - 1))));
    const idx = row * N + col;
    const s = scores.data[idx];
    return s !== undefined ? s : null;
  }, [activeSpecies, scores, terrain, lat, lon]);

  const substrateName = useMemo((): string | null => {
    if (!substrateColorMode || lat === null || lon === null) return null;
    const features = substrateCollection?.features;
    if (!features || features.length === 0) return null;
    const hit = hitTestSubstrate(lon, lat, features, hiddenSubstrateClasses);
    return hit?.properties.substrate ?? null;
  }, [substrateColorMode, lat, lon, substrateCollection, hiddenSubstrateClasses]);

  const tidalSummary = useMemo(() => {
    if (!tidalOverlay || !tidalData || !tidalData.available) {
      return { tidalPhase: null as string | null, tidalHeight: null as number | null };
    }
    const { tideHeight, nextEvent, slack } = tidalData;
    let phase: string | null = null;
    if (slack?.isSlack) {
      phase = "Slack";
    } else if (nextEvent?.type === "high") {
      phase = "Flooding";
    } else if (nextEvent?.type === "low") {
      phase = "Ebbing";
    }
    return { tidalPhase: phase, tidalHeight: tideHeight };
  }, [tidalOverlay, tidalData]);

  const substrateActive = substrateColorMode;
  const habitatActive = !!activeSpecies;
  const tidalActive = tidalOverlay && !!(tidalData?.available);

  // hasAnyData: true when at least one *overlay* is providing enrichment.
  // Depth and temperature are always present when terrain is loaded, so they
  // are deliberately excluded here — they must not suppress the prompt that
  // tells users to enable Substrate / Habitat overlays for richer data.
  const hasAnyData =
    (substrateActive && substrateName !== null) ||
    (habitatActive && habitatScore !== null) ||
    tidalActive;

  return {
    depth,
    lat,
    lon,
    substrateActive,
    substrateName,
    habitatActive,
    habitatSpeciesLabel: activeSpecies ? (SPECIES_CONFIGS[activeSpecies]?.label ?? null) : null,
    habitatScore,
    tidalActive,
    tidalPhase: tidalSummary.tidalPhase,
    tidalHeight: tidalSummary.tidalHeight,
    tempC: tempResult.tempC,
    tempLive: tempResult.tempLive,
    hasAnyData,
  };
}
