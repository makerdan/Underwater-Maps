import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  useGetMarkers,
  getGetMarkersQueryKey,
  useGetTrails,
  getGetTrailsQueryKey,
  getTrailsIdPoints,
  useGetDatasets,
  getGetDatasetsQueryKey,
  usePostDatasetsBboxQuery,
  useGetDatasetsMySaves,
  getGetDatasetsMySavesQueryKey,
  usePostDatasetsCatalogIdSave,
} from "@workspace/api-client-react";
import type {
  Marker,
  GpsTrail,
  DatasetCatalogSearchResult,
} from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useTerrainStore } from "@/lib/terrainStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { useContextMenuStore, type ContextMenuItem } from "@/lib/contextMenuStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import {
  buildHeatmapBitmap,
  buildContourLines,
  computeInitialTransform,
  clampTransform,
  canvasToLonLat,
  lonLatToCanvas,
  renderHeatmap,
  renderContourLines,
  renderGridLines,
  renderMarkers,
  renderDepthPoles,
  renderCameraArrow,
  renderScaleBar,
  renderColormapLegend,
  renderHabitatOverlay,
  renderEfhOverlay,
  renderEfhLegend,
  hitTestEfh,
  hitTestEfhLegend,
  renderSubstrateOverlay,
  renderSubstrateLegend,
  hitTestSubstrate,
  hitTestSubstrateLegend,
  renderGpsPosition,
  renderLiveTrail,
  renderSavedTrails,
  drawSelectionRect,
  renderWeatherStations,
  renderRawsStations,
} from "@/lib/overviewRenderer";
import type { OverviewTransform, CanvasSavedTrail, EfhLegendLayout, ContourSegment, WeatherStationPin, RawsStationPin } from "@/lib/overviewRenderer";
import { useWeatherStations } from "@/hooks/useWeatherStations";
import type { WeatherStation } from "@workspace/api-client-react";
import { WeatherStationPopover } from "@/components/WeatherStationLayer";
import { useRawsStations } from "@/hooks/useRawsStations";
import type { RawsStationItem } from "@/hooks/useRawsStations";
import { RawsStationPopover } from "@/components/RawsStationLayer";
import {
  useGetEfh,
  getGetEfhQueryKey,
  useGetSubstrate,
  getGetSubstrateQueryKey,
} from "@workspace/api-client-react";
import type {
  EfhFeature,
  SubstrateFeature,
  SubstrateFeatureCollection,
} from "@workspace/api-client-react";
import { useHabitatStore } from "@/lib/habitatStore";
import { filterEfhByBbox, getVisibleEfhFeatures } from "@/lib/efhBboxFilter";
import { HabitatLegend } from "@/components/HabitatLegend";
import { useGpsStore } from "@/lib/gpsStore";
import { useTrailStore } from "@/lib/trailStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { formatDepth, formatDistance } from "@/lib/units";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useUndoableTrailDelete } from "@/hooks/useUndoableTrailDelete";
import { TerrainDownloadPopover } from "@/components/TerrainDownloadPopover";
import { useUpscaledHeatmap } from "@/hooks/useUpscaledHeatmap";
import { useSatelliteTileStore } from "@/lib/satelliteTileStore";
import { useSatelliteTile } from "@/hooks/useSatelliteTile";

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  lon: number;
  lat: number;
  depth: number;
}

