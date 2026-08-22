/**
 * useMobileChartOverlays — MOBILE-ONLY: gathers every Analyze-tab overlay's
 * data + gating for the 2D mobile chart, mirroring the desktop OverviewMap's
 * wiring so the same settings toggles drive the same 2D layers with NO 3D
 * scene mounted:
 *
 *   - habitat scores      — habitatStore (activeSpecies + computed scores)
 *   - EFH polygons        — embedded grid polygons preferred, else /efh fetch
 *                           (hasEfh datasets only), bbox-clipped + species-
 *                           visibility-filtered exactly like the desktop map
 *   - substrate polygons  — /substrate fetch, gated on substrateColorMode
 *   - intertidal          — band datums from useIntertidal + hotspot pins
 *                           gated on intertidalHotspotsEnabled
 *
 * The hook only returns plain data; drawing happens in MobileChartView's rAF
 * loop with the shared desktop renderers from overviewRenderer.ts.
 */
import { useMemo } from "react";
import {
  useGetDatasets,
  getGetDatasetsQueryKey,
  useGetEfh,
  getGetEfhQueryKey,
  useGetSubstrate,
  getGetSubstrateQueryKey,
  useGetIntertidalSpots,
  getGetIntertidalSpotsQueryKey,
  type EfhFeature,
  type SubstrateFeature,
} from "@workspace/api-client-react";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useHabitatStore } from "@/lib/habitatStore";
import { useIntertidal } from "@/lib/useIntertidal";
import { getVisibleEfhFeatures } from "@/lib/efhBboxFilter";
import {
  buildIntertidalHotspotDescriptors,
  type IntertidalHotspotPin,
} from "@/lib/overviewRenderer";
// MOBILE-ONLY Plan-tab data sources:
import { useDepthProfileStore } from "@/lib/depthProfileStore";
import { useDriftStore, type DriftWaypoint, type TrollWaypoint } from "@/lib/driftStore";

export interface MobileChartOverlays {
  /** Habitat score array for the active species, or null when inactive. */
  habitatScores: Float32Array | null;
  /** Active species id (for the legend pill label), or null. */
  habitatSpecies: string | null;
  /** True when the EFH overlay toggle is on. */
  efhEnabled: boolean;
  /** Bbox-clipped, visibility-filtered EFH features ([] when off/empty). */
  efhFeatures: EfhFeature[];
  /** Persisted native ShoreZone/AOOS habitat features ([] when off/empty). */
  savedHabitatFeatures: SubstrateFeature[];
  /** True when substrate colour mode is on. */
  substrateEnabled: boolean;
  substrateFeatures: SubstrateFeature[];
  hiddenSubstrateClasses: Set<string>;
  /** True when the intertidal hotspots toggle is on. */
  intertidalEnabled: boolean;
  intertidalPins: IntertidalHotspotPin[];
  /** Effective tidal datums (ft above MLLW) for the intertidal band. */
  mhwFt: number | null;
  mhhwFt: number | null;
  /** True when anything above will draw — drives the mobile legend pill. */
  anyActive: boolean;
  // ── MOBILE-ONLY: Plan-tab overlays ──────────────────────────────────────
  /** Ordered lon/lat waypoints of the currently loaded saved route, or null. */
  routeWaypoints: ReadonlyArray<{ lon: number; lat: number }> | null;
  /** True when the drift planner toggle is on. */
  driftPlannerActive: boolean;
  /** Forward drift prediction path (null when not yet computed). */
  driftPath: DriftWaypoint[] | null;
  /** Boat start position latitude (null when not placed). */
  driftStartLat: number | null;
  /** Boat start position longitude (null when not placed). */
  driftStartLon: number | null;
  /** Backwards drift path from the catch point (null when reverse mode is off). */
  reverseDriftPath: DriftWaypoint[] | null;
  /** User-placed trolling turn points (empty when none). */
  trollWaypoints: TrollWaypoint[];
}

