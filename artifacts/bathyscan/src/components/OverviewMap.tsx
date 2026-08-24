import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  useGetMarkers,
  getGetMarkersQueryKey,
  useGetCatches,
  getGetCatchesQueryKey,
  useGetTrails,
  getGetTrailsQueryKey,
  getTrailsIdPoints,
  useGetDatasets,
  getGetDatasetsQueryKey,
  usePostDatasetsBboxQuery,
  usePostDatasetsPointRadiusQuery,
  useGetDatasetsMySaves,
  getGetDatasetsMySavesQueryKey,
  usePostDatasetsCatalogIdSave,
  useGetEfh,
  getGetEfhQueryKey,
  useGetSubstrate,
  getGetSubstrateQueryKey,
  useGetIntertidalSpots,
  getGetIntertidalSpotsQueryKey,
  useGetUserDatasets,
  getGetUserDatasetsQueryKey,
  getGetDatasetsIdOverviewQueryKey,
  getGetUserDatasetsIdOverviewQueryKey,
  postUserCollectionsIdLayout,
  patchUserCollectionsIdMeta,
  deleteUserCollectionsIdLayoutRevisionId,
  type LayoutRevision,
  type Marker,
  type GpsTrail,
  type DatasetCatalogSearchResult,
  type SubstrateFeature,
  type SubstrateFeatureCollection,
  type EfhFeature,
} from "@workspace/api-client-react";
import { OtherDataSection } from "@/components/OtherDataSection";
import { useAppState } from "@/lib/context";
import { useTerrainStore, sortByRecency } from "@/lib/terrainStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore, useTimelineVisible, type SelectedHotspot } from "@/lib/uiStore";
import { useTimelineStore } from "@/lib/timelineStore";
import { useContextMenuStore, type ContextMenuItem } from "@/lib/contextMenuStore";
import { lonLatToWorldXZ, isSyntheticGrid } from "@/lib/terrain";
import {
  puzzleLayoutToGeoCorrections,
  rebasePuzzleTransformsForView,
  type GeoBbox,
} from "@/lib/puzzleTransform";
import {
  buildHeatmapBitmap,
  buildContourLines,
  buildNodataBoundarySegments,
  computeInitialTransform,
  computeFitTransform,
  clampTransform,
  canvasToLonLat,
  lonLatToCanvas,
  lonRangeOf,
  normaliseLon,
  renderHeatmap,
  renderHeatmapAtBbox,
  renderSyntheticHatch,
  renderNodataBoundary,
  renderContourLines,
  renderIntertidalBand,
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
  renderSavedDrifts,
  hitTestSavedDrifts,
  drawSelectionRect,
  buildIntertidalHotspotDescriptors,
  shouldDrawOverlayAtScale,
  drawBackgroundImage,
  hasValidBgGeoAnchorPair,
  computeGapOverlapMask,
  drawGapOverlap,
  GAP_OVERLAP_STEP_PX,
  type GapOverlapMask,
  type GapOverlapTileInput,
  type ContourSegment,
  type EfhLegendLayout,
  type OverviewTransform,
  type CanvasSavedTrail,
  type NodataBoundarySegment,
  type WeatherStationPin,
  type RawsStationPin,
  type IntertidalHotspotPin,
} from "@/lib/overviewRenderer";
import { appendWaypoint, planFlyThroughStops, type Waypoint } from "@/lib/waypointHelpers";
import { MARKER_COLOR } from "@/lib/markerConstants";
import { MarkerIconPaths } from "@/lib/markerIcons";
import { useWeatherStations, type WeatherStation } from "@/hooks/useWeatherStations";
import { WeatherStationPopover } from "@/components/WeatherStationLayer";
import { useRawsStations, type RawsStationItem } from "@/hooks/useRawsStations";
import { RawsStationPopover } from "@/components/RawsStationLayer";
import { useHabitatStore } from "@/lib/habitatStore";
import { filterEfhByBbox, getVisibleEfhFeatures } from "@/lib/efhBboxFilter";
import { HabitatLegend } from "@/components/HabitatLegend";
import { useGpsStore } from "@/lib/gpsStore";
import { useTrailStore } from "@/lib/trailStore";
import { useSettingsStore, type PuzzleLayout } from "@/lib/settingsStore";
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
  registerPuzzleTestHandlers,
  markPuzzleBridgeReady,
} from "@/lib/testHelpers";
import { useSubstrateErrorToast } from "@/hooks/useSubstrateErrorToast";
import { approxBboxForRadius } from "@/lib/coordinateParser";
import { useSubstrateCoverageToast } from "@/hooks/useSubstrateCoverageToast";
import { useIntertidal } from "@/lib/useIntertidal";
import { IntertidalBandLegend } from "@/components/IntertidalBandLegend";
import { usePuzzleStore, type PuzzleTransform } from "@/lib/puzzleStore";
import { useSpecialCollectionStore } from "@/lib/specialCollectionStore";
import { computeSnapAdjustment, type SnapEdgeSeg, type SnapRect } from "@/lib/puzzleSnap";
import { buildRestoredPuzzleState, applyDragTranslation } from "@/lib/puzzleRestore";
import { CatalogResultFilters } from "@/components/CatalogResultFilters";
import { filterCatalogResults, EMPTY_CATALOG_RESULT_FILTERS, type CatalogResultFilters as CatalogFilters } from "@/lib/catalogResultFilters";

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  lon: number;
  lat: number;
  depth: number;
}

/**
 * Expand a selection set to include all group co-members of any newly-added tile.
 * Only tiles that weren't in `oldIds` trigger group expansion, so removing a
 * tile via shift-click does not re-pull in its group mates.
 */
function expandWithGroupMembers(
  newIds: Set<string>,
  oldIds: Set<string>,
  groups: Map<string, Set<string>>,
): Set<string> {
  const result = new Set(newIds);
  for (const id of newIds) {
    if (oldIds.has(id)) continue; // not newly added — skip expansion
    for (const [, members] of groups) {
      if (members.has(id)) {
        for (const m of members) result.add(m);
        break; // each tile is in at most one group (no nested groups)
      }
    }
  }
  return result;
}

/**
 * Canonical signature of a puzzle layout (positions, rotation, lock, note) —
 * compared against the last saved/restored signature to detect unsaved
 * changes before switching server layout revisions.
 */
function layoutSignatureOf(
  transforms: ReadonlyMap<string, PuzzleTransform>,
  groups: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): string {
  const entries = [...transforms.entries()]
    .map(([id, xf]) => [id, xf.tx, xf.ty, xf.angleDeg, !!xf.locked, xf.annotation ?? ""] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const groupEntries = [...groups.values()]
    .map((members) => [...members].sort())
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ entries, groups: groupEntries });
}

const OVERVIEW_CONTROLS_TOP_OFFSET = 36;

const PUZZLE_LAYOUTS_SYNC_KEY = "bathyscan:puzzleLayouts:event";
const PUZZLE_TRANSFORMS_DENSITY_KEY = "bathyscan:puzzleTransforms:density";

type PuzzleLayoutSyncEvent =
  | { type: "save"; layout: PuzzleLayout }
  | { type: "delete"; id: string };