export const OverviewMap: React.FC = () => {
  const setOverviewOpen = useUiStore((s) => s.setOverviewOpen);
  const setPendingDropIn = useUiStore((s) => s.setPendingDropIn);
  const gpsActive = useGpsStore((s) => s.active);
  const gpsPosition = useGpsStore((s) => s.position);
  const gpsError = useGpsStore((s) => s.error);
  const startWatching = useGpsStore((s) => s.startWatching);
  const overviewGrid = useTerrainStore((s) => s.overviewGrid);
  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);
  // Refs so the rAF render + DOM event handlers always read the latest store
  // state without forcing the effects to re-run on every store update.
  const visibleDatasetsRef = useRef(visibleDatasets);
  const primaryDatasetIdRef = useRef(primaryDatasetId);
  useEffect(() => {
    visibleDatasetsRef.current = visibleDatasets;
  }, [visibleDatasets]);
  useEffect(() => {
    primaryDatasetIdRef.current = primaryDatasetId;
  }, [primaryDatasetId]);
  const unitsForUi = useSettingsStore((s) => s.units);
  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const contoursEnabled = useSettingsStore((s) => s.contoursEnabled);
  const contourInterval = useSettingsStore((s) => s.contourInterval);
  const satelliteImagery = useSettingsStore((s) => s.satelliteImagery);

  // Derive the satellite-fetch bbox from overviewGrid so the tile is fetched
  // whenever a valid terrain bbox is available — even when the 3D scene isn't
  // mounted. Pass null when the setting is off to skip the network request.
  const satelliteBbox = useMemo(() => {
    if (!satelliteImagery || !overviewGrid) return null;
    return {
      minLon: overviewGrid.minLon,
      maxLon: overviewGrid.maxLon,
      minLat: overviewGrid.minLat,
      maxLat: overviewGrid.maxLat,
    };
  }, [satelliteImagery, overviewGrid]);
  useSatelliteTile(satelliteBbox);

  const datasetId = overviewGrid?.datasetId ?? "";
  const { data: markerData } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  const { data: trailsData, refetch: refetchTrails } = useGetTrails(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetTrailsQueryKey({ datasetId }) } },
  );

  const handleDeleteTrail = useUndoableTrailDelete(datasetId, refetchTrails);

  // EFH availability is now derived from dataset metadata (hasEfh flag from
  // /api/datasets), so this list does not need to be hardcoded here.

  // --- Panel state ---
  const [showTrailList, setShowTrailList] = useState(false);
  const showEfh = useUiStore((s) => s.efhOverlayEnabled);
  const setShowEfh = useUiStore((s) => s.setEfhOverlayEnabled);
  const showEfhRef = useRef(false);

  // --- Canvas ref ---
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Stable refs (no React state — updated imperatively in event handlers / rAF) ---
  const bitmapRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef<OverviewTransform | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const savedTrailsRef = useRef<CanvasSavedTrail[]>([]);
  const rafRef = useRef<number>(0);
  const efhFeaturesRef = useRef<EfhFeature[]>([]);
  /** Pre-built contour segments, rebuilt when grid or interval changes. */
  const contourSegmentsRef = useRef<ContourSegment[]>([]);
  const contoursEnabledRef = useRef(contoursEnabled);
  useEffect(() => { contoursEnabledRef.current = contoursEnabled; }, [contoursEnabled]);
  const substrateFeaturesRef = useRef<SubstrateFeature[]>([]);
  const substrateColorModeRef = useRef(false);
  const selectedSubstrateUnitIdRef = useRef<string | null>(null);
  const hiddenSubstrateClassesRef = useRef<ReadonlySet<string>>(new Set());
  const substrateLegendLayoutRef = useRef<ReturnType<typeof renderSubstrateLegend>>(null);
  const hiddenEfhSpeciesRef = useRef<ReadonlySet<string>>(new Set());
  const efhLegendLayoutRef = useRef<EfhLegendLayout | null>(null);

  // Weather station refs (read in rAF loop without React re-render)
  const weatherStationPinsRef = useRef<WeatherStationPin[]>([]);
  const weatherStationActiveRef = useRef(false);
  const weatherStationSelectedIdRef = useRef<string | null>(null);
  // Canvas-space positions of rendered pins (updated each rAF frame for hit-test)
  const weatherStationCanvasPositionsRef = useRef<Array<{ id: string; cx: number; cy: number }>>([]);
  // Full station objects keyed by id for the popover
  const weatherStationDataRef = useRef<Map<string, WeatherStation>>(new Map());

  // RAWS station refs (read in rAF loop without React re-render)
  const rawsPinsRef = useRef<RawsStationPin[]>([]);
  const rawsActiveRef = useRef(false);
  const rawsSelectedIdRef = useRef<string | null>(null);
  const rawsCanvasPositionsRef = useRef<Array<{ datasetId: string; cx: number; cy: number }>>([]);
  const rawsDataRef = useRef<Map<string, RawsStationItem>>(new Map());

  // Upscale hook — auto-enhances the heatmap via Topaz Labs on Poe when the
  // rendered grid is coarser than the canvas resolution warrants.
  const {
    isUpscaling,
    upscaledBitmap,
    requestUpscaleIfNeeded,
    invalidate: invalidateUpscale,
  } = useUpscaledHeatmap();
  const upscaledBitmapRef = useRef<HTMLImageElement | null>(null);
  const isUpscalingRef = useRef(false);
  const requestUpscaleIfNeededRef = useRef(requestUpscaleIfNeeded);
  const invalidateUpscaleRef = useRef(invalidateUpscale);
  useEffect(() => { upscaledBitmapRef.current = upscaledBitmap; }, [upscaledBitmap]);
  useEffect(() => { isUpscalingRef.current = isUpscaling; }, [isUpscaling]);
  useEffect(() => { requestUpscaleIfNeededRef.current = requestUpscaleIfNeeded; }, [requestUpscaleIfNeeded]);
  useEffect(() => { invalidateUpscaleRef.current = invalidateUpscale; }, [invalidateUpscale]);

  // Satellite imagery — read from the shared store (already populated by the
  // 3D LandTerrainMesh via useSatelliteTile). Load into an HTMLImageElement so
  // the rAF loop can drawImage it as a background layer.
  const satelliteTileUrl = useSatelliteTileStore((s) => s.tileUrl);
  const satelliteImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!satelliteTileUrl) {
      satelliteImgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => { satelliteImgRef.current = img; };
    img.onerror = () => { satelliteImgRef.current = null; };
    img.src = satelliteTileUrl;
  }, [satelliteTileUrl]);

  // Drag tracking
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // Mouse position (canvas-relative, −1 means outside)
  const mousePosRef = useRef({ x: -1, y: -1 });

  // --- React state: tooltip only ---
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, x: 0, y: 0, lon: 0, lat: 0, depth: 0,
  });

  // EFH detail panel state lives in uiStore so the 3D EfhZoneLayer click
  // handler can open the same panel without prop-drilling. The click
  // handler reads the setter via getState() inline (same pattern as
  // setPendingDropIn below) so the mouse-events effect doesn't need to
  // re-register when the setter identity changes.

  // --- Box-select tool state ------------------------------------------------
  // `selectMode` is the toolbar toggle. When true, the canvas mouse handlers
  // switch from pan/drop-in into rectangle-drawing mode. Refs mirror state
  // for use inside the imperative mouse handlers (which only run when the
  // owning effect is re-registered).
  const [selectMode, setSelectMode] = useState(false);
  const selectModeRef = useRef(false);
  useEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);

  // Weather station selected-pin React state (drives popover)
  const [selectedWeatherStation, setSelectedWeatherStation] = useState<WeatherStation | null>(null);
  const [selectedWeatherStationPos, setSelectedWeatherStationPos] = useState<{ cx: number; cy: number } | null>(null);

  // --- Download tool state --------------------------------------------------
  // `downloadMode` is mutually exclusive with `selectMode`. When active, the
  // rubber-band rectangle commits to a download bbox that triggers the
  // TerrainDownloadPopover instead of the catalog search panel.
  const [downloadMode, setDownloadMode] = useState(false);
  const downloadModeRef = useRef(false);
  useEffect(() => { downloadModeRef.current = downloadMode; }, [downloadMode]);

  // Committed download bbox (lon/lat). React state → popover re-renders.
  const [downloadBbox, setDownloadBbox] = useState<
    | { north: number; south: number; east: number; west: number }
    | null
  >(null);
  const downloadBboxRef = useRef<typeof downloadBbox>(null);
  useEffect(() => { downloadBboxRef.current = downloadBbox; }, [downloadBbox]);

  // In-progress drag rectangle (canvas pixels). `null` when no drag.
  const dragRectRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // Committed bbox (lon/lat) — drives the result panel. React state so the
  // panel re-renders when the user releases the mouse.
  const [selectedBbox, setSelectedBbox] = useState<
    | { north: number; south: number; east: number; west: number }
    | null
  >(null);
  // Mirror committed bbox into a ref so the rAF loop can paint the persistent
  // rectangle without re-registering on every state change.
  const selectedBboxRef = useRef<typeof selectedBbox>(null);
  useEffect(() => { selectedBboxRef.current = selectedBbox; }, [selectedBbox]);

  // --- Box-query hook + Load/Save plumbing (reuses FindDataPanel pattern) ---
  const bboxQuery = usePostDatasetsBboxQuery();
  const [bboxResults, setBboxResults] = useState<DatasetCatalogSearchResult[] | null>(null);
  const [bboxError, setBboxError] = useState<string | null>(null);
  const { setDatasetId } = useAppState();
  const saveMutation = usePostDatasetsCatalogIdSave();
  const { data: mySaves = [], refetch: refetchMySaves } = useGetDatasetsMySaves({
    query: { queryKey: getGetDatasetsMySavesQueryKey() },
  });
  const savedCatalogIds = React.useMemo(
    () => new Set(mySaves.map((s) => s.catalogId)),
    [mySaves],
  );
  const [bboxSavingIds, setBboxSavingIds] = useState<Set<string>>(new Set());

  const handleBboxLoad = useCallback(
    (_entry: DatasetCatalogSearchResult) => {
      // Preset datasets are retired (Task #403). Non-preset (user-saved or
      // external) entries don't have a runtime grid here, so this is a
      // no-op — the Find Data flow handles them.
      void _entry;
      void setDatasetId;
    },
    [setDatasetId],
  );

  const handleBboxSave = useCallback(
    async (id: string) => {
      setBboxSavingIds((s) => new Set(s).add(id));
      try {
        await saveMutation.mutateAsync({ id });
        await refetchMySaves();
      } catch (err) {
        void err;
      } finally {
        setBboxSavingIds((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }
    },
    [saveMutation, refetchMySaves],
  );

  const requestBbox = useCallback(async () => {
    if (!selectedBbox) return;
    setBboxError(null);
    try {
      const res = await bboxQuery.mutateAsync({ data: selectedBbox });
      setBboxResults(res.datasets);
    } catch (err) {
      const e = err as { details?: string; message?: string };
      setBboxError(e?.details ?? e?.message ?? "Request failed");
      setBboxResults(null);
    }
  }, [bboxQuery, selectedBbox]);

  const clearBbox = useCallback(() => {
    setSelectedBbox(null);
    setBboxResults(null);
    setBboxError(null);
  }, []);

  // Escape behavior (capture-phase so we win against the global App handler):
  //   1. Mid-drag (drawing a rectangle): cancel the in-progress drag only.
  //   2. Completed download box: clear it.
  //   3. Completed select box (or panel showing results): clear the box + panel.
  //   4. Otherwise: do nothing — let App.tsx's global Escape close the
  //      Overview Map as usual. We do NOT consume Escape just because
  //      select-mode is toggled on, so the map can still be closed with one
  //      key press from a "no box drawn yet" state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dragRectRef.current && !selectedBbox && !bboxResults && !downloadBbox) {
        e.stopPropagation();
        dragRectRef.current = null;
        return;
      }
      if (downloadBbox) {
        e.stopPropagation();
        dragRectRef.current = null;
        setDownloadBbox(null);
        return;
      }
      if (selectedBbox || bboxResults) {
        e.stopPropagation();
        dragRectRef.current = null;
        clearBbox();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selectedBbox, bboxResults, downloadBbox, clearBbox]);

  // GPS & trail state (read directly from stores in rAF — no React re-render)
  const pulseRef = useRef(0);

  // Keep markers ref in sync without causing rAF re-registration
  useEffect(() => {
    markersRef.current = markerData ?? [];
  }, [markerData]);

  // EFH data — either embedded in the overview grid (for user-saved noaa-efh-*
  // datasets) or fetched from /efh (for preset datasets with the hasEfh flag).
  const embeddedEfhPolygons = overviewGrid?.habitatPolygons ?? null;
  const waterTypeForDatasets = useSettingsStore((s) => s.waterType);
  const { data: allDatasets } = useGetDatasets(
    { waterType: waterTypeForDatasets },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType: waterTypeForDatasets }) } },
  );
  const hasEfh = !!allDatasets?.find((d) => d.id === datasetId)?.hasEfh;
  // Only hit /efh for preset datasets — user-saved EFH datasets have polygons
  // already embedded in overviewGrid.habitatPolygons.
  const { data: efhData } = useGetEfh(
    { datasetId },
    { query: { enabled: hasEfh && !embeddedEfhPolygons, staleTime: 60_000, queryKey: getGetEfhQueryKey({ datasetId }) } },
  );
  // Prefer embedded polygons (user-saved datasets) over the fetched preset data.
  // Apply the same bathymetric-bbox clip that EfhZoneLayer uses in 3D so both
  // views show identical polygon sets.
  const activeEfhFeatures = useMemo(() => {
    const raw = embeddedEfhPolygons?.features ?? efhData?.features ?? [];
    if (!overviewGrid) return raw;
    return filterEfhByBbox(raw, {
      minLon: overviewGrid.minLon,
      maxLon: overviewGrid.maxLon,
      minLat: overviewGrid.minLat,
      maxLat: overviewGrid.maxLat,
    });
  }, [embeddedEfhPolygons, efhData, overviewGrid]);
  useEffect(() => {
    efhFeaturesRef.current = activeEfhFeatures;
  }, [activeEfhFeatures]);

  // Keep showEfhRef in sync so the rAF loop can read it without a dep-array entry
  useEffect(() => {
    showEfhRef.current = showEfh;
  }, [showEfh]);

  // Substrate overlay — gated on the shared `substrateColorMode` toggle from
  // uiStore (also drives the 3D SubstrateLayer). When enabled, we fetch the
  // same /substrate/:id endpoint and render the polygons + legend on the 2D
  // canvas, mirroring the 3D scene.
  const substrateColorMode = useUiStore((s) => s.substrateColorMode);
  const selectedSubstrateUnitId = useUiStore(
    (s) => s.selectedSubstrate?.unitId ?? null,
  );
  useEffect(() => {
    substrateColorModeRef.current = substrateColorMode;
  }, [substrateColorMode]);
  useEffect(() => {
    selectedSubstrateUnitIdRef.current = selectedSubstrateUnitId;
  }, [selectedSubstrateUnitId]);
  const hiddenSubstrateClasses = useUiStore((s) => s.hiddenSubstrateClasses);
  useEffect(() => {
    hiddenSubstrateClassesRef.current = hiddenSubstrateClasses;
  }, [hiddenSubstrateClasses]);
  const hiddenEfhSpecies = useUiStore((s) => s.hiddenEfhSpecies);
  useEffect(() => {
    hiddenEfhSpeciesRef.current = hiddenEfhSpecies;
  }, [hiddenEfhSpecies]);

  // Weather stations overlay — query always runs when terrain loaded so FAA button works
  const weatherStationsActive = useUiStore((s) => s.weatherStationsActive);
  const {
    stations: weatherStations,
    faaWeatherCamsUrl,
  } = useWeatherStations();
  useEffect(() => {
    weatherStationActiveRef.current = weatherStationsActive;
    if (!weatherStationsActive) {
      weatherStationPinsRef.current = [];
      weatherStationDataRef.current = new Map();
      // Clear popover when the overlay is toggled off
      weatherStationSelectedIdRef.current = null;
      setSelectedWeatherStation(null);
      setSelectedWeatherStationPos(null);
    }
  }, [weatherStationsActive]);
  useEffect(() => {
    if (!weatherStationsActive) return;
    weatherStationPinsRef.current = weatherStations.map((s) => ({
      id: s.id, lat: s.lat, lon: s.lon,
    }));
    const m = new Map<string, WeatherStation>();
    for (const s of weatherStations) m.set(s.id, s);
    weatherStationDataRef.current = m;
  }, [weatherStations, weatherStationsActive]);

  // RAWS overlay — fetch all nearby stations when overlay is enabled
  const rawsOverlayActive = useUiStore((s) => s.rawsOverlayActive);
  const { stations: rawsStations } = useRawsStations();
  // Selected RAWS pin React state (drives popover)
  const [selectedRawsDatasetId, setSelectedRawsDatasetId] = useState<string | null>(null);
  const [selectedRawsPos, setSelectedRawsPos] = useState<{ cx: number; cy: number } | null>(null);
  useEffect(() => {
    rawsActiveRef.current = rawsOverlayActive;
    if (!rawsOverlayActive) {
      rawsPinsRef.current = [];
      rawsDataRef.current = new Map();
      rawsSelectedIdRef.current = null;
      setSelectedRawsDatasetId(null);
      setSelectedRawsPos(null);
    }
  }, [rawsOverlayActive]);
  useEffect(() => {
    if (!rawsOverlayActive) return;
    rawsPinsRef.current = rawsStations.map((s) => ({
      datasetId: s.datasetId, lat: s.lat, lon: s.lon,
    }));
    const m = new Map<string, RawsStationItem>();
    for (const s of rawsStations) m.set(s.datasetId, s);
    rawsDataRef.current = m;
  }, [rawsStations, rawsOverlayActive]);

  const { data: substrateCollection } = useGetSubstrate(datasetId, {
    query: {
      enabled: !!datasetId && substrateColorMode,
      queryKey: getGetSubstrateQueryKey(datasetId),
      staleTime: 5 * 60 * 1000,
    },
  });
  const substrateMeta = (substrateCollection as SubstrateFeatureCollection | undefined)
    ?.metadata as { sourceName?: string; creditUrl?: string } | undefined;
  const substrateSourceName =
    substrateMeta?.sourceName ?? "Alaska ShoreZone (NOAA AKR / ADF&G)";
  const substrateCreditUrl =
    substrateMeta?.creditUrl ?? "https://alaskafisheries.noaa.gov/shorezone/";
  useEffect(() => {
    substrateFeaturesRef.current = substrateCollection?.features ?? [];
  }, [substrateCollection]);

  // Fetch trail points when trails list changes; update savedTrailsRef for rAF
  useEffect(() => {
    if (!trailsData || trailsData.length === 0) {
      savedTrailsRef.current = [];
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const fetchAll = async () => {
      const results: CanvasSavedTrail[] = [];
      await Promise.all(
        trailsData.map(async (trail) => {
          try {
            // Paginate through all points (up to 1000 per trail for map rendering)
            const PAGE_SIZE = 500;
            const MAX_PAGES = 2; // cap at 1000 points for overview rendering
            const allPoints: { lon: number; lat: number }[] = [];
            let currentPage = 1;
            let hasMore = true;

            while (hasMore && currentPage <= MAX_PAGES && !cancelled && !controller.signal.aborted) {
              const page = await getTrailsIdPoints(
                trail.id,
                { page: currentPage, pageSize: PAGE_SIZE },
                { signal: controller.signal },
              );
              allPoints.push(...page.points.map((p) => ({ lon: p.lon, lat: p.lat })));
              hasMore = currentPage * PAGE_SIZE < page.total;
              currentPage++;
            }

            if (!cancelled && !controller.signal.aborted) {
              results.push({
                id: trail.id,
                colour: trail.colour,
                points: allPoints,
              });
            }
          } catch (err) {
            if (controller.signal.aborted) return;
            // skip trail if points fetch fails
            void err;
          }
        }),
      );
      if (!cancelled && !controller.signal.aborted) {
        savedTrailsRef.current = results;
      }
    };

    void fetchAll();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [trailsData]);

  // Rebuild contour segments whenever the grid, contour interval, or units change.
  useEffect(() => {
    if (!overviewGrid || !contoursEnabled) {
      contourSegmentsRef.current = [];
      return;
    }
    // Convert contour interval from user units to metres (grid depths are in metres).
    //   metric   → pass through (interval is already metres)
    //   imperial → feet ÷ 3.28084 = metres
    //   nautical → fathoms × 1.8288 = metres  (1 fathom = 6 ft = 1.8288 m)
    const intervalMetres =
      unitsForUi === "metric"   ? contourInterval :
      unitsForUi === "nautical" ? contourInterval * 1.8288 :
                                  contourInterval / 3.28084;
    contourSegmentsRef.current = buildContourLines(overviewGrid, intervalMetres);
  }, [overviewGrid, contourInterval, contoursEnabled, unitsForUi]);

  // Build offscreen bitmap whenever overviewGrid, palette, or colormap theme changes.
  // Also invalidates any cached upscaled bitmap so the new data re-triggers
  // Topaz upscaling on the next render pass.
  const paletteShallow = usePaletteStore((s) => s.shallow);
  const paletteDeep = usePaletteStore((s) => s.deep);
  const paletteBandColors = usePaletteStore((s) => s.bandColors);
  const paletteCustomStops = usePaletteStore((s) => s.customStops);
  const paletteBandBoundaries = usePaletteStore((s) => s.bandBoundaries);
  useEffect(() => {
    if (!overviewGrid) return;
    bitmapRef.current = buildHeatmapBitmap(overviewGrid, colormapTheme);
    invalidateUpscaleRef.current();
  }, [overviewGrid, colormapTheme, paletteShallow, paletteDeep, paletteBandColors, paletteCustomStops, paletteBandBoundaries]);

  // Compute initial transform whenever the grid or canvas is ready
  const initTransform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !overviewGrid) return;
    transformRef.current = computeInitialTransform(overviewGrid, canvas.width, canvas.height);
  }, [overviewGrid]);

  useEffect(() => {
    initTransform();
  }, [initTransform]);

  // ---------------------------------------------------------------------------
  // rAF render loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Track the last view key to detect pan/zoom changes and invalidate the
    // cached upscaled bitmap so a stale enhanced image is never shown after
    // the user moves the map.
    let lastViewKey: string | null = null;

    const loop = () => {
      const ctx = canvas.getContext("2d");
      const grid = overviewGrid;
      const bitmap = bitmapRef.current;
      const t = transformRef.current;

      if (!ctx || !grid || !bitmap || !t) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const cW = canvas.width;
      const cH = canvas.height;

      // Detect view changes and invalidate stale upscaled bitmap
      const viewKey = `${t.scale.toFixed(2)}_${t.offsetX.toFixed(0)}_${t.offsetY.toFixed(0)}`;
      if (viewKey !== lastViewKey) {
        if (lastViewKey !== null) {
          invalidateUpscaleRef.current();
        }
        lastViewKey = viewKey;
      }

      // Background
      ctx.fillStyle = "#020818";
      ctx.fillRect(0, 0, cW, cH);

      // Satellite imagery background — draw behind the heatmap so real-world
      // landmarks are visible. Same bounding-box extent as the terrain grid.
      const satImg = satelliteImgRef.current;
      if (satImg) {
        const lonRange = grid.maxLon - grid.minLon || 1;
        const latRange = grid.maxLat - grid.minLat || 1;
        const terrainW = t.pxPerDeg * lonRange * t.scale;
        const terrainH = t.pxPerDeg * latRange * t.scale;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(satImg, t.offsetX, t.offsetY, terrainW, terrainH);
      }

      // Depth heatmap — draw the Topaz-upscaled bitmap when available,
      // otherwise fall back to the raw offscreen bitmap. When satellite
      // imagery is showing, render the heatmap semi-transparently so the
      // satellite context remains visible.
      const heatmapAlpha = satImg ? 0.65 : 1.0;
      ctx.globalAlpha = heatmapAlpha;
      const upscaled = upscaledBitmapRef.current;
      if (upscaled) {
        const lonRange = grid.maxLon - grid.minLon || 1;
        const latRange = grid.maxLat - grid.minLat || 1;
        const terrainW = t.pxPerDeg * lonRange * t.scale;
        const terrainH = t.pxPerDeg * latRange * t.scale;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(upscaled, t.offsetX, t.offsetY, terrainW, terrainH);
        ctx.imageSmoothingEnabled = true;
      } else {
        renderHeatmap(ctx, bitmap, grid, t);
      }
      ctx.globalAlpha = 1.0;

      // Contour lines — drawn over the heatmap, under the geographic grid and markers.
      const { overviewShowGrid, overviewShowMarkers, units, colormapTheme: activeTheme } = useSettingsStore.getState();
      if (contoursEnabledRef.current && contourSegmentsRef.current.length > 0) {
        renderContourLines(ctx, contourSegmentsRef.current, grid, t, units, activeTheme);
      }

      // Lat/lon grid (gated by user setting; renderGridLines also checks scale ≥ 2 internally)
      if (overviewShowGrid) {
        renderGridLines(ctx, grid, t, cW, cH);
      }

      // Saved trails (completed)
      if (savedTrailsRef.current.length > 0) {
        renderSavedTrails(ctx, savedTrailsRef.current, grid, t);
      }

      // Markers (gated by user setting)
      if (overviewShowMarkers) {
        renderMarkers(ctx, markersRef.current, grid, t, cW, cH);

        // Depth poles (drawn above markers so labels are visible)
        renderDepthPoles(ctx, markersRef.current, grid, t, units);
      }

      // Camera arrow — read from Zustand store directly (no React re-render)
      const cam = useCameraStore.getState();
      if (cam.cameraLon !== null && cam.cameraLat !== null) {
        renderCameraArrow(ctx, cam.cameraLon, cam.cameraLat, cam.heading, grid, t);
      }

      // Habitat overlay (drawn above depth heatmap, below markers)
      const habitatScores = useHabitatStore.getState().scores;
      const habitatActive = useHabitatStore.getState().activeSpecies !== null;
      if (habitatActive && habitatScores) {
        renderHabitatOverlay(ctx, habitatScores, grid, t);
      }

      // EFH overlay (dashed species polygon outlines + legend)
      if (showEfhRef.current && efhFeaturesRef.current.length > 0) {
        const visibleEfhFeatures = getVisibleEfhFeatures(
          efhFeaturesRef.current,
          { minLon: grid.minLon, maxLon: grid.maxLon, minLat: grid.minLat, maxLat: grid.maxLat },
          hiddenEfhSpeciesRef.current,
        );
        renderEfhOverlay(ctx, visibleEfhFeatures, grid, t);
        efhLegendLayoutRef.current = renderEfhLegend(ctx, efhFeaturesRef.current, cW, cH, hiddenEfhSpeciesRef.current);
      } else {
        efhLegendLayoutRef.current = null;
      }

      // Substrate overlay (CMECS-coloured polygons + legend) — mirrors the
      // 3D SubstrateLayer so anglers can see the gravel / sand / mud zones
      // when planning from the top-down view.
      if (substrateColorModeRef.current && substrateFeaturesRef.current.length > 0) {
        renderSubstrateOverlay(
          ctx,
          substrateFeaturesRef.current,
          grid,
          t,
          selectedSubstrateUnitIdRef.current,
          hiddenSubstrateClassesRef.current,
        );
        substrateLegendLayoutRef.current = renderSubstrateLegend(
          ctx,
          substrateFeaturesRef.current,
          cH,
          hiddenSubstrateClassesRef.current,
        );
      } else {
        substrateLegendLayoutRef.current = null;
      }

      // GPS position + live trail
      const gps = useGpsStore.getState();
      const trail = useTrailStore.getState();
      pulseRef.current = (pulseRef.current + 0.02) % 1;
      const pulse = Math.abs(Math.sin(pulseRef.current * Math.PI));

      if (trail.recording && trail.currentPoints.length > 0) {
        renderLiveTrail(ctx, trail.currentPoints, grid, t, pulse);
      }

      if (gps.active && gps.position) {
        renderGpsPosition(
          ctx,
          gps.position.longitude,
          gps.position.latitude,
          gps.position.accuracy,
          grid,
          t,
          cW,
          cH,
          pulse,
          units,
        );
      }

      // Non-primary dataset footprints (Task #350) — drawn above heatmap
      // but below markers/scale-bar, projected through the *primary* grid's
      // coordinate frame so all footprints share one canvas.
      const visibleNow = visibleDatasetsRef.current;
      const primIdNow = primaryDatasetIdRef.current;
      if (visibleNow.length > 1 && primIdNow) {
        for (const v of visibleNow) {
          if (v.datasetId === primIdNow) continue;
          const og = v.overviewGrid;
          if (!og) continue;
          const corners: Array<[number, number]> = [
            [og.minLon, og.minLat],
            [og.maxLon, og.minLat],
            [og.maxLon, og.maxLat],
            [og.minLon, og.maxLat],
          ];
          ctx.save();
          ctx.beginPath();
          corners.forEach(([lon, lat], i) => {
            const [px, py] = lonLatToCanvas(lon, lat, grid, t);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.fillStyle = "rgba(0,229,255,0.06)";
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = "rgba(0,229,255,0.55)";
          ctx.stroke();
          ctx.setLineDash([]);
          // Tiny label at the top-left corner so users can identify each
          // footprint and know clicking it promotes-to-primary.
          const [lx, ly] = lonLatToCanvas(og.minLon, og.maxLat, grid, t);
          ctx.fillStyle = "rgba(0,229,255,0.85)";
          ctx.font = "10px monospace";
          ctx.fillText(`◎ ${og.datasetId}`, lx + 4, ly + 12);
          ctx.restore();
        }
      }

      // Scale bar
      renderScaleBar(ctx, grid, t, cH, units);

      // Colormap legend — top-right gradient strip with depth labels so users
      // can read off what the 2D colours mean, matching the 3D HUD scale bar.
      renderColormapLegend(ctx, activeTheme, grid.minDepth, grid.maxDepth, cW, cH, units);

      // Box-select / Download overlay (in-progress drag + committed bbox).
      // Painted on top of every other layer so the user can always see it.
      const drag = dragRectRef.current;

      /** Convert a committed lon/lat bbox to canvas pixel corners */
      const bboxToCanvasCorners = (north: number, south: number, east: number, west: number) => {
        const lonRange = grid.maxLon - grid.minLon || 1;
        const latRange = grid.maxLat - grid.minLat || 1;
        const terrainW = t.pxPerDeg * lonRange * t.scale;
        const terrainH = t.pxPerDeg * latRange * t.scale;
        const x0 = t.offsetX + ((west - grid.minLon) / lonRange) * terrainW;
        const y0 = t.offsetY + ((north - grid.minLat) / latRange) * terrainH;
        const x1 = t.offsetX + ((east - grid.minLon) / lonRange) * terrainW;
        const y1 = t.offsetY + ((south - grid.minLat) / latRange) * terrainH;
        return { x0, y0, x1, y1 };
      };

      if (drag) {
        const dl = canvasToLonLat(drag.x0, drag.y0, grid, t);
        const dr = canvasToLonLat(drag.x1, drag.y1, grid, t);
        const isDownload = downloadModeRef.current;
        drawSelectionRect(ctx, drag.x0, drag.y0, drag.x1, drag.y1, {
          width: Math.abs(dr.lon - dl.lon),
          height: Math.abs(dr.lat - dl.lat),
          ...(isDownload ? { strokeColor: "rgba(251,191,36,0.85)", fillColor: "rgba(251,191,36,0.06)" } : {}),
        });
      } else if (selectedBboxRef.current) {
        const { north, south, east, west } = selectedBboxRef.current;
        const { x0, y0, x1, y1 } = bboxToCanvasCorners(north, south, east, west);
        drawSelectionRect(ctx, x0, y0, x1, y1, {
          width: east - west,
          height: north - south,
        });
      } else if (downloadBboxRef.current) {
        const { north, south, east, west } = downloadBboxRef.current;
        const { x0, y0, x1, y1 } = bboxToCanvasCorners(north, south, east, west);
        drawSelectionRect(ctx, x0, y0, x1, y1, {
          width: east - west,
          height: north - south,
          strokeColor: "rgba(251,191,36,0.85)",
          fillColor: "rgba(251,191,36,0.06)",
        });
      }

      // Subtle border
      ctx.strokeStyle = "rgba(0,229,255,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, cW - 1, cH - 1);

      // RAWS station pins — AOOS RAWS land-weather stations (drawn above most layers)
      if (rawsActiveRef.current && rawsPinsRef.current.length > 0) {
        rawsCanvasPositionsRef.current = renderRawsStations(
          ctx,
          rawsPinsRef.current,
          grid,
          t,
          rawsSelectedIdRef.current,
        );
      } else {
        rawsCanvasPositionsRef.current = [];
      }

      // Weather station pins — NOAA ASOS/AWOS stations (drawn above all other layers)
      if (weatherStationActiveRef.current && weatherStationPinsRef.current.length > 0) {
        weatherStationCanvasPositionsRef.current = renderWeatherStations(
          ctx,
          weatherStationPinsRef.current,
          grid,
          t,
          weatherStationSelectedIdRef.current,
        );
      } else {
        weatherStationCanvasPositionsRef.current = [];
      }

      // "Enhancing…" indicator — shown while a Topaz upscale request is in
      // flight. Drawn last so it sits on top of all other layers.
      if (isUpscalingRef.current) {
        ctx.save();
        ctx.font = "9px 'JetBrains Mono', monospace";
        const label = "✦ ENHANCING…";
        const lw = ctx.measureText(label).width;
        const lx = cW - lw - 10;
        const ly = cH - 42;
        ctx.fillStyle = "rgba(2,8,24,0.65)";
        ctx.fillRect(lx - 5, ly - 10, lw + 10, 16);
        ctx.fillStyle = "#00e5ff";
        ctx.textBaseline = "top";
        ctx.fillText(label, lx, ly - 9);
        ctx.restore();
      }

      // Fire-and-forget upscale request. The hook's internal debounce (view-key
      // + in-flight guard) prevents duplicate network calls on every rAF tick.
      // We pass the offscreen heatmap bitmap (native grid resolution) so only
      // the depth data is sent to Topaz — not the overlays drawn above it.
      void requestUpscaleIfNeededRef.current(bitmap, t, grid);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [overviewGrid]);

  // ---------------------------------------------------------------------------
  // Mouse / wheel events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Select-area / Download tool: capture rectangle start in canvas coords
      // and suppress pan; left-button only.
      if ((selectModeRef.current || downloadModeRef.current) && e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        dragRectRef.current = { x0: mx, y0: my, x1: mx, y1: my };
        hasDraggedRef.current = true; // prevents the trailing `click` from firing drop-in
        return;
      }
      isDraggingRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        ox: transformRef.current?.offsetX ?? 0,
        oy: transformRef.current?.offsetY ?? 0,
      };
    };

    const updateTooltip = (mx: number, my: number) => {
      const grid = overviewGrid;
      const t = transformRef.current;
      if (!grid || !t) return;

      const { lon, lat } = canvasToLonLat(mx, my, grid, t);
      const lonRange = grid.maxLon - grid.minLon || 1;
      const latRange = grid.maxLat - grid.minLat || 1;
      const col = Math.round(((lon - grid.minLon) / lonRange) * (grid.width - 1));
      const row = Math.round(((lat - grid.minLat) / latRange) * (grid.height - 1));
      const inBounds =
        col >= 0 && col < grid.width && row >= 0 && row < grid.height;
      const depth = inBounds ? (grid.depths[row * grid.width + col] ?? 0) : 0;
      setTooltip({ visible: inBounds, x: mx + 14, y: my - 10, lon, lat, depth });
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      mousePosRef.current = { x: mx, y: my };

      // Select-area / Download tool: extend the drag rectangle, suppress tooltip/pan.
      if (selectModeRef.current || downloadModeRef.current) {
        if (dragRectRef.current) {
          dragRectRef.current.x1 = Math.max(0, Math.min(canvas.width, mx));
          dragRectRef.current.y1 = Math.max(0, Math.min(canvas.height, my));
        }
        setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        return;
      }

      // Tooltip
      const insideCanvas =
        mx >= 0 && mx < canvas.width && my >= 0 && my < canvas.height;
      if (insideCanvas) {
        updateTooltip(mx, my);
      } else {
        setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      }

      // Pan
      if (!isDraggingRef.current || !transformRef.current || !overviewGrid) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasDraggedRef.current = true;

      transformRef.current = clampTransform(
        {
          ...transformRef.current,
          offsetX: dragStartRef.current.ox + dx,
          offsetY: dragStartRef.current.oy + dy,
        },
        overviewGrid,
        canvas.width,
        canvas.height,
      );
    };

    const handleMouseUp = () => {
      // Commit the drawn rectangle as a bbox (if it has meaningful area).
      if ((selectModeRef.current || downloadModeRef.current) && dragRectRef.current) {
        const r = dragRectRef.current;
        const t = transformRef.current;
        dragRectRef.current = null;
        if (t && overviewGrid && Math.abs(r.x1 - r.x0) > 4 && Math.abs(r.y1 - r.y0) > 4) {
          const a = canvasToLonLat(r.x0, r.y0, overviewGrid, t);
          const b = canvasToLonLat(r.x1, r.y1, overviewGrid, t);
          const north = Math.max(a.lat, b.lat);
          const south = Math.min(a.lat, b.lat);
          const east = Math.max(a.lon, b.lon);
          const west = Math.min(a.lon, b.lon);
          const bbox = { north, south, east, west };
          if (downloadModeRef.current) {
            setDownloadBbox(bbox);
          } else {
            setSelectedBbox(bbox);
          }
        }
        return;
      }
      isDraggingRef.current = false;
    };

    const handleMouseLeave = () => {
      isDraggingRef.current = false;
      mousePosRef.current = { x: -1, y: -1 };
      setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      if (!t || !overviewGrid) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = Math.max(0.5, Math.min(20, t.scale * factor));
      const ratio = newScale / t.scale;

      transformRef.current = clampTransform(
        {
          ...t,
          scale: newScale,
          offsetX: mx + (t.offsetX - mx) * ratio,
          offsetY: my + (t.offsetY - my) * ratio,
        },
        overviewGrid,
        canvas.width,
        canvas.height,
      );
    };

    const handleClick = (e: MouseEvent) => {
      // Select / Download tool owns the canvas; never drop-in or open EFH while active.
      if (selectModeRef.current || downloadModeRef.current) return;
      if (hasDraggedRef.current) return;
      const t = transformRef.current;
      if (!t || !overviewGrid) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // RAWS station pin hit-test — before weather stations and other overlays
      if (rawsActiveRef.current && rawsCanvasPositionsRef.current.length > 0) {
        const HIT_R = 10;
        const hit = rawsCanvasPositionsRef.current.find(
          (p) => Math.hypot(p.cx - mx, p.cy - my) <= HIT_R,
        );
        if (hit) {
          const stationData = rawsDataRef.current.get(hit.datasetId) ?? null;
          if (stationData) {
            const alreadySelected = rawsSelectedIdRef.current === hit.datasetId;
            if (alreadySelected) {
              rawsSelectedIdRef.current = null;
              setSelectedRawsDatasetId(null);
              setSelectedRawsPos(null);
            } else {
              rawsSelectedIdRef.current = hit.datasetId;
              setSelectedRawsDatasetId(hit.datasetId);
              setSelectedRawsPos({ cx: hit.cx, cy: hit.cy });
              // Close weather station popover if open
              weatherStationSelectedIdRef.current = null;
              setSelectedWeatherStation(null);
              setSelectedWeatherStationPos(null);
            }
            return;
          }
        }
      }

      // Weather station pin hit-test — before other overlays so the pin is
      // always clickable even when EFH/substrate polygons are also active.
      if (weatherStationActiveRef.current && weatherStationCanvasPositionsRef.current.length > 0) {
        const HIT_R = 10;
        const hit = weatherStationCanvasPositionsRef.current.find(
          (p) => Math.hypot(p.cx - mx, p.cy - my) <= HIT_R,
        );
        if (hit) {
          const stationData = weatherStationDataRef.current.get(hit.id) ?? null;
          if (stationData) {
            const alreadySelected = weatherStationSelectedIdRef.current === hit.id;
            if (alreadySelected) {
              // Toggle off on second click
              weatherStationSelectedIdRef.current = null;
              setSelectedWeatherStation(null);
              setSelectedWeatherStationPos(null);
            } else {
              weatherStationSelectedIdRef.current = hit.id;
              setSelectedWeatherStation(stationData);
              setSelectedWeatherStationPos({ cx: hit.cx, cy: hit.cy });
              // Close RAWS popover if open
              rawsSelectedIdRef.current = null;
              setSelectedRawsDatasetId(null);
              setSelectedRawsPos(null);
            }
            return;
          }
        }
      }

      // EFH legend row click → toggle that species. Checked before polygon
      // hit-tests so the legend rows behave like buttons even when they
      // sit above EFH polygons on the canvas.
      if (showEfhRef.current && efhLegendLayoutRef.current) {
        const hitKey = hitTestEfhLegend(mx, my, efhLegendLayoutRef.current);
        if (hitKey) {
          useUiStore.getState().toggleEfhSpecies(hitKey);
          return;
        }
      }

      // Substrate legend row click → toggle that CMECS class. Checked before
      // anything else so the legend behaves like a button overlay even when
      // it sits over substrate/EFH polygons.
      if (substrateColorModeRef.current) {
        const hitKey = hitTestSubstrateLegend(
          mx,
          my,
          substrateLegendLayoutRef.current,
        );
        if (hitKey) {
          useUiStore.getState().toggleSubstrateClass(hitKey);
          return;
        }
      }

      const { lon, lat } = canvasToLonLat(mx, my, overviewGrid, t);

      // Non-primary footprint click → promote that dataset to primary instead
      // of dropping in. Hit-test newest-first so the most recently-added
      // footprint wins when overlapping.
      const visibleNow = visibleDatasetsRef.current;
      const primIdNow = primaryDatasetIdRef.current;
      for (let i = visibleNow.length - 1; i >= 0; i--) {
        const v = visibleNow[i];
        if (!v || v.datasetId === primIdNow) continue;
        const og = v.overviewGrid;
        if (!og) continue;
        if (
          lon >= og.minLon &&
          lon <= og.maxLon &&
          lat >= og.minLat &&
          lat <= og.maxLat
        ) {
          useTerrainStore.getState().setPrimary(v.datasetId, v.source);
          return;
        }
      }

      // EFH zone takes priority when the overlay is visible and the click
      // lands inside a polygon — open the species info panel instead of
      // dropping into the 3D scene. Hidden species and out-of-bbox polygons
      // are excluded via getVisibleEfhFeatures so clicks on filtered-out
      // polygons fall through to the drop-in handler.
      if (showEfhRef.current && efhFeaturesRef.current.length > 0) {
        const visibleEfh = getVisibleEfhFeatures(
          efhFeaturesRef.current,
          { minLon: overviewGrid.minLon, maxLon: overviewGrid.maxLon, minLat: overviewGrid.minLat, maxLat: overviewGrid.maxLat },
          hiddenEfhSpeciesRef.current,
        );
        const hit = hitTestEfh(lon, lat, visibleEfh);
        if (hit) {
          useUiStore.getState().setSelectedEfh(hit.properties);
          return;
        }
      }

      // Substrate polygon — when the overlay is on, a click inside a
      // polygon opens the same info card the 3D scene shows.
      if (
        substrateColorModeRef.current &&
        substrateFeaturesRef.current.length > 0
      ) {
        const hit = hitTestSubstrate(
          lon,
          lat,
          substrateFeaturesRef.current,
          hiddenSubstrateClassesRef.current,
        );
        if (hit) {
          const p = hit.properties;
          useUiStore.getState().setSelectedSubstrate({
            unitId: p.unitId,
            substrate: p.substrate,
            shoreZoneClass: p.shoreZoneClass,
            cmecsCode: p.cmecsCode,
            color: p.color,
            szMaterial: p.szMaterial ?? null,
            szForm: p.szForm ?? null,
            areaSqM: p.areaSqM ?? null,
            natsur: p.natsur ?? null,
            encChart: p.encChart ?? null,
            sourceName: substrateSourceName,
            creditUrl: substrateCreditUrl,
          });
          return;
        }
      }

      const { x: worldX, z: worldZ } = lonLatToWorldXZ(lon, lat, overviewGrid);

      useUiStore.getState().setPendingDropIn({ worldX, worldZ });
      useUiStore.getState().setOverviewOpen(false);
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // Suppress the right-click "Drop in here" menu while the select tool
      // is active — the user is in a different mental mode.
      if (selectModeRef.current) return;
      const t = transformRef.current;
      if (!t || !overviewGrid) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const { lon, lat } = canvasToLonLat(mx, my, overviewGrid, t);
      const { x: worldX, z: worldZ } = lonLatToWorldXZ(lon, lat, overviewGrid);

      // Approximate depth at this lon/lat from the overview grid.
      const N = overviewGrid.resolution;
      const lonRange = overviewGrid.maxLon - overviewGrid.minLon || 1;
      const latRange = overviewGrid.maxLat - overviewGrid.minLat || 1;
      const col = Math.max(
        0,
        Math.min(N - 1, Math.round(((lon - overviewGrid.minLon) / lonRange) * (N - 1))),
      );
      const row = Math.max(
        0,
        Math.min(N - 1, Math.round(((lat - overviewGrid.minLat) / latRange) * (N - 1))),
      );
      const depth = overviewGrid.depths[row * N + col] ?? overviewGrid.minDepth;

      const items: ContextMenuItem[] = [
        {
          label: "Drop in here",
          icon: "✈️",
          onClick: () => {
            useUiStore.getState().setPendingDropIn({ worldX, worldZ });
            useUiStore.getState().setOverviewOpen(false);
          },
        },
        {
          label: "Place marker here",
          icon: "📍",
          onClick: () => {
            useCameraStore.getState().setLastClickedGps({ lon, lat, depth });
            useUiStore.getState().setOverviewOpen(false);
            useUiStore.getState().setMarkerFormOpen(true);
          },
        },
        { label: "", onClick: () => {}, separator: true },
        {
          label: "Copy coordinates",
          icon: "📋",
          onClick: () => {
            const text = `lat: ${lat.toFixed(5)}, lon: ${lon.toFixed(5)}, depth: ${formatDepth(depth, { units: useSettingsStore.getState().units })}`;
            if (typeof navigator !== "undefined" && navigator.clipboard) {
              navigator.clipboard.writeText(text).catch(() => {});
            }
          },
        },
      ];

      useContextMenuStore.getState().show(e.clientX, e.clientY, items);
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("contextmenu", handleContextMenu);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [overviewGrid, substrateCreditUrl, substrateSourceName]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: "#020818",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Canvas fills the overlay */}
      <canvas
        ref={canvasRef}
        data-testid="overview-map-canvas"
        width={window.innerWidth}
        height={window.innerHeight}
        style={{ width: "100%", height: "100%", cursor: "crosshair", display: "block" }}
      />

      {/* Header bar */}
      <div
        className="overview-map-header"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          background: "rgba(2,8,24,0.75)",
          backdropFilter: "blur(6px)",
          borderBottom: "1px solid rgba(0,229,255,0.1)",
          zIndex: 41,
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.25em",
            color: "#00e5ff",
            textShadow: "0 0 8px rgba(0,229,255,0.45)",
          }}
        >
          ▼ OVERVIEW MAP
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            letterSpacing: "0.12em",
            color: "#64748b",
          }}
        >
          SCROLL TO ZOOM · DRAG TO PAN · CLICK TO DROP IN · [O] CLOSE
        </span>

        {/* GPS controls */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", pointerEvents: "auto" }}>
          {gpsError && (
            <span style={{ color: "#ef4444", fontSize: 9, fontFamily: "'JetBrains Mono', monospace", maxWidth: 180 }}>
              ⚠ {gpsError}
            </span>
          )}

          {gpsActive && gpsPosition && overviewGrid && (() => {
            const inBounds =
              gpsPosition.latitude >= overviewGrid.minLat &&
              gpsPosition.latitude <= overviewGrid.maxLat &&
              gpsPosition.longitude >= overviewGrid.minLon &&
              gpsPosition.longitude <= overviewGrid.maxLon;
            if (!inBounds) return null;
            return (
              <ViewscreenTooltip label="Dive in at your GPS position" side="bottom">
              <button
                onClick={() => {
                  const { x: worldX, z: worldZ } = lonLatToWorldXZ(
                    gpsPosition.longitude,
                    gpsPosition.latitude,
                    overviewGrid,
                  );
                  setPendingDropIn({ worldX, worldZ });
                  setOverviewOpen(false);
                }}
                style={{
                  background: "rgba(59,130,246,0.15)",
                  border: "1px solid rgba(59,130,246,0.5)",
                  borderRadius: 3,
                  color: "#60a5fa",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "20px",
                  whiteSpace: "nowrap",
                }}
              >
                ↓ DIVE HERE
              </button>
              </ViewscreenTooltip>
            );
          })()}

          {/* Box-select tool toggle — draw a rectangle to query catalog */}
          <ViewscreenTooltip label="Draw a rectangle to find datasets that cover that area" side="bottom">
            <button
              data-testid="overview-select-area-toggle"
              aria-pressed={selectMode}
              onClick={() => {
                const next = !selectMode;
                setSelectMode(next);
                if (next) { setDownloadMode(false); setDownloadBbox(null); }
                if (!next) clearBbox();
              }}
              style={{
                background: selectMode ? "rgba(0,229,255,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${selectMode ? "rgba(0,229,255,0.6)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: selectMode ? "#00e5ff" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                padding: "2px 10px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                lineHeight: "20px",
                whiteSpace: "nowrap",
              }}
            >
              ▭ SELECT AREA
            </button>
          </ViewscreenTooltip>

          {/* Download tool toggle — draw a rectangle to download CSV */}
          <ViewscreenTooltip label="Draw a rectangle to download bathymetric data as CSV" side="bottom">
            <button
              data-testid="overview-download-toggle"
              aria-pressed={downloadMode}
              onClick={() => {
                const next = !downloadMode;
                setDownloadMode(next);
                if (next) { setSelectMode(false); clearBbox(); }
                if (!next) { setDownloadBbox(null); dragRectRef.current = null; }
              }}
              style={{
                background: downloadMode ? "rgba(251,191,36,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${downloadMode ? "rgba(251,191,36,0.55)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: downloadMode ? "#fbbf24" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                padding: "2px 10px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                lineHeight: "20px",
                whiteSpace: "nowrap",
              }}
            >
              ↓ DOWNLOAD
            </button>
          </ViewscreenTooltip>

          {/* EFH overlay toggle — shown for preset datasets (hasEfh) and user-saved EFH datasets (embeddedEfhPolygons) */}
          {(hasEfh || !!embeddedEfhPolygons) && (
            <ViewscreenTooltip label="Toggle Essential Fish Habitat zones" side="bottom">
            <button
              data-testid="efh-overlay-toggle"
              onClick={() => setShowEfh(!showEfh)}
              aria-pressed={showEfh}
              style={{
                background: showEfh ? "rgba(34,197,94,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${showEfh ? "rgba(34,197,94,0.5)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: showEfh ? "#4ade80" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                padding: "2px 10px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                lineHeight: "20px",
                whiteSpace: "nowrap",
              }}
            >
              🐟 Essential Fish Habitat
            </button>
            </ViewscreenTooltip>
          )}

          {/* Trail list toggle */}
          {trailsData && trailsData.length > 0 && (
            <ViewscreenTooltip label="Show saved GPS trails" side="bottom">
            <button
              onClick={() => setShowTrailList((v) => !v)}
              style={{
                background: showTrailList ? "rgba(251,146,60,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${showTrailList ? "rgba(251,146,60,0.5)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: showTrailList ? "#fb923c" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                padding: "2px 10px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                lineHeight: "20px",
                whiteSpace: "nowrap",
              }}
            >
              🗺 TRAILS ({trailsData.length})
            </button>
            </ViewscreenTooltip>
          )}

          <ViewscreenTooltip label="Use your device's GPS for location" side="bottom">
          <button
            onClick={() => startWatching()}
            data-testid="gps-activate-btn"
            aria-pressed={gpsActive}
            style={{
              background: gpsActive ? "rgba(59,130,246,0.15)" : "rgba(0,10,20,0.75)",
              border: `1px solid ${gpsActive ? "rgba(59,130,246,0.5)" : "rgba(0,229,255,0.2)"}`,
              borderRadius: 3,
              color: gpsActive ? "#60a5fa" : "#94a3b8",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              padding: "2px 10px",
              cursor: "pointer",
              letterSpacing: "0.1em",
              lineHeight: "20px",
              whiteSpace: "nowrap",
            }}
          >
            {gpsActive ? "📍 GPS ACTIVE" : "📍 MY LOCATION"}
          </button>
          </ViewscreenTooltip>

          <ViewscreenTooltip label="Close the overview map (O)" side="bottom">
          <button
            onClick={() => setOverviewOpen(false)}
            style={{
              pointerEvents: "auto",
              background: "none",
              border: "1px solid rgba(0,229,255,0.2)",
              color: "#94a3b8",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              padding: "1px 10px",
              borderRadius: 3,
              cursor: "pointer",
              letterSpacing: "0.1em",
              lineHeight: "20px",
            }}
          >
            ✕ CLOSE
          </button>
          </ViewscreenTooltip>
        </div>
      </div>

      {/* Trail list panel */}
      {showTrailList && trailsData && trailsData.length > 0 && (
        <TrailListPanel
          trails={trailsData}
          savedTrailsRef={savedTrailsRef}
          onDelete={handleDeleteTrail}
          onClose={() => setShowTrailList(false)}
        />
      )}

      {/* Habitat suitability legend — mirrors the floating 3D legend so the
          amber heat key sits next to the habitat overlay here too. Renders
          nothing unless a species is active. */}
      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          zIndex: 41,
          pointerEvents: "none",
        }}
      >
        <HabitatLegend embedded />
      </div>

      {/* Depth tooltip */}
      {tooltip.visible && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y,
            background: "rgba(2,8,24,0.92)",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: 4,
            padding: "5px 9px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 42,
          }}
        >
          <div style={{ color: "#00e5ff", marginBottom: 1 }}>
            {tooltip.lon.toFixed(4)}° &nbsp;{tooltip.lat.toFixed(4)}°
          </div>
          <div style={{ color: "#cbd5e1" }}>{formatDepth(tooltip.depth, { units: unitsForUi })} depth</div>
        </div>
      )}

      {/* Box-select bbox panel — appears once the user releases a drag */}
      {selectedBbox && (
        <BboxQueryPanel
          bbox={selectedBbox}
          results={bboxResults}
          loading={bboxQuery.isPending}
          error={bboxError}
          onRequest={() => void requestBbox()}
          onRedraw={() => { setBboxResults(null); setBboxError(null); setSelectedBbox(null); }}
          onClear={clearBbox}
          onClose={() => { clearBbox(); setSelectMode(false); }}
          onLoad={handleBboxLoad}
          onSave={(id) => void handleBboxSave(id)}
          savedIds={savedCatalogIds}
          savingIds={bboxSavingIds}
        />
      )}

      {/* Download mode confirmation popover — appears after the user commits a download bbox */}
      {downloadBbox && (
        <TerrainDownloadPopover
          bbox={downloadBbox}
          onClose={() => { setDownloadBbox(null); dragRectRef.current = null; }}
        />
      )}

      {/* NOAA Weather Station popover — shown when a station pin is clicked */}
      {selectedWeatherStation && selectedWeatherStationPos && canvasRef.current && (
        <WeatherStationPopover
          station={selectedWeatherStation}
          pinX={selectedWeatherStationPos.cx}
          pinY={selectedWeatherStationPos.cy}
          containerWidth={canvasRef.current.width}
          faaWeatherCamsUrl={faaWeatherCamsUrl}
          onClose={() => {
            weatherStationSelectedIdRef.current = null;
            setSelectedWeatherStation(null);
            setSelectedWeatherStationPos(null);
          }}
        />
      )}

      {/* RAWS Station popover — shown when a RAWS pin is clicked */}
      {selectedRawsDatasetId && selectedRawsPos && canvasRef.current && (
        <RawsStationPopover
          datasetId={selectedRawsDatasetId}
          stationName={rawsDataRef.current.get(selectedRawsDatasetId)?.name ?? selectedRawsDatasetId}
          pinX={selectedRawsPos.cx}
          pinY={selectedRawsPos.cy}
          containerWidth={canvasRef.current.width}
          onClose={() => {
            rawsSelectedIdRef.current = null;
            setSelectedRawsDatasetId(null);
            setSelectedRawsPos(null);
          }}
        />
      )}

      {/* The shared EFH species detail panel is rendered once at the App
          root so it sits above both this overview map and the 3D scene. */}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Haversine distance helper (km)
