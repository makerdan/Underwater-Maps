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
import { useUiStore, useTimelineVisible } from "@/lib/uiStore";
import type { SelectedHotspot } from "@/lib/uiStore";
import { useTimelineStore } from "@/lib/timelineStore";
import { useContextMenuStore, type ContextMenuItem } from "@/lib/contextMenuStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import {
  buildHeatmapBitmap,
  buildContourLines,
  computeInitialTransform,
  computeFitTransform,
  clampTransform,
  canvasToLonLat,
  lonLatToCanvas,
  lonRangeOf,
  normaliseLon,
  renderHeatmap,
  renderHeatmapAtBbox,
  renderContourLines,
  renderGridLines,
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
  renderSavedTrails,
  drawSelectionRect,
  buildIntertidalHotspotDescriptors,
  shouldDrawOverlayAtScale,
} from "@/lib/overviewRenderer";
import { appendWaypoint, planFlyThroughStops } from "@/lib/waypointHelpers";
import type { Waypoint } from "@/lib/waypointHelpers";
import type { OverviewTransform, CanvasSavedTrail, EfhLegendLayout, ContourSegment, WeatherStationPin, RawsStationPin, IntertidalHotspotPin } from "@/lib/overviewRenderer";
import { MARKER_COLOR } from "@/lib/markerConstants";
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
  useGetIntertidalSpots,
  getGetIntertidalSpotsQueryKey,
  useGetUserDatasets,
  getGetUserDatasetsQueryKey,
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
import {
  registerRawsPopupHandlers,
  registerRawsCanvasPositionGetter,
  registerSubstrateFeatureGetter,
} from "@/lib/testHelpers";
import { useSubstrateErrorToast } from "@/hooks/useSubstrateErrorToast";
import { useSubstrateCoverageToast } from "@/hooks/useSubstrateCoverageToast";

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
  const { terrain: appTerrain } = useAppState();
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
  const datasetId = overviewGrid?.datasetId ?? appTerrain?.datasetId ?? "";
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
  /** Offscreen heatmap bitmaps keyed by datasetId for secondary (non-first) visible datasets. */
  const secondaryBitmapsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  /**
   * Synthetic world-space reference grid covering the combined lat/lon extent
   * of all visible datasets that have overview grids loaded. null when only
   * one dataset is visible (fall back to overviewGrid as coordinate frame).
   */
  const worldGridRef = useRef<import("@workspace/api-client-react").TerrainData | null>(null);
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
  // Full station objects keyed by id for the SVG onClick handler and popover
  const weatherStationDataRef = useRef<Map<string, WeatherStation>>(new Map());

  // RAWS station refs (read in rAF loop without React re-render)
  const rawsPinsRef = useRef<RawsStationPin[]>([]);
  const rawsActiveRef = useRef(false);
  const rawsSelectedIdRef = useRef<string | null>(null);
  const rawsCanvasPositionsRef = useRef<Array<{ datasetId: string; cx: number; cy: number }>>([]);
  const rawsDataRef = useRef<Map<string, RawsStationItem>>(new Map());

  // Intertidal hotspot pin refs (read in rAF loop without React re-render)
  const intertidalPinsRef = useRef<IntertidalHotspotPin[]>([]);
  const intertidalHotspotDataRef = useRef<Map<string, SelectedHotspot>>(new Map());
  const intertidalSelectedUnitIdRef = useRef<string | null>(null);
  const intertidalHotspotsEnabledRef = useRef(false);
  const intertidalScoreModeRef = useRef<'tidepool' | 'beachcombing'>('tidepool');

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

  // Dirty flag — rAF loop skips draws when nothing has changed (no camera
  // movement, no data updates, no mouse interaction, no GPS/trail pulse).
  const dirtyRef = useRef(true);

  // Fit-to-data animation state. Set by handleFitToData; consumed and cleared
  // by the rAF loop once the tween completes.
  const fitAnimRef = useRef<{
    from: OverviewTransform;
    to: OverviewTransform;
    startTime: number;
    duration: number;
  } | null>(null);

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

  // SVG overlay transform — updated each rAF frame so SVG elements reposition in sync with the canvas.
  const [svgTransform, setSvgTransform] = useState<OverviewTransform | null>(null);

  // Camera position selectors (reactive — update camera arrow in SVG without waiting for rAF).
  const cameraLon = useCameraStore((s) => s.cameraLon);
  const cameraLat = useCameraStore((s) => s.cameraLat);
  const cameraHeading = useCameraStore((s) => s.heading);

  // Marker visibility setting (reactive for SVG render).
  const overviewShowMarkers = useSettingsStore((s) => s.overviewShowMarkers);

  // Weather station selected-pin React state (drives popover)
  const [selectedWeatherStation, setSelectedWeatherStation] = useState<WeatherStation | null>(null);

  // --- Tools popover state --------------------------------------------------
  // Controls the compact "Tools" popover that houses box-select and download.
  const [toolsPopoverOpen, setToolsPopoverOpen] = useState(false);
  const toolsWrapperRef = useRef<HTMLDivElement>(null);

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

  // --- Waypoint tool state --------------------------------------------------
  // When active, map clicks drop numbered pins instead of teleporting.
  const [waypointMode, setWaypointMode] = useState(false);
  const waypointModeRef = useRef(false);
  useEffect(() => { waypointModeRef.current = waypointMode; }, [waypointMode]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const waypointsRef = useRef<Waypoint[]>([]);
  useEffect(() => {
    waypointsRef.current = waypoints;
    dirtyRef.current = true;
  }, [waypoints]);
  const [showWaypointPanel, setShowWaypointPanel] = useState(false);

  // Tracks active fly-through timeout IDs so they can be cancelled.
  const flyThroughTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cancelFlyThrough = useCallback(() => {
    flyThroughTimeoutsRef.current.forEach(clearTimeout);
    flyThroughTimeoutsRef.current = [];
  }, []);

  // Clear pending timers when the component unmounts.
  useEffect(() => () => { cancelFlyThrough(); }, [cancelFlyThrough]);

  // Fly-through: sequentially drop-in to each waypoint with a dwell interval.
  const flyThroughWaypoints = useCallback(() => {
    const wps = waypointsRef.current;
    if (!overviewGrid) return;
    const stops = planFlyThroughStops(wps, overviewGrid);
    if (stops.length === 0) return;
    const DWELL_MS = 4000;
    cancelFlyThrough();
    useUiStore.getState().setOverviewOpen(false);
    flyThroughTimeoutsRef.current = stops.map((stop, i) =>
      setTimeout(() => {
        useUiStore.getState().setPendingDropIn(stop);
      }, i * DWELL_MS)
    );
  }, [overviewGrid, cancelFlyThrough]);

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
  const { setDatasetId, setTerrain } = useAppState();
  const saveMutation = usePostDatasetsCatalogIdSave();
  const { data: mySaves = [], refetch: refetchMySaves } = useGetDatasetsMySaves({
    query: { queryKey: getGetDatasetsMySavesQueryKey() },
  });
  const savedCatalogIds = React.useMemo(
    () => new Set(mySaves.map((s) => s.catalogId)),
    [mySaves],
  );
  const [bboxSavingIds, setBboxSavingIds] = useState<Set<string>>(new Set());

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

  // Compute the union bbox of all visible datasets that have a loaded overview
  // grid and animate the minimap transform to frame it.
  const handleFitToData = useCallback(() => {
    const withGrid = visibleDatasets.filter((v) => !!v.overviewGrid);
    if (withGrid.length === 0) return;
    const canvas = canvasRef.current;
    const currentTransform = transformRef.current;
    if (!canvas || !currentTransform) return;

    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const v of withGrid) {
      const og = v.overviewGrid!;
      minLon = Math.min(minLon, og.minLon);
      maxLon = Math.max(maxLon, og.maxLon);
      minLat = Math.min(minLat, og.minLat);
      maxLat = Math.max(maxLat, og.maxLat);
    }

    const targetTransform = computeFitTransform(
      { minLon, maxLon, minLat, maxLat },
      canvas.width,
      canvas.height,
    );

    fitAnimRef.current = {
      from: { ...currentTransform },
      to: targetTransform,
      startTime: performance.now(),
      duration: 400,
    };
    dirtyRef.current = true;
  }, [visibleDatasets]);

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

  // Close the Tools popover when clicking outside its wrapper.
  useEffect(() => {
    if (!toolsPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      if (toolsWrapperRef.current && !toolsWrapperRef.current.contains(e.target as Node)) {
        setToolsPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [toolsPopoverOpen]);

  // GPS & trail state (read directly from stores in rAF — no React re-render)

  // Keep markers ref in sync without causing rAF re-registration
  useEffect(() => {
    markersRef.current = markerData ?? [];
    dirtyRef.current = true;
  }, [markerData]);

  // EFH data — either embedded in the overview grid (for user-saved noaa-efh-*
  // datasets) or fetched from /efh (for preset datasets with the hasEfh flag).
  const embeddedEfhPolygons = overviewGrid?.habitatPolygons ?? null;
  const waterTypeForDatasets = useSettingsStore((s) => s.waterType);
  const { data: allDatasets } = useGetDatasets(
    { waterType: waterTypeForDatasets },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType: waterTypeForDatasets }) } },
  );
  const { data: userDatasetsForNames } = useGetUserDatasets({
    query: {
      queryKey: getGetUserDatasetsQueryKey(),
      retry: false,
      staleTime: 60_000,
    },
  });
  // Build a ref so the rAF render loop always has fresh dataset names without
  // re-triggering the expensive draw effect.
  const datasetNameMapRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const m = new Map<string, string>();
    for (const d of allDatasets ?? []) m.set(d.id, d.name);
    for (const d of userDatasetsForNames ?? []) m.set(d.id, d.name);
    datasetNameMapRef.current = m;
  }, [allDatasets, userDatasetsForNames]);
  const hasEfh = !!allDatasets?.find((d) => d.id === datasetId)?.hasEfh;
  // Derived once per render so the Fit button doesn't repeat the filter three
  // times in inline JSX style expressions.
  const datasetsWithGrid = useMemo(
    () => visibleDatasets.filter((v) => !!v.overviewGrid),
    [visibleDatasets],
  );
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
    dirtyRef.current = true;
  }, [activeEfhFeatures]);

  // Keep showEfhRef in sync so the rAF loop can read it without a dep-array entry
  useEffect(() => {
    showEfhRef.current = showEfh;
    dirtyRef.current = true;
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
    dirtyRef.current = true;
  }, [substrateColorMode]);
  useEffect(() => {
    selectedSubstrateUnitIdRef.current = selectedSubstrateUnitId;
    dirtyRef.current = true;
  }, [selectedSubstrateUnitId]);
  const hiddenSubstrateClasses = useUiStore((s) => s.hiddenSubstrateClasses);
  useEffect(() => {
    hiddenSubstrateClassesRef.current = hiddenSubstrateClasses;
    dirtyRef.current = true;
  }, [hiddenSubstrateClasses]);
  const hiddenEfhSpecies = useUiStore((s) => s.hiddenEfhSpecies);
  useEffect(() => {
    hiddenEfhSpeciesRef.current = hiddenEfhSpecies;
    dirtyRef.current = true;
  }, [hiddenEfhSpecies]);

  // Weather stations overlay — query always runs when terrain loaded so FAA button works
  const weatherStationsActive = useUiStore((s) => s.weatherStationsActive);
  const timelineVisible = useTimelineVisible();
  const timelineCurrentTime = useTimelineStore((s) => s.currentTime);
  const {
    stations: weatherStations,
    faaWeatherCamsUrl,
    stale: weatherStationsStale,
  } = useWeatherStations();
  useEffect(() => {
    weatherStationActiveRef.current = weatherStationsActive;
    if (!weatherStationsActive) {
      weatherStationPinsRef.current = [];
      weatherStationDataRef.current = new Map();
      // Clear popover when the overlay is toggled off
      weatherStationSelectedIdRef.current = null;
      setSelectedWeatherStation(null);
    }
    dirtyRef.current = true;
  }, [weatherStationsActive]);
  useEffect(() => {
    if (!weatherStationsActive) return;
    weatherStationPinsRef.current = weatherStations.map((s) => ({
      id: s.id, lat: s.lat, lon: s.lon,
    }));
    const m = new Map<string, WeatherStation>();
    for (const s of weatherStations) m.set(s.id, s);
    weatherStationDataRef.current = m;
    dirtyRef.current = true;
  }, [weatherStations, weatherStationsActive]);

  // RAWS overlay — fetch all nearby stations when overlay is enabled
  const rawsOverlayActive = useUiStore((s) => s.rawsOverlayActive);
  const { stations: rawsStations } = useRawsStations();
  // Selected RAWS pin React state (drives popover)
  const [selectedRawsDatasetId, setSelectedRawsDatasetId] = useState<string | null>(null);
  // Register popup state setter and canvas-position getter so e2e tests can
  // open the popover via the backdoor AND dispatch real canvas clicks at the
  // actual rendered pin coordinates.
  useEffect(() => {
    registerRawsPopupHandlers(setSelectedRawsDatasetId, () => {});
    registerRawsCanvasPositionGetter(() => rawsCanvasPositionsRef.current);
    registerSubstrateFeatureGetter(() => substrateFeaturesRef.current.length);
  }, []);
  useEffect(() => {
    rawsActiveRef.current = rawsOverlayActive;
    if (!rawsOverlayActive) {
      rawsPinsRef.current = [];
      rawsDataRef.current = new Map();
      rawsSelectedIdRef.current = null;
      setSelectedRawsDatasetId(null);
    }
    dirtyRef.current = true;
  }, [rawsOverlayActive]);
  useEffect(() => {
    if (!rawsOverlayActive) return;
    rawsPinsRef.current = rawsStations.map((s) => ({
      datasetId: s.datasetId, lat: s.lat, lon: s.lon,
    }));
    const m = new Map<string, RawsStationItem>();
    for (const s of rawsStations) m.set(s.datasetId, s);
    rawsDataRef.current = m;
    dirtyRef.current = true;
  }, [rawsStations, rawsOverlayActive]);

  const { data: substrateCollection, isError: substrateIsError } = useGetSubstrate(datasetId, {
    query: {
      enabled: !!datasetId && substrateColorMode,
      queryKey: getGetSubstrateQueryKey(datasetId),
      staleTime: 5 * 60 * 1000,
    },
  });

  const substrateEnabled = !!datasetId && substrateColorMode;
  // Multi-primary: enable user-dataset overlays if ANY visible dataset is a user upload.
  const primaryIsUserDataset = visibleDatasets.some((v) => v.source === "user");

  useSubstrateErrorToast({
    isError: substrateIsError,
    isEmpty: !substrateIsError && substrateCollection !== undefined && substrateCollection.features.length === 0,
    datasetId,
    enabled: substrateEnabled,
  });

  useSubstrateCoverageToast({
    hasFeatures: !substrateIsError && (substrateCollection?.features?.length ?? 0) > 0,
    isUserDataset: primaryIsUserDataset,
    datasetId,
    enabled: substrateEnabled,
  });

  const substrateMeta = (substrateCollection as SubstrateFeatureCollection | undefined)
    ?.metadata as { sourceName?: string; creditUrl?: string } | undefined;
  const substrateSourceName =
    substrateMeta?.sourceName ?? "Alaska ShoreZone (NOAA AKR / ADF&G)";
  const substrateCreditUrl =
    substrateMeta?.creditUrl ?? "https://alaskafisheries.noaa.gov/shorezone/";
  useEffect(() => {
    substrateFeaturesRef.current = substrateCollection?.features ?? [];
    dirtyRef.current = true;
  }, [substrateCollection]);

  // Intertidal hotspots overlay — mirrors intertidalHotspotsEnabled / intertidalScoreMode
  // from uiStore so the 2D pins match what the 3D IntertidalHotspotsLayer shows.
  const intertidalHotspotsEnabled = useUiStore((s) => s.intertidalHotspotsEnabled);
  const intertidalScoreMode = useUiStore((s) => s.intertidalScoreMode);
  const selectedHotspot = useUiStore((s) => s.selectedHotspot);
  useEffect(() => {
    intertidalHotspotsEnabledRef.current = intertidalHotspotsEnabled;
    if (!intertidalHotspotsEnabled) {
      intertidalPinsRef.current = [];
      intertidalHotspotDataRef.current = new Map();
      intertidalSelectedUnitIdRef.current = null;
    }
    dirtyRef.current = true;
  }, [intertidalHotspotsEnabled]);
  useEffect(() => {
    intertidalScoreModeRef.current = intertidalScoreMode;
    dirtyRef.current = true;
  }, [intertidalScoreMode]);
  // Keep selected-pin ref in sync with the shared selectedHotspot
  useEffect(() => {
    intertidalSelectedUnitIdRef.current = selectedHotspot?.unitId ?? null;
    dirtyRef.current = true;
  }, [selectedHotspot]);
  // Always fetch with type="both" so the query key stays stable when
  // intertidalScoreMode changes. The frontend builds pins using whichever
  // score column is active (tidepoolScore / beachcombingScore), so we never
  // need a separate network round-trip when the user toggles the mode.
  const intertidalSpotsParams = { type: "both" as const, minScore: 10 };
  const { data: intertidalSpotsData } = useGetIntertidalSpots(
    datasetId,
    intertidalSpotsParams,
    {
      query: {
        enabled: !!datasetId && intertidalHotspotsEnabled,
        queryKey: getGetIntertidalSpotsQueryKey(datasetId, intertidalSpotsParams),
        staleTime: 5 * 60 * 1000,
      },
    },
  );
  // Build pin descriptors and hotspot data map whenever spots data / mode changes.
  useEffect(() => {
    if (!intertidalSpotsData || !intertidalHotspotsEnabled) {
      intertidalPinsRef.current = [];
      intertidalHotspotDataRef.current = new Map();
      return;
    }
    const mode = intertidalScoreModeRef.current;
    const meta = (intertidalSpotsData as { metadata?: { sourceName?: string; sourceCredit?: string } }).metadata;
    const sourceName = meta?.sourceName ?? "NOAA ShoreZone / AOOS";
    const creditUrl = meta?.sourceCredit ?? "https://portal.aoos.org/";

    const { pins, dataMap } = buildIntertidalHotspotDescriptors(
      intertidalSpotsData.features as Parameters<typeof buildIntertidalHotspotDescriptors>[0],
      mode,
      sourceName,
      creditUrl,
    );

    intertidalPinsRef.current = pins;
    intertidalHotspotDataRef.current = dataMap;
    dirtyRef.current = true;
  }, [intertidalSpotsData, intertidalHotspotsEnabled, intertidalScoreMode]);

  // Fetch trail points when trails list changes; update savedTrailsRef for rAF
  useEffect(() => {
    if (!trailsData || trailsData.length === 0) {
      savedTrailsRef.current = [];
      dirtyRef.current = true;
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
        dirtyRef.current = true;
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
      dirtyRef.current = true;
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
    dirtyRef.current = true;
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
    dirtyRef.current = true;
  }, [overviewGrid, colormapTheme, paletteShallow, paletteDeep, paletteBandColors, paletteCustomStops, paletteBandBoundaries]);

  // Maintain secondary dataset bitmaps and the combined world-space bbox grid.
  // Runs whenever visibleDatasets changes OR palette/colormap changes so all
  // secondary bitmaps stay in sync with the primary colormap theme.
  useEffect(() => {
    // Collect all entries that have an overview grid, in order.
    const withGrid = visibleDatasets.filter((v) => !!v.overviewGrid);
    const primaryId = visibleDatasets[0]?.datasetId ?? null;

    // Remove bitmaps for datasets that are no longer visible.
    const visibleIds = new Set(withGrid.map((v) => v.datasetId));
    for (const id of secondaryBitmapsRef.current.keys()) {
      if (!visibleIds.has(id)) secondaryBitmapsRef.current.delete(id);
    }

    // Build/rebuild bitmaps for every secondary (non-first) visible dataset.
    for (const v of withGrid) {
      if (v.datasetId === primaryId) continue; // primary handled by the effect above
      const og = v.overviewGrid!;
      secondaryBitmapsRef.current.set(v.datasetId, buildHeatmapBitmap(og, colormapTheme));
    }

    // Compute the combined bbox when 2+ datasets have overview grids loaded.
    if (withGrid.length > 1) {
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const v of withGrid) {
        const og = v.overviewGrid!;
        minLon = Math.min(minLon, og.minLon);
        maxLon = Math.max(maxLon, og.maxLon);
        minLat = Math.min(minLat, og.minLat);
        maxLat = Math.max(maxLat, og.maxLat);
      }
      // Cast: only bbox fields are used by projection helpers; depth array is unused.
      worldGridRef.current = { minLon, maxLon, minLat, maxLat } as unknown as import("@workspace/api-client-react").TerrainData;
    } else {
      worldGridRef.current = null;
    }

    // Re-initialize the canvas transform whenever the visible set changes so
    // all loaded datasets fit in view at once.  Uses the combined world-space
    // bbox when multiple datasets are present; falls back to the single loaded
    // grid otherwise (mirrors what initTransform does on first primary load).
    const canvas = canvasRef.current;
    if (canvas && withGrid.length > 0) {
      const refGrid = worldGridRef.current ?? withGrid[0]!.overviewGrid!;
      transformRef.current = computeInitialTransform(refGrid, canvas.width, canvas.height);
    }

    dirtyRef.current = true;
  }, [visibleDatasets, colormapTheme, paletteShallow, paletteDeep, paletteBandColors, paletteCustomStops, paletteBandBoundaries]);

  // Compute initial transform whenever the grid (or combined world grid) or canvas is ready
  const initTransform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !overviewGrid) return;
    // Use the world grid (combined bbox) when multiple datasets are loaded
    // so the initial view fits all of them at once.
    const refGrid = worldGridRef.current ?? overviewGrid;
    transformRef.current = computeInitialTransform(refGrid, canvas.width, canvas.height);
  }, [overviewGrid]);

  useEffect(() => {
    initTransform();
  }, [initTransform]);

  // ---------------------------------------------------------------------------
  // Canvas context-loss recovery
  //
  // Browsers (especially mobile / under GPU pressure) can reclaim the 2D
  // canvas context, which clears the on-screen canvas AND may wipe the
  // offscreen bitmap canvases cached in bitmapRef / secondaryBitmapsRef.
  // Without handling, the overview map goes permanently black until reload.
  //
  // On `contextrestored` we imperatively rebuild all heatmap bitmaps from the
  // latest store state (read via getState()/refs so this effect never needs to
  // re-register) and mark the rAF loop dirty. The user's pan/zoom transform is
  // deliberately left untouched.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rebuildBitmaps = () => {
      const og = useTerrainStore.getState().overviewGrid;
      const theme = useSettingsStore.getState().colormapTheme;
      if (og) {
        bitmapRef.current = buildHeatmapBitmap(og, theme);
      }
      const visibleNow = visibleDatasetsRef.current;
      const primaryId = visibleNow[0]?.datasetId ?? null;
      secondaryBitmapsRef.current.clear();
      for (const v of visibleNow) {
        if (v.datasetId === primaryId || !v.overviewGrid) continue;
        secondaryBitmapsRef.current.set(
          v.datasetId,
          buildHeatmapBitmap(v.overviewGrid, theme),
        );
      }
      invalidateUpscaleRef.current();
      dirtyRef.current = true;
    };

    const onContextLost = () => {
      // Draw calls are no-ops while the context is lost; mark dirty so the
      // first frame after restore repaints even if nothing else changed.
      dirtyRef.current = true;
    };
    const onContextRestored = () => {
      rebuildBitmaps();
    };

    canvas.addEventListener("contextlost", onContextLost);
    canvas.addEventListener("contextrestored", onContextRestored);
    return () => {
      canvas.removeEventListener("contextlost", onContextLost);
      canvas.removeEventListener("contextrestored", onContextRestored);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // rAF render loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Subscribe to stores that change outside of React renders so we can mark
    // the canvas dirty and trigger a redraw without re-running this effect.
    const unsubCamera = useCameraStore.subscribe(() => { dirtyRef.current = true; });
    const unsubGps    = useGpsStore.subscribe(()    => { dirtyRef.current = true; });
    const unsubTrail  = useTrailStore.subscribe(()  => { dirtyRef.current = true; });

    // Track the last view key to detect pan/zoom changes and invalidate the
    // cached upscaled bitmap so a stale enhanced image is never shown after
    // the user moves the map.
    let lastViewKey: string | null = null;

    const loop = () => {
      const ctx = canvas.getContext("2d");
      // `grid` is the primary dataset's overview grid — used for per-dataset data
      // (depth range for colormap legend, upscale request bbox, satellite tile).
      const grid = overviewGrid;
      const bitmap = bitmapRef.current;
      const t = transformRef.current;

      if (!ctx || !grid || !bitmap || !t) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Tick the fit-to-data tween BEFORE the dirty check so the animation
      // keeps running even when nothing else has changed.
      if (fitAnimRef.current) {
        const anim = fitAnimRef.current;
        const elapsed = performance.now() - anim.startTime;
        const progress = Math.min(1, elapsed / anim.duration);
        // Ease-in-out cubic
        const ease =
          progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        const from = anim.from;
        const to = anim.to;
        transformRef.current = {
          pxPerDeg: from.pxPerDeg + (to.pxPerDeg - from.pxPerDeg) * ease,
          scale: from.scale + (to.scale - from.scale) * ease,
          offsetX: from.offsetX + (to.offsetX - from.offsetX) * ease,
          offsetY: from.offsetY + (to.offsetY - from.offsetY) * ease,
        };
        dirtyRef.current = true;
        if (progress >= 1) {
          transformRef.current = to;
          fitAnimRef.current = null;
        }
      }

      // When multiple datasets are visible, `worldGrid` is a synthetic TerrainData
      // whose bbox spans the combined extent of all loaded overview grids.
      // All lon/lat → canvas projections use this so every dataset sits in a shared
      // coordinate frame.  Falls back to the primary grid when only one is loaded.
      const worldGrid = worldGridRef.current ?? grid;

      // Skip the draw when nothing has changed. GPS pulsing and trail recording
      // require continuous animation; everything else can wait for a dirty mark.
      if (!dirtyRef.current) {
        const gps = useGpsStore.getState();
        const trail = useTrailStore.getState();
        const alwaysAnimate =
          (gps.active && gps.position !== null) ||
          (trail.recording && trail.currentPoints.length > 0);
        if (!alwaysAnimate) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
      }
      dirtyRef.current = false;

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

      // Multi-dataset heatmap rendering:
      //   1. Secondary datasets (behind, in dataset order)
      //   2. Primary dataset (on top so it is never obscured)
      //
      // When only one dataset is loaded this collapses to the same single
      // renderHeatmap call that existed before.
      ctx.globalAlpha = 1.0;

      // Secondary heatmaps — rendered first so the primary sits on top.
      const visibleNow = visibleDatasetsRef.current;
      const primIdNow = primaryDatasetIdRef.current;
      if (visibleNow.length > 1) {
        for (const v of visibleNow) {
          if (v.datasetId === primIdNow) continue;
          const og = v.overviewGrid;
          const secBitmap = og ? secondaryBitmapsRef.current.get(v.datasetId) : undefined;
          if (!og || !secBitmap) continue;
          renderHeatmapAtBbox(ctx, secBitmap, og, worldGrid, t);
        }
      }

      // Primary heatmap — Topaz-upscaled when available, otherwise raw bitmap.
      const upscaled = upscaledBitmapRef.current;
      if (upscaled) {
        // Upscaled image covers the primary grid's bbox within world space.
        const [px0, py0] = lonLatToCanvas(grid.minLon, grid.maxLat, worldGrid, t);
        const [px1, py1] = lonLatToCanvas(grid.maxLon, grid.minLat, worldGrid, t);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(upscaled, px0, py0, px1 - px0, py1 - py0);
        ctx.imageSmoothingEnabled = true;
      } else {
        // Single-dataset fast path: renderHeatmap uses the legacy
        // (offsetX/offsetY) coordinates which equal lonLatToCanvas on the
        // primary grid.  For multi-dataset mode we position via bbox.
        if (worldGridRef.current) {
          renderHeatmapAtBbox(ctx, bitmap, grid, worldGrid, t);
        } else {
          renderHeatmap(ctx, bitmap, grid, t);
        }
      }
      ctx.globalAlpha = 1.0;

      // Dataset boundary outlines — thin dashed borders drawn over the heatmap
      // patches so the edges of each dataset are clearly visible.
      if (visibleNow.length > 1 && primIdNow) {
        for (const v of visibleNow) {
          const og = v.overviewGrid;
          if (!og) continue;
          const isPrimDataset = v.datasetId === primIdNow;
          ctx.save();
          ctx.beginPath();
          const corners: Array<[number, number]> = [
            [og.minLon, og.minLat],
            [og.maxLon, og.minLat],
            [og.maxLon, og.maxLat],
            [og.minLon, og.maxLat],
          ];
          corners.forEach(([lon, lat], i) => {
            const [px, py] = lonLatToCanvas(lon, lat, worldGrid, t);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.lineWidth = isPrimDataset ? 1.5 : 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = isPrimDataset
            ? "rgba(255,255,255,0.35)"
            : "rgba(0,229,255,0.55)";
          ctx.stroke();
          ctx.setLineDash([]);
          // Tiny label at the NW corner so users can identify each patch.
          const [lx, ly] = lonLatToCanvas(og.minLon, og.maxLat, worldGrid, t);
          ctx.fillStyle = isPrimDataset
            ? "rgba(255,255,255,0.70)"
            : "rgba(0,229,255,0.85)";
          ctx.font = "10px monospace";
          const patchLabel = datasetNameMapRef.current.get(og.datasetId) ?? og.datasetId;
          ctx.fillText(`◎ ${patchLabel}`, lx + 4, ly + 12);
          ctx.restore();
        }
      }

      // Contour lines — drawn over the heatmap, under the geographic grid and markers.
      const { overviewShowGrid, units, colormapTheme: activeTheme } = useSettingsStore.getState();
      if (contoursEnabledRef.current && contourSegmentsRef.current.length > 0) {
        // renderContourLines uses grid.width/height/minDepth/maxDepth and its own
        // internal lonLatToCanvas — must stay on the primary dataset's overviewGrid.
        renderContourLines(ctx, contourSegmentsRef.current, grid, t, units, activeTheme);
      }

      // Lat/lon grid (gated by user setting; renderGridLines also checks scale ≥ 2 internally)
      if (overviewShowGrid) {
        renderGridLines(ctx, worldGrid, t, cW, cH);
      }

      // Saved trails (completed)
      if (savedTrailsRef.current.length > 0) {
        renderSavedTrails(ctx, savedTrailsRef.current, worldGrid, t);
      }

      // Habitat overlay (drawn above depth heatmap, below markers)
      const habitatScores = useHabitatStore.getState().scores;
      const habitatActive = useHabitatStore.getState().activeSpecies !== null;
      if (habitatActive && habitatScores) {
        // renderHabitatOverlay scales habitat scores to the primary grid's bbox —
        // must use overviewGrid, not the synthetic world-extent grid.
        renderHabitatOverlay(ctx, habitatScores, grid, t);
      }

      // EFH overlay (dashed species polygon outlines + legend)
      // Hidden below POLYGON_LOD_MIN_ZOOM: polygons are too small to read and
      // add render noise without value when zoomed far out.
      if (showEfhRef.current && efhFeaturesRef.current.length > 0 && shouldDrawOverlayAtScale(t.scale)) {
        const visibleEfhFeatures = getVisibleEfhFeatures(
          efhFeaturesRef.current,
          { minLon: worldGrid.minLon, maxLon: worldGrid.maxLon, minLat: worldGrid.minLat, maxLat: worldGrid.maxLat },
          hiddenEfhSpeciesRef.current,
        );
        renderEfhOverlay(ctx, visibleEfhFeatures, worldGrid, t);
        efhLegendLayoutRef.current = renderEfhLegend(ctx, efhFeaturesRef.current, cW, cH, hiddenEfhSpeciesRef.current);
      } else {
        efhLegendLayoutRef.current = null;
      }

      // Substrate overlay (CMECS-coloured polygons + legend) — mirrors the
      // 3D SubstrateLayer so anglers can see the gravel / sand / mud zones
      // when planning from the top-down view.
      // Hidden below POLYGON_LOD_MIN_ZOOM: same rationale as EFH overlay.
      if (substrateColorModeRef.current && substrateFeaturesRef.current.length > 0 && shouldDrawOverlayAtScale(t.scale)) {
        renderSubstrateOverlay(
          ctx,
          substrateFeaturesRef.current,
          worldGrid,
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

      // Scale bar
      renderScaleBar(ctx, worldGrid, t, cH, units);

      // Colormap legend — top-right gradient strip with depth labels so users
      // can read off what the 2D colours mean, matching the 3D HUD scale bar.
      // Use the primary grid's depth range so the legend always reflects the
      // primary dataset's colour mapping.
      renderColormapLegend(ctx, activeTheme, grid.minDepth, grid.maxDepth, cW, cH, units);

      // Box-select / Download overlay (in-progress drag + committed bbox).
      // Painted on top of every other layer so the user can always see it.
      const drag = dragRectRef.current;

      /** Convert a committed lon/lat bbox to canvas pixel corners */
      const bboxToCanvasCorners = (north: number, south: number, east: number, west: number) => {
        const [x0, y0] = lonLatToCanvas(west, north, worldGrid, t);
        const [x1, y1] = lonLatToCanvas(east, south, worldGrid, t);
        return { x0, y0, x1, y1 };
      };

      if (drag) {
        const dl = canvasToLonLat(drag.x0, drag.y0, worldGrid, t);
        const dr = canvasToLonLat(drag.x1, drag.y1, worldGrid, t);
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

      // Compute RAWS canvas positions without drawing — kept for the e2e test helper
      // (registerRawsCanvasPositionGetter) so Playwright can locate pins by pixel coords.
      if (rawsActiveRef.current && rawsPinsRef.current.length > 0) {
        const MARGIN = 11;
        rawsCanvasPositionsRef.current = rawsPinsRef.current
          .map((s) => {
            const [cx, cy] = lonLatToCanvas(s.lon, s.lat, worldGrid, t);
            return { datasetId: s.datasetId, cx, cy };
          })
          .filter(({ cx, cy }) => cx >= -MARGIN && cx <= cW + MARGIN && cy >= -MARGIN && cy <= cH + MARGIN);
      } else {
        rawsCanvasPositionsRef.current = [];
      }

      // Push current transform to the SVG overlay state so React re-renders
      // SVG elements (markers, camera arrow, GPS dot, pins) in the correct position.
      setSvgTransform({ ...t });

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
    return () => {
      cancelAnimationFrame(rafRef.current);
      unsubCamera();
      unsubGps();
      unsubTrail();
    };
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
        dirtyRef.current = true;
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
      // Cancel any in-progress fit animation so manual pan takes over immediately.
      fitAnimRef.current = null;
    };

    const updateTooltip = (mx: number, my: number) => {
      const grid = overviewGrid; // primary grid — depth array lives here
      const t = transformRef.current;
      if (!grid || !t) return;

      // Use the world coordinate frame so the canvas → lon/lat conversion
      // works correctly when multiple datasets shift the transform origin.
      const activeGrid = worldGridRef.current ?? grid;
      const { lon, lat } = canvasToLonLat(mx, my, activeGrid, t);
      // Depth lookup is always from the primary grid (its bbox / depths array).
      const lonRange = lonRangeOf(grid);
      const latRange = grid.maxLat - grid.minLat || 1;
      const col = Math.round(((normaliseLon(lon, grid) - grid.minLon) / lonRange) * (grid.width - 1));
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
          dirtyRef.current = true;
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
        worldGridRef.current ?? overviewGrid,
        canvas.width,
        canvas.height,
      );
      dirtyRef.current = true;
    };

    const handleMouseUp = () => {
      // Commit the drawn rectangle as a bbox (if it has meaningful area).
      if ((selectModeRef.current || downloadModeRef.current) && dragRectRef.current) {
        const r = dragRectRef.current;
        const t = transformRef.current;
        dragRectRef.current = null;
        if (t && overviewGrid && Math.abs(r.x1 - r.x0) > 4 && Math.abs(r.y1 - r.y0) > 4) {
          const coordGrid = worldGridRef.current ?? overviewGrid;
          const a = canvasToLonLat(r.x0, r.y0, coordGrid, t);
          const b = canvasToLonLat(r.x1, r.y1, coordGrid, t);
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

      // Cancel any in-progress fit animation so manual zoom takes over immediately.
      fitAnimRef.current = null;
      transformRef.current = clampTransform(
        {
          ...t,
          scale: newScale,
          offsetX: mx + (t.offsetX - mx) * ratio,
          offsetY: my + (t.offsetY - my) * ratio,
        },
        worldGridRef.current ?? overviewGrid,
        canvas.width,
        canvas.height,
      );
      dirtyRef.current = true;
    };

    const handleClick = (e: MouseEvent) => {
      // Select / Download tool owns the canvas; never drop-in or open EFH while active.
      if (selectModeRef.current || downloadModeRef.current) return;
      if (hasDraggedRef.current) return;

      // Waypoint tool: drop a numbered pin at the click location.
      if (waypointModeRef.current) {
        const t = transformRef.current;
        if (!t || !overviewGrid) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const coordGrid = worldGridRef.current ?? overviewGrid;
        const { lon, lat } = canvasToLonLat(mx, my, coordGrid, t);
        setWaypoints((prev) => appendWaypoint(prev, lon, lat));
        setShowWaypointPanel(true);
        return;
      }
      const t = transformRef.current;
      if (!t || !overviewGrid) {
        // No terrain grid loaded yet — close the overlay to respect the dismiss
        // gesture even though a teleport isn't possible without coordinates.
        useUiStore.getState().setOverviewOpen(false);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Note: RAWS, weather station, and intertidal pin clicks are handled by
      // onClick on SVG elements (see SVG overlay below) — no canvas hit-test needed.

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

      const coordGrid = worldGridRef.current ?? overviewGrid;
      const { lon, lat } = canvasToLonLat(mx, my, coordGrid, t);

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
          if (v.source === "preset") {
            setDatasetId(v.datasetId);
          } else {
            setDatasetId(null);
            if (v.activeGrid) setTerrain(v.activeGrid);
          }
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
          { minLon: coordGrid.minLon, maxLon: coordGrid.maxLon, minLat: coordGrid.minLat, maxLat: coordGrid.maxLat },
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

      const ctxCoordGrid = worldGridRef.current ?? overviewGrid;
      const { lon, lat } = canvasToLonLat(mx, my, ctxCoordGrid, t);
      // Synthetic events (or exotic input devices) can carry non-finite
      // coordinates — opening the menu with garbage lon/lat would wire
      // NaN into pendingDropIn / lastClickedGps, so bail out instead.
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      // lonLatToWorldXZ uses the primary dataset's 3D coordinate frame — keep overviewGrid.
      const { x: worldX, z: worldZ } = lonLatToWorldXZ(lon, lat, overviewGrid);

      // Approximate depth at this lon/lat from the overview grid.
      const N = overviewGrid.resolution;
      const lonRange = lonRangeOf(overviewGrid);
      const latRange = overviewGrid.maxLat - overviewGrid.minLat || 1;
      const col = Math.max(
        0,
        Math.min(N - 1, Math.round(((normaliseLon(lon, overviewGrid) - overviewGrid.minLon) / lonRange) * (N - 1))),
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
  }, [overviewGrid, substrateCreditUrl, substrateSourceName, setDatasetId, setTerrain]);

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

      {/* SVG marker/pin overlay — positioned exactly over the canvas so SVG
          coordinates match canvas pixel coordinates 1:1.  All interactive pin
          elements carry pointerEvents:"all" so clicks don't fall through; the
          svg root uses pointerEvents:"none" so pan/zoom still reaches the canvas. */}
      {svgTransform && overviewGrid && (() => {
        const wg = worldGridRef.current ?? overviewGrid;
        const cW = canvasRef.current?.width ?? window.innerWidth;
        const cH = canvasRef.current?.height ?? window.innerHeight;
        const MARGIN = 14;
        const inCanvas = (cx: number, cy: number, m = MARGIN) =>
          cx >= -m && cx <= cW + m && cy >= -m && cy <= cH + m;

        return (
          <svg
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              overflow: "visible",
              zIndex: 41,
            }}
          >
            <defs>
              <filter id="ov-marker-glow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="2" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="ov-cam-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* ── Depth poles ───────────────────────────────────────────────── */}
            {overviewShowMarkers && markersRef.current.map((m) => {
              if (m.type !== "depth_pole") return null;
              if (m.depth === undefined || m.depth === null) return null;
              const [cx, cy] = lonLatToCanvas(m.lon, m.lat, wg, svgTransform);
              if (!inCanvas(cx, cy, 30)) return null;
              let colour = "#00ffee";
              try {
                const parsed = JSON.parse(m.notes ?? "{}") as Record<string, unknown>;
                if (typeof parsed["colour"] === "string") colour = parsed["colour"];
              } catch { /* ignored */ }
              const units = useSettingsStore.getState().units;
              const depthText = units === "imperial"
                ? `-${(m.depth * 3.28084).toFixed(0)} ft`
                : `-${m.depth.toFixed(0)} m`;
              return (
                <g key={`pole-${m.id}`} pointerEvents="none">
                  <line x1={cx} y1={cy} x2={cx} y2={cy - 14} stroke={colour} strokeWidth={1.5} opacity={0.85} />
                  <circle cx={cx} cy={cy - 14} r={3.5} fill={colour} opacity={0.5} />
                  <text
                    x={cx + 5} y={cy - 14}
                    fill={colour} fontSize={8} dominantBaseline="middle"
                    fontFamily="'JetBrains Mono', monospace" opacity={0.9}
                  >{depthText}</text>
                </g>
              );
            })}

            {/* ── Markers ───────────────────────────────────────────────────── */}
            {overviewShowMarkers && markersRef.current.map((m) => {
              const [cx, cy] = lonLatToCanvas(m.lon, m.lat, wg, svgTransform);
              if (!inCanvas(cx, cy)) return null;
              const colour = (MARKER_COLOR as Record<string, string>)[m.type] ?? "#e2e8f0";
              const r = Math.max(3.5, Math.min(9, svgTransform.scale * 1.8));
              return (
                <g key={`mk-${m.id}`} pointerEvents="none" filter="url(#ov-marker-glow)">
                  <circle cx={cx} cy={cy} r={r} fill={colour} opacity={0.92} />
                  {svgTransform.scale >= 3 && (
                    <text
                      x={cx + r + 4} y={cy}
                      fill={colour} fontSize={11} dominantBaseline="middle"
                      fontFamily="'JetBrains Mono', monospace" opacity={0.9}
                    >{m.label}</text>
                  )}
                </g>
              );
            })}

            {/* ── Camera arrow ──────────────────────────────────────────────── */}
            {cameraLon !== null && cameraLat !== null && (() => {
              const [cx, cy] = lonLatToCanvas(cameraLon, cameraLat, wg, svgTransform);
              if (!inCanvas(cx, cy, 20)) return null;
              const size = 11;
              const rot = 180 - cameraHeading;
              return (
                <polygon
                  points={`0,${-size} ${size * 0.6},${size * 0.65} 0,0 ${-size * 0.6},${size * 0.65}`}
                  fill="#d4ac0d"
                  opacity={0.95}
                  filter="url(#ov-cam-glow)"
                  transform={`translate(${cx},${cy}) rotate(${rot})`}
                  pointerEvents="none"
                />
              );
            })()}

            {/* ── GPS live trail ────────────────────────────────────────────── */}
            {(() => {
              const trail = useTrailStore.getState();
              if (!trail.recording || trail.currentPoints.length < 2) return null;
              const pts = trail.currentPoints
                .map(p => { const [x, y] = lonLatToCanvas(p.lon, p.lat, wg, svgTransform); return `${x},${y}`; })
                .join(' ');
              const last = trail.currentPoints[trail.currentPoints.length - 1]!;
              const [lx, ly] = lonLatToCanvas(last.lon, last.lat, wg, svgTransform);
              return (
                <g pointerEvents="none">
                  <polyline points={pts} fill="none" stroke="#f97316" strokeWidth={2}
                    strokeLinejoin="round" strokeLinecap="round" opacity={0.85}
                    filter="url(#ov-marker-glow)" />
                  <circle cx={lx} cy={ly} r={4} fill="#f97316">
                    <animate attributeName="r" values="4;7;4" dur="1.2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.85;0.2;0.85" dur="1.2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={lx} cy={ly} r={4} fill="#f97316" opacity={0.95} />
                </g>
              );
            })()}

            {/* ── GPS dot ───────────────────────────────────────────────────── */}
            {gpsActive && gpsPosition && (() => {
              const lon = gpsPosition.longitude;
              const lat = gpsPosition.latitude;
              const [cx, cy] = lonLatToCanvas(lon, lat, wg, svgTransform);
              const inBounds = inCanvas(cx, cy, 0);

              if (inBounds) {
                const lonRange = lonRangeOf(wg);
                const terrainW = svgTransform.pxPerDeg * lonRange * svgTransform.scale;
                const mPerPx = lonRange > 0 ? (lonRange * 111_320) / terrainW : 1;
                const accuracyR = Math.max(8, gpsPosition.accuracy / mPerPx);
                return (
                  <g pointerEvents="none">
                    <circle cx={cx} cy={cy} r={accuracyR}
                      fill="none" stroke="rgba(59,130,246,0.35)"
                      strokeWidth={1} strokeDasharray="4 3" />
                    <circle cx={cx} cy={cy} r={10}
                      fill="none" stroke="rgba(59,130,246,0.25)" strokeWidth={1.5}>
                      <animate attributeName="r" values="8;15;8" dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={cx} cy={cy} r={5} fill="#3b82f6" />
                  </g>
                );
              } else {
                // Out-of-bounds — render an edge arrow pointing to GPS
                const centerX = cW / 2;
                const centerY = cH / 2;
                const angle = Math.atan2(cy - centerY, cx - centerX);
                const EM = 20;
                const ex = Math.max(EM, Math.min(cW - EM, centerX + Math.cos(angle) * (cW / 2 - EM)));
                const ey = Math.max(EM, Math.min(cH - EM, centerY + Math.sin(angle) * (cH / 2 - EM)));
                const ar = 7;
                const ax0 = ex + Math.cos(angle) * ar;
                const ay0 = ey + Math.sin(angle) * ar;
                const ax1 = ex + Math.cos(angle - 2.4) * ar * 0.7;
                const ay1 = ey + Math.sin(angle - 2.4) * ar * 0.7;
                const ax2 = ex + Math.cos(angle + 2.4) * ar * 0.7;
                const ay2 = ey + Math.sin(angle + 2.4) * ar * 0.7;
                return (
                  <g pointerEvents="none" opacity={0.85}>
                    <polygon
                      points={`${ax0},${ay0} ${ax1},${ay1} ${ax2},${ay2}`}
                      fill="#3b82f6" />
                  </g>
                );
              }
            })()}

            {/* ── Weather station pins ──────────────────────────────────────── */}
            {weatherStationActiveRef.current && weatherStationPinsRef.current.map((pin) => {
              const [cx, cy] = lonLatToCanvas(pin.lon, pin.lat, wg, svgTransform);
              if (!inCanvas(cx, cy)) return null;
              const isSelected = weatherStationSelectedIdRef.current === pin.id;
              return (
                <g
                  key={`wx-${pin.id}`}
                  style={{ cursor: "pointer", pointerEvents: "all" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const stationData = weatherStationDataRef.current.get(pin.id) ?? null;
                    if (!stationData) return;
                    if (isSelected) {
                      weatherStationSelectedIdRef.current = null;
                      setSelectedWeatherStation(null);
                    } else {
                      weatherStationSelectedIdRef.current = pin.id;
                      setSelectedWeatherStation(stationData);
                      rawsSelectedIdRef.current = null;
                      setSelectedRawsDatasetId(null);
                    }
                    dirtyRef.current = true;
                  }}
                >
                  {isSelected && (
                    <circle cx={cx} cy={cy} r={11} fill="rgba(251,191,36,0.18)" />
                  )}
                  <circle cx={cx} cy={cy} r={isSelected ? 7 : 5}
                    fill={isSelected ? "#fde68a" : "#fbbf24"}
                    stroke={isSelected ? "#f59e0b" : "rgba(0,0,0,0.5)"}
                    strokeWidth={isSelected ? 1.5 : 1} />
                  <text x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="central"
                    fill={isSelected ? "#78350f" : "#451a03"}
                    fontSize={isSelected ? 7 : 6}
                    fontFamily="sans-serif" fontWeight="bold"
                    pointerEvents="none"
                  >W</text>
                </g>
              );
            })}

            {/* ── RAWS station pins ─────────────────────────────────────────── */}
            {rawsActiveRef.current && rawsPinsRef.current.map((pin) => {
              const [cx, cy] = lonLatToCanvas(pin.lon, pin.lat, wg, svgTransform);
              if (!inCanvas(cx, cy)) return null;
              const isSelected = rawsSelectedIdRef.current === pin.datasetId;
              return (
                <g
                  key={`raws-${pin.datasetId}`}
                  style={{ cursor: "pointer", pointerEvents: "all" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSelected) {
                      rawsSelectedIdRef.current = null;
                      setSelectedRawsDatasetId(null);
                    } else {
                      rawsSelectedIdRef.current = pin.datasetId;
                      setSelectedRawsDatasetId(pin.datasetId);
                      weatherStationSelectedIdRef.current = null;
                      setSelectedWeatherStation(null);
                    }
                    dirtyRef.current = true;
                  }}
                >
                  {isSelected && (
                    <circle cx={cx} cy={cy} r={11} fill="rgba(52,211,153,0.18)" />
                  )}
                  <circle cx={cx} cy={cy} r={isSelected ? 7 : 5}
                    fill={isSelected ? "#6ee7b7" : "#34d399"}
                    stroke={isSelected ? "#059669" : "rgba(0,0,0,0.5)"}
                    strokeWidth={isSelected ? 1.5 : 1} />
                  <text x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="central"
                    fill={isSelected ? "#065f46" : "#064e3b"}
                    fontSize={isSelected ? 7 : 6}
                    fontFamily="sans-serif" fontWeight="bold"
                    pointerEvents="none"
                  >R</text>
                </g>
              );
            })}

            {/* ── Waypoint connecting line ──────────────────────────────────── */}
            {waypoints.length >= 2 && (() => {
              const pts = waypoints.map(wp => {
                const [cx, cy] = lonLatToCanvas(wp.lon, wp.lat, wg, svgTransform);
                return `${cx},${cy}`;
              }).join(' ');
              return (
                <polyline
                  points={pts}
                  fill="none"
                  stroke="#a855f7"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  opacity={0.55}
                  pointerEvents="none"
                />
              );
            })()}

            {/* ── Waypoint pins ─────────────────────────────────────────────── */}
            {waypoints.map((wp, i) => {
              const [cx, cy] = lonLatToCanvas(wp.lon, wp.lat, wg, svgTransform);
              if (!inCanvas(cx, cy, 20)) return null;
              return (
                <g key={`wp-${wp.id}`} pointerEvents="none">
                  <circle cx={cx} cy={cy} r={10} fill="#a855f7" opacity={0.85} />
                  <circle cx={cx} cy={cy} r={10} fill="none" stroke="#e879f9" strokeWidth={1.5} opacity={0.6} />
                  <text
                    x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="central"
                    fill="white" fontSize={9} fontWeight="bold"
                    fontFamily="sans-serif"
                    pointerEvents="none"
                  >{i + 1}</text>
                </g>
              );
            })}

            {/* ── Intertidal hotspot pins ───────────────────────────────────── */}
            {intertidalHotspotsEnabledRef.current && intertidalPinsRef.current.map((pin) => {
              const [cx, cy] = lonLatToCanvas(pin.lon, pin.lat, wg, svgTransform);
              if (!inCanvas(cx, cy)) return null;
              const isSelected = intertidalSelectedUnitIdRef.current === pin.unitId;
              const baseColor = pin.color;
              const scoreFrac = Math.max(0, Math.min(100, pin.score)) / 100;
              const R = (isSelected ? 7 : 4) + scoreFrac * 4;
              const fillOpacity = 0.55 + scoreFrac * 0.35;
              const borderOpacity = 0.8 + scoreFrac * 0.2;
              return (
                <g
                  key={`it-${pin.unitId}`}
                  style={{ cursor: "pointer", pointerEvents: "all" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const hotspot = intertidalHotspotDataRef.current.get(pin.unitId) ?? null;
                    if (!hotspot) return;
                    if (isSelected) {
                      intertidalSelectedUnitIdRef.current = null;
                      useUiStore.getState().setSelectedHotspot(null);
                    } else {
                      intertidalSelectedUnitIdRef.current = pin.unitId;
                      useUiStore.getState().setSelectedHotspot(hotspot);
                    }
                    dirtyRef.current = true;
                  }}
                >
                  {isSelected && (
                    <circle cx={cx} cy={cy} r={R + 5} fill={baseColor} fillOpacity={0.18} />
                  )}
                  <circle cx={cx} cy={cy} r={R}
                    fill={baseColor} fillOpacity={fillOpacity}
                    stroke={baseColor} strokeOpacity={borderOpacity}
                    strokeWidth={isSelected ? 2 : 1.5} />
                  <text x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="central"
                    fill="white" opacity={0.9}
                    fontSize={R > 6 ? 7 : 6}
                    fontFamily="sans-serif" fontWeight="bold"
                    pointerEvents="none"
                  >{pin.color === "#0d9488" ? "T" : "B"}</text>
                </g>
              );
            })}
          </svg>
        );
      })()}

      {/* Intertidal mode legend — positioned bottom-right above the scale bar */}
      {intertidalHotspotsEnabled && intertidalPinsRef.current.length > 0 && (
        <div
          style={{
            position: "absolute",
            right: 8,
            bottom: 30,
            background: "rgba(2,8,24,0.85)",
            border: `1px solid ${intertidalScoreMode === "tidepool" ? "rgba(13,148,136,0.35)" : "rgba(217,119,6,0.35)"}`,
            borderRadius: 3,
            padding: "6px 8px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            zIndex: 41,
            pointerEvents: "none",
          }}
        >
          <div style={{ color: "#94a3b8", marginBottom: 3, letterSpacing: "0.1em" }}>INTERTIDAL</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <svg width={8} height={8} style={{ flexShrink: 0 }}>
              <circle cx={4} cy={4} r={4} fill={intertidalScoreMode === "tidepool" ? "#0d9488" : "#d97706"} />
            </svg>
            <span style={{ color: intertidalScoreMode === "tidepool" ? "#0d9488" : "#d97706" }}>
              {intertidalScoreMode === "tidepool" ? "TIDEPOOL" : "BEACHCOMBING"}
            </span>
          </div>
        </div>
      )}

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


          {/* Fit to Data — zoom and pan to frame all loaded datasets */}
          <ViewscreenTooltip label="Zoom and pan to fit all loaded datasets in view" side="bottom">
            <button
              data-testid="overview-fit-to-data"
              onClick={handleFitToData}
              disabled={datasetsWithGrid.length === 0}
              style={{
                background: "rgba(0,10,20,0.75)",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 3,
                color: datasetsWithGrid.length === 0 ? "#475569" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                padding: "2px 10px",
                cursor: datasetsWithGrid.length === 0 ? "not-allowed" : "pointer",
                letterSpacing: "0.1em",
                lineHeight: "20px",
                whiteSpace: "nowrap",
                opacity: datasetsWithGrid.length === 0 ? 0.45 : 1,
              }}
            >
              ⊡ FIT
            </button>
          </ViewscreenTooltip>


          {/* Tools popover — collapses box-select and download into one button */}
          <div ref={toolsWrapperRef} style={{ position: "relative" }}>
            <ViewscreenTooltip label="Area tools: box-select or download" side="bottom">
              <button
                data-testid="overview-tools-toggle"
                aria-expanded={toolsPopoverOpen}
                aria-haspopup="true"
                onClick={() => setToolsPopoverOpen((v) => !v)}
                style={{
                  background: (selectMode || downloadMode || waypointMode)
                    ? "rgba(0,229,255,0.12)"
                    : toolsPopoverOpen
                    ? "rgba(0,229,255,0.08)"
                    : "rgba(0,10,20,0.75)",
                  border: `1px solid ${
                    (selectMode || downloadMode || waypointMode)
                      ? "rgba(0,229,255,0.6)"
                      : toolsPopoverOpen
                      ? "rgba(0,229,255,0.4)"
                      : "rgba(0,229,255,0.2)"
                  }`,
                  borderRadius: 3,
                  color: (selectMode || downloadMode || waypointMode) ? "#00e5ff" : toolsPopoverOpen ? "#7dd3fc" : "#94a3b8",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  padding: "2px 10px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "20px",
                  whiteSpace: "nowrap",
                }}
              >
                {selectMode ? "▭ SELECT" : downloadMode ? "↓ DOWNLOAD" : waypointMode ? "📍 WAYPOINTS" : "⚙ TOOLS"}
              </button>
            </ViewscreenTooltip>

            <div
              data-testid="overview-tools-popover"
              role="menu"
              style={{
                display: toolsPopoverOpen ? "block" : "none",
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                background: "rgba(2,8,24,0.97)",
                border: "1px solid rgba(0,229,255,0.25)",
                borderRadius: 4,
                backdropFilter: "blur(8px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
                zIndex: 50,
                minWidth: 168,
                overflow: "hidden",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
                <div
                  style={{
                    padding: "5px 10px 4px",
                    borderBottom: "1px solid rgba(0,229,255,0.1)",
                    fontSize: 8,
                    color: "#64748b",
                    letterSpacing: "0.18em",
                  }}
                >
                  TOOLS
                </div>

                {/* Box-Select row */}
                <button
                  data-testid="overview-select-area-toggle"
                  role="menuitem"
                  aria-pressed={selectMode}
                  onClick={() => {
                    const next = !selectMode;
                    setSelectMode(next);
                    if (next) { setDownloadMode(false); setWaypointMode(false); setDownloadBbox(null); }
                    if (!next) clearBbox();
                    setToolsPopoverOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "7px 10px",
                    background: selectMode ? "rgba(0,229,255,0.1)" : "transparent",
                    border: "none",
                    borderBottom: "1px solid rgba(0,229,255,0.07)",
                    color: selectMode ? "#00e5ff" : "#cbd5e1",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>▭</span>
                  <span style={{ flex: 1 }}>BOX SELECT</span>
                  {selectMode && (
                    <span style={{ fontSize: 8, color: "#00e5ff", opacity: 0.85 }}>● ON</span>
                  )}
                </button>

                {/* Download row */}
                <button
                  data-testid="overview-download-toggle"
                  role="menuitem"
                  aria-pressed={downloadMode}
                  onClick={() => {
                    const next = !downloadMode;
                    setDownloadMode(next);
                    if (next) { setSelectMode(false); setWaypointMode(false); clearBbox(); }
                    if (!next) { setDownloadBbox(null); dragRectRef.current = null; }
                    setToolsPopoverOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "7px 10px",
                    background: downloadMode ? "rgba(251,191,36,0.1)" : "transparent",
                    border: "none",
                    borderBottom: "1px solid rgba(0,229,255,0.07)",
                    color: downloadMode ? "#fbbf24" : "#cbd5e1",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>↓</span>
                  <span style={{ flex: 1 }}>DOWNLOAD</span>
                  {downloadMode && (
                    <span style={{ fontSize: 8, color: "#fbbf24", opacity: 0.85 }}>● ON</span>
                  )}
                </button>

                {/* Waypoints row */}
                <button
                  data-testid="overview-waypoint-mode-toggle"
                  role="menuitem"
                  aria-pressed={waypointMode}
                  onClick={() => {
                    const next = !waypointMode;
                    setWaypointMode(next);
                    if (next) { setSelectMode(false); setDownloadMode(false); clearBbox(); setDownloadBbox(null); dragRectRef.current = null; }
                    setToolsPopoverOpen(false);
                    if (next) setShowWaypointPanel(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "7px 10px",
                    background: waypointMode ? "rgba(168,85,247,0.12)" : "transparent",
                    border: "none",
                    color: waypointMode ? "#c084fc" : "#cbd5e1",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>📍</span>
                  <span style={{ flex: 1 }}>WAYPOINTS</span>
                  {waypointMode && (
                    <span style={{ fontSize: 8, color: "#c084fc", opacity: 0.85 }}>● ON</span>
                  )}
                </button>
              </div>
          </div>

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

          {/* Waypoints panel toggle — visible when waypoints exist or mode is on */}
          {(waypoints.length > 0 || waypointMode) && (
            <ViewscreenTooltip label="Show waypoint list" side="bottom">
            <button
              data-testid="overview-waypoint-panel-toggle"
              onClick={() => setShowWaypointPanel((v) => !v)}
              style={{
                background: showWaypointPanel ? "rgba(168,85,247,0.18)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${showWaypointPanel ? "rgba(168,85,247,0.55)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: showWaypointPanel ? "#c084fc" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                padding: "2px 10px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                lineHeight: "20px",
                whiteSpace: "nowrap",
              }}
            >
              📍 WAYPOINTS ({waypoints.length})
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

      {/* Waypoint list panel */}
      {showWaypointPanel && (
        <WaypointListPanel
          waypoints={waypoints}
          waypointMode={waypointMode}
          onReorder={setWaypoints}
          onDelete={(id) =>
            setWaypoints((prev) => {
              const next = prev.filter((w) => w.id !== id);
              return next.map((w, i) => ({ ...w, label: String(i + 1) }));
            })
          }
          onFlyThrough={flyThroughWaypoints}
          onClose={() => setShowWaypointPanel(false)}
        />
      )}

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

      {/* NOAA Weather Station popover — anchored to the station's current SVG position
          so it follows the pin automatically when the user pans or zooms. */}
      {selectedWeatherStation && svgTransform && overviewGrid && canvasRef.current && (() => {
        const wg = worldGridRef.current ?? overviewGrid;
        const [pinX, pinY] = lonLatToCanvas(
          selectedWeatherStation.lon,
          selectedWeatherStation.lat,
          wg,
          svgTransform,
        );
        return (
          <WeatherStationPopover
            station={selectedWeatherStation}
            pinX={pinX}
            pinY={pinY}
            containerWidth={canvasRef.current!.width}
            faaWeatherCamsUrl={faaWeatherCamsUrl}
            stale={weatherStationsStale}
            timelineTime={timelineCurrentTime}
            timelineActive={timelineVisible}
            onClose={() => {
              weatherStationSelectedIdRef.current = null;
              setSelectedWeatherStation(null);
            }}
          />
        );
      })()}

      {/* RAWS Station popover — anchored to the station's current SVG position. */}
      {selectedRawsDatasetId && svgTransform && overviewGrid && canvasRef.current && (() => {
        const station = rawsDataRef.current.get(selectedRawsDatasetId);
        if (!station) return null;
        const wg = worldGridRef.current ?? overviewGrid;
        const [pinX, pinY] = lonLatToCanvas(station.lon, station.lat, wg, svgTransform);
        return (
          <RawsStationPopover
            datasetId={selectedRawsDatasetId}
            stationName={station.name ?? selectedRawsDatasetId}
            pinX={pinX}
            pinY={pinY}
            containerWidth={canvasRef.current!.width}
            timelineTime={timelineCurrentTime}
            timelineActive={timelineVisible}
            onClose={() => {
              rawsSelectedIdRef.current = null;
              setSelectedRawsDatasetId(null);
            }}
          />
        );
      })()}

      {/* The shared EFH species detail panel is rendered once at the App
          root so it sits above both this overview map and the 3D scene. */}
    </div>
  );
};

// ---------------------------------------------------------------------------
// WaypointListPanel — compact list with drag-to-reorder and fly-through
// ---------------------------------------------------------------------------
interface WaypointListPanelProps {
  waypoints: Waypoint[];
  waypointMode: boolean;
  onReorder: (waypoints: Waypoint[]) => void;
  onDelete: (id: string) => void;
  onFlyThrough: () => void;
  onClose: () => void;
}

const WaypointListPanel: React.FC<WaypointListPanelProps> = ({
  waypoints,
  waypointMode,
  onReorder,
  onDelete,
  onFlyThrough,
  onClose,
}) => {
  const dragIdxRef = React.useRef<number | null>(null);

  const MONO: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
  };

  const handleDragStart = (i: number) => { dragIdxRef.current = i; };

  const handleDrop = (i: number) => {
    const from = dragIdxRef.current;
    dragIdxRef.current = null;
    if (from === null || from === i) return;
    const next = [...waypoints];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(i, 0, item);
    onReorder(next.map((w, idx) => ({ ...w, label: String(idx + 1) })));
  };

  return (
    <div
      data-testid="overview-waypoint-panel"
      style={{
        position: "absolute",
        top: 44,
        right: 16,
        width: 280,
        maxHeight: "65vh",
        overflowY: "auto",
        background: "rgba(2,8,24,0.92)",
        border: "1px solid rgba(168,85,247,0.25)",
        borderRadius: 6,
        zIndex: 43,
        backdropFilter: "blur(8px)",
        pointerEvents: "auto",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid rgba(168,85,247,0.15)",
        }}
      >
        <span style={{ ...MONO, letterSpacing: "0.15em", color: "#c084fc" }}>
          WAYPOINTS{waypoints.length > 0 ? ` (${waypoints.length})` : ""}
        </span>
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

      {/* Empty state hint */}
      {waypoints.length === 0 && (
        <div
          style={{
            padding: "14px 12px",
            ...MONO,
            fontSize: 9,
            color: "#64748b",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          {waypointMode
            ? "Click the map to drop waypoints"
            : "Enable Waypoints in ⚙ Tools to start"}
        </div>
      )}

      {/* Waypoint rows (drag-to-reorder) */}
      {waypoints.map((wp, i) => (
        <div
          key={wp.id}
          draggable
          onDragStart={() => handleDragStart(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(i)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px 6px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            cursor: "grab",
            userSelect: "none",
          }}
        >
          {/* Numbered circle */}
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#a855f7",
              border: "1.5px solid #e879f9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: 9,
              fontWeight: "bold",
              color: "white",
              fontFamily: "sans-serif",
            }}
          >
            {i + 1}
          </div>

          {/* Coordinates */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...MONO, color: "#e2e8f0", fontSize: 9, lineHeight: 1.4 }}>
              {wp.lat.toFixed(4)}°, {wp.lon.toFixed(4)}°
            </div>
          </div>

          {/* Drag handle */}
          <span style={{ color: "#475569", fontSize: 13, cursor: "grab" }}>⠿</span>

          {/* Delete button */}
          <button
            onClick={() => onDelete(wp.id)}
            title="Remove waypoint"
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              fontSize: 12,
              lineHeight: 1,
              padding: "3px 4px",
              flexShrink: 0,
              borderRadius: 3,
            }}
          >
            ✕
          </button>
        </div>
      ))}

      {/* Fly Through button */}
      <div style={{ padding: "10px 12px" }}>
        <button
          data-testid="overview-waypoint-fly-through"
          onClick={onFlyThrough}
          disabled={waypoints.length < 2}
          style={{
            width: "100%",
            background:
              waypoints.length >= 2 ? "rgba(168,85,247,0.2)" : "rgba(168,85,247,0.05)",
            border: `1px solid ${waypoints.length >= 2 ? "rgba(168,85,247,0.6)" : "rgba(168,85,247,0.2)"}`,
            borderRadius: 3,
            color: waypoints.length >= 2 ? "#c084fc" : "#475569",
            padding: "5px 10px",
            cursor: waypoints.length < 2 ? "not-allowed" : "pointer",
            fontSize: 9,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.12em",
            opacity: waypoints.length < 2 ? 0.5 : 1,
          }}
        >
          {waypoints.length >= 2
            ? `▶ FLY THROUGH (${waypoints.length} stops)`
            : "▶ FLY THROUGH — need 2+ waypoints"}
        </button>
      </div>
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