function broadcastPuzzleLayoutEvent(event: PuzzleLayoutSyncEvent): void {
  try {
    localStorage.setItem(PUZZLE_LAYOUTS_SYNC_KEY, JSON.stringify(event));
  } catch {
    // The settings store remains authoritative if browser storage is unavailable.
  }
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
  const overviewFetchErrorIds = useTerrainStore((s) => s.overviewFetchErrorIds);
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
  const puzzleLayouts = useSettingsStore((s) => s.puzzleLayouts);
  const datasetId = overviewGrid?.datasetId ?? appTerrain?.datasetId ?? "";
  const { data: markerData } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  const { data: catchData } = useGetCatches(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetCatchesQueryKey({ datasetId }) } },
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
  const overviewRootRef = useRef<HTMLDivElement>(null);

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
  /** Type of the marker that was most recently right-clicked on the overview canvas, or null. */
  const rightClickedMarkerTypeRef = useRef<string | null>(null);
  const savedTrailsRef = useRef<CanvasSavedTrail[]>([]);
  const selectedSavedDriftIdRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  /** Tracks the view key (scale+offset) at the last geo-transform publish so
   *  the rAF loop can re-publish when zoom or pan changes the pixel→geo ratio. */
  const lastGeoPublishKeyRef = useRef<string>("");
  const efhFeaturesRef = useRef<EfhFeature[]>([]);
  /** Pre-built contour segments keyed by datasetId, rebuilt when any dataset's grid or interval changes. */
  const contourSegmentsRef = useRef<Map<string, ContourSegment[]>>(new Map());
  /** Pre-built no-data boundary segments keyed by datasetId, rebuilt when each dataset's grid changes. */
  const nodataBoundarySegmentsRef = useRef<Map<string, NodataBoundarySegment[]>>(new Map());
  const showNodataBoundary = useUiStore((s) => s.showNodataBoundary);
  const showNodataBoundaryRef = useRef(showNodataBoundary);
  useEffect(() => {
    showNodataBoundaryRef.current = showNodataBoundary;
    dirtyRef.current = true;
  }, [showNodataBoundary]);
  const contoursEnabledRef = useRef(contoursEnabled);
  useEffect(() => { contoursEnabledRef.current = contoursEnabled; }, [contoursEnabled]);
  const substrateFeaturesRef = useRef<SubstrateFeature[]>([]);
  const substrateColorModeRef = useRef(false);
  const selectedSubstrateUnitIdRef = useRef<string | null>(null);
  const hiddenSubstrateClassesRef = useRef<ReadonlySet<string>>(new Set());
  const substrateLegendLayoutRef = useRef<ReturnType<typeof renderSubstrateLegend>>(null);
  const hiddenEfhSpeciesRef = useRef<ReadonlySet<string>>(new Set());
  const efhLegendLayoutRef = useRef<EfhLegendLayout | null>(null);
  const embeddedHabitatFeaturesRef = useRef<SubstrateFeature[]>([]);

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

  // Intertidal tidal datum refs — updated by useEffect below; read in rAF loop
  // without React re-render to avoid re-registering the draw effect on every
  // datum change.
  const intertidalMhwFtRef = useRef<number | null>(null);
  const intertidalMhhwFtRef = useRef<number | null>(null);
  const { mhwFt: intertidalMhwFt, mhhwFt: intertidalMhhwFt } = useIntertidal();
  useEffect(() => {
    intertidalMhwFtRef.current = intertidalMhwFt;
    intertidalMhhwFtRef.current = intertidalMhhwFt;
    dirtyRef.current = true;
  }, [intertidalMhwFt, intertidalMhhwFt]);

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

  // React Query client — used by handleOverviewRetry to invalidate overview queries.
  const queryClient = useQueryClient();

  // --- Overview load-failure state -------------------------------------------
  // Set to true after the 15 s LOADING timeout so the retry button renders.
  // Reset to false when the user clicks Retry.
  const [overviewLoadFailed, setOverviewLoadFailed] = useState(false);
  const overviewLoadFailedRef = useRef(false);

  // Exposes a function that resets `nullGridSince` inside the rAF closure so
  // the retry handler (outside the closure) can restart the loading timer.
  const nullGridSinceResetRef = useRef<(() => void) | null>(null);

  const handleOverviewRetry = useCallback(() => {
    // Clear the error state → LOADING spinner reappears immediately.
    overviewLoadFailedRef.current = false;
    setOverviewLoadFailed(false);
    // Restart the stale-fetch timer inside the rAF closure so a second
    // consecutive fetch failure correctly re-surfaces the Retry button.
    nullGridSinceResetRef.current?.();
    dirtyRef.current = true;
    // Invalidate the overview query for every visible dataset so React Query
    // re-issues the fetch (the VisibleDatasetsLoader children will re-trigger).
    for (const v of visibleDatasets) {
      if (v.source === "preset") {
        void queryClient.invalidateQueries({
          queryKey: getGetDatasetsIdOverviewQueryKey(v.datasetId),
        });
      } else if (v.source === "user") {
        void queryClient.invalidateQueries({
          queryKey: getGetUserDatasetsIdOverviewQueryKey(v.datasetId),
        });
      }
    }
  }, [queryClient, visibleDatasets]);

  // Fast-error path: when React Query returns isError=true for the primary
  // dataset's overview fetch, surface the error UI immediately without
  // waiting for the 15 s stale-fetch timeout.  The 15 s timeout remains as a
  // backstop for stalls where the query stays in isLoading without erroring.
  useEffect(() => {
    if (!primaryDatasetId) return;
    if (!overviewFetchErrorIds.includes(primaryDatasetId)) return;
    // Only flip once — avoid repeated setState on every re-render.
    if (overviewLoadFailedRef.current) return;
    overviewLoadFailedRef.current = true;
    setOverviewLoadFailed(true);
    dirtyRef.current = true;
  }, [overviewFetchErrorIds, primaryDatasetId]);

  // Navigates to Find Data from the error-state hint link so users can
  // switch to a working dataset without closing and reopening the map.
  const handleErrorHintClick = useCallback(() => {
    useUiStore.getState().setSidebarMode("explore");
    useUiStore.getState().setFindDataPanelOpen(true);
    useUiStore.getState().setOverviewOpen(false);
  }, []);

  // Dirty flag — rAF loop skips draws when nothing has changed (no camera
  // movement, no data updates, no mouse interaction, no GPS/trail pulse).
  const dirtyRef = useRef(true);

  // Keep the backing store in the same coordinate system as the measured
  // overlay.  This is deliberately imperative: resizing must not wait for a
  // React render or leave the SVG/hit-test layer using the old dimensions.
  useEffect(() => {
    const root = overviewRootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const resize = () => {
      const width = Math.max(1, Math.round(root.clientWidth || window.innerWidth));
      const height = Math.max(1, Math.round(root.clientHeight || window.innerHeight));
      if (canvas.width === width && canvas.height === height) return;

      const dx = (width - canvas.width) / 2;
      const dy = (height - canvas.height) / 2;
      canvas.width = width;
      canvas.height = height;
      if (transformRef.current) {
        transformRef.current = { ...transformRef.current, offsetX: transformRef.current.offsetX + dx, offsetY: transformRef.current.offsetY + dy };
        setSvgTransform({ ...transformRef.current });
      }
      fitAnimRef.current = null;
      dirtyRef.current = true;
    };

    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(root);
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
    };
  }, []);

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
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ distance: number; scale: number; centerX: number; centerY: number } | null>(null);
  const suppressMouseUntilRef = useRef(0);

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
  const cameraPosition = useCameraStore((s) => s.cameraPosition);
  const cameraHeading = useCameraStore((s) => s.heading);

  // Marker visibility settings (reactive for SVG render and context-menu close guard).
  const overviewShowMarkers = useSettingsStore((s) => s.overviewShowMarkers);
  const visibleMarkerTypes = useSettingsStore((s) => s.visibleMarkerTypes);
  const overviewShowMarkersRef = useRef(overviewShowMarkers);
  const visibleMarkerTypesRef = useRef(visibleMarkerTypes);
  useEffect(() => {
    overviewShowMarkersRef.current = overviewShowMarkers;
    dirtyRef.current = true;
  }, [overviewShowMarkers]);
  useEffect(() => {
    visibleMarkerTypesRef.current = visibleMarkerTypes;
    dirtyRef.current = true;
  }, [visibleMarkerTypes]);

  // Weather station selected-pin React state (drives popover)
  const [selectedWeatherStation, setSelectedWeatherStation] = useState<WeatherStation | null>(null);
  const weatherOpenerRef = useRef<HTMLElement | SVGElement | null>(null);
  const rawsOpenerRef = useRef<HTMLElement | SVGElement | null>(null);
  const intertidalOpenerRef = useRef<HTMLElement | SVGElement | null>(null);
  const toolsOpenerRef = useRef<HTMLButtonElement | null>(null);
  const waypointPanelOpenerRef = useRef<HTMLButtonElement | null>(null);
  const trailPanelOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [overlayVersion, setOverlayVersion] = useState(0);
  const [selectedRawsDatasetId, setSelectedRawsDatasetId] = useState<string | null>(null);
  const selectedHotspot = useUiStore((s) => s.selectedHotspot);

  // --- Tools popover state --------------------------------------------------
  // Controls the compact "Tools" popover that houses box-select and download.
  const [toolsPopoverOpen, setToolsPopoverOpen] = useState(false);
  const toolsWrapperRef = useRef<HTMLDivElement>(null);

  // --- Georef pick mode ---------------------------------------------------
  // When DatasetPanel's PDF georef dialog triggers "Pick on map", this mode
  // activates. The user draws a rubber-band rectangle; on mouse-up the bbox
  // is committed to uiStore.georefPickBbox for DatasetPanel to consume.
  // Mutually exclusive with selectMode and downloadMode.
  const georefPickModeStore = useUiStore((s) => s.georefPickMode);
  const georefPickModeRef = useRef(false);
  useEffect(() => { georefPickModeRef.current = georefPickModeStore; }, [georefPickModeStore]);

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

  // --- Puzzle mode state -------------------------------------------------
  // When active, users can drag and rotate individual dataset heatmap tiles
  // like puzzle pieces to visually align overlapping surveys. Session-only —
  // does not affect bbox, contours, markers, or any persisted data.
  const [puzzleMode, setPuzzleMode] = useState(false);
  const puzzleModeRef = useRef(false);
  useEffect(() => { puzzleModeRef.current = puzzleMode; }, [puzzleMode]);
  // Canvas-only preference for the current mounted map. It deliberately is not
  // persisted with a puzzle layout or user settings.
  const [showPuzzleTitles, setShowPuzzleTitles] = useState(true);
  const showPuzzleTitlesRef = useRef(true);
  useEffect(() => {
    showPuzzleTitlesRef.current = showPuzzleTitles;
    dirtyRef.current = true;
  }, [showPuzzleTitles]);

  // Sync puzzle mode into puzzleStore so MarkerLayer can follow without prop drilling.
  const setPuzzleStoreMode = usePuzzleStore((s) => s.setPuzzleMode);
  useEffect(() => { setPuzzleStoreMode(puzzleMode); }, [puzzleMode, setPuzzleStoreMode]);

  // Brief "saved" flash state — true for ~1500 ms after the user clicks SAVE.
  const [puzzleSaveStatus, setPuzzleSaveStatus] = useState<"idle" | "saved" | "failed">("idle");
  const puzzleSaved = puzzleSaveStatus === "saved";

  // Layout preset save form — inline text input that appears below the toolbar.
  const [puzzleLayoutFormOpen, setPuzzleLayoutFormOpen] = useState(false);
  const [puzzleLayoutNameInput, setPuzzleLayoutNameInput] = useState("");
  // Layouts dropdown — lists saved presets for restore/delete.
  const [layoutsDropdownOpen, setLayoutsDropdownOpen] = useState(false);
  const layoutsDropdownRef = useRef<HTMLDivElement>(null);

  // Snap-to-neighbor toggle (default on) — tiles snap flush when an edge
  // comes within SNAP_THRESHOLD_PX of a neighbor's facing edge.
  const [snapEnabled, setSnapEnabled] = useState(true);
  const snapEnabledRef = useRef(true);
  useEffect(() => { snapEnabledRef.current = snapEnabled; }, [snapEnabled]);
  // Gap/overlap indicator overlay toggle.
  const [showGapOverlay, setShowGapOverlay] = useState(false);
  const showGapOverlayRef = useRef(false);
  useEffect(() => { showGapOverlayRef.current = showGapOverlay; dirtyRef.current = true; }, [showGapOverlay]);
  // Green flash on a just-snapped edge, drawn by the rAF loop until expiry.
  const snapFlashRef = useRef<{ edges: SnapEdgeSeg[]; until: number } | null>(null);
  const lastSnapKeyRef = useRef<string | null>(null);
  // Debounced (200 ms) gap/overlap raster cache keyed by view+transform signature.
  const gapMaskCacheRef = useRef<{ key: string; mask: GapOverlapMask | null; computedAt: number } | null>(null);
  const gapRecomputeTimerRef = useRef<number | null>(null);
  // Tile annotation editor (right-click → Add note). ≤ 40 chars per note.
  const [annotationEditor, setAnnotationEditor] = useState<{ datasetId: string; value: string } | null>(null);

  // Per-dataset spatial offsets (canvas pixels). Persists for the lifetime of
  // the session — toggling puzzle mode OFF leaves tiles where they were placed.
  const [puzzleTransforms, setPuzzleTransforms] = useState<
    Map<string, PuzzleTransform>
  >(new Map());
  const puzzleTransformsRef = useRef<Map<string, PuzzleTransform>>(new Map());
  // Pixel offsets are persisted for backwards compatibility. This tracks the
  // view density at which those offsets are currently expressed.
  const puzzlePixelDensityRef = useRef<number | null>(null);
  // A persisted transform set may have been created at a different viewport
  // size. Apply its density once the initial canvas transform is available.
  const hydratedPuzzlePixelDensityRef = useRef<number | null>(null);
  const rebasePuzzleTransformsForViewChange = useCallback((nextTransform: OverviewTransform) => {
    const nextDensity = nextTransform.pxPerDeg * nextTransform.scale;
    const previousDensity = puzzlePixelDensityRef.current;
    puzzlePixelDensityRef.current = nextDensity;
    if (previousDensity === null || puzzleTransformsRef.current.size === 0 ||
        Math.abs(previousDensity - nextDensity) < 1e-9) return;
    const rebased = rebasePuzzleTransformsForView(
      puzzleTransformsRef.current,
      previousDensity,
      nextDensity,
    );
    puzzleTransformsRef.current = rebased;
    setPuzzleTransforms(rebased);
    dirtyRef.current = true;
  }, []);
  useEffect(() => {
    puzzleTransformsRef.current = puzzleTransforms;
    dirtyRef.current = true;
    const savedDensity = hydratedPuzzlePixelDensityRef.current;
    const currentDensity = puzzlePixelDensityRef.current;
    if (
      savedDensity !== null &&
      currentDensity !== null &&
      puzzleTransforms.size > 0
    ) {
      const rebased = rebasePuzzleTransformsForView(
        puzzleTransforms,
        savedDensity,
        currentDensity,
      );
      puzzleTransformsRef.current = rebased;
      hydratedPuzzlePixelDensityRef.current = null;
      setPuzzleTransforms(rebased);
      return;
    }
    // Auto-persist to sessionStorage so positions survive navigation / component
    // unmount without requiring an explicit ✦ SAVE click. The ↺ RESET button
    // still calls sessionStorage.removeItem() directly when it wipes all
    // transforms, so there is no conflict — this branch simply skips writing
    // when the map is empty (size === 0 after a reset).
    if (puzzleTransforms.size > 0) {
      const serialised = JSON.stringify([...puzzleTransforms.entries()]);
      try {
        sessionStorage.setItem("bathyscan:puzzleTransforms", serialised);
      } catch {
        // Ignore quota / security errors silently.
      }
      try {
        localStorage.setItem("bathyscan:puzzleTransforms", serialised);
      } catch {
        // Ignore quota / security errors silently.
      }
      const density = puzzlePixelDensityRef.current;
      if (density !== null && Number.isFinite(density) && density > 0) {
        try { sessionStorage.setItem(PUZZLE_TRANSFORMS_DENSITY_KEY, String(density)); } catch { /* unavailable */ }
        try { localStorage.setItem(PUZZLE_TRANSFORMS_DENSITY_KEY, String(density)); } catch { /* unavailable */ }
      }
    } else {
      try { sessionStorage.removeItem("bathyscan:puzzleTransforms"); } catch { /* unavailable */ }
      try { localStorage.removeItem("bathyscan:puzzleTransforms"); } catch { /* unavailable */ }
      try { sessionStorage.removeItem(PUZZLE_TRANSFORMS_DENSITY_KEY); } catch { /* unavailable */ }
      try { localStorage.removeItem(PUZZLE_TRANSFORMS_DENSITY_KEY); } catch { /* unavailable */ }
    }

    // Convert pixel-space puzzle transforms to geographic offsets so the
    // Minimap can draw tiles at the correct shifted positions.
    // worldGridRef is null in single-dataset mode; fall back to overviewGrid
    // (the same pattern used throughout OverviewMap for single-dataset rendering).
    const worldGrid = worldGridRef.current ?? overviewGrid;
    // transformRef may not be populated yet during sessionStorage hydration
    // (before the first rAF); compute a fresh initial transform as a fallback.
    const canvas = canvasRef.current;
    const transform =
      transformRef.current ??
      (worldGrid && canvas && canvas.width > 0
        ? computeInitialTransform(worldGrid, canvas.width, canvas.height)
        : null);

    if (puzzleTransforms.size === 0) {
      // User hit Reset (or map was initialised with no saved transforms) → clear.
      useUiStore.getState().clearPuzzleGeoTransforms();
    } else if (worldGrid && transform) {
      // Refs are ready — compute geographic deltas and publish to uiStore.
      const geoMap = new Map<string, { dLon: number; dLat: number; angleDeg: number }>();
      for (const [datasetId, { tx, ty, angleDeg }] of puzzleTransforms.entries()) {
        // Find this dataset's bbox to compute the canonical tile center in canvas space.
        const entry = visibleDatasetsRef.current.find((v) => v.datasetId === datasetId);
        const bbox = entry?.overviewGrid ?? overviewGrid;
        if (!bbox) continue;
        const centerLon = (bbox.minLon + bbox.maxLon) / 2;
        const centerLat = (bbox.minLat + bbox.maxLat) / 2;
        const [tcx, tcy] = lonLatToCanvas(centerLon, centerLat, worldGrid, transform);
        // Canonical center and puzzle-offset center, both converted to lon/lat.
        const canonPt = canvasToLonLat(tcx, tcy, worldGrid, transform);
        const offsetPt = canvasToLonLat(tcx + tx, tcy + ty, worldGrid, transform);
        geoMap.set(datasetId, {
          dLon: offsetPt.lon - canonPt.lon,
          dLat: offsetPt.lat - canonPt.lat,
          angleDeg,
        });
      }
      useUiStore.getState().setPuzzleGeoTransforms(geoMap);
    }
    // If worldGrid or transform are still null, skip publishing —
    // the Minimap keeps the last known state until refs are populated.
  }, [puzzleTransforms, overviewGrid]);

  // Sync puzzle transforms into puzzleStore so MarkerLayer can apply them to
  // 3D marker positions without prop drilling through the R3F canvas hierarchy.
  const setPuzzleStoreTransforms = usePuzzleStore((s) => s.setPuzzleTransforms);
  useEffect(() => {
    // Convert Map → plain object for the store.
    const record: Record<string, PuzzleTransform> = {};
    for (const [id, xf] of puzzleTransforms) record[id] = xf;
    setPuzzleStoreTransforms(record);
  }, [puzzleTransforms, setPuzzleStoreTransforms]);

  // Hydrate puzzle transforms on mount. Prefer sessionStorage (more recent
  // within the same tab session) and fall back to localStorage so arrangements
  // survive a full browser restart / tab close.
  useLayoutEffect(() => {
    try {
      const raw =
        sessionStorage.getItem("bathyscan:puzzleTransforms") ??
        localStorage.getItem("bathyscan:puzzleTransforms");
      if (raw) {
        const entries = JSON.parse(raw) as Array<[string, { tx: number; ty: number; angleDeg: number; flipH?: boolean; flipV?: boolean; locked?: boolean; annotation?: string }]>;
        if (Array.isArray(entries) && entries.length > 0) {
          // Normalise: default flipH/flipV to false for entries saved before this feature.
          setPuzzleTransforms(new Map(entries.map(([id, xf]) => [
            id,
            {
              tx: xf.tx, ty: xf.ty, angleDeg: xf.angleDeg,
              flipH: xf.flipH ?? false, flipV: xf.flipV ?? false,
              ...(xf.locked ? { locked: true } : {}),
              ...(xf.annotation ? { annotation: String(xf.annotation).slice(0, 40) } : {}),
            },
          ])));
        }
      }
      const rawDensity =
        sessionStorage.getItem(PUZZLE_TRANSFORMS_DENSITY_KEY) ??
        localStorage.getItem(PUZZLE_TRANSFORMS_DENSITY_KEY);
      const savedDensity = rawDensity === null ? NaN : Number(rawDensity);
      if (Number.isFinite(savedDensity) && savedDensity > 0) {
        hydratedPuzzlePixelDensityRef.current = savedDensity;
      }
    } catch {
      // Silently ignore corrupt or missing data.
    }
  }, []);

  // A storage event is the browser's cross-tab synchronization channel.
  // sessionStorage is intentionally not listened to here because it is
  // scoped to this tab; the mirrored localStorage value is what other tabs
  // receive when a layout is cleaned up.
  useEffect(() => {
    const handlePuzzleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;

      if (event.key === PUZZLE_LAYOUTS_SYNC_KEY && event.newValue) {
        try {
          const change = JSON.parse(event.newValue) as PuzzleLayoutSyncEvent;
          if (change.type === "save" && change.layout?.id) {
            useSettingsStore.setState((state) => ({
              puzzleLayouts: [
                ...state.puzzleLayouts.filter((layout) => layout.id !== change.layout.id),
                change.layout,
              ].slice(-50),
            }));
          } else if (change.type === "delete" && typeof change.id === "string") {
            useSettingsStore.setState((state) => ({
              puzzleLayouts: state.puzzleLayouts.filter((layout) => layout.id !== change.id),
            }));
          }
        } catch {
          // Ignore corrupt cross-tab data and retain the current preset library.
        }
      } else if (event.key === "bathyscan:puzzleTransforms") {
        if (!event.newValue) {
          setPuzzleTransforms(new Map());
          return;
        }
        try {
          const entries = JSON.parse(event.newValue) as Array<
            [string, { tx: number; ty: number; angleDeg: number; flipH?: boolean; flipV?: boolean; locked?: boolean; annotation?: string }]
          >;
          if (!Array.isArray(entries)) return;
          setPuzzleTransforms(
            new Map(entries.map(([id, xf]) => [
              id,
              {
                tx: xf.tx, ty: xf.ty, angleDeg: xf.angleDeg,
                flipH: xf.flipH ?? false, flipV: xf.flipV ?? false,
                ...(xf.locked ? { locked: true } : {}),
                ...(xf.annotation ? { annotation: String(xf.annotation).slice(0, 40) } : {}),
              },
            ])),
          );
        } catch {
          // Ignore corrupt cross-tab data and retain the current layout.
        }
      } else if (event.key === PUZZLE_TRANSFORMS_DENSITY_KEY) {
        const density = event.newValue === null ? NaN : Number(event.newValue);
        hydratedPuzzlePixelDensityRef.current =
          Number.isFinite(density) && density > 0 ? density : null;
      } else if (event.key === "bathyscan:puzzleGroups") {
        if (!event.newValue) {
          setPuzzleGroups(new Map());
          return;
        }
        try {
          const entries = JSON.parse(event.newValue) as Array<[string, string[]]>;
          if (!Array.isArray(entries)) return;
          setPuzzleGroups(
            new Map(entries.map(([gid, members]) => [gid, new Set(members)])),
          );
          const maxN = entries.reduce((m, [gid]) => {
            const n = parseInt(gid.replace("group-", ""), 10);
            return isNaN(n) ? m : Math.max(m, n);
          }, 0);
          puzzleGroupCounterRef.current = Math.max(puzzleGroupCounterRef.current, maxN);
        } catch {
          // Ignore corrupt cross-tab data and retain the current layout.
        }
      }
    };

    window.addEventListener("storage", handlePuzzleStorage);
    return () => window.removeEventListener("storage", handlePuzzleStorage);
  }, []);

  // Currently selected puzzle tiles (set of datasetIds) and the primary tile.
  // puzzleSelectedIdsRef is updated synchronously in event handlers for hit-testing;
  // puzzleSelectedIds is a React state mirror so the toolbar can re-render.
  const puzzleSelectedIdsRef = useRef<Set<string>>(new Set());
  const [puzzleSelectedIds, setPuzzleSelectedIds_internal] = useState<Set<string>>(new Set());
  /** The most-recently-clicked tile — drives corner-handle placement. */
  const puzzlePrimaryIdRef = useRef<string | null>(null);
  // Helper: set both ref and state for selection (always creates a new Set to trigger re-render).
  const setPuzzleSelectedIds = useCallback((ids: Set<string>, primaryId?: string | null) => {
    puzzleSelectedIdsRef.current = ids;
    setPuzzleSelectedIds_internal(new Set(ids));
    if (primaryId !== undefined) puzzlePrimaryIdRef.current = primaryId;
  }, []);
  // Groups: maps groupId ("group-N") → set of member datasetIds.
  const puzzleGroupsRef = useRef<Map<string, Set<string>>>(new Map());
  const [puzzleGroups, setPuzzleGroups] = useState<Map<string, Set<string>>>(new Map());
  const puzzleGroupCounterRef = useRef(0);
  // Keep puzzleGroupsRef in sync with state.
  useEffect(() => { puzzleGroupsRef.current = puzzleGroups; }, [puzzleGroups]);

  // Persist puzzle groups to sessionStorage and localStorage whenever they change.
  useEffect(() => {
    if (puzzleGroups.size > 0) {
      const serialised = JSON.stringify(
        [...puzzleGroups.entries()].map(([gid, members]) => [gid, [...members]]),
      );
      try {
        sessionStorage.setItem("bathyscan:puzzleGroups", serialised);
      } catch {
        // Ignore quota / security errors silently.
      }
      try {
        localStorage.setItem("bathyscan:puzzleGroups", serialised);
      } catch {
        // Ignore quota / security errors silently.
      }
    } else {
      try { sessionStorage.removeItem("bathyscan:puzzleGroups"); } catch { /* unavailable */ }
      try { localStorage.removeItem("bathyscan:puzzleGroups"); } catch { /* unavailable */ }
    }
  }, [puzzleGroups]);

  // Hydrate puzzle groups on mount. Prefer sessionStorage (more recent within
  // the same tab session) and fall back to localStorage so groups survive a
  // full browser restart / tab close.
  useLayoutEffect(() => {
    try {
      const raw =
        sessionStorage.getItem("bathyscan:puzzleGroups") ??
        localStorage.getItem("bathyscan:puzzleGroups");
      if (raw) {
        const entries = JSON.parse(raw) as Array<[string, string[]]>;
        if (Array.isArray(entries) && entries.length > 0) {
          const restored = new Map<string, Set<string>>(
            entries.map(([gid, members]) => [gid, new Set(members)]),
          );
          setPuzzleGroups(restored);
          // Restore counter so new groups don't collide with restored IDs.
          const maxN = entries.reduce((m, [gid]) => {
            const n = parseInt(gid.replace("group-", ""), 10);
            return isNaN(n) ? m : Math.max(m, n);
          }, 0);
          puzzleGroupCounterRef.current = maxN;
        }
      }
    } catch {
      // Silently ignore corrupt or missing storage data.
    }
  }, []);

  // Prune group memberships when datasets are unloaded from the viewer.
  // During the initial app load, visibleDatasets can briefly be empty while
  // persisted puzzle state has already hydrated. Do not mistake that loading
  // window for an unload; once visibility has been observed, empty is a real
  // state and groups are pruned normally.
  const hasObservedVisibleDatasetsRef = useRef(false);
  useEffect(() => {
    if (visibleDatasets.length > 0) {
      hasObservedVisibleDatasetsRef.current = true;
    } else if (!hasObservedVisibleDatasetsRef.current) {
      return;
    }
    const aliveIds = new Set(visibleDatasets.map((v) => v.datasetId));
    setPuzzleTransforms((prev) => {
      const next = new Map([...prev].filter(([id]) => aliveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setPuzzleGroups((prev) => {
      const next = new Map<string, Set<string>>();
      let changed = false;
      for (const [gid, members] of prev) {
        const pruned = new Set([...members].filter((id) => aliveIds.has(id)));
        if (pruned.size >= 2) {
          next.set(gid, pruned);
          if (pruned.size !== members.size) changed = true;
        } else {
          changed = true; // group dissolved or shrank to single member
        }
      }
      return changed ? next : prev;
    });
  }, [visibleDatasets]);

  // Close layouts dropdown when user clicks outside it.
  useEffect(() => {
    if (!layoutsDropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (layoutsDropdownRef.current && !layoutsDropdownRef.current.contains(e.target as Node)) {
        setLayoutsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [layoutsDropdownOpen]);

  /** Restore a saved layout: apply tile transforms and groups, silently skipping missing dataset IDs. */
  const restorePuzzleLayout = useCallback((layout: PuzzleLayout) => {
    const aliveIds = new Set(visibleDatasets.map((v) => v.datasetId));
    // Restore transforms only for datasets still visible.
    const nextTransforms = new Map<string, PuzzleTransform>();
    for (const tile of layout.tiles) {
      if (aliveIds.has(tile.datasetId)) {
        nextTransforms.set(tile.datasetId, {
          tx: tile.tx, ty: tile.ty, angleDeg: tile.angleDeg,
          flipH: tile.flipH ?? false, flipV: tile.flipV ?? false,
        });
      }
    }
    const currentDensity = transformRef.current
      ? transformRef.current.pxPerDeg * transformRef.current.scale
      : null;
    const restoredTransforms =
      currentDensity !== null &&
      layout.pixelDensity !== undefined &&
      Number.isFinite(layout.pixelDensity) &&
      layout.pixelDensity > 0
        ? rebasePuzzleTransformsForView(
            nextTransforms,
            layout.pixelDensity,
            currentDensity,
          )
        : nextTransforms;
    if (currentDensity !== null) puzzlePixelDensityRef.current = currentDensity;
    setPuzzleTransforms(restoredTransforms);
    // Restore groups — keep only groups whose members are ≥ 2 alive datasets.
    const nextGroups = new Map<string, Set<string>>();
    let maxCounter = puzzleGroupCounterRef.current;
    for (let i = 0; i < layout.groups.length; i++) {
      const members = layout.groups[i]!.filter((id) => aliveIds.has(id));
      if (members.length >= 2) {
        const gid = `group-${++maxCounter}`;
        nextGroups.set(gid, new Set(members));
      }
    }
    puzzleGroupCounterRef.current = maxCounter;
    setPuzzleGroups(nextGroups);
    // Deselect tiles so the restored layout is shown cleanly.
    setPuzzleSelectedIds(new Set(), null);
    dirtyRef.current = true;
    setLayoutsDropdownOpen(false);
  }, [visibleDatasets, setPuzzleTransforms, setPuzzleGroups, setPuzzleSelectedIds]);

  /** Save current transforms+groups as a named layout preset. */
  const saveCurrentPuzzleLayout = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return;
    const tiles: PuzzleLayout["tiles"] = [];
    for (const [datasetId, xf] of puzzleTransformsRef.current) {
      tiles.push({ datasetId, tx: xf.tx, ty: xf.ty, angleDeg: xf.angleDeg, flipH: xf.flipH, flipV: xf.flipV });
    }
    const groups: string[][] = [];
    for (const members of puzzleGroupsRef.current.values()) {
      groups.push([...members]);
    }
    const id = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const pixelDensity = transformRef.current
      ? transformRef.current.pxPerDeg * transformRef.current.scale
      : undefined;
    const layout = {
      id,
      name: trimmed,
      tiles,
      groups,
      ...(pixelDensity !== undefined && Number.isFinite(pixelDensity) && pixelDensity > 0
        ? { pixelDensity }
        : {}),
    };
    useSettingsStore.setState((state) => ({
      puzzleLayouts: [
        ...state.puzzleLayouts.filter((existing) => existing.id !== layout.id),
        layout,
      ].slice(-50),
    }));
    broadcastPuzzleLayoutEvent({ type: "save", layout });
    setPuzzleLayoutFormOpen(false);
    setPuzzleLayoutNameInput("");
    setPuzzleSaveStatus("saved");
    setTimeout(() => setPuzzleSaveStatus("idle"), 3000);
  }, []);

  // Signature of the current layout — compared against the last saved/restored
  // signature to detect unsaved changes before switching revisions.
  const lastAppliedLayoutSigRef = useRef<string | null>(null);
  const [pendingRevisionDeletes, setPendingRevisionDeletes] = useState<Set<string>>(new Set());
  const pendingRevisionDeletesRef = useRef(new Set<string>());
  const revisionRestoreRequestRef = useRef(0);

  /**
   * Save the current layout (tiles incl. locked + annotation, and groups) as a
   * named revision on the active special collection's server record.
   */
  const [serverLayoutSaving, setServerLayoutSaving] = useState(false);
  const saveLayoutToServer = useCallback(async (name: string) => {
    const active = useSpecialCollectionStore.getState().active;
    const trimmed = name.trim().slice(0, 120);
    if (!active || !trimmed || serverLayoutSaving) return;
    const tiles = [...puzzleTransformsRef.current.entries()].map(([tileId, xf]) => ({
      datasetId: tileId,
      tx: xf.tx,
      ty: xf.ty,
      angleDeg: xf.angleDeg,
      locked: !!xf.locked,
      annotation: xf.annotation ?? null,
    }));
    let gIndex = 0;
    const groups = [...puzzleGroupsRef.current.entries()].map(([gid, members]) => ({
      id: gid,
      name: `Group ${++gIndex}`,
      datasetIds: [...members],
    }));
    setServerLayoutSaving(true);
    try {
      const revision = await postUserCollectionsIdLayout(active.collectionId, {
        name: trimmed,
        tiles,
        groups,
      });
      useSpecialCollectionStore.getState().appendRevision(active.collectionId, revision);
      lastAppliedLayoutSigRef.current = layoutSignatureOf(
        puzzleTransformsRef.current,
        puzzleGroupsRef.current,
      );
      setPuzzleLayoutFormOpen(false);
      setPuzzleLayoutNameInput("");
      setPuzzleSaveStatus("saved");
      setTimeout(() => setPuzzleSaveStatus("idle"), 3000);
    } catch {
      toast({
        title: "Save failed",
        description: "Could not save the layout to the server. Please try again.",
        variant: "destructive",
        duration: 4000,
      });
    } finally {
      setServerLayoutSaving(false);
    }
  }, [serverLayoutSaving]);

  /** Restore a server layout revision, confirming first if unsaved changes exist. */
  const restoreServerRevision = useCallback(async (rev: LayoutRevision) => {
    const active = useSpecialCollectionStore.getState().active;
    if (!active) return;
    const previousRevisionId = active.activeRevisionId;
    const restoreRequest = ++revisionRestoreRequestRef.current;
    const sig = layoutSignatureOf(puzzleTransformsRef.current, puzzleGroupsRef.current);
    if (
      lastAppliedLayoutSigRef.current !== null &&
      sig !== lastAppliedLayoutSigRef.current &&
      typeof window !== "undefined" &&
      !window.confirm(`Discard unsaved layout changes and restore "${rev.name}"?`)
    ) {
      return;
    }
    useSpecialCollectionStore.getState().requestRestore({
      tiles: rev.tiles.map((tl) => ({
        datasetId: tl.datasetId,
        tx: tl.tx,
        ty: tl.ty,
        angleDeg: tl.angleDeg,
        locked: tl.locked,
        annotation: tl.annotation ?? undefined,
      })),
      groups: rev.groups.map((g) => [...g.datasetIds]),
    });
    useSpecialCollectionStore.setState((s) =>
      s.active?.collectionId === active.collectionId
        ? { active: { ...s.active, activeRevisionId: rev.id } }
        : {},
    );
    setLayoutsDropdownOpen(false);
    try {
      await patchUserCollectionsIdMeta(active.collectionId, { activeRevisionId: rev.id });
    } catch {
      // The local layout remains useful, but must not be presented as a
      // durable active-revision choice when the metadata write was rejected.
      useSpecialCollectionStore.setState((s) =>
        s.active?.collectionId === active.collectionId &&
        s.active.activeRevisionId === rev.id &&
        revisionRestoreRequestRef.current === restoreRequest
          ? { active: { ...s.active, activeRevisionId: previousRevisionId } }
          : {},
      );
      toast({
        title: "Revision restore partly failed",
        description: "The layout was restored locally, but the active revision could not be saved. Please try again.",
        variant: "destructive",
        duration: 6000,
      });
    }
  }, []);

  /** Delete a server layout revision. */
  const deleteServerRevision = useCallback(async (rev: LayoutRevision) => {
    const active = useSpecialCollectionStore.getState().active;
    if (!active) return;
    if (pendingRevisionDeletesRef.current.has(rev.id)) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete layout revision "${rev.name}"?`)) return;
    const collectionId = active.collectionId;
    pendingRevisionDeletesRef.current.add(rev.id);
    setPendingRevisionDeletes((current) => new Set(current).add(rev.id));
    try {
      await deleteUserCollectionsIdLayoutRevisionId(collectionId, rev.id);
      useSpecialCollectionStore.getState().removeRevision(collectionId, rev.id);
      toast({
        title: "Revision deleted",
        description: `"${rev.name}" was deleted.`,
        duration: 3000,
      });
    } catch {
      toast({
        title: "Delete failed",
        description: "The revision was not deleted. Check your connection and try again.",
        variant: "destructive",
        duration: 4000,
      });
    } finally {
      pendingRevisionDeletesRef.current.delete(rev.id);
      setPendingRevisionDeletes((current) => {
        const next = new Set(current);
        next.delete(rev.id);
        return next;
      });
    }
  }, []);

  /** Commit the annotation editor's text onto its tile (empty → remove note). */
  const commitAnnotation = useCallback(() => {
    if (!annotationEditor) return;
    const trimmed = annotationEditor.value.trim().slice(0, 40);
    setPuzzleTransforms((prev) => {
      const next = new Map(prev);
      const existing = prev.get(annotationEditor.datasetId) ??
        { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false };
      const copy: PuzzleTransform = { ...existing };
      if (trimmed) copy.annotation = trimmed;
      else delete copy.annotation;
      next.set(annotationEditor.datasetId, copy);
      return next;
    });
    setAnnotationEditor(null);
    dirtyRef.current = true;
  }, [annotationEditor]);

  const puzzleDragSubModeRef = useRef<"translate" | "rotate" | "pan" | null>(null);
  // Which corner handle was hit at mousedown (for click-nudge detection).
  const puzzleHandleEdgeRef = useRef<"topLeft" | "topRight" | "bottomRight" | "bottomLeft" | null>(null);
  // Whether the pointer actually moved during a rotate drag (distinguishes click from drag).
  const puzzleRotateActuallyDraggedRef = useRef(false);
  // Context captured at drag start for incremental delta computation.
  const puzzleDragStartRef = useRef<{
    mx: number; my: number;
    tx: number; ty: number; angleDeg: number;
    cx: number; cy: number;
    startTransforms: Map<string, PuzzleTransform>;
    collectiveCx: number; collectiveCy: number;
    startAngleDeg: number;
  }>({ mx: 0, my: 0, tx: 0, ty: 0, angleDeg: 0, cx: 0, cy: 0,
       startTransforms: new Map(), collectiveCx: 0, collectiveCy: 0, startAngleDeg: 0 });

  // Sign-out isolation: when performSignOutCleanup() bumps the puzzleStore
  // signOutNonce, clear ALL component-local puzzle state in the live instance.
  // Without this, the mounted OverviewMap keeps the previous account's tile
  // transforms/groups on the canvas and would re-mirror them into puzzleStore
  // (and the uiStore geo-transform mirror) on the next local state change.
  const puzzleSignOutNonce = usePuzzleStore((s) => s.signOutNonce);
  const lastSeenSignOutNonceRef = useRef(puzzleSignOutNonce);
  useEffect(() => {
    if (puzzleSignOutNonce === lastSeenSignOutNonceRef.current) return;
    lastSeenSignOutNonceRef.current = puzzleSignOutNonce;
    setPuzzleMode(false);
    setPuzzleTransforms(new Map());
    setPuzzleGroups(new Map());
    setPuzzleSelectedIds(new Set(), null);
    puzzleGroupCounterRef.current = 0;
    lastAppliedLayoutSigRef.current = null;
    useUiStore.getState().setPuzzleGeoTransforms(new Map());
    dirtyRef.current = true;
  }, [puzzleSignOutNonce, setPuzzleSelectedIds]);

  // --- Special collection (reference-image puzzle assembly) ----------------
  const spcActive = useSpecialCollectionStore((s) => s.active);
  const spcPendingRestore = useSpecialCollectionStore((s) => s.pendingRestore);
  const spcPendingPuzzleOn = useSpecialCollectionStore((s) => s.pendingPuzzleOn);
  const referenceImageCannotBePlaced =
    Boolean(spcActive?.bgImage) &&
    !hasValidBgGeoAnchorPair(spcActive?.bgGeoAnchors) &&
    !visibleDatasets.some((dataset) => dataset.overviewGrid);
  // Redraw when the active special collection (image / opacity / anchors) changes.
  useEffect(() => { dirtyRef.current = true; }, [spcActive]);
  // Enter puzzle mode when a collection is activated without a saved revision.
  useEffect(() => {
    if (spcPendingPuzzleOn > 0) {
      setPuzzleMode(true);
      dirtyRef.current = true;
    }
  }, [spcPendingPuzzleOn]);

  // Consume a pending layout restore in ONE batch: puzzle mode, canvas
  // transform Map, and groups are all derived from the same payload
  // (buildRestoredPuzzleState). The puzzleStore record is committed
  // SYNCHRONOUSLY here — from the same builder output, sharing the same
  // transform objects as the canvas Map — rather than waiting for the
  // dependent mirror effect, so 3D marker geography can never observe a
  // window where the canvas has restored but the store still holds the
  // prior layout (or vice versa). The mirror effect that later re-fires on
  // the canvas state commit writes the identical record and is a no-op.
  useEffect(() => {
    if (!spcPendingRestore) return;
    const aliveIds = new Set(visibleDatasetsRef.current.map((v) => v.datasetId));
    const restored = buildRestoredPuzzleState(
      spcPendingRestore.payload,
      aliveIds,
      puzzleGroupCounterRef.current,
    );
    puzzleGroupCounterRef.current = restored.groupCounterEnd;
    usePuzzleStore.getState().setPuzzleTransforms(restored.storeRecord);
    setPuzzleMode(true);
    setPuzzleTransforms(restored.transforms);
    setPuzzleGroups(restored.groups);
    setPuzzleSelectedIds(new Set(), null);
    dirtyRef.current = true;
    lastAppliedLayoutSigRef.current = layoutSignatureOf(restored.transforms, restored.groups);
    useSpecialCollectionStore.getState().consumeRestore();
  }, [spcPendingRestore, setPuzzleSelectedIds]);

  // --- Apply saved puzzle layout to the 3D scene (Apply-to-3D) --------------
  const [applyTo3DConfirmOpen, setApplyTo3DConfirmOpen] = useState(false);

  /** Active saved revision of the active special collection (if any). */
  const spcActiveRevision = useMemo(() => {
    if (!spcActive) return null;
    return spcActive.layoutRevisions.find((r) => r.id === spcActive.activeRevisionId) ?? null;
  }, [spcActive]);

  // The Apply-to-3D button only appears when the saved layout actually moves
  // something — at least one tile with a non-identity transform.
  const spcRevisionHasNonIdentityTile = useMemo(
    () => (spcActiveRevision?.tiles ?? []).some((t) => t.tx !== 0 || t.ty !== 0 || t.angleDeg !== 0),
    [spcActiveRevision],
  );

  // Mark an applied 3D layout as outdated whenever the puzzle transforms
  // change afterwards (drag / rotate / reset / restore). markGeoLayoutOutdated
  // is a no-op unless a layout is currently in "applied" state, so running it
  // on every transforms commit (including hydration) is safe.
  const prevPuzzleTransformsFor3DRef = useRef<Map<string, PuzzleTransform> | null>(null);
  useEffect(() => {
    if (
      prevPuzzleTransformsFor3DRef.current !== null &&
      prevPuzzleTransformsFor3DRef.current !== puzzleTransforms
    ) {
      useSpecialCollectionStore.getState().markGeoLayoutOutdated();
    }
    prevPuzzleTransformsFor3DRef.current = puzzleTransforms;
  }, [puzzleTransforms, puzzleGroups.size]);

  /**
   * Confirmed Apply-to-3D: convert the saved layout revision into geographic
   * corrections, shift each affected dataset's 3D render origin, and fly the
   * camera to the union of the corrected bboxes. Stored grids / DB rows are
   * never mutated — corrections live only on the terrainStore entries.
   */
  const handleApplyLayoutTo3D = useCallback(() => {
    setApplyTo3DConfirmOpen(false);
    const active = useSpecialCollectionStore.getState().active;
    if (!active) return;
    const rev = active.layoutRevisions.find((r) => r.id === active.activeRevisionId) ?? null;
    if (!rev) return;

    // Same reference-grid / transform resolution as the geo-transform mirror
    // effect above: worldGrid falls back to the primary overviewGrid, and the
    // transform falls back to a freshly computed initial transform.
    const worldGrid = worldGridRef.current ?? overviewGrid;
    const canvas = canvasRef.current;
    const transform =
      transformRef.current ??
      (worldGrid && canvas && canvas.width > 0
        ? computeInitialTransform(worldGrid, canvas.width, canvas.height)
        : null);
    if (!worldGrid || !transform) {
      toast({
        title: "Apply failed",
        description: "The overview map is still initialising. Please try again.",
        variant: "destructive",
        duration: 4000,
      });
      return;
    }

    const bboxes: Record<string, GeoBbox> = {};
    for (const v of visibleDatasetsRef.current) {
      const g = v.overviewGrid ?? v.activeGrid;
      if (g) {
        bboxes[v.datasetId] = { minLon: g.minLon, maxLon: g.maxLon, minLat: g.minLat, maxLat: g.maxLat };
      }
    }
    const corrections = puzzleLayoutToGeoCorrections(rev.tiles, bboxes, worldGrid, transform);
    const correctedIds = Object.keys(corrections);
    if (correctedIds.length === 0) return;

    useTerrainStore.getState().setDatasetGeoCorrections(corrections);
    useSpecialCollectionStore.getState().markGeoLayoutApplied(active.collectionId, correctedIds);

    // Camera fly-to: frame the union of the corrected bboxes. The world frame
    // is anchored to the primary's RAW grid while secondaries are placed
    // relative to the corrected primary centre, so the union centre must be
    // expressed in that anchored frame by subtracting the primary's own
    // correction before converting to world coordinates.
    const state = useTerrainStore.getState();
    const primaryId = state.primaryDatasetId;
    const primaryGrid = state.activeGrid ?? state.overviewGrid;
    if (primaryId && primaryGrid) {
      let minLon = Infinity;
      let maxLon = -Infinity;
      let minLat = Infinity;
      let maxLat = -Infinity;
      for (const v of state.visibleDatasets) {
        const g = v.overviewGrid ?? v.activeGrid;
        if (!g) continue;
        const c = corrections[v.datasetId];
        const dLon = c?.dLon ?? 0;
        const dLat = c?.dLat ?? 0;
        minLon = Math.min(minLon, g.minLon + dLon);
        maxLon = Math.max(maxLon, g.maxLon + dLon);
        minLat = Math.min(minLat, g.minLat + dLat);
        maxLat = Math.max(maxLat, g.maxLat + dLat);
      }
      if (Number.isFinite(minLon)) {
        const pCorr = corrections[primaryId];
        const centerLon = (minLon + maxLon) / 2 - (pCorr?.dLon ?? 0);
        const centerLat = (minLat + maxLat) / 2 - (pCorr?.dLat ?? 0);
        const { x, z } = lonLatToWorldXZ(centerLon, centerLat, primaryGrid);
        useUiStore.getState().setPendingDropIn({ worldX: x, worldZ: z });
      }
    }
  }, [overviewGrid]);

  // Hit rect for the "Find Data" link rendered in the empty-state canvas.
  // Updated each rAF frame when no datasets are selected; used by handleClick
  // and handleMouseMove to make the link interactive without an SVG overlay.
  const emptyStateLinkRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

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
  const { data: mySaves = [], refetch: refetchMySaves } = useGetDatasetsMySaves(undefined, {
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
    useUiStore.getState().clearCoordSearchArea();
  }, []);

  // --- Manual coordinate + radius search (queued from the Find Data panel) ---
  const pointRadiusQuery = usePostDatasetsPointRadiusQuery();
  const pendingCoordSearch = useUiStore((s) => s.pendingCoordSearch);
  const coordSearchArea = useUiStore((s) => s.coordSearchArea);
  // Mirror into a ref so the rAF loop can paint the circle without
  // re-registering; mark dirty whenever the area changes.
  const coordSearchAreaRef = useRef<typeof coordSearchArea>(null);
  useEffect(() => {
    coordSearchAreaRef.current = coordSearchArea;
    dirtyRef.current = true;
  }, [coordSearchArea]);

  useEffect(() => {
    if (!pendingCoordSearch) return;
    const { lat, lon, radiusKm } = pendingCoordSearch;
    const ui = useUiStore.getState();
    ui.clearPendingCoordSearch();

    // Immediately show an approximate search area while the server responds.
    const approx = approxBboxForRadius(lat, lon, radiusKm);
    ui.setCoordSearchArea({ lat, lon, radiusKm, bbox: approx });
    setSelectedBbox(approx);
    setBboxResults(null);
    setBboxError(null);

    // Tween the minimap to frame the search circle (same pattern as fit-to-data).
    const canvas = canvasRef.current;
    const currentTransform = transformRef.current;
    if (canvas && currentTransform) {
      const targetTransform = computeFitTransform(
        { minLon: approx.west, maxLon: approx.east, minLat: approx.south, maxLat: approx.north },
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
    }

    void (async () => {
      try {
        const res = await pointRadiusQuery.mutateAsync({
          data: { lat, lon, radius: radiusKm, unit: "km" },
        });
        useUiStore.getState().setCoordSearchArea({ lat, lon, radiusKm: res.radiusKm, bbox: res.bbox });
        setSelectedBbox(res.bbox);
        setBboxResults(res.datasets);
      } catch (err) {
        const e = err as { details?: string; message?: string };
        setBboxError(e?.details ?? e?.message ?? "Coordinate search failed");
        setBboxResults(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bboxQuery.mutateAsync and pointRadiusQuery.mutateAsync are stable React Query mutation refs
  }, [pendingCoordSearch]);

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

  // Step-zoom handler — zooms in or out by the given factor, pivoting on the
  // canvas centre, and animates via fitAnimRef (same tween mechanism as FIT).
  const handleZoomStep = useCallback((factor: number) => {
    const canvas = canvasRef.current;
    const t = transformRef.current;
    if (!canvas || !t || !overviewGrid) return;

    const newScale = Math.max(0.5, Math.min(20, t.scale * factor));
    const ratio = newScale / t.scale;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    const targetTransform = clampTransform(
      {
        ...t,
        scale: newScale,
        offsetX: cx + (t.offsetX - cx) * ratio,
        offsetY: cy + (t.offsetY - cy) * ratio,
      },
      worldGridRef.current ?? overviewGrid,
      canvas.width,
      canvas.height,
    );
    fitAnimRef.current = {
      from: { ...t },
      to: targetTransform,
      startTime: performance.now(),
      duration: 300,
    };
    dirtyRef.current = true;
  }, [overviewGrid]);

  const openFindData = useCallback(() => {
    useUiStore.getState().setSidebarMode("explore");
    useUiStore.getState().setFindDataPanelOpen(true);
    useUiStore.getState().setOverviewOpen(false);
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
        return;
      }
      // Dismiss the nearest transient popup before allowing the app-level
      // handler to close the whole Overview. Restore focus to its opener.
      if (selectedWeatherStation) {
        e.stopPropagation();
        weatherStationSelectedIdRef.current = null;
        setSelectedWeatherStation(null);
        weatherOpenerRef.current?.focus();
        return;
      }
      if (selectedRawsDatasetId) {
        e.stopPropagation();
        rawsSelectedIdRef.current = null;
        setSelectedRawsDatasetId(null);
        rawsOpenerRef.current?.focus();
        return;
      }
      if (selectedHotspot) {
        e.stopPropagation();
        useUiStore.getState().setSelectedHotspot(null);
        intertidalOpenerRef.current?.focus();
        return;
      }
      if (showWaypointPanel) {
        e.stopPropagation();
        setShowWaypointPanel(false);
        waypointPanelOpenerRef.current?.focus();
        return;
      }
      if (showTrailList) {
        e.stopPropagation();
        setShowTrailList(false);
        trailPanelOpenerRef.current?.focus();
        return;
      }
      if (toolsPopoverOpen) {
        e.stopPropagation();
        setToolsPopoverOpen(false);
        toolsOpenerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    selectedBbox, bboxResults, downloadBbox, clearBbox, selectedWeatherStation,
    selectedRawsDatasetId, selectedHotspot, showWaypointPanel, showTrailList,
    toolsPopoverOpen,
  ]);

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

  // Close any open context menu when markers are globally hidden. The menu may
  // have been opened on a marker that is no longer rendered, so leaving it open
  // would leave the user with a stale action list.
  useEffect(() => {
    if (!overviewShowMarkers && useContextMenuStore.getState().open) {
      useContextMenuStore.getState().hide();
      rightClickedMarkerTypeRef.current = null;
    }
  }, [overviewShowMarkers]);

  // Close the context menu when the marker type it was opened on is filtered
  // out of the visible set (e.g. the user unchecks a marker type while the menu
  // is still open).
  useEffect(() => {
    const type = rightClickedMarkerTypeRef.current;
    if (
      type !== null &&
      !visibleMarkerTypes.includes(type as typeof visibleMarkerTypes[number]) &&
      useContextMenuStore.getState().open
    ) {
      useContextMenuStore.getState().hide();
      rightClickedMarkerTypeRef.current = null;
    }
  }, [visibleMarkerTypes]);

  // Depth-pole colours parsed once per marker-data change, not per render.
  const poleColourByMarker = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of markerData ?? []) {
      if (m.type !== "depth_pole") continue;
      let colour = "#00ffee";
      try {
        const parsed = JSON.parse(m.notes ?? "{}") as Record<string, unknown>;
        if (typeof parsed["colour"] === "string") colour = parsed["colour"];
      } catch { /* ignored */ }
      map.set(m.id, colour);
    }
    return map;
  }, [markerData]);

  // Catch-journal symbols per marker for the SVG overlay — one per entry
  // (duplicates kept so repeat catches stay visible).
  const catchSymbolsByMarker = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of catchData ?? []) {
      const list = map.get(e.markerId) ?? [];
      list.push(e.symbol);
      if (!map.has(e.markerId)) map.set(e.markerId, list);
    }
    return map;
  }, [catchData]);

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
    dirtyRef.current = true;
  }, [allDatasets, userDatasetsForNames]);
  const hasEfh = !!allDatasets?.find((d) => d.id === datasetId)?.hasEfh;
  // Derived once per render so the Fit button doesn't repeat the filter three
  // times in inline JSX style expressions.
  const datasetsWithGrid = useMemo(
    () => visibleDatasets.filter((v) => !!v.overviewGrid),
    [visibleDatasets],
  );

  // True when the puzzle has any non-default state — controls Reset button.
  const hasPuzzleTransforms = useMemo(() => {
    if (puzzleGroups.size > 0) return true;
    for (const v of puzzleTransforms.values()) {
      if (v.tx !== 0 || v.ty !== 0 || v.angleDeg !== 0 || v.flipH || v.flipV) return true;
    }
    return false;
  }, [puzzleTransforms, puzzleGroups.size]);
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
    const efhFeatures = raw.filter((f) =>
      Boolean(f.properties.species && f.properties.commonName && f.properties.fmp),
    );
    if (!overviewGrid) return efhFeatures as EfhFeature[];
    return filterEfhByBbox(efhFeatures as EfhFeature[], {
      minLon: overviewGrid.minLon,
      maxLon: overviewGrid.maxLon,
      minLat: overviewGrid.minLat,
      maxLat: overviewGrid.maxLat,
    });
  }, [embeddedEfhPolygons, efhData, overviewGrid]);
  useEffect(() => {
    const raw = embeddedEfhPolygons?.features ?? [];
    embeddedHabitatFeaturesRef.current = raw
      .filter((f) => !f.properties.species && !!f.properties.substrate)
      .map((f) => f as unknown as SubstrateFeature);
    dirtyRef.current = true;
  }, [embeddedEfhPolygons]);
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
    setOverlayVersion((v) => v + 1);
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
    setOverlayVersion((v) => v + 1);
  }, [weatherStations, weatherStationsActive]);

  // RAWS overlay — fetch all nearby stations when overlay is enabled
  const rawsOverlayActive = useUiStore((s) => s.rawsOverlayActive);
  const { stations: rawsStations } = useRawsStations();
  // Selected RAWS pin React state (drives popover)
  // Register popup state setter and canvas-position getter so e2e tests can
  // open the popover via the backdoor AND dispatch real canvas clicks at the
  // actual rendered pin coordinates.
  useEffect(() => {
    registerRawsPopupHandlers(setSelectedRawsDatasetId, () => {});
    registerRawsCanvasPositionGetter(() => rawsCanvasPositionsRef.current);
    registerSubstrateFeatureGetter(() => substrateFeaturesRef.current.length);
    registerPuzzleTestHandlers(
      (on) => { setPuzzleMode(on); },
      (ids) => {
        const filtered = ids.filter(Boolean) as string[];
        const newSet = new Set(filtered);
        const primary = filtered[0] ?? null;
        setPuzzleSelectedIds(newSet, primary);
      },
      () => puzzlePrimaryIdRef.current,
      (id) => puzzleTransformsRef.current.get(id) ?? null,
      (ids) => {
        const gid = `group-${++puzzleGroupCounterRef.current}`;
        const members = new Set(ids);
        setPuzzleGroups((prev) => {
          const next = new Map(prev);
          next.set(gid, members);
          return next;
        });
        return gid;
      },
      () => {
        const out: Record<string, string[]> = {};
        for (const [gid, members] of puzzleGroupsRef.current) {
          out[gid] = [...members];
        }
        return out;
      },
    );
    markPuzzleBridgeReady();
  }, [setPuzzleSelectedIds]);
  useEffect(() => {
    rawsActiveRef.current = rawsOverlayActive;
    if (!rawsOverlayActive) {
      rawsPinsRef.current = [];
      rawsDataRef.current = new Map();
      rawsSelectedIdRef.current = null;
      setSelectedRawsDatasetId(null);
    }
    dirtyRef.current = true;
    setOverlayVersion((v) => v + 1);
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
    setOverlayVersion((v) => v + 1);
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
    ?.metadata as { sourceName?: string; creditUrl?: string; fetchedAt?: string } | undefined;
  const substrateSourceName =
    substrateMeta?.sourceName ?? "Alaska ShoreZone (NOAA AKR / ADF&G)";
  const substrateCreditUrl =
    substrateMeta?.creditUrl ?? "https://alaskafisheries.noaa.gov/shorezone/";
  const substrateFetchedAt = substrateMeta?.fetchedAt ?? null;
  useEffect(() => {
    substrateFeaturesRef.current = substrateCollection?.features ?? [];
    dirtyRef.current = true;
  }, [substrateCollection]);

  // Intertidal hotspots overlay — mirrors intertidalHotspotsEnabled / intertidalScoreMode
  // from uiStore so the 2D pins match what the 3D IntertidalHotspotsLayer shows.
  const intertidalHotspotsEnabled = useUiStore((s) => s.intertidalHotspotsEnabled);
  const intertidalScoreMode = useUiStore((s) => s.intertidalScoreMode);
  useEffect(() => {
    intertidalHotspotsEnabledRef.current = intertidalHotspotsEnabled;
    if (!intertidalHotspotsEnabled) {
      intertidalPinsRef.current = [];
      intertidalHotspotDataRef.current = new Map();
      intertidalSelectedUnitIdRef.current = null;
    }
    dirtyRef.current = true;
    setOverlayVersion((v) => v + 1);
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
    setOverlayVersion((v) => v + 1);
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

  // Rebuild no-data boundary segments for the primary dataset whenever its grid changes.
  // Secondary dataset segments are kept in sync inside the secondary-bitmaps effect below.
  useEffect(() => {
    if (!overviewGrid) {
      dirtyRef.current = true;
      return;
    }
    nodataBoundarySegmentsRef.current.set(overviewGrid.datasetId, buildNodataBoundarySegments(overviewGrid));
    dirtyRef.current = true;
  }, [overviewGrid]);

  // Rebuild contour segments for all visible datasets whenever the visible set,
  // contour interval, units, or enabled flag changes.
  useEffect(() => {
    if (!contoursEnabled) {
      contourSegmentsRef.current.clear();
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

    // Remove segments for datasets that are no longer visible.
    const visibleIds = new Set(visibleDatasets.filter((v) => !!v.overviewGrid).map((v) => v.datasetId));
    for (const id of contourSegmentsRef.current.keys()) {
      if (!visibleIds.has(id)) contourSegmentsRef.current.delete(id);
    }

    // Build/rebuild segments for every visible dataset that has a grid.
    for (const v of visibleDatasets) {
      const og = v.overviewGrid;
      if (!og) continue;
      contourSegmentsRef.current.set(v.datasetId, buildContourLines(og, intervalMetres));
    }

    dirtyRef.current = true;
  }, [visibleDatasets, contourInterval, contoursEnabled, unitsForUi]);

  // Build offscreen bitmap whenever overviewGrid, palette, or colormap theme changes.
  // Also invalidates any cached upscaled bitmap so the new data re-triggers
  // Topaz upscaling on the next render pass.
  const paletteShallow = usePaletteStore((s) => s.shallow);
  const paletteDeep = usePaletteStore((s) => s.deep);
  const paletteBandColors = usePaletteStore((s) => s.bandColors);
  const paletteCustomStops = usePaletteStore((s) => s.customStops);
  const paletteBandBoundaries = usePaletteStore((s) => s.bandBoundaries);
  useEffect(() => {
    if (!overviewGrid) {
      // Clear the stale bitmap so a brief loading window after unload cannot
      // show a ghost of the previous dataset behind the "LOADING…" indicator.
      bitmapRef.current = null;
      invalidateUpscaleRef.current();
      dirtyRef.current = true;
      return;
    }
    bitmapRef.current = buildHeatmapBitmap(overviewGrid, colormapTheme, overviewGrid.topography);
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

    // Remove bitmaps and nodata segments for datasets that are no longer visible.
    const visibleIds = new Set(withGrid.map((v) => v.datasetId));
    for (const id of secondaryBitmapsRef.current.keys()) {
      if (!visibleIds.has(id)) secondaryBitmapsRef.current.delete(id);
    }
    for (const id of nodataBoundarySegmentsRef.current.keys()) {
      if (!visibleIds.has(id)) nodataBoundarySegmentsRef.current.delete(id);
    }

    // Build/rebuild bitmaps and nodata segments for every secondary (non-first) visible dataset.
    for (const v of withGrid) {
      if (v.datasetId === primaryId) continue; // primary handled by the effect above
      const og = v.overviewGrid;
      if (!og) continue;
      secondaryBitmapsRef.current.set(v.datasetId, buildHeatmapBitmap(og, colormapTheme, og.topography));
      nodataBoundarySegmentsRef.current.set(v.datasetId, buildNodataBoundarySegments(og));
    }

    // Compute the combined bbox when 2+ datasets have overview grids loaded.
    if (withGrid.length > 1) {
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const v of withGrid) {
        const og = v.overviewGrid;
        if (!og) continue;
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
    // Sync reference grid into puzzleStore so MarkerLayer can apply puzzle
    // transforms without being co-located with the OverviewMap canvas.
    usePuzzleStore.getState().setWorldGrid(worldGridRef.current);

    // Re-initialize the canvas transform whenever the visible set changes so
    // all loaded datasets fit in view at once.  Uses the combined world-space
    // bbox when multiple datasets are present; falls back to the single loaded
    // grid otherwise (mirrors what initTransform does on first primary load).
    const canvas = canvasRef.current;
    if (canvas && withGrid.length > 0) {
      const refGrid = worldGridRef.current ?? withGrid.find((d) => d.overviewGrid != null)?.overviewGrid;
      if (refGrid) {
        transformRef.current = computeInitialTransform(refGrid, canvas.width, canvas.height);
        const nextDensity = transformRef.current.pxPerDeg * transformRef.current.scale;
        const savedDensity = hydratedPuzzlePixelDensityRef.current;
        puzzlePixelDensityRef.current = nextDensity;
        if (savedDensity !== null && puzzleTransformsRef.current.size > 0) {
          const rebased = rebasePuzzleTransformsForView(
            puzzleTransformsRef.current,
            savedDensity,
            nextDensity,
          );
          puzzleTransformsRef.current = rebased;
          setPuzzleTransforms(rebased);
          hydratedPuzzlePixelDensityRef.current = null;
        }
      }
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
    const nextDensity = transformRef.current.pxPerDeg * transformRef.current.scale;
    const savedDensity = hydratedPuzzlePixelDensityRef.current;
    puzzlePixelDensityRef.current = nextDensity;
    if (savedDensity !== null && puzzleTransformsRef.current.size > 0) {
      const rebased = rebasePuzzleTransformsForView(
        puzzleTransformsRef.current,
        savedDensity,
        nextDensity,
      );
      puzzleTransformsRef.current = rebased;
      setPuzzleTransforms(rebased);
      hydratedPuzzlePixelDensityRef.current = null;
    }
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
        bitmapRef.current = buildHeatmapBitmap(og, theme, og.topography);
      }
      const visibleNow = visibleDatasetsRef.current;
      const primaryId = visibleNow[0]?.datasetId ?? null;
      secondaryBitmapsRef.current.clear();
      for (const v of visibleNow) {
        if (v.datasetId === primaryId || !v.overviewGrid) continue;
        secondaryBitmapsRef.current.set(
          v.datasetId,
          buildHeatmapBitmap(v.overviewGrid, theme, v.overviewGrid.topography),
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

    // Tracks when we first observed non-empty visibleDatasets with a null grid,
    // so we can switch from "LOADING..." to an error message after a timeout.
    // Reset to null whenever the grid arrives (effect re-runs) or visibleDatasets
    // becomes empty again.
    let nullGridSince: number | null = null;
    // Expose a reset function so handleOverviewRetry (outside this closure) can
    // restart the loading clock without the effect needing to re-run.
    nullGridSinceResetRef.current = () => { nullGridSince = null; };

    const loop = () => {
      const ctx = canvas.getContext("2d");
      // `grid` is the primary dataset's overview grid — used for per-dataset data
      // (depth range for colormap legend, upscale request bbox, satellite tile).
      const grid = overviewGrid;
      const bitmap = bitmapRef.current;
      let t = transformRef.current;

      if (!ctx) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const cW = canvas.width;
      const cH = canvas.height;

      // Case 1: No datasets selected — show an empty-state hint rather than the
      // loading spinner. The rAF loop keeps running so the hint stays visible and
      // responds immediately when the user selects a dataset.
      const visibleNow = visibleDatasetsRef.current;
      if (visibleNow.length === 0) {
        // Empty and loading states have no rendered map to preserve.
        ctx.fillStyle = "#020818";
        ctx.fillRect(0, 0, cW, cH);
        nullGridSince = null; // reset the stale-fetch tracker
        ctx.font = "11px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,229,255,0.35)";
        ctx.fillText("No datasets selected", cW / 2, cH / 2 - 10);

        // Draw "Choose a dataset from Find Data" as a clickable link.
        const linkText = "Choose a dataset from Find Data";
        const linkY = cH / 2 + 8;
        ctx.fillStyle = "rgba(0,229,255,0.85)";
        ctx.fillText(linkText, cW / 2, linkY);
        // Underline
        const tw = ctx.measureText(linkText).width;
        const lx = cW / 2 - tw / 2;
        ctx.strokeStyle = "rgba(0,229,255,0.85)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx, linkY + 7);
        ctx.lineTo(lx + tw, linkY + 7);
        ctx.stroke();
        // Store hit rect for click / cursor detection (generous padding).
        emptyStateLinkRectRef.current = { x: lx - 4, y: linkY - 9, w: tw + 8, h: 20 };

        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      // Clear the empty-state link rect once datasets are present.
      emptyStateLinkRectRef.current = null;

      if (!grid || !bitmap || !t) {
        // Case 2: Datasets are selected but their grids are still fetching.
        // Track how long we've been waiting; after 15 s assume the fetch failed
        // and show an error message instead of spinning forever.
        ctx.fillStyle = "#020818";
        ctx.fillRect(0, 0, cW, cH);
        if (nullGridSince === null) nullGridSince = Date.now();
        const waitedMs = Date.now() - nullGridSince;
        ctx.fillStyle = "rgba(0,229,255,0.35)";
        ctx.font = "11px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Treat both a definitive React Query error (overviewLoadFailedRef set
        // by the fast-error useEffect) and a 15 s stall as "failed".
        if (waitedMs > 15_000) {
          // Flip the React state once so the retry button renders in the DOM.
          if (!overviewLoadFailedRef.current) {
            overviewLoadFailedRef.current = true;
            setOverviewLoadFailed(true);
          }
        }
        if (overviewLoadFailedRef.current) {
          ctx.fillText("Could not load map data", cW / 2, cH / 2);
        } else {
          const dotsCount = 1 + (Math.floor(Date.now() / 400) % 3);
          ctx.fillText("LOADING" + ".".repeat(dotsCount), cW / 2, cH / 2);
        }
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Grid arrived — clear any lingering error state so a retry → success path
      // removes the retry button without the user having to interact again.
      if (overviewLoadFailedRef.current) {
        overviewLoadFailedRef.current = false;
        setOverviewLoadFailed(false);
      }

      // Grid arrived — reset the stale-fetch tracker for the next time the
      // primary dataset changes and we enter a fresh loading phase.
      nullGridSince = null;

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
        // Fit animation updates transformRef directly; render this frame with
        // the latest transform rather than the snapshot captured above.
        t = transformRef.current;
      }

      // Keep persisted pixel offsets proportional to the current geographic
      // scale. This runs after every animation frame, including interrupted
      // and repeated fit/zoom transitions.
      rebasePuzzleTransformsForViewChange(t);

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

      // Loaded map pixels persist between frames. Clear only when this frame
      // will redraw, so an idle rAF cannot erase an already-painted map.
      ctx.fillStyle = "#020818";
      ctx.fillRect(0, 0, cW, cH);

      // Detect view changes and invalidate stale upscaled bitmap
      const viewKey = `${t.scale.toFixed(2)}_${t.offsetX.toFixed(0)}_${t.offsetY.toFixed(0)}`;
      if (viewKey !== lastViewKey) {
        if (lastViewKey !== null) {
          invalidateUpscaleRef.current();
        }
        lastViewKey = viewKey;
      }

      // Re-publish puzzle geo transforms whenever the view key (scale/offset)
      // changes while puzzle tiles are positioned.  Wheel zoom and fit-animation
      // update transformRef.current directly without touching [puzzleTransforms],
      // so the [puzzleTransforms] effect alone is insufficient — we recompute
      // here instead using the same `t` and `worldGrid` that the rAF draw uses
      // to ensure pixel→geo mapping is always consistent with what is rendered.
      if (puzzleTransformsRef.current.size > 0 && viewKey !== lastGeoPublishKeyRef.current) {
        lastGeoPublishKeyRef.current = viewKey;
        const geoMapRaf = new Map<string, { dLon: number; dLat: number; angleDeg: number }>();
        for (const [dsId, { tx, ty, angleDeg }] of puzzleTransformsRef.current.entries()) {
          const dsEntry = visibleDatasetsRef.current.find((v) => v.datasetId === dsId);
          const dsBbox = dsEntry?.overviewGrid ?? grid;
          if (!dsBbox) continue;
          const cLon = (dsBbox.minLon + dsBbox.maxLon) / 2;
          const cLat = (dsBbox.minLat + dsBbox.maxLat) / 2;
          const [tcx, tcy] = lonLatToCanvas(cLon, cLat, worldGrid, t);
          const canonPt = canvasToLonLat(tcx, tcy, worldGrid, t);
          const offsetPt = canvasToLonLat(tcx + tx, tcy + ty, worldGrid, t);
          geoMapRaf.set(dsId, {
            dLon: offsetPt.lon - canonPt.lon,
            dLat: offsetPt.lat - canonPt.lat,
            angleDeg,
          });
        }
        useUiStore.getState().setPuzzleGeoTransforms(geoMapRaf);
      }

      // Multi-dataset heatmap rendering — sorted by survey recency so the
      // dataset with the most recent `dataUpdatedAt` is drawn last (on top).
      // The primary dataset acts as a tiebreaker for equal/unknown dates.
      //
      // When only one dataset is loaded this collapses to the same single
      // renderHeatmap call that existed before.
      ctx.globalAlpha = 1.0;

      const primIdNow = primaryDatasetIdRef.current;

      // Special-collection background reference image — drawn BELOW all
      // dataset heatmaps whenever a collection with a loaded image is active.
      // The collection store is the source of truth for overlay visibility;
      // keeping this independent of the puzzle toolbar toggle prevents a
      // loaded reference image from disappearing when that UI state changes.
      // Placement uses the two-point geo-anchor affine when set, otherwise the
      // union bbox of the visible datasets, at the configured opacity.
      const spcNow = useSpecialCollectionStore.getState().active;
      if (spcNow?.bgImage) {
        const bgBboxes = visibleNow
          .map((v) => (v.datasetId === primIdNow ? grid : v.overviewGrid))
          .filter((g): g is NonNullable<typeof g> => g != null)
          .map((g) => ({ minLon: g.minLon, maxLon: g.maxLon, minLat: g.minLat, maxLat: g.maxLat }));
        drawBackgroundImage(
          ctx,
          spcNow.bgImage,
          spcNow.bgImageW,
          spcNow.bgImageH,
          spcNow.bgGeoAnchors,
          bgBboxes,
          worldGrid,
          t,
          spcNow.bgOpacity,
        );
      }

      // Helper: apply puzzle transform for a tile and draw selection affordances.
      // Called inside the tile loop for each dataset to draw; wraps the actual
      // drawImage calls in ctx.save()/restore() with per-tile rotation+translation.
      const drawPuzzleTile = (
        drawFn: () => void,
        tileDatasetId: string,
        tileBbox: { minLon: number; maxLon: number; minLat: number; maxLat: number },
      ) => {
        const [bx0, by0] = lonLatToCanvas(tileBbox.minLon, tileBbox.maxLat, worldGrid, t);
        const [bx1, by1] = lonLatToCanvas(tileBbox.maxLon, tileBbox.minLat, worldGrid, t);
        const tcx = (bx0 + bx1) / 2;
        const tcy = (by0 + by1) / 2;
        const pxform = puzzleTransformsRef.current.get(tileDatasetId);
        const ptx = pxform?.tx ?? 0;
        const pty = pxform?.ty ?? 0;
        const pAngleRad = ((pxform?.angleDeg ?? 0) * Math.PI) / 180;
        const pFlipH = pxform?.flipH ?? false;
        const pFlipV = pxform?.flipV ?? false;

        ctx.save();
        // Rotate around tile center, apply flip, then translate.
        ctx.translate(tcx + ptx, tcy + pty);
        ctx.rotate(pAngleRad);
        ctx.scale(pFlipH ? -1 : 1, pFlipV ? -1 : 1);
        ctx.translate(-tcx, -tcy);

        drawFn();

        // Puzzle tile title — attached to the tile's transformed top edge, but
        // counter-rotated and counter-flipped so it is always upright on screen.
        // This is canvas-only; it has no bearing on the tile's hit testing.
        if (puzzleModeRef.current && showPuzzleTitlesRef.current) {
          const gridName = visibleDatasetsRef.current.find((v) => v.datasetId === tileDatasetId)
            ?.overviewGrid?.name;
          const displayName = datasetNameMapRef.current.get(tileDatasetId) ?? gridName;
          const title = typeof displayName === "string" && displayName.trim()
            ? displayName.trim()
            : `Dataset ${tileDatasetId}`;
          const titleMaxWidth = Math.max(36, Math.abs(bx1 - bx0) - 28);

          ctx.save();
          // Keep the title clear of the outer-corner handles, while its anchor
          // continues to follow the translated/rotated/flipped tile.
          ctx.translate(tcx, by0 - 12);
          ctx.scale(pFlipH ? -1 : 1, pFlipV ? -1 : 1);
          ctx.rotate(-pAngleRad);
          ctx.font = "600 10px 'JetBrains Mono', monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(2,8,24,0.9)";
          ctx.fillStyle = "#e2e8f0";
          ctx.strokeText(title, 0, 0, titleMaxWidth);
          ctx.fillText(title, 0, 0, titleMaxWidth);
          ctx.restore();
        }

        // Selection affordances — bright-purple outline for all selected tiles;
        // corner handles are drawn only on the primary tile.
        if (puzzleModeRef.current && puzzleSelectedIdsRef.current.has(tileDatasetId)) {
          const CORNER_HANDLE_OFFSET = 8;
          const isPrimary = puzzlePrimaryIdRef.current === tileDatasetId;
          ctx.save();
          ctx.strokeStyle = "rgba(168,85,247,0.92)";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
          ctx.setLineDash([]);
          // Corner handles — only on the primary tile so there's one set of controls.
          if (isPrimary) {
            const cornerHandles = [
              { x: bx0 - CORNER_HANDLE_OFFSET, y: by0 - CORNER_HANDLE_OFFSET }, // topLeft
              { x: bx1 + CORNER_HANDLE_OFFSET, y: by0 - CORNER_HANDLE_OFFSET }, // topRight
              { x: bx1 + CORNER_HANDLE_OFFSET, y: by1 + CORNER_HANDLE_OFFSET }, // bottomRight
              { x: bx0 - CORNER_HANDLE_OFFSET, y: by1 + CORNER_HANDLE_OFFSET }, // bottomLeft
            ];
            for (const h of cornerHandles) {
              ctx.beginPath();
              ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
              ctx.fillStyle = "#c084fc";
              ctx.fill();
              ctx.strokeStyle = "rgba(255,255,255,0.85)";
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
          }
          ctx.restore();
        }
        // Group-membership label: small colored pill near the tile's top-left corner.
        if (puzzleModeRef.current) {
          const GROUP_LABEL_COLORS = ["#f97316", "#a855f7", "#22d3ee", "#84cc16", "#f43f5e"];
          for (const [gid, members] of puzzleGroupsRef.current) {
            if (members.has(tileDatasetId)) {
              const gNum = parseInt(gid.replace("group-", ""), 10);
              const color = GROUP_LABEL_COLORS[(gNum - 1) % GROUP_LABEL_COLORS.length] ?? "#f97316";
              const label = `G${gNum}`;
              ctx.save();
              ctx.font = "bold 9px monospace";
              const tw = ctx.measureText(label).width;
              const px = bx0 + 4;
              const py = by0 + 4;
              ctx.fillStyle = color;
              ctx.globalAlpha = 0.85;
              ctx.fillRect(px - 2, py - 1, tw + 5, 12);
              ctx.globalAlpha = 1;
              ctx.fillStyle = "#ffffff";
              ctx.textBaseline = "top";
              ctx.fillText(label, px, py);
              ctx.restore();
              break; // show first group membership only
            }
          }
        }
        // Padlock glyph for locked tiles + italic annotation note — rendered
        // in the NW corner label area, below the group pill when present.
        if (puzzleModeRef.current && pxform) {
          let labelY = by0 + 18;
          if (pxform.locked) {
            ctx.save();
            ctx.font = "10px monospace";
            ctx.textBaseline = "top";
            ctx.fillText("🔒", bx0 + 4, labelY);
            ctx.restore();
            labelY += 13;
          }
          if (pxform.annotation) {
            ctx.save();
            ctx.font = "italic 9px monospace";
            ctx.textBaseline = "top";
            ctx.fillStyle = "rgba(226,232,240,0.9)";
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.lineWidth = 2;
            ctx.strokeText(pxform.annotation, bx0 + 4, labelY);
            ctx.fillText(pxform.annotation, bx0 + 4, labelY);
            ctx.restore();
          }
        }

        ctx.restore();
      };

      // Helper: apply the same puzzle transform as drawPuzzleTile but without
      // the selection affordances — used for overlay layers (contours, bands,
      // borders) so they move in lockstep with their bitmap tile.  Outside
      // puzzle mode this is a transparent pass-through.
      const applyPuzzleTransform = (
        tileDatasetId: string,
        tileBbox: { minLon: number; maxLon: number; minLat: number; maxLat: number },
        drawFn: () => void,
      ) => {
        const [bx0, by0] = lonLatToCanvas(tileBbox.minLon, tileBbox.maxLat, worldGrid, t);
        const [bx1, by1] = lonLatToCanvas(tileBbox.maxLon, tileBbox.minLat, worldGrid, t);
        const tcx = (bx0 + bx1) / 2;
        const tcy = (by0 + by1) / 2;
        const pxform = puzzleTransformsRef.current.get(tileDatasetId);
        const ptx = pxform?.tx ?? 0;
        const pty = pxform?.ty ?? 0;
        const pAngleRad = ((pxform?.angleDeg ?? 0) * Math.PI) / 180;
        const pFlipH = pxform?.flipH ?? false;
        const pFlipV = pxform?.flipV ?? false;

        ctx.save();
        ctx.translate(tcx + ptx, tcy + pty);
        ctx.rotate(pAngleRad);
        ctx.scale(pFlipH ? -1 : 1, pFlipV ? -1 : 1);
        ctx.translate(-tcx, -tcy);

        drawFn();

        ctx.restore();
      };

      if (visibleNow.length > 1) {
        // Sort oldest-first so the newest survey data is always on top.
        const sorted = sortByRecency(visibleNow);
        for (const v of sorted) {
          if (v.datasetId === primIdNow) {
            // Primary heatmap — Topaz-upscaled when available, otherwise raw bitmap.
            const upscaled = upscaledBitmapRef.current;
            drawPuzzleTile(
              () => {
                if (upscaled) {
                  const [px0, py0] = lonLatToCanvas(grid.minLon, grid.maxLat, worldGrid, t);
                  const [px1, py1] = lonLatToCanvas(grid.maxLon, grid.minLat, worldGrid, t);
                  ctx.imageSmoothingEnabled = false;
                  ctx.drawImage(upscaled, px0, py0, px1 - px0, py1 - py0);
                  ctx.imageSmoothingEnabled = true;
                } else {
                  renderHeatmapAtBbox(ctx, bitmap, grid, worldGrid, t);
                }
              },
              v.datasetId,
              { minLon: grid.minLon, maxLon: grid.maxLon, minLat: grid.minLat, maxLat: grid.maxLat },
            );
          } else {
            const og = v.overviewGrid;
            const secBitmap = og ? secondaryBitmapsRef.current.get(v.datasetId) : undefined;
            if (!og || !secBitmap) continue;
            drawPuzzleTile(
              () => { renderHeatmapAtBbox(ctx, secBitmap, og, worldGrid, t); },
              v.datasetId,
              { minLon: og.minLon, maxLon: og.maxLon, minLat: og.minLat, maxLat: og.maxLat },
            );
          }
        }
      } else {
        // Primary heatmap — Topaz-upscaled when available, otherwise raw bitmap.
        const upscaled = upscaledBitmapRef.current;
        drawPuzzleTile(
          () => {
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
          },
          grid.datasetId,
          { minLon: grid.minLon, maxLon: grid.maxLon, minLat: grid.minLat, maxLat: grid.maxLat },
        );
      }
      ctx.globalAlpha = 1.0;

      // Gap/overlap indicator — red hatch where the union bbox has no tile
      // coverage, orange fill where two or more tiles overlap. Rasterized at
      // 1/4 resolution and recomputed with a 200 ms debounce.
      if (puzzleModeRef.current && showGapOverlayRef.current) {
        const gapTiles: GapOverlapTileInput[] = [];
        for (const v of visibleNow) {
          const og = v.datasetId === primIdNow ? grid : v.overviewGrid;
          if (!og) continue;
          const [gx0, gy0] = lonLatToCanvas(og.minLon, og.maxLat, worldGrid, t);
          const [gx1, gy1] = lonLatToCanvas(og.maxLon, og.minLat, worldGrid, t);
          const gxf = puzzleTransformsRef.current.get(v.datasetId);
          gapTiles.push({
            x0: gx0, y0: gy0, x1: gx1, y1: gy1,
            tx: gxf?.tx ?? 0, ty: gxf?.ty ?? 0, angleDeg: gxf?.angleDeg ?? 0,
          });
        }
        const gapKey =
          viewKey + "::" +
          gapTiles
            .map((g) => `${g.x0.toFixed(1)},${g.y0.toFixed(1)},${g.x1.toFixed(1)},${g.y1.toFixed(1)},${g.tx.toFixed(1)},${g.ty.toFixed(1)},${g.angleDeg}`)
            .join(";");
        const gapCache = gapMaskCacheRef.current;
        const gapNow = performance.now();
        if (!gapCache || (gapCache.key !== gapKey && gapNow - gapCache.computedAt >= 200)) {
          gapMaskCacheRef.current = {
            key: gapKey,
            mask: computeGapOverlapMask(gapTiles, GAP_OVERLAP_STEP_PX),
            computedAt: gapNow,
          };
        } else if (gapCache.key !== gapKey && gapRecomputeTimerRef.current === null) {
          // Debounce window still open — schedule a redraw once it elapses.
          gapRecomputeTimerRef.current = window.setTimeout(() => {
            gapRecomputeTimerRef.current = null;
            dirtyRef.current = true;
          }, Math.max(10, 205 - (gapNow - gapCache.computedAt)));
        }
        const gapMask = gapMaskCacheRef.current?.mask;
        if (gapMask) drawGapOverlap(ctx, gapMask);
      }

      // Brief green flash on a just-snapped tile edge (≤ 300 ms).
      if (snapFlashRef.current) {
        const flash = snapFlashRef.current;
        if (performance.now() < flash.until) {
          ctx.save();
          ctx.strokeStyle = "rgba(34,197,94,0.95)";
          ctx.lineWidth = 3;
          for (const seg of flash.edges) {
            ctx.beginPath();
            if (seg.axis === "v") {
              ctx.moveTo(seg.pos, seg.from);
              ctx.lineTo(seg.pos, seg.to);
            } else {
              ctx.moveTo(seg.from, seg.pos);
              ctx.lineTo(seg.to, seg.pos);
            }
            ctx.stroke();
          }
          ctx.restore();
          dirtyRef.current = true; // keep animating until the flash expires
        } else {
          snapFlashRef.current = null;
          dirtyRef.current = true;
        }
      }

      // Simulated-data rainbow hatch — drawn over any coverage area whose
      // grid reports a synthetic data source. Real-data areas are untouched.
      if (visibleNow.length > 1) {
        for (const v of visibleNow) {
          const og = v.overviewGrid;
          if (og && isSyntheticGrid(og)) {
            applyPuzzleTransform(
              v.datasetId,
              { minLon: og.minLon, maxLon: og.maxLon, minLat: og.minLat, maxLat: og.maxLat },
              () => { renderSyntheticHatch(ctx, og, worldGrid, t); },
            );
          }
        }
      } else if (isSyntheticGrid(grid)) {
        applyPuzzleTransform(
          grid.datasetId,
          { minLon: grid.minLon, maxLon: grid.maxLon, minLat: grid.minLat, maxLat: grid.maxLat },
          () => { renderSyntheticHatch(ctx, grid, worldGrid, t); },
        );
      }

      // Dataset boundary outlines — thin dashed borders drawn over the heatmap
      // patches so the edges of each dataset are clearly visible.
      if (visibleNow.length > 1 && primIdNow) {
        for (const v of visibleNow) {
          const og = v.overviewGrid;
          if (!og) continue;
          const isPrimDataset = v.datasetId === primIdNow;
          applyPuzzleTransform(
            v.datasetId,
            { minLon: og.minLon, maxLon: og.maxLon, minLat: og.minLat, maxLat: og.maxLat },
            () => {
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
            },
          );
        }
      }

      // Intertidal band fill — teal/amber depth zones that mirror the 3D terrain
      // shader.  Drawn BEFORE contour lines so contour lines and their labels
      // remain fully legible on top of the semi-transparent fill.
      // In multi-dataset mode each visible dataset's own grid is used so the
      // bands are aligned to the correct bbox (same pattern as renderContourLines).
      if (intertidalMhwFtRef.current !== null) {
        for (const v of visibleNow) {
          const og = v.overviewGrid;
          if (!og) continue;
          applyPuzzleTransform(
            v.datasetId,
            { minLon: og.minLon, maxLon: og.maxLon, minLat: og.minLat, maxLat: og.maxLat },
            () => {
              renderIntertidalBand(
                ctx,
                og,
                worldGrid,
                t,
                intertidalMhwFtRef.current!,
                intertidalMhhwFtRef.current,
              );
            },
          );
        }
      }

      // Survey-boundary indicators — dashed grey strokes at the edge of null
      // (no-data) zones so users understand where coverage ends.  Drawn above
      // the heatmap/intertidal fill but below contour lines and labels.
      // In multi-dataset mode each visible dataset's own nodata boundary is
      // rendered using its own grid so segment positions are correct.
      if (showNodataBoundaryRef.current && nodataBoundarySegmentsRef.current.size > 0) {
        for (const v of visibleNow) {
          const og = v.overviewGrid;
          if (!og) continue;
          const segs = nodataBoundarySegmentsRef.current.get(og.datasetId);
          if (segs && segs.length > 0) {
            applyPuzzleTransform(
              v.datasetId,
              { minLon: og.minLon, maxLon: og.maxLon, minLat: og.minLat, maxLat: og.maxLat },
              () => { renderNodataBoundary(ctx, segs, og, t, worldGrid); },
            );
          }
        }
      }

      // Contour lines — drawn over the heatmap and intertidal fill, under the
      // geographic grid and markers, so depth labels stay crisp.
      // In multi-dataset mode each visible dataset's own contour lines are
      // rendered using its own grid so segment positions are correct.
      const { overviewShowGrid, units, colormapTheme: activeTheme } = useSettingsStore.getState();
      if (contoursEnabledRef.current && contourSegmentsRef.current.size > 0) {
        for (const v of visibleNow) {
          const og = v.overviewGrid;
          if (!og) continue;
          const segs = contourSegmentsRef.current.get(og.datasetId);
          if (segs && segs.length > 0) {
            applyPuzzleTransform(
              v.datasetId,
              { minLon: og.minLon, maxLon: og.maxLon, minLat: og.minLat, maxLat: og.maxLat },
              () => {
                // renderContourLines uses og.width/height/minDepth/maxDepth for the
                // dataset's own grid, but projects lon/lat coords onto the shared
                // worldGrid canvas layout (same anchor used by renderHeatmapAtBbox).
                renderContourLines(ctx, segs, og, t, units, activeTheme, worldGrid);
              },
            );
          }
        }
      }

      // Lat/lon grid (gated by user setting; renderGridLines also checks scale ≥ 2 internally)
      if (overviewShowGrid) {
        renderGridLines(ctx, worldGrid, t, cW, cH);
      }

      // Saved trails (completed)
      if (savedTrailsRef.current.length > 0) {
        renderSavedTrails(ctx, savedTrailsRef.current, worldGrid, t);
      }
      if (overviewShowMarkersRef.current && visibleMarkerTypesRef.current.length > 0 && markersRef.current.length > 0) {
        renderSavedDrifts(
          ctx,
          markersRef.current.filter((marker) => visibleMarkerTypesRef.current.includes(marker.type)),
          worldGrid,
          t,
          selectedSavedDriftIdRef.current,
        );
      }

      // Habitat overlay (drawn above depth heatmap, below markers)
      const habitatScores = useHabitatStore.getState().scores;
      const habitatActive = useHabitatStore.getState().activeSpecies !== null;
      if (habitatActive && habitatScores.status === "done") {
        // renderHabitatOverlay scales habitat scores to the primary grid's bbox —
        // must use overviewGrid, not the synthetic world-extent grid.
        renderHabitatOverlay(ctx, habitatScores.data, grid, t);
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

      // Saved ShoreZone/AOOS habitat uses the native substrate styling rather
      // than the EFH species legend/detail panel. It is enabled by the same
      // habitat-overlay switch because it is part of the saved habitat layer.
      if (showEfhRef.current && embeddedHabitatFeaturesRef.current.length > 0 && shouldDrawOverlayAtScale(t.scale)) {
        renderSubstrateOverlay(
          ctx,
          embeddedHabitatFeaturesRef.current,
          worldGrid,
          t,
          null,
          new Set(),
        );
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
        const isGeoref = georefPickModeRef.current;
        drawSelectionRect(ctx, drag.x0, drag.y0, drag.x1, drag.y1, {
          width: Math.abs(dr.lon - dl.lon),
          height: Math.abs(dr.lat - dl.lat),
          ...(isDownload ? { strokeColor: "rgba(251,191,36,0.85)", fillColor: "rgba(251,191,36,0.06)" } : {}),
          ...(isGeoref ? { strokeColor: "rgba(167,139,250,0.9)", fillColor: "rgba(167,139,250,0.08)" } : {}),
        });
      } else if (coordSearchAreaRef.current) {
        // Manual coordinate search — draw a circle (not a rectangle) centred
        // on the searched point, sized from its bbox, plus a crosshair.
        const area = coordSearchAreaRef.current;
        const { north, south, east, west } = area.bbox;
        const [cx, cy] = lonLatToCanvas(area.lon, area.lat, worldGrid, t);
        const [ex] = lonLatToCanvas(east, area.lat, worldGrid, t);
        const [wx] = lonLatToCanvas(west, area.lat, worldGrid, t);
        const [, ny] = lonLatToCanvas(area.lon, north, worldGrid, t);
        const [, sy] = lonLatToCanvas(area.lon, south, worldGrid, t);
        const rx = Math.abs(ex - wx) / 2;
        const ry = Math.abs(sy - ny) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,229,255,0.06)";
        ctx.fill();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(0,229,255,0.85)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        // Centre crosshair
        const CH = 6;
        ctx.beginPath();
        ctx.moveTo(cx - CH, cy);
        ctx.lineTo(cx + CH, cy);
        ctx.moveTo(cx, cy - CH);
        ctx.lineTo(cx, cy + CH);
        ctx.strokeStyle = "rgba(0,229,255,0.95)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
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
      // Also mirror into puzzleStore so MarkerLayer can convert puzzle canvas-pixel
      // offsets to geographic coordinates using the same pan/zoom state.
      usePuzzleStore.getState().setOverviewTransform({ ...t });

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
      // Note: do NOT clear puzzleStore here. This cleanup fires whenever
      // overviewGrid changes (not only on unmount), so clearing would wipe
      // puzzle state mid-session — e.g. when a secondary dataset loads or the
      // primary changes — while puzzleMode/transforms sync effects do not
      // re-run because their own deps did not change. The unmount cleanup
      // below is the sole place that clears the store.
    };
  }, [overviewGrid, rebasePuzzleTransformsForViewChange]);

  // Clear puzzleStore only on component unmount so 3D markers revert to their
  // original positions when the panel is closed, but NOT on intermediate
  // overviewGrid changes that restart the rAF loop mid-session.
  useEffect(() => () => { usePuzzleStore.getState().clear(); }, []);

  // ---------------------------------------------------------------------------
  // Mouse / wheel events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (suppressMouseUntilRef.current > performance.now()) return;
      // Puzzle mode — intercept left-button for tile hit-test and drag setup.
      if (puzzleModeRef.current && e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        // Selection is committed on mousedown. Only a meaningful movement
        // suppresses the trailing click, so an empty-space click still clears
        // selection without being treated as a pan.
        hasDraggedRef.current = false;
        dirtyRef.current = true;

        const t = transformRef.current;
        if (!t || !overviewGrid) return;
        const worldGrid = worldGridRef.current ?? overviewGrid;
        const HANDLE_RADIUS = 10; // px hit area for rotation handle
        const CORNER_HANDLE_OFFSET = 8; // px diagonal outward offset from each corner

        // Check rotation handles for the primary tile first.
        const primaryId = puzzlePrimaryIdRef.current;
        if (primaryId && puzzleSelectedIdsRef.current.has(primaryId)) {
          const selV = visibleDatasetsRef.current.find((v) => v.datasetId === primaryId);
          const selOg = primaryId === primaryDatasetIdRef.current ? overviewGrid : selV?.overviewGrid;
          if (selOg) {
            const [bx0, by0] = lonLatToCanvas(selOg.minLon, selOg.maxLat, worldGrid, t);
            const [bx1, by1] = lonLatToCanvas(selOg.maxLon, selOg.minLat, worldGrid, t);
            const tcx = (bx0 + bx1) / 2;
            const tcy = (by0 + by1) / 2;
            const pxform = puzzleTransformsRef.current.get(primaryId);
            const ptx = pxform?.tx ?? 0;
            const pty = pxform?.ty ?? 0;
            const pAngleRad = ((pxform?.angleDeg ?? 0) * Math.PI) / 180;

            const cornerLocalOffsets: Array<{ ldx: number; ldy: number; edge: "topLeft" | "topRight" | "bottomRight" | "bottomLeft" }> = [
              { ldx: (bx0 - CORNER_HANDLE_OFFSET) - tcx, ldy: (by0 - CORNER_HANDLE_OFFSET) - tcy, edge: "topLeft"     },
              { ldx: (bx1 + CORNER_HANDLE_OFFSET) - tcx, ldy: (by0 - CORNER_HANDLE_OFFSET) - tcy, edge: "topRight"    },
              { ldx: (bx1 + CORNER_HANDLE_OFFSET) - tcx, ldy: (by1 + CORNER_HANDLE_OFFSET) - tcy, edge: "bottomRight" },
              { ldx: (bx0 - CORNER_HANDLE_OFFSET) - tcx, ldy: (by1 + CORNER_HANDLE_OFFSET) - tcy, edge: "bottomLeft"  },
            ];

            let hitEdge: "topLeft" | "topRight" | "bottomRight" | "bottomLeft" | null = null;
            for (const { ldx, ldy, edge } of cornerLocalOffsets) {
              const hsx = tcx + ptx + ldx * Math.cos(pAngleRad) - ldy * Math.sin(pAngleRad);
              const hsy = tcy + pty + ldx * Math.sin(pAngleRad) + ldy * Math.cos(pAngleRad);
              if (Math.sqrt((mx - hsx) ** 2 + (my - hsy) ** 2) <= HANDLE_RADIUS) {
                hitEdge = edge;
                break;
              }
            }

            if (hitEdge !== null) {
              // Compute collective bounding-box center of all selected tiles.
              const selectedIds = puzzleSelectedIdsRef.current;
              let sumCx = 0;
              let sumCy = 0;
              let count = 0;
              for (const id of selectedIds) {
                const vv = visibleDatasetsRef.current.find((v) => v.datasetId === id);
                const og = id === primaryDatasetIdRef.current ? overviewGrid : vv?.overviewGrid;
                if (!og) continue;
                const [rx0, ry0] = lonLatToCanvas(og.minLon, og.maxLat, worldGrid, t);
                const [rx1, ry1] = lonLatToCanvas(og.maxLon, og.minLat, worldGrid, t);
                const xf = puzzleTransformsRef.current.get(id);
                sumCx += (rx0 + rx1) / 2 + (xf?.tx ?? 0);
                sumCy += (ry0 + ry1) / 2 + (xf?.ty ?? 0);
                count++;
              }
              const ccx = count > 0 ? sumCx / count : mx;
              const ccy = count > 0 ? sumCy / count : my;

              // Snapshot all selected transforms for multi-tile rotate.
              const startTransforms = new Map<string, PuzzleTransform>();
              for (const id of selectedIds) {
                const xf = puzzleTransformsRef.current.get(id) ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false };
                startTransforms.set(id, { ...xf });
              }

              puzzleHandleEdgeRef.current = hitEdge;
              puzzleRotateActuallyDraggedRef.current = false;
              puzzleDragSubModeRef.current = "rotate";
              puzzleDragStartRef.current = {
                mx, my,
                tx: ptx, ty: pty,
                angleDeg: pxform?.angleDeg ?? 0,
                cx: tcx + ptx, cy: tcy + pty,
                startTransforms,
                collectiveCx: ccx, collectiveCy: ccy,
                startAngleDeg: Math.atan2(mx - ccx, -(my - ccy)) * (180 / Math.PI),
              };
              return;
            }
          }
        }

        // Hit-test tiles newest-first (last drawn = topmost).
        const visibleNow = visibleDatasetsRef.current;
        const sorted = sortByRecency(visibleNow);
        let hitId: string | null = null;
        for (let i = sorted.length - 1; i >= 0; i--) {
          const v = sorted[i];
          if (!v) continue;
          const og =
            v.datasetId === primaryDatasetIdRef.current
              ? overviewGrid
              : v.overviewGrid;
          if (!og) continue;
          const [bx0, by0] = lonLatToCanvas(og.minLon, og.maxLat, worldGrid, t);
          const [bx1, by1] = lonLatToCanvas(og.maxLon, og.minLat, worldGrid, t);
          const tcx = (bx0 + bx1) / 2;
          const tcy = (by0 + by1) / 2;
          const pxform = puzzleTransformsRef.current.get(v.datasetId);
          const ptx = pxform?.tx ?? 0;
          const pty = pxform?.ty ?? 0;
          const pAngleRad = ((pxform?.angleDeg ?? 0) * Math.PI) / 180;
          // Inverse-rotate the pointer into the tile's local (unrotated) space.
          const pdx = mx - (tcx + ptx);
          const pdy = my - (tcy + pty);
          const localX = tcx + pdx * Math.cos(-pAngleRad) - pdy * Math.sin(-pAngleRad);
          const localY = tcy + pdx * Math.sin(-pAngleRad) + pdy * Math.cos(-pAngleRad);
          if (localX >= bx0 && localX <= bx1 && localY >= by0 && localY <= by1) {
            hitId = v.datasetId;
            break;
          }
        }

        // Determine new selection based on Shift key and hit result.
        const oldSelection = puzzleSelectedIdsRef.current;
        let newSelection: Set<string>;

        if (e.shiftKey) {
          if (hitId === null) {
            // Shift+click on empty area: no change.
            newSelection = new Set(oldSelection);
          } else if (oldSelection.has(hitId)) {
            // Shift+click on already-selected tile: remove it.
            newSelection = new Set(oldSelection);
            newSelection.delete(hitId);
          } else {
            // Shift+click on unselected tile: add it.
            newSelection = new Set(oldSelection);
            newSelection.add(hitId);
          }
        } else {
          if (hitId === null) {
            // Plain click on empty area: clear selection.
            newSelection = new Set();
          } else if (oldSelection.has(hitId)) {
            // Plain click on already-selected tile: keep selection (enables drag).
            newSelection = new Set(oldSelection);
          } else {
            // Plain click on new tile: replace selection.
            newSelection = new Set([hitId]);
          }
        }

        // Expand newly-added tiles to include their group co-members.
        newSelection = expandWithGroupMembers(newSelection, oldSelection, puzzleGroupsRef.current);

        // Primary tile: the tile that was just clicked (or first in set).
        const newPrimaryId = hitId ?? (newSelection.size > 0 ? ([...newSelection][0] ?? null) : null);
        setPuzzleSelectedIds(newSelection, newPrimaryId);

        // Set translate drag submode if a tile was hit and is in the final
        // selection. Locked tiles are selectable but never start a drag.
        if (hitId !== null && newSelection.has(hitId) && !puzzleTransformsRef.current.get(hitId)?.locked) {
          // Snapshot all selected transforms for multi-tile drag.
          const startTransforms = new Map<string, PuzzleTransform>();
          for (const id of newSelection) {
            const xf = puzzleTransformsRef.current.get(id) ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false };
            startTransforms.set(id, { ...xf });
          }
          const hitV = visibleNow.find((vv) => vv.datasetId === hitId);
          const hitOg = hitId === primaryDatasetIdRef.current ? overviewGrid : hitV?.overviewGrid;
          if (hitOg) {
            const [hbx0, hby0] = lonLatToCanvas(hitOg.minLon, hitOg.maxLat, worldGrid, t);
            const [hbx1, hby1] = lonLatToCanvas(hitOg.maxLon, hitOg.minLat, worldGrid, t);
            const htcx = (hbx0 + hbx1) / 2;
            const htcy = (hby0 + hby1) / 2;
            const hpxform = puzzleTransformsRef.current.get(hitId);
            const hptx = hpxform?.tx ?? 0;
            const hpty = hpxform?.ty ?? 0;
            puzzleDragSubModeRef.current = "translate";
            puzzleDragStartRef.current = {
              mx, my,
              tx: hptx, ty: hpty,
              angleDeg: hpxform?.angleDeg ?? 0,
              cx: htcx, cy: htcy,
              startTransforms,
              collectiveCx: htcx + hptx, collectiveCy: htcy + hpty,
              startAngleDeg: 0,
            };
          }
        } else {
          // Empty puzzle background keeps the established selection-clearing
          // behavior, but becomes a normal clamped viewport pan once moved.
          puzzleDragSubModeRef.current = "pan";
          isDraggingRef.current = true;
          dragStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            ox: transformRef.current?.offsetX ?? 0,
            oy: transformRef.current?.offsetY ?? 0,
          };
          fitAnimRef.current = null;
        }
        return;
      }

      // Select-area / Download / Georef-pick tool: capture rectangle start in
      // canvas coords and suppress pan; left-button only.
      if ((selectModeRef.current || downloadModeRef.current || georefPickModeRef.current) && e.button === 0) {
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

      // Empty-state: show pointer cursor when hovering the "Find Data" link.
      if (visibleDatasetsRef.current.length === 0) {
        const lr = emptyStateLinkRectRef.current;
        const overLink = lr !== null && mx >= lr.x && mx <= lr.x + lr.w && my >= lr.y && my <= lr.y + lr.h;
        canvas.style.cursor = overLink ? "pointer" : "default";
        return;
      }

      // Puzzle mode — handle active drags and cursor feedback.
      if (puzzleModeRef.current) {
        setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        const subMode = puzzleDragSubModeRef.current;

        if (subMode === "pan" && isDraggingRef.current && transformRef.current && overviewGrid) {
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
          canvas.style.cursor = "grabbing";
          dirtyRef.current = true;
          return;
        }

        if (subMode === "translate" && puzzleSelectedIdsRef.current.size > 0) {
          hasDraggedRef.current = true;
          const start = puzzleDragStartRef.current;
          let dx = mx - start.mx;
          let dy = my - start.my;

          // Snap-to-neighbor: probe with the grabbed (primary) tile's bbox.
          // Only unrotated tiles participate — rotated bbox edges aren't
          // axis-aligned, so "flush" is undefined for them.
          if (snapEnabledRef.current) {
            const tSnap = transformRef.current;
            const wgSnap = worldGridRef.current ?? overviewGrid;
            const probeId = puzzlePrimaryIdRef.current;
            const probeStart = probeId ? start.startTransforms.get(probeId) : undefined;
            if (tSnap && wgSnap && probeId && probeStart && !probeStart.locked && probeStart.angleDeg % 360 === 0) {
              const probeV = visibleDatasetsRef.current.find((v) => v.datasetId === probeId);
              const probeOg = probeId === primaryDatasetIdRef.current ? overviewGrid : probeV?.overviewGrid;
              if (probeOg) {
                const [pbx0, pby0] = lonLatToCanvas(probeOg.minLon, probeOg.maxLat, wgSnap, tSnap);
                const [pbx1, pby1] = lonLatToCanvas(probeOg.maxLon, probeOg.minLat, wgSnap, tSnap);
                const moving: SnapRect = {
                  left: pbx0 + probeStart.tx + dx,
                  top: pby0 + probeStart.ty + dy,
                  right: pbx1 + probeStart.tx + dx,
                  bottom: pby1 + probeStart.ty + dy,
                };
                const neighbors: SnapRect[] = [];
                for (const v of visibleDatasetsRef.current) {
                  if (puzzleSelectedIdsRef.current.has(v.datasetId)) continue;
                  const og = v.datasetId === primaryDatasetIdRef.current ? overviewGrid : v.overviewGrid;
                  if (!og) continue;
                  const nxf = puzzleTransformsRef.current.get(v.datasetId);
                  if ((nxf?.angleDeg ?? 0) % 360 !== 0) continue;
                  const [nx0, ny0] = lonLatToCanvas(og.minLon, og.maxLat, wgSnap, tSnap);
                  const [nx1, ny1] = lonLatToCanvas(og.maxLon, og.minLat, wgSnap, tSnap);
                  neighbors.push({
                    left: nx0 + (nxf?.tx ?? 0),
                    top: ny0 + (nxf?.ty ?? 0),
                    right: nx1 + (nxf?.tx ?? 0),
                    bottom: ny1 + (nxf?.ty ?? 0),
                  });
                }
                const snap = computeSnapAdjustment(moving, neighbors);
                if (snap.edges.length > 0) {
                  dx += snap.dx;
                  dy += snap.dy;
                  // Flash only when a NEW edge pairing engages (not every frame).
                  const key = snap.edges.map((sg) => `${sg.axis}:${Math.round(sg.pos)}`).join("|");
                  if (key !== lastSnapKeyRef.current) {
                    lastSnapKeyRef.current = key;
                    snapFlashRef.current = { edges: snap.edges, until: performance.now() + 300 };
                  }
                } else {
                  lastSnapKeyRef.current = null;
                }
              }
            }
          }

          // applyDragTranslation skips locked tiles (lock blocks drag).
          setPuzzleTransforms((prev) => applyDragTranslation(prev, start.startTransforms, dx, dy));
          canvas.style.cursor = "grabbing";
          return;
        }

        if (subMode === "rotate" && puzzleSelectedIdsRef.current.size > 0) {
          hasDraggedRef.current = true;
          puzzleRotateActuallyDraggedRef.current = true;
          const start = puzzleDragStartRef.current;
          const ccx = start.collectiveCx;
          const ccy = start.collectiveCy;
          // Delta angle from the drag-start pointer direction around collective center.
          const currentAngleDeg = Math.atan2(mx - ccx, -(my - ccy)) * (180 / Math.PI);
          const deltaDeg = Math.round(currentAngleDeg - start.startAngleDeg);
          const deltaRad = (deltaDeg * Math.PI) / 180;
          const tNow = transformRef.current;
          const wgNow = worldGridRef.current ?? overviewGrid;
          setPuzzleTransforms((prev) => {
            const next = new Map(prev);
            for (const [id, startXf] of start.startTransforms) {
              if (startXf.locked) continue; // locked tiles never rotate
              const newAngle = startXf.angleDeg + deltaDeg;
              let orbitTx = startXf.tx;
              let orbitTy = startXf.ty;
              // Orbit tile center around collective center by deltaDeg.
              if (tNow && wgNow) {
                const vv = visibleDatasetsRef.current.find((v) => v.datasetId === id);
                const tileOg = id === primaryDatasetIdRef.current ? overviewGrid : vv?.overviewGrid;
                if (tileOg) {
                  const [tbx0, tby0] = lonLatToCanvas(tileOg.minLon, tileOg.maxLat, wgNow, tNow);
                  const [tbx1, tby1] = lonLatToCanvas(tileOg.maxLon, tileOg.minLat, wgNow, tNow);
                  const baseCx = (tbx0 + tbx1) / 2;
                  const baseCy = (tby0 + tby1) / 2;
                  const tileCx = baseCx + startXf.tx;
                  const tileCy = baseCy + startXf.ty;
                  const relX = tileCx - ccx;
                  const relY = tileCy - ccy;
                  const cos = Math.cos(deltaRad);
                  const sin = Math.sin(deltaRad);
                  const newTileCx = ccx + relX * cos - relY * sin;
                  const newTileCy = ccy + relX * sin + relY * cos;
                  orbitTx = newTileCx - baseCx;
                  orbitTy = newTileCy - baseCy;
                }
              }
              const existing = prev.get(id);
              next.set(id, {
                ...(existing ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false }),
                angleDeg: newAngle,
                tx: orbitTx,
                ty: orbitTy,
              });
            }
            return next;
          });
          canvas.style.cursor = "grabbing";
          return;
        }

        // Not dragging — show hover cursor based on whether pointer is over a handle or tile.
        const t = transformRef.current;
        if (t && overviewGrid) {
          const worldGrid = worldGridRef.current ?? overviewGrid;
          const visibleNow = visibleDatasetsRef.current;
          const HOVER_HANDLE_RADIUS = 10;
          const HOVER_CORNER_HANDLE_OFFSET = 8;
          let overHandle = false;
          let overTile = false;

          // Check primary tile's four corner handles first.
          const hovSelId = puzzlePrimaryIdRef.current;
          if (hovSelId) {
            const hovSelV = visibleNow.find((v) => v.datasetId === hovSelId);
            const hovSelOg = hovSelId === primaryDatasetIdRef.current ? overviewGrid : hovSelV?.overviewGrid;
            if (hovSelOg) {
              const [hbx0, hby0] = lonLatToCanvas(hovSelOg.minLon, hovSelOg.maxLat, worldGrid, t);
              const [hbx1, hby1] = lonLatToCanvas(hovSelOg.maxLon, hovSelOg.minLat, worldGrid, t);
              const htcx = (hbx0 + hbx1) / 2;
              const htcy = (hby0 + hby1) / 2;
              const hpxform = puzzleTransformsRef.current.get(hovSelId);
              const hptx = hpxform?.tx ?? 0;
              const hpty = hpxform?.ty ?? 0;
              const hpAngleRad = ((hpxform?.angleDeg ?? 0) * Math.PI) / 180;
              const hovHandles = [
                { ldx: (hbx0 - HOVER_CORNER_HANDLE_OFFSET) - htcx, ldy: (hby0 - HOVER_CORNER_HANDLE_OFFSET) - htcy },
                { ldx: (hbx1 + HOVER_CORNER_HANDLE_OFFSET) - htcx, ldy: (hby0 - HOVER_CORNER_HANDLE_OFFSET) - htcy },
                { ldx: (hbx1 + HOVER_CORNER_HANDLE_OFFSET) - htcx, ldy: (hby1 + HOVER_CORNER_HANDLE_OFFSET) - htcy },
                { ldx: (hbx0 - HOVER_CORNER_HANDLE_OFFSET) - htcx, ldy: (hby1 + HOVER_CORNER_HANDLE_OFFSET) - htcy },
              ];
              for (const { ldx, ldy } of hovHandles) {
                const hsx = htcx + hptx + ldx * Math.cos(hpAngleRad) - ldy * Math.sin(hpAngleRad);
                const hsy = htcy + hpty + ldx * Math.sin(hpAngleRad) + ldy * Math.cos(hpAngleRad);
                if (Math.sqrt((mx - hsx) ** 2 + (my - hsy) ** 2) <= HOVER_HANDLE_RADIUS) {
                  overHandle = true;
                  break;
                }
              }
            }
          }

          if (!overHandle) {
            for (const v of visibleNow) {
              const og =
                v.datasetId === primaryDatasetIdRef.current
                  ? overviewGrid
                  : v.overviewGrid;
              if (!og) continue;
              const [bx0, by0] = lonLatToCanvas(og.minLon, og.maxLat, worldGrid, t);
              const [bx1, by1] = lonLatToCanvas(og.maxLon, og.minLat, worldGrid, t);
              const tcx = (bx0 + bx1) / 2;
              const tcy = (by0 + by1) / 2;
              const pxform = puzzleTransformsRef.current.get(v.datasetId);
              const ptx = pxform?.tx ?? 0;
              const pty = pxform?.ty ?? 0;
              const pAngleRad = ((pxform?.angleDeg ?? 0) * Math.PI) / 180;
              const pdx = mx - (tcx + ptx);
              const pdy = my - (tcy + pty);
              const localX = tcx + pdx * Math.cos(-pAngleRad) - pdy * Math.sin(-pAngleRad);
              const localY = tcy + pdx * Math.sin(-pAngleRad) + pdy * Math.cos(-pAngleRad);
              if (localX >= bx0 && localX <= bx1 && localY >= by0 && localY <= by1) {
                overTile = true;
                break;
              }
            }
          }

          canvas.style.cursor = overHandle ? "crosshair" : overTile ? "grab" : "crosshair";
        } else {
          canvas.style.cursor = "crosshair";
        }
        return;
      }

      // Select-area / Download / Georef-pick tool: extend the drag rectangle, suppress tooltip/pan.
      if (selectModeRef.current || downloadModeRef.current || georefPickModeRef.current) {
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
      rebasePuzzleTransformsForViewChange(transformRef.current);
      dirtyRef.current = true;
    };

    const handleMouseUp = () => {
      // End any active puzzle drag.
      if (puzzleModeRef.current) {
        // Click-without-drag on a rotation handle → ±1° nudge.
        if (
          puzzleDragSubModeRef.current === "rotate" &&
          !puzzleRotateActuallyDraggedRef.current &&
          puzzleHandleEdgeRef.current !== null
        ) {
          const nudgeEdge = puzzleHandleEdgeRef.current;
          const nudgeIds = [...puzzleSelectedIdsRef.current];
          if (nudgeIds.length > 0) {
            const delta = nudgeEdge === "topRight" || nudgeEdge === "bottomLeft" ? 1 : -1;
            setPuzzleTransforms((prev) => {
              const next = new Map(prev);
              for (const nudgeId of nudgeIds) {
                const existing = prev.get(nudgeId);
                if (existing?.locked) continue; // locked tiles never rotate
                const current = existing?.angleDeg ?? 0;
                next.set(nudgeId, { ...(existing ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false }), angleDeg: current + delta });
              }
              return next;
            });
            dirtyRef.current = true;
          }
        }
        puzzleHandleEdgeRef.current = null;
        puzzleRotateActuallyDraggedRef.current = false;
        puzzleDragSubModeRef.current = null;
        isDraggingRef.current = false;
        return;
      }
      // Commit the drawn rectangle as a bbox (if it has meaningful area).
      if ((selectModeRef.current || downloadModeRef.current || georefPickModeRef.current) && dragRectRef.current) {
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
          if (georefPickModeRef.current) {
            useUiStore.getState().setGeorefPickBbox({
              minLon: west,
              minLat: south,
              maxLon: east,
              maxLat: north,
            });
            useUiStore.getState().setGeorefPickMode(false);
          } else if (downloadModeRef.current) {
            setDownloadBbox({ north, south, east, west });
          } else {
            setSelectedBbox({ north, south, east, west });
          }
        } else if (georefPickModeRef.current) {
          // Too small a drag — stay in pick mode so user can try again.
          dirtyRef.current = true;
        }
        return;
      }
      isDraggingRef.current = false;
    };

    const handleMouseLeave = () => {
      isDraggingRef.current = false;
      puzzleDragSubModeRef.current = null;
      puzzleHandleEdgeRef.current = null;
      puzzleRotateActuallyDraggedRef.current = false;
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
      rebasePuzzleTransformsForViewChange(transformRef.current);
      dirtyRef.current = true;
    };

    const handleClick = (e: MouseEvent) => {
      // Puzzle mode owns the canvas; suppress all click-through behaviors.
      if (puzzleModeRef.current) return;
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
      // Empty-state: clicking the "Find Data" link opens the panel; clicking
      // anywhere else closes the overview (same dismiss gesture as before).
      if (visibleDatasetsRef.current.length === 0) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const lr = emptyStateLinkRectRef.current;
        if (lr && mx >= lr.x && mx <= lr.x + lr.w && my >= lr.y && my <= lr.y + lr.h) {
          useUiStore.getState().setSidebarMode("explore");
          useUiStore.getState().setFindDataPanelOpen(true);
          useUiStore.getState().setOverviewOpen(false);
        } else {
          useUiStore.getState().setOverviewOpen(false);
        }
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

      // Saved drift ribbons have their own interaction model. A ribbon click
      // selects it and exposes the endpoint affordances; clicking either
      // endpoint flies to the exact persisted waypoint. This runs before
      // footprint and polygon handling, while ordinary point markers retain
      // their existing context-menu and drop-in behavior.
      if (useSettingsStore.getState().overviewShowMarkers) {
        const driftHit = hitTestSavedDrifts(
          markersRef.current.filter((marker) =>
            useSettingsStore.getState().visibleMarkerTypes.includes(marker.type)),
          mx,
          my,
          coordGrid,
          t,
        );
        if (driftHit) {
          selectedSavedDriftIdRef.current = driftHit.marker.id;
          if (driftHit.endpoint) {
            const geometry = driftHit.marker.geometry;
            const endpoint = driftHit.endpoint === "start"
              ? geometry.waypoints[0]
              : geometry.waypoints[geometry.waypoints.length - 1];
            if (endpoint) {
              const { x: worldX, z: worldZ } = lonLatToWorldXZ(endpoint.lon, endpoint.lat, overviewGrid);
              setPendingDropIn({ worldX, worldZ });
              setOverviewOpen(false);
            }
          } else {
            dirtyRef.current = true;
          }
          return;
        }
        selectedSavedDriftIdRef.current = null;
      }

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
          if (hit.properties.species && hit.properties.commonName && hit.properties.fmp &&
              hit.properties.depthRangeM && hit.properties.habitatDescription) {
            useUiStore.getState().setSelectedEfh(hit.properties as import("@workspace/api-client-react").EfhSpeciesProperties);
          }
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
            fetchedAt: substrateFetchedAt,
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

      // Puzzle mode: right-click on a tile opens a tile-specific menu
      // (add/edit/remove note, lock/unlock) instead of the standard menu.
      if (puzzleModeRef.current) {
        const ctxWorldGrid = worldGridRef.current ?? overviewGrid;
        const sortedCtx = sortByRecency(visibleDatasetsRef.current);
        let tileHitId: string | null = null;
        // Newest-first so the hit matches the tile drawn on top.
        for (let i = sortedCtx.length - 1; i >= 0; i--) {
          const v = sortedCtx[i];
          if (!v) continue;
          const og = v.datasetId === primaryDatasetIdRef.current ? overviewGrid : v.overviewGrid;
          if (!og) continue;
          const [tbx0, tby0] = lonLatToCanvas(og.minLon, og.maxLat, ctxWorldGrid, t);
          const [tbx1, tby1] = lonLatToCanvas(og.maxLon, og.minLat, ctxWorldGrid, t);
          const tcxc = (tbx0 + tbx1) / 2;
          const tcyc = (tby0 + tby1) / 2;
          const pxf = puzzleTransformsRef.current.get(v.datasetId);
          const aRad = ((pxf?.angleDeg ?? 0) * Math.PI) / 180;
          const pdx = mx - (tcxc + (pxf?.tx ?? 0));
          const pdy = my - (tcyc + (pxf?.ty ?? 0));
          // Inverse-rotate the pointer into the tile's local frame.
          const lx = tcxc + pdx * Math.cos(-aRad) - pdy * Math.sin(-aRad);
          const ly = tcyc + pdx * Math.sin(-aRad) + pdy * Math.cos(-aRad);
          if (lx >= tbx0 && lx <= tbx1 && ly >= tby0 && ly <= tby1) {
            tileHitId = v.datasetId;
            break;
          }
        }
        if (tileHitId !== null) {
          const tileId = tileHitId;
          const xfNow = puzzleTransformsRef.current.get(tileId);
          // Context actions apply to the hit tile plus any group co-members,
          // matching multi-move semantics.
          const tileActionIds = new Set<string>([tileId]);
          for (const members of puzzleGroupsRef.current.values()) {
            if (members.has(tileId)) {
              for (const m of members) tileActionIds.add(m);
              break;
            }
          }
          const applyTileFlip = (axis: "flipH" | "flipV") => {
            setPuzzleTransforms((prev) => {
              const next = new Map(prev);
              for (const id of tileActionIds) {
                const existing = prev.get(id);
                const base = existing ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false };
                next.set(id, { ...base, [axis]: !base[axis] });
              }
              return next;
            });
            dirtyRef.current = true;
          };
          const applyTileRotation = (delta: number | null) => {
            setPuzzleTransforms((prev) => {
              const next = new Map(prev);
              for (const id of tileActionIds) {
                const existing = prev.get(id);
                if (existing?.locked) continue;
                const base = existing ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false };
                next.set(id, {
                  ...base,
                  angleDeg: delta === null ? 0 : base.angleDeg + delta,
                });
              }
              return next;
            });
            dirtyRef.current = true;
          };
          const rotationSteps = [90, 45, 5, 1] as const;
          const tileItems: ContextMenuItem[] = [
            ...rotationSteps.map((degrees) => ({
              label: `Rotate ${degrees}° counter-clockwise`,
              icon: "↶",
              onClick: () => applyTileRotation(-degrees),
            })),
            { label: "", onClick: () => {}, separator: true },
            ...[...rotationSteps].reverse().map((degrees) => ({
              label: `Rotate ${degrees}° clockwise`,
              icon: "↷",
              onClick: () => applyTileRotation(degrees),
            })),
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Reset rotation",
              icon: "↺",
              onClick: () => applyTileRotation(null),
            },
            { label: "", onClick: () => {}, separator: true },
            {
              label: "Flip H",
              icon: "⇔",
              onClick: () => applyTileFlip("flipH"),
            },
            {
              label: "Flip V",
              icon: "⇕",
              onClick: () => applyTileFlip("flipV"),
            },
            { label: "", onClick: () => {}, separator: true },
            {
              label: xfNow?.annotation ? "Edit note" : "Add note",
              icon: "📝",
              onClick: () => setAnnotationEditor({ datasetId: tileId, value: xfNow?.annotation ?? "" }),
            },
            ...(xfNow?.annotation
              ? [{
                  label: "Remove note",
                  icon: "✕",
                  onClick: () => {
                    setPuzzleTransforms((prev) => {
                      const next = new Map(prev);
                      const existing = prev.get(tileId);
                      if (existing) {
                        const copy: PuzzleTransform = { ...existing };
                        delete copy.annotation;
                        next.set(tileId, copy);
                      }
                      return next;
                    });
                    dirtyRef.current = true;
                  },
                }]
              : []),
            {
              label: xfNow?.locked ? "Unlock tile" : "Lock tile",
              icon: xfNow?.locked ? "🔓" : "🔒",
              onClick: () => {
                setPuzzleTransforms((prev) => {
                  const next = new Map(prev);
                  const existing = prev.get(tileId) ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false };
                  next.set(tileId, { ...existing, locked: !existing.locked });
                  return next;
                });
                dirtyRef.current = true;
              },
            },
          ];
          useContextMenuStore.getState().show(e.clientX, e.clientY, tileItems);
          return;
        }
        // No tile hit — fall through to the standard context menu.
      }

      // Hit-test markers so we can close the context menu if the marker is
      // filtered away while the menu is open (overviewShowMarkers toggle or
      // visibleMarkerTypes change).
      if (useSettingsStore.getState().overviewShowMarkers && markersRef.current.length > 0) {
        const coordGridHit = worldGridRef.current ?? overviewGrid;
        let hitType: string | null = null;
        for (const m of markersRef.current) {
          const [mcx, mcy] = lonLatToCanvas(m.lon, m.lat, coordGridHit, t);
          const hitR = Math.max(3.5, Math.min(9, t.scale * 1.8)) + 6;
          if ((mx - mcx) ** 2 + (my - mcy) ** 2 <= hitR * hitR) {
            hitType = m.type;
            break;
          }
        }
        rightClickedMarkerTypeRef.current = hitType;
      } else {
        rightClickedMarkerTypeRef.current = null;
      }

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

      // --- Puzzle tile hit-test for flip context menu items ---
      let puzzleHitId: string | null = null;
      if (puzzleModeRef.current) {
        const worldGrid = worldGridRef.current ?? overviewGrid;
        const visibleNow = visibleDatasetsRef.current;
        const sorted = sortByRecency(visibleNow);
        for (let i = sorted.length - 1; i >= 0; i--) {
          const v = sorted[i];
          if (!v) continue;
          const og =
            v.datasetId === primaryDatasetIdRef.current
              ? overviewGrid
              : v.overviewGrid;
          if (!og) continue;
          const [bx0, by0] = lonLatToCanvas(og.minLon, og.maxLat, worldGrid, t);
          const [bx1, by1] = lonLatToCanvas(og.maxLon, og.minLat, worldGrid, t);
          const tcx = (bx0 + bx1) / 2;
          const tcy = (by0 + by1) / 2;
          const pxform = puzzleTransformsRef.current.get(v.datasetId);
          const ptx = pxform?.tx ?? 0;
          const pty = pxform?.ty ?? 0;
          const pAngleRad = ((pxform?.angleDeg ?? 0) * Math.PI) / 180;
          const pdx = mx - (tcx + ptx);
          const pdy = my - (tcy + pty);
          const localX = tcx + pdx * Math.cos(-pAngleRad) - pdy * Math.sin(-pAngleRad);
          const localY = tcy + pdx * Math.sin(-pAngleRad) + pdy * Math.cos(-pAngleRad);
          if (localX >= bx0 && localX <= bx1 && localY >= by0 && localY <= by1) {
            puzzleHitId = v.datasetId;
            break;
          }
        }
      }

      const items: ContextMenuItem[] = [];

      // Flip items appear at the top when a puzzle tile was right-clicked.
      if (puzzleHitId !== null) {
        // Collect all tiles to flip: the hit tile plus any group co-members.
        const flipIds = new Set<string>([puzzleHitId]);
        for (const members of puzzleGroupsRef.current.values()) {
          if (members.has(puzzleHitId)) {
            for (const m of members) flipIds.add(m);
            break;
          }
        }

        const applyContextFlip = (axis: "flipH" | "flipV") => {
          setPuzzleTransforms((prev) => {
            const next = new Map(prev);
            for (const id of flipIds) {
              const existing = prev.get(id);
              const base = existing ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false };
              next.set(id, { ...base, [axis]: !base[axis] });
            }
            return next;
          });
          dirtyRef.current = true;
        };

        items.push(
          {
            label: "Flip H",
            icon: "⇔",
            onClick: () => applyContextFlip("flipH"),
          },
          {
            label: "Flip V",
            icon: "⇕",
            onClick: () => applyContextFlip("flipV"),
          },
          { label: "", onClick: () => {}, separator: true },
        );
      }

      items.push(
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
              navigator.clipboard.writeText(text).catch(() => {
                toast({
                  title: "Copy failed",
                  description: "Clipboard permission denied. Try copying manually.",
                  variant: "destructive",
                  duration: 4000,
                });
              });
            }
          },
        },
      );

      useContextMenuStore.getState().show(e.clientX, e.clientY, items);
    };

    // Clears any in-progress drag state when the pointer stream is cancelled by
    // a system gesture (two-finger pinch, OS-level dialog, stylus palm-rejection,
    // etc.) without firing a mouseup. Without this handler, dragRectRef stays
    // populated and the selection overlay remains visible indefinitely.
    const handlePointerCancel = () => {
      dragRectRef.current = null;
      isDraggingRef.current = false;
      activePointersRef.current.clear();
      pinchRef.current = null;
      puzzleDragSubModeRef.current = null;
      puzzleHandleEdgeRef.current = null;
      puzzleRotateActuallyDraggedRef.current = false;
      hasDraggedRef.current = false;
      canvas.style.cursor = "crosshair";
      dirtyRef.current = true;
    };

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault();
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture?.(e.pointerId);
      if (activePointersRef.current.size === 2) {
        const points = [...activePointersRef.current.values()];
        const first = points[0]!;
        const second = points[1]!;
        const centerX = (first.x + second.x) / 2 - canvas.getBoundingClientRect().left;
        const centerY = (first.y + second.y) / 2 - canvas.getBoundingClientRect().top;
        pinchRef.current = {
          distance: Math.hypot(second.x - first.x, second.y - first.y),
          scale: transformRef.current?.scale ?? 1,
          centerX,
          centerY,
        };
        dragRectRef.current = null;
        isDraggingRef.current = false;
        puzzleDragSubModeRef.current = null;
        dirtyRef.current = true;
        return;
      }
      handleMouseDown(e as unknown as MouseEvent);
      // Browsers may synthesize a mousedown after pointerdown.  Ignore only
      // that compatibility event; pointer-driven input above must still enter
      // the normal puzzle/select/pan setup path.
      suppressMouseUntilRef.current = performance.now() + 500;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const tracked = activePointersRef.current.get(e.pointerId);
      if (!tracked) return;
      tracked.x = e.clientX;
      tracked.y = e.clientY;
      const points = [...activePointersRef.current.values()];
      if (points.length >= 2 && pinchRef.current && transformRef.current && overviewGrid) {
        e.preventDefault();
        const first = points[0]!;
        const second = points[1]!;
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        const ratio = distance / Math.max(1, pinchRef.current.distance);
        const nextScale = Math.max(0.5, Math.min(20, pinchRef.current.scale * ratio));
        const actualRatio = nextScale / transformRef.current.scale;
        const { centerX, centerY } = pinchRef.current;
        fitAnimRef.current = null;
        transformRef.current = clampTransform(
          {
            ...transformRef.current,
            scale: nextScale,
            offsetX: centerX + (transformRef.current.offsetX - centerX) * actualRatio,
            offsetY: centerY + (transformRef.current.offsetY - centerY) * actualRatio,
          },
          worldGridRef.current ?? overviewGrid,
          canvas.width,
          canvas.height,
        );
        rebasePuzzleTransformsForViewChange(transformRef.current);
        dirtyRef.current = true;
        return;
      }
      handleMouseMove(e as unknown as MouseEvent);
    };

    const handlePointerUp = (e: PointerEvent) => {
      activePointersRef.current.delete(e.pointerId);
      canvas.releasePointerCapture?.(e.pointerId);
      if (pinchRef.current) {
        if (activePointersRef.current.size < 2) pinchRef.current = null;
        if (activePointersRef.current.size === 0) {
          handleMouseUp();
          hasDraggedRef.current = false;
        }
        return;
      }
      handleMouseUp();
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("pointerdown", handlePointerDown, { passive: false });
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("contextmenu", handleContextMenu);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [
    overviewGrid,
    substrateCreditUrl,
    substrateSourceName,
    substrateFetchedAt,
    setDatasetId,
    setTerrain,
    setPuzzleSelectedIds,
    setOverviewOpen,
    setPendingDropIn,
    rebasePuzzleTransformsForViewChange,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      ref={overviewRootRef}
      role="dialog"
      aria-label="Overview map"
      aria-modal="true"
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
        style={{ width: "100%", height: "100%", cursor: "crosshair", display: "block", touchAction: "none" }}
      />

      {referenceImageCannotBePlaced && (
        <div
          data-testid="overview-reference-image-placement-hint"
          role="status"
          style={{
            position: "absolute",
            left: "50%",
            bottom: 18,
            transform: "translateX(-50%)",
            zIndex: 42,
            maxWidth: "min(560px, calc(100% - 32px))",
            padding: "8px 12px",
            border: "1px solid rgba(251,191,36,0.5)",
            borderRadius: 4,
            background: "rgba(69, 26, 3, 0.92)",
            color: "#fde68a",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(11px * var(--bs-font-scale, 1))",
            lineHeight: 1.45,
            textAlign: "center",
          }}
        >
          Reference image can’t be placed. Load a dataset or save two valid GPS anchors.
        </div>
      )}

      {/* Canvas text cannot be reached by a screen reader. Keep the painted
          affordance for mouse users and provide its real keyboard equivalent. */}
      {visibleDatasets.length === 0 && (
        <button
          type="button"
          data-testid="overview-find-data"
          aria-label="Find data to add to the overview map"
          onClick={openFindData}
          style={{
            position: "absolute",
            left: "50%",
            top: "calc(50% + 8px)",
            transform: "translate(-50%, -50%)",
            zIndex: 42,
            background: "transparent",
            border: "0",
            color: "rgba(0,229,255,0.85)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(11px * var(--bs-font-scale, 1))",
            letterSpacing: "0.02em",
            padding: "8px",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Choose a dataset from Find Data
        </button>
      )}

      {/* Retry button — appears after the 15 s load-failure timeout so the
          user can re-trigger the fetch without closing and reopening the map. */}
      {overviewLoadFailed && (
        <div
          data-testid="overview-load-retry"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, calc(-50% + 20px))",
            zIndex: 42,
          }}
        >
          <button
            type="button"
            onClick={handleOverviewRetry}
            aria-label="Retry loading overview map data"
            style={{
              background: "rgba(2,8,24,0.85)",
              border: "1px solid rgba(0,229,255,0.4)",
              borderRadius: 3,
              color: "rgba(0,229,255,0.75)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(11px * var(--bs-font-scale, 1))",
              letterSpacing: "0.15em",
              padding: "4px 16px",
              cursor: "pointer",
            }}
          >
            ↻ RETRY
          </button>
        </div>
      )}

      {/* Error-state hint link — visible alongside the Retry button so users
          can switch to a working dataset without reloading the page.
          Mirrors the "Choose a dataset from Find Data" canvas link shown in
          the empty-state (no datasets selected) case. */}
      {overviewLoadFailed && (
        <div
          data-testid="overview-error-hint"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, calc(-50% + 52px))",
            zIndex: 42,
            textAlign: "center",
          }}
        >
          <button
            type="button"
            onClick={handleErrorHintClick}
            aria-label="Find data to replace the map dataset"
            style={{
              background: "none",
              border: "none",
              color: "rgba(0,229,255,0.85)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(11px * var(--bs-font-scale, 1))",
              letterSpacing: "0.05em",
              padding: "4px 8px",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Choose a dataset from Find Data
          </button>
        </div>
      )}

      {/* Zoom button strip — right edge, below compass, above legends */}
      <div
        style={{
          position: "absolute",
          right: 16,
          top: 56 + OVERVIEW_CONTROLS_TOP_OFFSET,
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          pointerEvents: "auto",
        }}
      >
        <ViewscreenTooltip label="Zoom in" side="left">
          <button
            data-testid="overview-zoom-in"
            onClick={() => handleZoomStep(1.35)}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(2,8,24,0.75)",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 3,
              color: "#94a3b8",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(18px * var(--bs-font-scale, 1))",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            +
          </button>
        </ViewscreenTooltip>
        <ViewscreenTooltip label="Zoom out" side="left">
          <button
            data-testid="overview-zoom-out"
            onClick={() => handleZoomStep(1 / 1.35)}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(2,8,24,0.75)",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 3,
              color: "#94a3b8",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(18px * var(--bs-font-scale, 1))",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            −
          </button>
        </ViewscreenTooltip>
        <ViewscreenTooltip label="Fit all datasets in view" side="left">
          <button
            data-testid="overview-zoom-fit"
            onClick={handleFitToData}
            disabled={datasetsWithGrid.length === 0}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(2,8,24,0.75)",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 3,
              color: datasetsWithGrid.length === 0 ? "#475569" : "#94a3b8",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(15px * var(--bs-font-scale, 1))",
              cursor: datasetsWithGrid.length === 0 ? "not-allowed" : "pointer",
              lineHeight: 1,
              opacity: datasetsWithGrid.length === 0 ? 0.45 : 1,
            }}
          >
            ⊡
          </button>
        </ViewscreenTooltip>
      </div>

      {/* Fixed compass rose — always North-up; pinned to top-right corner so it
          is visible on top of all overlays and clearly communicates orientation. */}
      <div
        data-testid="overview-compass"
        style={{
          position: "absolute",
          top: 14 + OVERVIEW_CONTROLS_TOP_OFFSET,
          right: 14,
          width: 36,
          height: 36,
          pointerEvents: "none",
          zIndex: 42,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(2,8,24,0.72)",
          border: "1px solid rgba(0,229,255,0.2)",
          borderRadius: "50%",
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(9px * var(--bs-font-scale, 1))",
            fontWeight: 700,
            color: "rgba(0,229,255,0.85)",
            lineHeight: 1,
            marginBottom: 1,
          }}
        >
          N
        </span>
        <span style={{ fontSize: "calc(9px * var(--bs-font-scale, 1))", color: "rgba(0,229,255,0.85)", lineHeight: 1 }}>↑</span>
      </div>

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
            {overviewShowMarkers && (markerData ?? []).map((m) => {
              if (m.type !== "depth_pole") return null;
              if (m.depth === undefined || m.depth === null) return null;
              const [cx, cy] = lonLatToCanvas(m.lon, m.lat, wg, svgTransform);
              if (!inCanvas(cx, cy, 30)) return null;
              const colour = poleColourByMarker.get(m.id) ?? "#00ffee";
              const depthText = unitsForUi === "imperial"
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
            {overviewShowMarkers && (markerData ?? []).map((m) => {
              const [cx, cy] = lonLatToCanvas(m.lon, m.lat, wg, svgTransform);
              if (!inCanvas(cx, cy)) return null;
              const colour = (MARKER_COLOR as Record<string, string>)[m.type] ?? "#e2e8f0";
              const r = Math.max(3.5, Math.min(9, svgTransform.scale * 1.8));
              return (
                <g key={`mk-${m.id}`} pointerEvents="none" filter="url(#ov-marker-glow)">
                  {m.geometry?.kind === "area" && (
                    <circle cx={cx} cy={cy} r={r + (m.geometry.shape === "circle" ? Math.max(7, Math.min(24, m.geometry.radiusM / 8)) : 10)} fill={`${colour}12`} stroke={colour} strokeWidth={1.2} strokeDasharray="3 2" opacity={0.7} />
                  )}
                  <circle cx={cx} cy={cy} r={r + 2.5} fill="#020818" stroke={colour} strokeWidth={1} opacity={0.85} />
                  {/* Custom SVG symbol, scaled from its 24x24 viewBox to fit the disc */}
                  <g
                    color={colour}
                    opacity={0.95}
                    transform={`translate(${cx - r}, ${cy - r}) scale(${(r * 2) / 24})`}
                  >
                    <MarkerIconPaths type={m.type} />
                  </g>
                  {svgTransform.scale >= 3 && (
                    <text
                      x={cx + r + 4} y={cy}
                      fill={colour} fontSize={11} dominantBaseline="middle"
                      fontFamily="'JetBrains Mono', monospace" opacity={0.9}
                    >{m.label}</text>
                  )}
                  {(() => {
                    const symbols = catchSymbolsByMarker.get(m.id);
                    if (!symbols || symbols.length === 0) return null;
                    // Spaced row of catch symbols above the marker dot.
                    const shown = symbols.slice(0, 5);
                    const spacing = 12;
                    const startX = cx - ((shown.length - 1) * spacing) / 2;
                    return shown.map((s, i) => (
                      <text
                        key={`cs-${m.id}-${i}`}
                        x={startX + i * spacing}
                        y={cy - r - 6}
                        fontSize={11}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >{s}</text>
                    ));
                  })()}
                </g>
              );
            })}

            {/* ── Camera arrow ──────────────────────────────────────────────── */}
            {cameraPosition.known && (() => {
              const [cx, cy] = lonLatToCanvas(cameraPosition.lon, cameraPosition.lat, wg, svgTransform);
              if (!inCanvas(cx, cy, 20)) return null;
              const size = 11;
              // Heading 0° = North = rotate(0) in SVG (arrow defined pointing up).
              const rot = cameraHeading;
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
                  role="button"
                  tabIndex={0}
                  aria-label={`Weather station ${weatherStationDataRef.current.get(pin.id)?.name ?? pin.id}`}
                  aria-selected={isSelected}
                  style={{ cursor: "pointer", pointerEvents: "all" }}
                  onFocus={(e) => { weatherOpenerRef.current = e.currentTarget; }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                    }
                  }}
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
                  data-testid={`raws-pin-${pin.datasetId}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`RAWS station ${rawsDataRef.current.get(pin.datasetId)?.name ?? pin.datasetId}`}
                  aria-selected={isSelected}
                  style={{ cursor: "pointer", pointerEvents: "all" }}
                  onFocus={(e) => { rawsOpenerRef.current = e.currentTarget; }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                    }
                  }}
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
                  role="button"
                  tabIndex={0}
                  aria-label={`Intertidal ${intertidalScoreModeRef.current === "tidepool" ? "tidepool" : "beachcombing"} hotspot ${pin.unitId}, score ${pin.score}`}
                  aria-selected={isSelected}
                  style={{ cursor: "pointer", pointerEvents: "all" }}
                  onFocus={(e) => { intertidalOpenerRef.current = e.currentTarget; }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                    }
                  }}
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

      {/* DOM equivalent of actionable map pins for keyboard and assistive
          technology users. Kept off-canvas rather than hidden from the tree. */}
      <div
        key={overlayVersion}
        aria-label="Map overlays"
        style={{ position: "absolute", left: -10000, top: 0, width: 1, height: 1, overflow: "hidden" }}
      >
        {weatherStationActiveRef.current && weatherStations.map((station) => {
          const selected = weatherStationSelectedIdRef.current === station.id;
          return (
            <button
              key={`a11y-wx-${station.id}`}
              type="button"
              aria-label={`Weather station ${station.name ?? station.id}`}
              aria-selected={selected}
              onClick={() => {
                weatherStationSelectedIdRef.current = selected ? null : station.id;
                setSelectedWeatherStation(selected ? null : station);
              }}
            >
              {station.name ?? station.id}
            </button>
          );
        })}
        {rawsOverlayActive && rawsStations.map((station) => {
          const selected = rawsSelectedIdRef.current === station.datasetId;
          return (
            <button
              key={`a11y-raws-${station.datasetId}`}
              type="button"
              aria-label={`RAWS station ${station.name ?? station.datasetId}`}
              aria-selected={selected}
              onClick={() => {
                rawsSelectedIdRef.current = selected ? null : station.datasetId;
                setSelectedRawsDatasetId(selected ? null : station.datasetId);
              }}
            >
              {station.name ?? station.datasetId}
            </button>
          );
        })}
        {intertidalHotspotsEnabledRef.current && intertidalPinsRef.current.map((pin) => {
          const selected = intertidalSelectedUnitIdRef.current === pin.unitId;
          return (
            <button
              key={`a11y-it-${pin.unitId}`}
              type="button"
              aria-label={`Intertidal hotspot ${pin.unitId}, score ${pin.score}`}
              aria-selected={selected}
              onClick={() => {
                const hotspot = intertidalHotspotDataRef.current.get(pin.unitId);
                if (!hotspot) return;
                intertidalSelectedUnitIdRef.current = selected ? null : pin.unitId;
                useUiStore.getState().setSelectedHotspot(selected ? null : hotspot);
              }}
            >
              {pin.unitId}
            </button>
          );
        })}
      </div>

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
            fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
          justifyContent: "flex-start",
          gap: 16,
          padding: "0 2in 0 12px",
          boxSizing: "border-box",
          overflowX: "auto",
          overflowY: "hidden",
          background: "rgba(2,8,24,0.75)",
          backdropFilter: "blur(6px)",
          borderBottom: "1px solid rgba(0,229,255,0.1)",
          zIndex: 41,
          pointerEvents: "auto",
        }}
        data-testid="overview-map-header-scroll"
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(13px * var(--bs-font-scale, 1))",
            letterSpacing: "0.25em",
            color: "#00e5ff",
            textShadow: "0 0 8px rgba(0,229,255,0.45)",
            flexShrink: 0,
          }}
        >
          ▼ OVERVIEW MAP
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(11px * var(--bs-font-scale, 1))",
            letterSpacing: "0.1em",
            color: "#475569",
            flexShrink: 0,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          SCROLL TO ZOOM · DRAG TO PAN · CLICK TO DROP IN
        </span>

        {/* GPS controls */}
        <div
          className="overview-map-header-controls"
          data-testid="overview-map-header-controls"
          role="toolbar"
          aria-label="Overview map controls"
          style={{ display: "flex", flexShrink: 0, gap: 6, alignItems: "center", minWidth: "max-content" }}
        >
          {gpsError && (
            <span style={{ color: "#ef4444", fontSize: "calc(12px * var(--bs-font-scale, 1))", fontFamily: "'JetBrains Mono', monospace", maxWidth: 180 }}>
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
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "18px",
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
              aria-label="Fit all loaded datasets in view"
              onClick={handleFitToData}
              disabled={datasetsWithGrid.length === 0}
              style={{
                background: "rgba(0,10,20,0.75)",
                border: "1px solid rgba(0,229,255,0.2)",
                borderRadius: 3,
                color: datasetsWithGrid.length === 0 ? "#475569" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
                padding: "2px 8px",
                cursor: datasetsWithGrid.length === 0 ? "not-allowed" : "pointer",
                letterSpacing: "0.1em",
                lineHeight: "18px",
                whiteSpace: "nowrap",
                opacity: datasetsWithGrid.length === 0 ? 0.45 : 1,
              }}
            >
              ⊡ FIT
            </button>
          </ViewscreenTooltip>

          <ViewscreenTooltip label={showPuzzleTitles ? "Hide puzzle tile titles" : "Show puzzle tile titles"} side="bottom">
            <button
              data-testid="overview-puzzle-titles-toggle"
              aria-label={showPuzzleTitles ? "Hide puzzle tile titles" : "Show puzzle tile titles"}
              aria-pressed={showPuzzleTitles}
              onClick={() => {
                setShowPuzzleTitles((visible) => {
                  const next = !visible;
                  showPuzzleTitlesRef.current = next;
                  dirtyRef.current = true;
                  return next;
                });
              }}
              style={{
                background: showPuzzleTitles ? "rgba(14,165,233,0.14)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${showPuzzleTitles ? "rgba(56,189,248,0.6)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: showPuzzleTitles ? "#7dd3fc" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
                padding: "2px 7px",
                cursor: "pointer",
                lineHeight: "18px",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {showPuzzleTitles ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
              TITLES
            </button>
          </ViewscreenTooltip>

          {/* Puzzle mode — drag and rotate individual dataset tiles */}
          <ViewscreenTooltip label="Puzzle mode: drag and rotate dataset tiles to align surveys" side="bottom">
            <button
              data-testid="overview-puzzle-toggle"
              aria-label="Toggle puzzle mode"
              aria-pressed={puzzleMode}
              onClick={() => {
                const next = !puzzleMode;
                setPuzzleMode(next);
                // Deactivate other exclusive modes.
                if (next) {
                  setSelectMode(false);
                  setDownloadMode(false);
                  setWaypointMode(false);
                  dragRectRef.current = null;
                }
                dirtyRef.current = true;
              }}
              style={{
                background: puzzleMode ? "rgba(168,85,247,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${puzzleMode ? "rgba(168,85,247,0.65)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: puzzleMode ? "#c084fc" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
                padding: "2px 8px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                lineHeight: "18px",
                whiteSpace: "nowrap",
              }}
            >
              ⧉ PUZZLE
            </button>
          </ViewscreenTooltip>

          {/* Active special collection badge */}
          {puzzleMode && spcActive && (
            <span
              data-testid="overview-special-collection-badge"
              title={`Special collection "${spcActive.name}" is active`}
              style={{
                color: "#fbbf24",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "calc(11px * var(--bs-font-scale, 1))",
                letterSpacing: "0.05em",
                lineHeight: "18px",
                padding: "2px 4px",
                whiteSpace: "nowrap",
                maxWidth: 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              ✷ {spcActive.name}
            </span>
          )}

          {/* Apply saved layout to the 3D scene — special collections with a
              saved (non-identity) active revision only. */}
          {puzzleMode && spcActive && spcRevisionHasNonIdentityTile && (
            <ViewscreenTooltip label="Load each dataset's 3D terrain at its puzzle-adjusted geographic position" side="bottom">
              <button
                data-testid="overview-puzzle-apply-3d"
                aria-label="Apply puzzle layout to 3D scene"
                onClick={() => setApplyTo3DConfirmOpen(true)}
                style={{
                  background: "rgba(45,212,191,0.12)",
                  border: "1px solid rgba(45,212,191,0.5)",
                  borderRadius: 3,
                  color: "#2dd4bf",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "18px",
                  whiteSpace: "nowrap",
                }}
              >
                ⬡ APPLY TO 3D
              </button>
            </ViewscreenTooltip>
          )}

          {/* Snap-to-neighbor toggle — visible in puzzle mode */}
          {puzzleMode && (
            <ViewscreenTooltip label="Snap tiles flush when dragged within 12 px of a neighbor's edge" side="bottom">
              <button
                data-testid="overview-puzzle-snap-toggle"
                aria-label="Toggle snap to neighboring tile edges"
                aria-pressed={snapEnabled}
                onClick={() => setSnapEnabled((v) => !v)}
                style={{
                  background: snapEnabled ? "rgba(34,197,94,0.15)" : "rgba(0,10,20,0.75)",
                  border: `1px solid ${snapEnabled ? "rgba(34,197,94,0.6)" : "rgba(0,229,255,0.2)"}`,
                  borderRadius: 3,
                  color: snapEnabled ? "#4ade80" : "#94a3b8",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "18px",
                  whiteSpace: "nowrap",
                }}
              >
                ⌗ SNAP
              </button>
            </ViewscreenTooltip>
          )}

          {/* Gap/overlap indicator toggle — visible in puzzle mode */}
          {puzzleMode && (
            <ViewscreenTooltip label="Highlight uncovered gaps (red) and overlapping tiles (orange)" side="bottom">
              <button
                data-testid="overview-puzzle-gap-toggle"
                aria-label="Toggle gap and overlap highlights"
                aria-pressed={showGapOverlay}
                onClick={() => setShowGapOverlay((v) => !v)}
                style={{
                  background: showGapOverlay ? "rgba(251,146,60,0.15)" : "rgba(0,10,20,0.75)",
                  border: `1px solid ${showGapOverlay ? "rgba(251,146,60,0.6)" : "rgba(0,229,255,0.2)"}`,
                  borderRadius: 3,
                  color: showGapOverlay ? "#fb923c" : "#94a3b8",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "18px",
                  whiteSpace: "nowrap",
                }}
              >
                ▦ GAPS
              </button>
            </ViewscreenTooltip>
          )}

          {/* Reset button — visible when any tile has been moved or rotated */}
          {hasPuzzleTransforms && (
            <ViewscreenTooltip label="Snap all tiles back to their original positions" side="bottom">
              <button
                data-testid="overview-puzzle-reset"
                aria-label="Reset puzzle tile positions"
                onClick={() => {
                  setPuzzleTransforms(new Map());
                  setPuzzleSelectedIds(new Set(), null);
                  setPuzzleGroups(new Map());
                  puzzleGroupCounterRef.current = 0;
                   try { sessionStorage.removeItem("bathyscan:puzzleTransforms"); } catch { /* unavailable */ }
                   try { sessionStorage.removeItem("bathyscan:puzzleGroups"); } catch { /* unavailable */ }
                   try { localStorage.removeItem("bathyscan:puzzleTransforms"); } catch { /* unavailable */ }
                   try { localStorage.removeItem("bathyscan:puzzleGroups"); } catch { /* unavailable */ }
                  dirtyRef.current = true;
                }}
                style={{
                  background: "rgba(239,68,68,0.12)",
                  border: "1px solid rgba(239,68,68,0.45)",
                  borderRadius: 3,
                  color: "#f87171",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "18px",
                  whiteSpace: "nowrap",
                }}
              >
                ↺ RESET
              </button>
            </ViewscreenTooltip>
          )}

          {/* Save to Session button — visible when any tile has been moved or rotated */}
          {hasPuzzleTransforms && (
            <ViewscreenTooltip label="Save tile positions to session storage (survives navigation)" side="bottom">
              <button
                data-testid="overview-puzzle-save"
                aria-label="Save puzzle tile positions to this session"
                onClick={() => {
                   let saved = false;
                   try {
                    sessionStorage.setItem(
                      "bathyscan:puzzleTransforms",
                      JSON.stringify([...puzzleTransforms.entries()]),
                    );
                     saved = true;
                  } catch {
                     // Storage can be disabled or reject writes (quota/private
                     // browsing). Do not show success when that happens.
                  }
                    setPuzzleSaveStatus(saved ? "saved" : "failed");
                    if (!saved) {
                      toast({
                        title: "Session save unavailable",
                        description: "Your layout is still visible, but browser storage rejected the save. Keep this tab open or try again after enabling site storage.",
                        variant: "destructive",
                        duration: 6000,
                      });
                    }
                    setTimeout(() => setPuzzleSaveStatus("idle"), saved ? 3000 : 6000);
                }}
                style={{
                  background: puzzleSaved ? "rgba(34,197,94,0.22)" : "rgba(20,184,166,0.12)",
                  border: puzzleSaved ? "1px solid rgba(34,197,94,0.80)" : "1px solid rgba(20,184,166,0.50)",
                  borderRadius: 3,
                  color: puzzleSaved ? "#86efac" : "#2dd4bf",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "18px",
                  whiteSpace: "nowrap",
                  transition: "background 0.15s, border-color 0.15s, color 0.15s",
                }}
              >
                {puzzleSaved ? "✓ SAVED" : puzzleSaveStatus === "failed" ? "⚠ SAVE FAILED" : "✦ SAVE"}
              </button>
            </ViewscreenTooltip>
          )}

          {/* Save named layout preset — visible when puzzle has any transforms
              (or always in puzzle mode when a special collection is active,
              so an initial arrangement can be saved as revision #1). */}
          {(hasPuzzleTransforms || (puzzleMode && spcActive != null)) && (
            <ViewscreenTooltip label="Pin this arrangement as a named layout preset (synced to your account)" side="bottom">
              <button
                data-testid="overview-puzzle-save-layout"
                aria-label="Save current puzzle arrangement as a named layout"
                onClick={() => {
                  setPuzzleLayoutFormOpen((v) => !v);
                  setLayoutsDropdownOpen(false);
                }}
                style={{
                  background: puzzleLayoutFormOpen ? "rgba(168,85,247,0.18)" : "rgba(99,102,241,0.12)",
                  border: `1px solid ${puzzleLayoutFormOpen ? "rgba(168,85,247,0.65)" : "rgba(99,102,241,0.5)"}`,
                  borderRadius: 3,
                  color: puzzleLayoutFormOpen ? "#c084fc" : "#a5b4fc",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "18px",
                  whiteSpace: "nowrap",
                }}
              >
                📌 SAVE LAYOUT
              </button>
            </ViewscreenTooltip>
          )}

          {/* Restore / delete named layout presets — visible when puzzle mode
              is on and layouts exist. With an active special collection the
              dropdown lists its server-saved revisions instead. */}
          {puzzleMode && (spcActive ? spcActive.layoutRevisions.length > 0 : puzzleLayouts.length > 0) && (
            <div ref={layoutsDropdownRef} style={{ position: "relative" }}>
              <ViewscreenTooltip label="Restore a previously saved puzzle layout" side="bottom">
                <button
                  data-testid="overview-puzzle-layouts-btn"
                  aria-label="Open saved puzzle layouts"
                  onClick={() => {
                    setLayoutsDropdownOpen((v) => !v);
                    setPuzzleLayoutFormOpen(false);
                  }}
                  style={{
                    background: layoutsDropdownOpen ? "rgba(99,102,241,0.18)" : "rgba(99,102,241,0.10)",
                    border: `1px solid ${layoutsDropdownOpen ? "rgba(99,102,241,0.65)" : "rgba(99,102,241,0.4)"}`,
                    borderRadius: 3,
                    color: "#a5b4fc",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
                    padding: "2px 8px",
                    cursor: "pointer",
                    letterSpacing: "0.1em",
                    lineHeight: "18px",
                    whiteSpace: "nowrap",
                  }}
                >
                  LAYOUTS {layoutsDropdownOpen ? "▴" : "▾"}
                </button>
              </ViewscreenTooltip>
              {layoutsDropdownOpen && (
                <div
                  data-testid="overview-puzzle-layouts-dropdown"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    right: 0,
                    background: "rgba(8,16,32,0.97)",
                    border: "1px solid rgba(99,102,241,0.45)",
                    borderRadius: 4,
                    minWidth: 200,
                    maxWidth: 320,
                    zIndex: 100,
                    boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
                    overflow: "hidden",
                  }}
                >
                  {spcActive ? [...spcActive.layoutRevisions]
                    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
                    .map((rev) => (
                      <div
                        key={rev.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 8px",
                          borderBottom: "1px solid rgba(99,102,241,0.15)",
                          background: rev.id === spcActive.activeRevisionId ? "rgba(251,191,36,0.08)" : "transparent",
                        }}
                      >
                        <button
                          data-testid={`overview-puzzle-revision-restore-${rev.id}`}
                          onClick={() => void restoreServerRevision(rev)}
                          title={`Restore revision "${rev.name}"`}
                          style={{
                            flex: 1,
                            background: "transparent",
                            border: "none",
                            color: rev.id === spcActive.activeRevisionId ? "#fbbf24" : "#e2e8f0",
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: "calc(11px * var(--bs-font-scale, 1))",
                            textAlign: "left",
                            cursor: "pointer",
                            padding: "2px 4px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          ↩ {rev.name}
                          <span style={{ color: "#64748b", fontSize: "calc(9px * var(--bs-font-scale, 1))", marginLeft: 6 }}>
                            {new Date(rev.savedAt).toLocaleDateString()}
                          </span>
                        </button>
                        <button
                          data-testid={`overview-puzzle-revision-delete-${rev.id}`}
                          aria-label={`Delete revision ${rev.name}`}
                          onClick={() => void deleteServerRevision(rev)}
                          disabled={pendingRevisionDeletes.has(rev.id)}
                          title="Delete this revision"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#f87171",
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: "calc(11px * var(--bs-font-scale, 1))",
                            cursor: pendingRevisionDeletes.has(rev.id) ? "wait" : "pointer",
                            opacity: pendingRevisionDeletes.has(rev.id) ? 0.5 : 1,
                            padding: "2px 4px",
                            flexShrink: 0,
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )) : puzzleLayouts.map((layout) => (
                    <div
                      key={layout.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 8px",
                        borderBottom: "1px solid rgba(99,102,241,0.15)",
                      }}
                    >
                      <button
                        data-testid={`overview-puzzle-layout-restore-${layout.id}`}
                        onClick={() => restorePuzzleLayout(layout)}
                        title={`Restore "${layout.name}"`}
                        style={{
                          flex: 1,
                          background: "transparent",
                          border: "none",
                          color: "#e2e8f0",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "calc(11px * var(--bs-font-scale, 1))",
                          textAlign: "left",
                          cursor: "pointer",
                          padding: "2px 4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ↩ {layout.name}
                      </button>
                      <button
                        data-testid={`overview-puzzle-layout-delete-${layout.id}`}
                        aria-label={`Delete layout ${layout.name}`}
                        onClick={() => {
                          useSettingsStore.setState((state) => ({
                            puzzleLayouts: state.puzzleLayouts.filter((l) => l.id !== layout.id),
                          }));
                          broadcastPuzzleLayoutEvent({ type: "delete", id: layout.id });
                        }}
                        title="Delete this layout"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#f87171",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "calc(11px * var(--bs-font-scale, 1))",
                          cursor: "pointer",
                          padding: "2px 4px",
                          flexShrink: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Inline "save layout" name input form */}
          {puzzleLayoutFormOpen && (
            <div
              data-testid="overview-puzzle-layout-form"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "rgba(8,16,32,0.95)",
                border: "1px solid rgba(168,85,247,0.45)",
                borderRadius: 4,
                padding: "2px 6px",
              }}
            >
              <input
                data-testid="overview-puzzle-layout-name-input"
                autoFocus
                type="text"
                value={puzzleLayoutNameInput}
                onChange={(e) => setPuzzleLayoutNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && puzzleLayoutNameInput.trim()) {
                    if (spcActive) void saveLayoutToServer(puzzleLayoutNameInput);
                    else saveCurrentPuzzleLayout(puzzleLayoutNameInput);
                  } else if (e.key === "Escape") {
                    setPuzzleLayoutFormOpen(false);
                    setPuzzleLayoutNameInput("");
                  }
                }}
                placeholder="Layout name…"
                maxLength={80}
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#e2e8f0",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(11px * var(--bs-font-scale, 1))",
                  width: 140,
                  minWidth: 80,
                }}
              />
              <button
                data-testid="overview-puzzle-layout-confirm"
                aria-label="Save named puzzle layout"
                disabled={!puzzleLayoutNameInput.trim() || serverLayoutSaving}
                onClick={() => {
                  if (spcActive) void saveLayoutToServer(puzzleLayoutNameInput);
                  else saveCurrentPuzzleLayout(puzzleLayoutNameInput);
                }}
                style={{
                  background: puzzleLayoutNameInput.trim() ? "rgba(168,85,247,0.25)" : "transparent",
                  border: "1px solid rgba(168,85,247,0.4)",
                  borderRadius: 3,
                  color: puzzleLayoutNameInput.trim() ? "#c084fc" : "#64748b",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(10px * var(--bs-font-scale, 1))",
                  padding: "1px 6px",
                  cursor: puzzleLayoutNameInput.trim() ? "pointer" : "default",
                  letterSpacing: "0.08em",
                  lineHeight: "18px",
                }}
              >
                PIN
              </button>
              <button
                data-testid="overview-puzzle-layout-cancel"
                aria-label="Cancel saving puzzle layout"
                onClick={() => {
                  setPuzzleLayoutFormOpen(false);
                  setPuzzleLayoutNameInput("");
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(11px * var(--bs-font-scale, 1))",
                  cursor: "pointer",
                  padding: "1px 4px",
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Tile annotation editor — opened via right-click → Add note */}
          {annotationEditor && (
            <div
              data-testid="overview-puzzle-annotation-form"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "rgba(8,16,32,0.95)",
                border: "1px solid rgba(34,211,238,0.45)",
                borderRadius: 4,
                padding: "2px 6px",
              }}
            >
              <input
                data-testid="overview-puzzle-annotation-input"
                autoFocus
                type="text"
                value={annotationEditor.value}
                maxLength={40}
                onChange={(e) =>
                  setAnnotationEditor((prev) => (prev ? { ...prev, value: e.target.value } : prev))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitAnnotation();
                  else if (e.key === "Escape") setAnnotationEditor(null);
                }}
                placeholder="Note (max 40 chars)…"
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#e2e8f0",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(11px * var(--bs-font-scale, 1))",
                  width: 160,
                  minWidth: 100,
                }}
              />
              <button
                data-testid="overview-puzzle-annotation-confirm"
                aria-label="Save tile annotation"
                onClick={commitAnnotation}
                style={{
                  background: "rgba(34,211,238,0.2)",
                  border: "1px solid rgba(34,211,238,0.4)",
                  borderRadius: 3,
                  color: "#22d3ee",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(10px * var(--bs-font-scale, 1))",
                  padding: "1px 6px",
                  cursor: "pointer",
                  letterSpacing: "0.08em",
                  lineHeight: "18px",
                }}
              >
                OK
              </button>
              <button
                data-testid="overview-puzzle-annotation-cancel"
                aria-label="Cancel tile annotation"
                onClick={() => setAnnotationEditor(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(11px * var(--bs-font-scale, 1))",
                  cursor: "pointer",
                  padding: "1px 4px",
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* GROUP / UNGROUP toolbar buttons */}
          {puzzleMode && (() => {
            const selectedArr = [...puzzleSelectedIds];
            const allInOneGroup =
              selectedArr.length >= 2 &&
              [...puzzleGroups.values()].some((members) =>
                selectedArr.every((id) => members.has(id)),
              );
            const hasGroupedTile = selectedArr.some((id) =>
              [...puzzleGroups.values()].some((members) => members.has(id)),
            );
            return (
              <>
                {selectedArr.length >= 2 && !allInOneGroup && (
                  <ViewscreenTooltip label="Group selected tiles so they move as one unit" side="bottom">
                    <button
                      data-testid="overview-puzzle-group"
                      aria-label="Group selected tiles"
                      onClick={() => {
                        const gid = `group-${++puzzleGroupCounterRef.current}`;
                        const members = new Set(selectedArr);
                        setPuzzleGroups((prev) => {
                          const next = new Map(prev);
                          next.set(gid, members);
                          return next;
                        });
                      }}
                      style={{
                        background: "rgba(34,211,238,0.12)",
                        border: "1px solid rgba(34,211,238,0.5)",
                        borderRadius: 3,
                        color: "#22d3ee",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "calc(12px * var(--bs-font-scale, 1))",
                        padding: "2px 8px",
                        cursor: "pointer",
                        letterSpacing: "0.1em",
                        lineHeight: "18px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ⛓ GROUP
                    </button>
                  </ViewscreenTooltip>
                )}
                {hasGroupedTile && (
                  <ViewscreenTooltip label="Dissolve group(s) overlapping the current selection" side="bottom">
                    <button
                      data-testid="overview-puzzle-ungroup"
                      aria-label="Ungroup selected tiles"
                      onClick={() => {
                        setPuzzleGroups((prev) => {
                          const next = new Map(prev);
                          for (const [gid, members] of prev) {
                            if (selectedArr.some((id) => members.has(id))) {
                              next.delete(gid);
                            }
                          }
                          return next;
                        });
                      }}
                      style={{
                        background: "rgba(251,146,60,0.12)",
                        border: "1px solid rgba(251,146,60,0.5)",
                        borderRadius: 3,
                        color: "#fb923c",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "calc(12px * var(--bs-font-scale, 1))",
                        padding: "2px 8px",
                        cursor: "pointer",
                        letterSpacing: "0.1em",
                        lineHeight: "18px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ✂ UNGROUP
                    </button>
                  </ViewscreenTooltip>
                )}
              </>
            );
          })()}

          {/* Lock toggle — visible in puzzle mode when any tile is selected */}
          {puzzleMode && puzzleSelectedIds.size > 0 && (() => {
            const allLocked = [...puzzleSelectedIds].every((id) => puzzleTransforms.get(id)?.locked);
            const toggleLock = () => {
              setPuzzleTransforms((prev) => {
                const next = new Map(prev);
                for (const id of puzzleSelectedIds) {
                  const existing = prev.get(id) ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false };
                  next.set(id, { ...existing, locked: !allLocked });
                }
                return next;
              });
              dirtyRef.current = true;
            };
            return (
              <ViewscreenTooltip
                label={allLocked ? "Unlock selected tile(s) so they can move again" : "Lock selected tile(s) against drag and rotate"}
                side="bottom"
              >
                <button
                  data-testid="overview-puzzle-lock-toggle"
                  aria-label={allLocked ? "Unlock selected tiles" : "Lock selected tiles"}
                  aria-pressed={allLocked}
                  onClick={toggleLock}
                  style={{
                    background: allLocked ? "rgba(251,191,36,0.15)" : "rgba(0,10,20,0.75)",
                    border: `1px solid ${allLocked ? "rgba(251,191,36,0.6)" : "rgba(0,229,255,0.2)"}`,
                    borderRadius: 3,
                    color: allLocked ? "#fbbf24" : "#94a3b8",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
                    padding: "2px 8px",
                    cursor: "pointer",
                    letterSpacing: "0.1em",
                    lineHeight: "18px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {allLocked ? "🔓 UNLOCK" : "🔒 LOCK"}
                </button>
              </ViewscreenTooltip>
            );
          })()}

          {/* Flip controls — visible in puzzle mode when any tile is selected */}
          {puzzleMode && puzzleSelectedIds.size > 0 && (() => {
            const flipBtnStyle: React.CSSProperties = {
              background: "rgba(0,10,20,0.75)",
              border: "1px solid rgba(168,85,247,0.45)",
              borderRadius: 3,
              color: "#c084fc",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(11px * var(--bs-font-scale, 1))",
              padding: "2px 6px",
              cursor: "pointer",
              lineHeight: "18px",
              whiteSpace: "nowrap",
            };
            const applyFlip = (axis: "flipH" | "flipV") => {
              setPuzzleTransforms((prev) => {
                const next = new Map(prev);
                for (const id of puzzleSelectedIds) {
                  const existing = prev.get(id);
                  if (existing?.locked) continue; // locked tiles never flip
                  const base = existing ?? { tx: 0, ty: 0, angleDeg: 0, flipH: false, flipV: false };
                  next.set(id, { ...base, [axis]: !base[axis] });
                }
                return next;
              });
              dirtyRef.current = true;
            };
            return (
              <div
                data-testid="overview-puzzle-flip-panel"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  background: "rgba(168,85,247,0.08)",
                  border: "1px solid rgba(168,85,247,0.35)",
                  borderRadius: 4,
                  padding: "2px 6px",
                }}
              >
                <span style={{ color: "rgba(192,132,252,0.7)", fontFamily: "'JetBrains Mono', monospace", fontSize: "calc(10px * var(--bs-font-scale,1))", letterSpacing: "0.05em", marginRight: 2 }}>⇔</span>
                <button
                  data-testid="overview-puzzle-flip-h"
                  aria-label="Flip selected tiles horizontally"
                  style={flipBtnStyle}
                  title="Flip selected tile(s) horizontally"
                  onClick={() => applyFlip("flipH")}
                >
                  Flip H
                </button>
                <button
                  data-testid="overview-puzzle-flip-v"
                  aria-label="Flip selected tiles vertically"
                  style={flipBtnStyle}
                  title="Flip selected tile(s) vertically"
                  onClick={() => applyFlip("flipV")}
                >
                  Flip V
                </button>
              </div>
            );
          })()}

          {/* Tools popover — collapses box-select and download into one button */}
          <div ref={toolsWrapperRef} style={{ position: "relative" }}>
            <ViewscreenTooltip label="Area tools: box-select or export terrain" side="bottom">
              <button
                data-testid="overview-tools-toggle"
                aria-label="Open map tools"
                aria-expanded={toolsPopoverOpen}
                aria-haspopup="true"
                onClick={(e) => {
                  toolsOpenerRef.current = e.currentTarget;
                  setToolsPopoverOpen((v) => !v);
                }}
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
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  padding: "2px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  lineHeight: "18px",
                  whiteSpace: "nowrap",
                }}
              >
                {selectMode ? "▭ SELECT" : downloadMode ? "↓ EXPORT" : waypointMode ? "📍 WAYPOINTS" : "⚙ TOOLS"}
              </button>
            </ViewscreenTooltip>

            <div
              data-testid="overview-tools-popover"
              role="menu"
              style={{
                display: toolsPopoverOpen ? "block" : "none",
                // The header scroll container clips descendants vertically.
                // Use a viewport layer so the menu remains visible in both
                // normal and horizontally-scrolled narrow layouts.
                position: "fixed",
                top: 40,
                right: 8,
                background: "rgba(2,8,24,0.97)",
                border: "1px solid rgba(0,229,255,0.25)",
                borderRadius: 4,
                backdropFilter: "blur(8px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
                zIndex: 1000,
                minWidth: 168,
                overflow: "hidden",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
                <div
                  style={{
                    padding: "5px 10px 4px",
                    borderBottom: "1px solid rgba(0,229,255,0.1)",
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
                    color: "#64748b",
                    letterSpacing: "0.18em",
                  }}
                >
                  TOOLS
                </div>

                {/* Box-Select row */}
                <button
                  data-testid="overview-select-area-toggle"
                  aria-label="Toggle box select tool"
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
                    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>▭</span>
                  <span style={{ flex: 1 }}>BOX SELECT</span>
                  {selectMode && (
                    <span style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#00e5ff", opacity: 0.85 }}>● ON</span>
                  )}
                </button>

                {/* Download row */}
                <button
                  data-testid="overview-download-toggle"
                  aria-label="Toggle export terrain tool"
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
                    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>↓</span>
                  <span style={{ flex: 1 }}>EXPORT TERRAIN</span>
                  {downloadMode && (
                    <span style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#fbbf24", opacity: 0.85 }}>● ON</span>
                  )}
                </button>

                {/* Waypoints row */}
                <button
                  data-testid="overview-waypoint-mode-toggle"
                  aria-label="Toggle waypoint mode"
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
                    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>📍</span>
                  <span style={{ flex: 1 }}>WAYPOINTS</span>
                  {waypointMode && (
                    <span style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#c084fc", opacity: 0.85 }}>● ON</span>
                  )}
                </button>

              </div>
          </div>

          {/* EFH overlay toggle — shown for preset datasets (hasEfh) and user-saved EFH datasets (embeddedEfhPolygons) */}
          {(hasEfh || !!embeddedEfhPolygons) && (
            <ViewscreenTooltip label="Toggle Essential Fish Habitat zones" side="bottom">
            <button
              data-testid="efh-overlay-toggle"
              aria-label="Toggle Essential Fish Habitat overlay"
              onClick={() => setShowEfh(!showEfh)}
              aria-pressed={showEfh}
              style={{
                background: showEfh ? "rgba(34,197,94,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${showEfh ? "rgba(34,197,94,0.5)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: showEfh ? "#4ade80" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
                padding: "2px 8px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                lineHeight: "18px",
                whiteSpace: "nowrap",
              }}
            >
              🐟 EFH
            </button>
            </ViewscreenTooltip>
          )}

          {/* Waypoints panel toggle — visible when waypoints exist or mode is on */}
          {(waypoints.length > 0 || waypointMode) && (
            <ViewscreenTooltip label="Show waypoint list" side="bottom">
            <button
              data-testid="overview-waypoint-panel-toggle"
              aria-label="Show waypoint list"
                aria-expanded={showWaypointPanel}
                aria-controls="overview-waypoint-panel"
              onClick={(e) => {
                waypointPanelOpenerRef.current = e.currentTarget;
                setShowWaypointPanel((v) => !v);
              }}
              style={{
                background: showWaypointPanel ? "rgba(168,85,247,0.18)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${showWaypointPanel ? "rgba(168,85,247,0.55)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: showWaypointPanel ? "#c084fc" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
                padding: "2px 8px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                lineHeight: "18px",
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
              type="button"
              aria-expanded={showTrailList}
              aria-controls="overview-trail-list-panel"
              onClick={(e) => {
                trailPanelOpenerRef.current = e.currentTarget;
                setShowTrailList((v) => !v);
              }}
              aria-label="Show saved GPS trails"
              style={{
                background: showTrailList ? "rgba(251,146,60,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${showTrailList ? "rgba(251,146,60,0.5)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: showTrailList ? "#fb923c" : "#94a3b8",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
                padding: "2px 8px",
                cursor: "pointer",
                letterSpacing: "0.1em",
                lineHeight: "18px",
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
            aria-label={gpsActive ? "GPS active" : "Use my location"}
            aria-pressed={gpsActive}
            style={{
              background: gpsActive ? "rgba(59,130,246,0.15)" : "rgba(0,10,20,0.75)",
              border: `1px solid ${gpsActive ? "rgba(59,130,246,0.5)" : "rgba(0,229,255,0.2)"}`,
              borderRadius: 3,
              color: gpsActive ? "#60a5fa" : "#94a3b8",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              padding: "2px 8px",
              cursor: "pointer",
              letterSpacing: "0.1em",
              lineHeight: "18px",
              whiteSpace: "nowrap",
            }}
          >
            {gpsActive ? "📍 GPS ACTIVE" : "📍 MY LOCATION"}
          </button>
          </ViewscreenTooltip>

          <ViewscreenTooltip label="Close the overview map (O)" side="bottom">
          <button
            data-testid="overview-close"
            aria-label="Close overview map"
            onClick={() => setOverviewOpen(false)}
            style={{
              pointerEvents: "auto",
              background: "none",
              border: "1px solid rgba(0,229,255,0.2)",
              color: "#94a3b8",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              padding: "2px 8px",
              borderRadius: 3,
              cursor: "pointer",
              letterSpacing: "0.1em",
              lineHeight: "18px",
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

      {/* Intertidal band legend — embedded at bottom-right, mirrors the
          floating legend shown in the 3D view. Shown whenever MHW is resolved
          (same condition as the renderIntertidalBand rAF guard). */}
      {intertidalMhwFt !== null && (
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            zIndex: 41,
            pointerEvents: "none",
          }}
        >
          <IntertidalBandLegend embedded />
        </div>
      )}

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
            fontSize: "calc(15px * var(--bs-font-scale, 1))",
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

      {/* Georef pick mode banner — full-width instruction bar at the top */}
      {georefPickModeStore && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 55,
            padding: "8px 16px",
            background: "rgba(109,40,217,0.88)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "calc(20px * var(--bs-font-scale,1))" }}>⬛</span>
            <span style={{ fontSize: "calc(15px * var(--bs-font-scale,1))", color: "#ede9fe", fontWeight: 600 }}>
              Drag a rectangle on the map to set the PDF bounding box
            </span>
          </div>
          <button
            type="button"
            onClick={() => useUiStore.getState().setGeorefPickMode(false)}
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 4,
              color: "#ede9fe",
              fontSize: "calc(13.5px * var(--bs-font-scale,1))",
              padding: "2px 10px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Cancel
          </button>
        </div>
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

      {/* Apply-to-3D confirmation dialog */}
      {applyTo3DConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Apply puzzle layout to 3D scene"
          data-testid="apply-3d-confirm-dialog"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
          onClick={() => setApplyTo3DConfirmOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "rgba(0,10,20,0.95)", border: "1px solid rgba(45,212,191,0.4)", borderRadius: 6, padding: 18, width: 360, maxWidth: "90vw", color: "#cbd5e1", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "calc(14px * var(--bs-font-scale, 1))" }}
          >
            <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", fontWeight: 700, marginBottom: 10, letterSpacing: "0.05em", color: "#2dd4bf" }}>
              Apply the current puzzle layout to the 3D scene?
            </div>
            <div style={{ color: "#94a3b8", fontSize: "calc(13px * var(--bs-font-scale, 1))", marginBottom: 12 }}>
              Each dataset will be loaded at its adjusted geographic position.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                data-testid="btn-apply-3d-cancel"
                onClick={() => setApplyTo3DConfirmOpen(false)}
                style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "4px 14px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, color: "#94a3b8", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
              >
                Cancel
              </button>
              <button
                data-testid="btn-apply-3d-confirm"
                onClick={handleApplyLayoutTo3D}
                style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "4px 14px", background: "rgba(45,212,191,0.12)", border: "1px solid rgba(45,212,191,0.5)", borderRadius: 3, color: "#2dd4bf", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

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
    fontSize: "calc(15px * var(--bs-font-scale, 1))",
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
      id="overview-waypoint-panel"
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
          type="button"
          aria-label="Close waypoint list"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "calc(19.5px * var(--bs-font-scale, 1))",
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
            fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
              fontWeight: "bold",
              color: "white",
              fontFamily: "sans-serif",
            }}
          >
            {i + 1}
          </div>

          {/* Coordinates */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...MONO, color: "#e2e8f0", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", lineHeight: 1.4 }}>
              {wp.lat.toFixed(4)}°, {wp.lon.toFixed(4)}°
            </div>
          </div>

          {/* Drag handle */}
          <span style={{ color: "#475569", fontSize: "calc(19.5px * var(--bs-font-scale, 1))", cursor: "grab" }}>⠿</span>

          {/* Delete button */}
          <button
            onClick={() => onDelete(wp.id)}
            title="Remove waypoint"
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              fontSize: "calc(18px * var(--bs-font-scale, 1))",
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
            fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
    fontSize: "calc(15px * var(--bs-font-scale, 1))",
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
      id="overview-trail-list-panel"
      role="dialog"
      aria-label="Saved GPS trails"
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
              style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "calc(18px * var(--bs-font-scale, 1))", padding: 0 }}
            >
              ←
            </button>
          )}
          <span style={{ ...MONO, letterSpacing: "0.15em", color: "#fb923c" }}>
            {selectedTrail ? selectedTrail.name.toUpperCase().slice(0, 22) : "SAVED TRAILS"}
          </span>
        </div>
        <button
          type="button"
          aria-label={selectedTrail ? "Close saved trail details" : "Close saved GPS trails"}
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "calc(19.5px * var(--bs-font-scale, 1))",
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
                <div style={{ ...MONO, fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 1 }}>{label}</div>
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
              fontSize: "calc(15px * var(--bs-font-scale, 1))",
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
                <div style={{ ...MONO, fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", marginTop: 2 }}>
                  {trail.pointCount} pts
                  {durationMin > 0 ? ` · ${durationMin} min` : ""}
                  {distKm !== null
                    ? ` · ${formatDistance(distKm * 1000, { units: unitsForUi })}`
                    : ""}
                </div>
              </div>

              {/* Arrow */}
              <span style={{ color: "#64748b", fontSize: "calc(16.5px * var(--bs-font-scale, 1))" }}>›</span>
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
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_CATALOG_RESULT_FILTERS);
  const filteredResults = useMemo(
    () => results ? filterCatalogResults(results, filters) : null,
    [results, filters],
  );
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
        <span style={{ color: "#00e5ff", fontSize: "calc(15px * var(--bs-font-scale, 1))", letterSpacing: "0.15em" }}>
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
            fontSize: "calc(21px * var(--bs-font-scale, 1))",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "10px 12px", fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#cbd5e1" }}>
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
              fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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
        <CatalogResultFilters
          filters={filters}
          onChange={setFilters}
          testId="overview-result-filters"
        />
        {results === null && !loading && !error && (
          <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
            Click "Request bathymetry" to see matching datasets.
          </div>
        )}
        {results && results.length === 0 && (
          <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
            No datasets cover this area.
          </div>
        )}
        {results && results.length > 0 && filteredResults?.length === 0 && (
          <div data-testid="overview-filtered-empty" style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
            Data was found, but the current filters hide every result.
          </div>
        )}
        {filteredResults?.map((entry) => {
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
              <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#e2e8f0", fontWeight: 600 }}>{entry.name}</div>
              <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#cbd5e1", marginTop: 2, letterSpacing: "0.08em", textTransform: "uppercase" }}>
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
                    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
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

      {/* Non-bathymetry NCEI reference records for this area */}
      <OtherDataSection bbox={bbox} />
    </div>
  );
};