export function useMobileChartOverlays(): MobileChartOverlays {
  const overviewGrid = useTerrainStore((s) => s.overviewGrid);
  const datasetId = useTerrainStore((s) => s.primaryDatasetId);
  const waterType = useSettingsStore((s) => s.waterType);

  // Same overlay flags the desktop OverviewMap reads.
  const efhOverlayEnabled = useUiStore((s) => s.efhOverlayEnabled);
  const hiddenEfhSpecies = useUiStore((s) => s.hiddenEfhSpecies);
  const substrateColorMode = useUiStore((s) => s.substrateColorMode);
  const hiddenSubstrateClasses = useUiStore((s) => s.hiddenSubstrateClasses);
  const intertidalHotspotsEnabled = useUiStore((s) => s.intertidalHotspotsEnabled);
  const intertidalScoreMode = useUiStore((s) => s.intertidalScoreMode);

  // Habitat — store-driven, no fetch (scores are computed client-side).
  const activeSpecies = useHabitatStore((s) => s.activeSpecies);
  const scores = useHabitatStore((s) => s.scores);
  const habitatScores = activeSpecies !== null && scores.status === "done" ? scores.data : null;

  // ── EFH ──────────────────────────────────────────────────────────────────
  // Embedded polygons (user-saved EFH datasets) are preferred; preset
  // datasets with the hasEfh flag fetch from /efh — same rule as desktop.
  const embeddedHabitatPolygons = overviewGrid?.habitatPolygons ?? null;
  const { data: datasets } = useGetDatasets(
    { waterType },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType }) } },
  );
  const hasEfh = !!(
    datasetId &&
    // Only preset dataset metadata carries hasEfh; user datasets embed their
    // polygons in overviewGrid.habitatPolygons instead (handled above).
    (datasets ?? []).find((d) => d.id === datasetId)?.hasEfh
  );
  const { data: efhData } = useGetEfh(
    { datasetId: datasetId ?? "" },
    {
      query: {
        // MOBILE-ONLY gating difference: also require the toggle, so phones
        // don't pay for EFH payloads the user never switched on.
        enabled: efhOverlayEnabled && hasEfh && !embeddedHabitatPolygons,
        staleTime: 60_000,
        queryKey: getGetEfhQueryKey({ datasetId: datasetId ?? "" }),
      },
    },
  );
  const { efhFeatures, savedHabitatFeatures } = useMemo(() => {
    if (!efhOverlayEnabled || !overviewGrid) {
      return { efhFeatures: [], savedHabitatFeatures: [] };
    }
    const raw = (embeddedHabitatPolygons?.features ?? efhData?.features ?? []) as Array<
      EfhFeature | SubstrateFeature
    >;
    const native = raw.filter(
      (feature) => {
        const properties = feature.properties as unknown as Record<string, unknown>;
        return !properties.species && !!properties.substrate;
      },
    ) as SubstrateFeature[];
    const efh = raw.filter(
      (feature) => {
        const properties = feature.properties as unknown as Record<string, unknown>;
        return !!properties.species && !!properties.commonName;
      },
    ) as EfhFeature[];
    return {
      efhFeatures: getVisibleEfhFeatures(
        efh,
        {
          minLon: overviewGrid.minLon,
          maxLon: overviewGrid.maxLon,
          minLat: overviewGrid.minLat,
          maxLat: overviewGrid.maxLat,
        },
        hiddenEfhSpecies,
      ),
      savedHabitatFeatures: native,
    };
  }, [efhOverlayEnabled, overviewGrid, embeddedHabitatPolygons, efhData, hiddenEfhSpecies]);

  // ── Substrate ────────────────────────────────────────────────────────────
  const { data: substrateCollection } = useGetSubstrate(datasetId ?? "", {
    query: {
      enabled: !!datasetId && substrateColorMode,
      staleTime: 60_000,
      queryKey: getGetSubstrateQueryKey(datasetId ?? ""),
    },
  });
  const substrateFeatures = useMemo<SubstrateFeature[]>(
    () => (substrateColorMode ? ((substrateCollection?.features ?? []) as SubstrateFeature[]) : []),
    [substrateColorMode, substrateCollection],
  );

  // ── Intertidal ───────────────────────────────────────────────────────────
  const { mhwFt, mhhwFt } = useIntertidal();
  const intertidalSpotsParams = { type: "both" as const, minScore: 10 };
  const { data: intertidalSpotsData } = useGetIntertidalSpots(
    datasetId ?? "",
    intertidalSpotsParams,
    {
      query: {
        enabled: !!datasetId && intertidalHotspotsEnabled,
        staleTime: 5 * 60 * 1000,
        queryKey: getGetIntertidalSpotsQueryKey(datasetId ?? "", intertidalSpotsParams),
      },
    },
  );
  const intertidalPins = useMemo<IntertidalHotspotPin[]>(() => {
    if (!intertidalHotspotsEnabled) return [];
    const features = intertidalSpotsData?.features ?? [];
    if (features.length === 0) return [];
    // Desktop renders interactive DOM pins; the mobile chart draws plain
    // canvas dots, so only the pin descriptors are needed here.
    return buildIntertidalHotspotDescriptors(features, intertidalScoreMode, "", "").pins;
  }, [intertidalHotspotsEnabled, intertidalSpotsData, intertidalScoreMode]);

  // ── MOBILE-ONLY: Plan-tab — active route waypoints ───────────────────────
  // Read from the depth profile store so any route loaded via RoutesPanel
  // is immediately visible on the 2D chart without an extra fetch.
  const routeWaypoints = useDepthProfileStore((s) => s.profile?.waypoints ?? null);

  // ── MOBILE-ONLY: Plan-tab — drift planner state ───────────────────────────
  const driftPlannerActive = useDriftStore((s) => s.driftPlannerActive);
  const driftPath = useDriftStore((s) => s.driftPath);
  const driftStartLat = useDriftStore((s) => s.driftStartLat);
  const driftStartLon = useDriftStore((s) => s.driftStartLon);
  const reverseDriftPath = useDriftStore((s) => s.reverseDriftPath);
  const trollWaypoints = useDriftStore((s) => s.driftWaypoints);

  const anyActive =
    habitatScores !== null ||
    (efhOverlayEnabled && efhFeatures.length > 0) ||
    (substrateColorMode && substrateFeatures.length > 0) ||
    intertidalHotspotsEnabled ||
    mhwFt !== null ||
    routeWaypoints !== null ||
    (driftPlannerActive && (driftPath !== null || driftStartLat !== null));

  return {
    habitatScores,
    habitatSpecies: activeSpecies,
    efhEnabled: efhOverlayEnabled,
    efhFeatures,
    savedHabitatFeatures,
    substrateEnabled: substrateColorMode,
    substrateFeatures,
    hiddenSubstrateClasses,
    intertidalEnabled: intertidalHotspotsEnabled,
    intertidalPins,
    mhwFt,
    mhhwFt,
    anyActive,
    routeWaypoints,
    driftPlannerActive,
    driftPath,
    driftStartLat,
    driftStartLon,
    reverseDriftPath,
    trollWaypoints,
  };
}