// ---------------------------------------------------------------------------
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// TrailListPanel — shows saved trails with Haversine distance + delete
// ---------------------------------------------------------------------------
interface TrailListPanelProps {
  trails: GpsTrail[];
  savedTrailsRef: React.RefObject<CanvasSavedTrail[]>;
  onDelete: (id: string, name: string) => void;
  onClose: () => void;
}

const TrailListPanel: React.FC<TrailListPanelProps> = ({ trails, savedTrailsRef, onDelete, onClose }) => {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const unitsForUi = useSettingsStore((s) => s.units);

  const MONO: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
  };

  const selectedTrail = selectedId ? trails.find((t) => t.id === selectedId) : null;
  const selectedCanvas = selectedId
    ? savedTrailsRef.current.find((t) => t.id === selectedId)
    : undefined;

  // Compute Haversine distance for a trail
  const computeDistanceKm = (canvasTrail: CanvasSavedTrail | undefined): number | null => {
    if (!canvasTrail || canvasTrail.points.length < 2) return null;
    let dist = 0;
    for (let i = 1; i < canvasTrail.points.length; i++) {
      const prev = canvasTrail.points[i - 1]!;
      const curr = canvasTrail.points[i]!;
      dist += haversineKm(prev.lat, prev.lon, curr.lat, curr.lon);
    }
    return dist;
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 44,
        right: 16,
        width: 300,
        maxHeight: "65vh",
        overflowY: "auto",
        background: "rgba(2,8,24,0.92)",
        border: "1px solid rgba(0,229,255,0.15)",
        borderRadius: 6,
        zIndex: 43,
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid rgba(0,229,255,0.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {selectedTrail && (
            <button
              onClick={() => setSelectedId(null)}
              style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12, padding: 0 }}
            >
              ←
            </button>
          )}
          <span style={{ ...MONO, letterSpacing: "0.15em", color: "#fb923c" }}>
            {selectedTrail ? selectedTrail.name.toUpperCase().slice(0, 22) : "SAVED TRAILS"}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Detail view */}
      {selectedTrail ? (
        <div style={{ padding: "10px 12px" }}>
          <div style={{ ...MONO, color: "#e2e8f0", marginBottom: 8 }}>{selectedTrail.name}</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
            {[
              {
                label: "START",
                value: new Date(selectedTrail.startedAt).toLocaleString(undefined, {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                }),
              },
              {
                label: "END",
                value: new Date(selectedTrail.endedAt).toLocaleString(undefined, {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                }),
              },
              {
                label: "DURATION",
                value: (() => {
                  const ms = new Date(selectedTrail.endedAt).getTime() - new Date(selectedTrail.startedAt).getTime();
                  const m = Math.floor(ms / 60_000);
                  const h = Math.floor(m / 60);
                  return h > 0 ? `${h}h ${m % 60}m` : `${m} min`;
                })(),
              },
              { label: "POINTS", value: String(selectedTrail.pointCount) },
              {
                label: "DISTANCE",
                value: (() => {
                  const km = computeDistanceKm(selectedCanvas);
                  if (km === null) return "—";
                  return formatDistance(km * 1000, { units: unitsForUi });
                })(),
              },
              {
                label: "COLOUR",
                value: (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: selectedTrail.colour, display: "inline-block" }} />
                    {selectedTrail.colour}
                  </span>
                ),
              },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ ...MONO, fontSize: 9, color: "#94a3b8", marginBottom: 1 }}>{label}</div>
                <div style={{ ...MONO, color: "#e2e8f0" }}>{value as React.ReactNode}</div>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              onDelete(selectedTrail.id, selectedTrail.name);
              setSelectedId(null);
            }}
            style={{
              marginTop: 12,
              width: "100%",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 3,
              color: "#ef4444",
              cursor: "pointer",
              fontSize: 10,
              padding: "5px 10px",
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.1em",
            }}
          >
            ✕ DELETE TRAIL
          </button>
        </div>
      ) : (
        /* Trail list */
        trails.map((trail) => {
          const canvasTrail = savedTrailsRef.current.find((t) => t.id === trail.id);
          const durationMs =
            new Date(trail.endedAt).getTime() - new Date(trail.startedAt).getTime();
          const durationMin = Math.round(durationMs / 60_000);
          const distKm = computeDistanceKm(canvasTrail);

          return (
            <button
              key={trail.id}
              onClick={() => setSelectedId(trail.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 12px",
                width: "100%",
                background: "none",
                border: "none",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {/* Colour swatch */}
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: trail.colour,
                  flexShrink: 0,
                }}
              />

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    ...MONO,
                    color: "#e2e8f0",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {trail.name}
                </div>
                <div style={{ ...MONO, fontSize: 9, color: "#94a3b8", marginTop: 2 }}>
                  {trail.pointCount} pts
                  {durationMin > 0 ? ` · ${durationMin} min` : ""}
                  {distKm !== null
                    ? ` · ${formatDistance(distKm * 1000, { units: unitsForUi })}`
                    : ""}
                </div>
              </div>

              {/* Arrow */}
              <span style={{ color: "#64748b", fontSize: 11 }}>›</span>
            </button>
          );
        })
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Box-select query panel
//
// Floats over the right side of the overview map once the user releases a
// drag in select-area mode. Shows the bbox metrics, a "Request bathymetry"
// button, and the resulting catalog entries with Load/Save controls that
// mirror the Find Data flow.
// ---------------------------------------------------------------------------

interface BboxQueryPanelProps {
  bbox: { north: number; south: number; east: number; west: number };
  results: DatasetCatalogSearchResult[] | null;
  loading: boolean;
  error: string | null;
  onRequest: () => void;
  onRedraw: () => void;
  onClear: () => void;
  onClose: () => void;
  onLoad: (entry: DatasetCatalogSearchResult) => void;
  onSave: (id: string) => void;
  savedIds: Set<string>;
  savingIds: Set<string>;
}

const BboxQueryPanel: React.FC<BboxQueryPanelProps> = ({
  bbox,
  results,
  loading,
  error,
  onRequest,
  onRedraw,
  onClear,
  onClose,
  onLoad: _onLoad,
  onSave,
  savedIds,
  savingIds,
}) => {
  const widthDeg = bbox.east - bbox.west;
  const heightDeg = bbox.north - bbox.south;
  // Approximate km dimensions using Haversine along the bbox midlines.
  const midLat = (bbox.north + bbox.south) / 2;
  const midLon = (bbox.east + bbox.west) / 2;
  const widthKm = haversineKm(midLat, bbox.west, midLat, bbox.east);
  const heightKm = haversineKm(bbox.south, midLon, bbox.north, midLon);
  const areaKm2 = widthKm * heightKm;
  const fmtKm = (km: number) =>
    km >= 100 ? `${km.toFixed(0)} km` : km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`;
  const fmtArea = (km2: number) =>
    km2 >= 1000 ? `${(km2 / 1000).toFixed(1)}k km²` : km2 >= 10 ? `${km2.toFixed(0)} km²` : `${km2.toFixed(1)} km²`;
  return (
    <div
      data-testid="overview-bbox-panel"
      role="dialog"
      aria-label="Selected area datasets"
      style={{
        position: "absolute",
        top: 48,
        right: 12,
        width: 320,
        maxHeight: "calc(100vh - 64px)",
        display: "flex",
        flexDirection: "column",
        background: "rgba(2,8,24,0.95)",
        border: "1px solid rgba(0,229,255,0.25)",
        borderRadius: 4,
        backdropFilter: "blur(8px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        zIndex: 43,
        pointerEvents: "auto",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgba(0,229,255,0.15)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ color: "#00e5ff", fontSize: 10, letterSpacing: "0.15em" }}>
          SELECTED AREA
        </span>
        <button
          onClick={onClose}
          aria-label="Close selected area panel"
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "10px 12px", fontSize: 10, color: "#cbd5e1" }}>
        <div data-testid="overview-bbox-metrics" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
          <span style={{ color: "#94a3b8" }}>N</span>
          <span>{bbox.north.toFixed(5)}°</span>
          <span style={{ color: "#94a3b8" }}>S</span>
          <span>{bbox.south.toFixed(5)}°</span>
          <span style={{ color: "#94a3b8" }}>E</span>
          <span>{bbox.east.toFixed(5)}°</span>
          <span style={{ color: "#94a3b8" }}>W</span>
          <span>{bbox.west.toFixed(5)}°</span>
          <span style={{ color: "#94a3b8" }}>SIZE</span>
          <span data-testid="overview-bbox-size-deg">{widthDeg.toFixed(4)}° × {heightDeg.toFixed(4)}°</span>
          <span style={{ color: "#94a3b8" }}>SPAN</span>
          <span data-testid="overview-bbox-size-km">{fmtKm(widthKm)} × {fmtKm(heightKm)}</span>
          <span style={{ color: "#94a3b8" }}>AREA</span>
          <span data-testid="overview-bbox-area-km">~{fmtArea(areaKm2)}</span>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button
            data-testid="overview-bbox-request"
            onClick={onRequest}
            disabled={loading}
            style={{
              flex: 1,
              background: "rgba(0,229,255,0.15)",
              border: "1px solid rgba(0,229,255,0.5)",
              borderRadius: 3,
              color: "#00e5ff",
              padding: "4px 8px",
              cursor: loading ? "wait" : "pointer",
              fontSize: 9,
              letterSpacing: "0.1em",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "REQUESTING…" : "▼ REQUEST BATHYMETRY"}
          </button>
          <button
            data-testid="overview-bbox-redraw"
            onClick={onRedraw}
            style={{
              background: "transparent",
              border: "1px solid rgba(0,229,255,0.2)",
              borderRadius: 3,
              color: "#7dd3fc",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: 9,
              letterSpacing: "0.1em",
            }}
          >
            REDRAW
          </button>
          <button
            data-testid="overview-bbox-clear"
            onClick={onClear}
            style={{
              background: "transparent",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 3,
              color: "#fca5a5",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: 9,
              letterSpacing: "0.1em",
            }}
          >
            CLEAR
          </button>
        </div>

        {error && (
          <div
            data-testid="overview-bbox-error"
            style={{
              marginTop: 8,
              padding: "6px 8px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.35)",
              borderRadius: 3,
              color: "#fca5a5",
              fontSize: 9,
              userSelect: "text",
            }}
          >
            ⚠ {error}
          </div>
        )}
      </div>

      <div
        data-testid="overview-bbox-results"
        style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px", minHeight: 0 }}
      >
        {results === null && !loading && !error && (
          <div style={{ fontSize: 9, color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
            Click "Request bathymetry" to see matching datasets.
          </div>
        )}
        {results && results.length === 0 && (
          <div style={{ fontSize: 9, color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
            No datasets cover this area.
          </div>
        )}
        {results && results.map((entry) => {
          const saved = savedIds.has(entry.id);
          const saving = savingIds.has(entry.id);
          return (
            <div
              key={entry.id}
              data-testid="overview-bbox-result-card"
              style={{
                padding: "8px 10px",
                marginBottom: 6,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(0,229,255,0.1)",
                borderRadius: 3,
              }}
            >
              <div style={{ fontSize: 10, color: "#e2e8f0", fontWeight: 600 }}>{entry.name}</div>
              <div style={{ fontSize: 8, color: "#cbd5e1", marginTop: 2, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {entry.dataType} · {entry.sourceAgency}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                {/* Save is always available — presets are retired (Task #403),
                    but user-saved/external entries can still be saved here. */}
                <button
                  data-testid="overview-bbox-save"
                  onClick={() => !saved && !saving && onSave(entry.id)}
                  disabled={saved || saving}
                  style={{
                    flex: 1,
                    background: saved ? "rgba(34,197,94,0.1)" : "rgba(0,229,255,0.05)",
                    border: `1px solid ${saved ? "rgba(34,197,94,0.4)" : "rgba(0,229,255,0.2)"}`,
                    borderRadius: 3,
                    color: saved ? "#4ade80" : "#7dd3fc",
                    padding: "3px 6px",
                    cursor: saved || saving ? "default" : "pointer",
                    fontSize: 9,
                    letterSpacing: "0.08em",
                  }}
                >
                  {saved ? "✓ SAVED" : saving ? "SAVING…" : "+ SAVE"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
