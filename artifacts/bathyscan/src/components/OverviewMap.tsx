import React, { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMarkers,
  getGetMarkersQueryKey,
  useGetTrails,
  getGetTrailsQueryKey,
  useDeleteTrailsId,
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
import { requestDatasetSwitch } from "@/lib/simulatedDataStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { useContextMenuStore, type ContextMenuItem } from "@/lib/contextMenuStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import {
  buildHeatmapBitmap,
  computeInitialTransform,
  clampTransform,
  canvasToLonLat,
  lonLatToCanvas,
  renderHeatmap,
  renderGridLines,
  renderMarkers,
  renderDepthPoles,
  renderCameraArrow,
  renderScaleBar,
  renderHabitatOverlay,
  renderEfhOverlay,
  renderEfhLegend,
  hitTestEfh,
  renderGpsPosition,
  renderLiveTrail,
  renderSavedTrails,
  drawSelectionRect,
} from "@/lib/overviewRenderer";
import type { OverviewTransform, CanvasSavedTrail } from "@/lib/overviewRenderer";
import { useGetEfh, getGetEfhQueryKey } from "@workspace/api-client-react";
import type { EfhFeature, EfhSpeciesProperties } from "@workspace/api-client-react";
import { useHabitatStore } from "@/lib/habitatStore";
import { useGpsStore } from "@/lib/gpsStore";
import { useTrailStore } from "@/lib/trailStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { formatDepth, formatDistance } from "@/lib/units";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { registerOverviewEfhDetailSetter } from "@/lib/testHelpers";

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
  const queryClient = useQueryClient();

  const datasetId = overviewGrid?.datasetId ?? "";
  const { data: markerData } = useGetMarkers(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  const { data: trailsData, refetch: refetchTrails } = useGetTrails(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getGetTrailsQueryKey({ datasetId }) } },
  );

  const deleteTrail = useDeleteTrailsId({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTrailsQueryKey({ datasetId }) });
        void refetchTrails();
      },
    },
  });

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

  // EFH detail panel — populated when the user clicks an EFH polygon while
  // the overlay is visible.
  const [efhDetail, setEfhDetail] = useState<EfhSpeciesProperties | null>(null);

  // --- Box-select tool state ------------------------------------------------
  // `selectMode` is the toolbar toggle. When true, the canvas mouse handlers
  // switch from pan/drop-in into rectangle-drawing mode. Refs mirror state
  // for use inside the imperative mouse handlers (which only run when the
  // owning effect is re-registered).
  const [selectMode, setSelectMode] = useState(false);
  const selectModeRef = useRef(false);
  useEffect(() => { selectModeRef.current = selectMode; }, [selectMode]);

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
  //   2. Completed box (or panel showing results): clear the box + panel.
  //   3. Otherwise: do nothing — let App.tsx's global Escape close the
  //      Overview Map as usual. We do NOT consume Escape just because
  //      select-mode is toggled on, so the map can still be closed with one
  //      key press from a "no box drawn yet" state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dragRectRef.current && !selectedBbox && !bboxResults) {
        e.stopPropagation();
        dragRectRef.current = null;
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
  }, [selectedBbox, bboxResults, clearBbox]);

  // Expose the setter to e2e tests (Task #319) so they can open the same
  // panel a click would, without reverse-engineering the canvas projection.
  // The registry no-ops in production builds where testHelpers is tree-shaken.
  useEffect(() => {
    registerOverviewEfhDetailSetter(setEfhDetail);
    return () => registerOverviewEfhDetailSetter(null);
  }, []);

  // GPS & trail state (read directly from stores in rAF — no React re-render)
  const pulseRef = useRef(0);

  // Keep markers ref in sync without causing rAF re-registration
  useEffect(() => {
    markersRef.current = markerData ?? [];
  }, [markerData]);

  // EFH data — only fetch for datasets that have bundled EFH zones
  // (declared via the `hasEfh` flag in the dataset metadata).
  const waterTypeForDatasets = useSettingsStore((s) => s.waterType);
  const { data: allDatasets } = useGetDatasets(
    { waterType: waterTypeForDatasets },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType: waterTypeForDatasets }) } },
  );
  const hasEfh = !!allDatasets?.find((d) => d.id === datasetId)?.hasEfh;
  const { data: efhData } = useGetEfh(
    { datasetId },
    { query: { enabled: hasEfh, staleTime: 60_000, queryKey: getGetEfhQueryKey({ datasetId }) } },
  );
  useEffect(() => {
    efhFeaturesRef.current = efhData?.features ?? [];
  }, [efhData]);

  // Keep showEfhRef in sync so the rAF loop can read it without a dep-array entry
  useEffect(() => {
    showEfhRef.current = showEfh;
  }, [showEfh]);

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

  // Build offscreen bitmap whenever overviewGrid or palette changes
  const paletteShallow = usePaletteStore((s) => s.shallow);
  const paletteDeep = usePaletteStore((s) => s.deep);
  useEffect(() => {
    if (!overviewGrid) return;
    bitmapRef.current = buildHeatmapBitmap(overviewGrid);
  }, [overviewGrid, paletteShallow, paletteDeep]);

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

      // Background
      ctx.fillStyle = "#020818";
      ctx.fillRect(0, 0, cW, cH);

      // Depth heatmap
      renderHeatmap(ctx, bitmap, grid, t);

      // Lat/lon grid (gated by user setting; renderGridLines also checks scale ≥ 2 internally)
      const { overviewShowGrid, overviewShowMarkers, units } = useSettingsStore.getState();
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
        renderEfhOverlay(ctx, efhFeaturesRef.current, grid, t);
        renderEfhLegend(ctx, efhFeaturesRef.current, cW, cH);
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

      // Box-select overlay (in-progress drag + committed bbox). Painted on
      // top of every other layer so the user can always see what they drew.
      const drag = dragRectRef.current;
      if (drag) {
        const dl = canvasToLonLat(drag.x0, drag.y0, grid, t);
        const dr = canvasToLonLat(drag.x1, drag.y1, grid, t);
        drawSelectionRect(ctx, drag.x0, drag.y0, drag.x1, drag.y1, {
          width: Math.abs(dr.lon - dl.lon),
          height: Math.abs(dr.lat - dl.lat),
        });
      } else if (selectedBboxRef.current) {
        const { north, south, east, west } = selectedBboxRef.current;
        const [x0, y0] = (() => {
          const lonRange = grid.maxLon - grid.minLon || 1;
          const latRange = grid.maxLat - grid.minLat || 1;
          const terrainW = t.pxPerDeg * lonRange * t.scale;
          const terrainH = t.pxPerDeg * latRange * t.scale;
          return [
            t.offsetX + ((west - grid.minLon) / lonRange) * terrainW,
            t.offsetY + ((north - grid.minLat) / latRange) * terrainH,
          ];
        })();
        const [x1, y1] = (() => {
          const lonRange = grid.maxLon - grid.minLon || 1;
          const latRange = grid.maxLat - grid.minLat || 1;
          const terrainW = t.pxPerDeg * lonRange * t.scale;
          const terrainH = t.pxPerDeg * latRange * t.scale;
          return [
            t.offsetX + ((east - grid.minLon) / lonRange) * terrainW,
            t.offsetY + ((south - grid.minLat) / latRange) * terrainH,
          ];
        })();
        drawSelectionRect(ctx, x0, y0, x1, y1, {
          width: east - west,
          height: north - south,
        });
      }

      // Subtle border
      ctx.strokeStyle = "rgba(0,229,255,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, cW - 1, cH - 1);

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
      // Select-area tool: capture rectangle start in canvas coords and
      // suppress pan; left-button only.
      if (selectModeRef.current && e.button === 0) {
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

      // Select-area tool: extend the drag rectangle, suppress tooltip/pan.
      if (selectModeRef.current) {
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
      if (selectModeRef.current && dragRectRef.current) {
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
          setSelectedBbox({ north, south, east, west });
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
      // Select tool owns the canvas; never drop-in or open EFH while active.
      if (selectModeRef.current) return;
      if (hasDraggedRef.current) return;
      const t = transformRef.current;
      if (!t || !overviewGrid) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

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
      // dropping into the 3D scene.
      if (showEfhRef.current && efhFeaturesRef.current.length > 0) {
        const hit = hitTestEfh(lon, lat, efhFeaturesRef.current);
        if (hit) {
          setEfhDetail(hit.properties);
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
  }, [overviewGrid]);

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
            color: "#334155",
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
                setSelectMode((v) => !v);
                if (selectMode) clearBbox();
              }}
              style={{
                background: selectMode ? "rgba(0,229,255,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${selectMode ? "rgba(0,229,255,0.6)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: selectMode ? "#00e5ff" : "#475569",
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

          {/* EFH overlay toggle — only shown for datasets with bundled EFH zones */}
          {hasEfh && (
            <ViewscreenTooltip label="Toggle Essential Fish Habitat zones" side="bottom">
            <button
              onClick={() => setShowEfh(!showEfh)}
              aria-pressed={showEfh}
              style={{
                background: showEfh ? "rgba(34,197,94,0.15)" : "rgba(0,10,20,0.75)",
                border: `1px solid ${showEfh ? "rgba(34,197,94,0.5)" : "rgba(0,229,255,0.2)"}`,
                borderRadius: 3,
                color: showEfh ? "#4ade80" : "#475569",
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
                color: showTrailList ? "#fb923c" : "#475569",
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
              color: gpsActive ? "#60a5fa" : "#475569",
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
              color: "#475569",
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
          onDelete={(id) => deleteTrail.mutate({ id })}
          onClose={() => setShowTrailList(false)}
        />
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
            fontSize: 10,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 42,
          }}
        >
          <div style={{ color: "#00e5ff", marginBottom: 1 }}>
            {tooltip.lon.toFixed(4)}° &nbsp;{tooltip.lat.toFixed(4)}°
          </div>
          <div style={{ color: "#64748b" }}>{formatDepth(tooltip.depth, { units: unitsForUi })} depth</div>
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

      {/* EFH species detail panel */}
      {efhDetail && (
        <EfhDetailPanel
          properties={efhDetail}
          units={unitsForUi}
          onClose={() => setEfhDetail(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// EFH species detail panel
// ---------------------------------------------------------------------------
const EfhDetailPanel: React.FC<{
  properties: EfhSpeciesProperties;
  units: "metric" | "imperial";
  onClose: () => void;
}> = ({ properties, units, onClose }) => {
  const p = properties;
  const depthRange = Array.isArray(p.depthRangeM) && p.depthRangeM.length >= 2
    ? `${formatDepth(p.depthRangeM[0]!, { units })} – ${formatDepth(p.depthRangeM[1]!, { units })}`
    : null;

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const MONO = "'JetBrains Mono', monospace";
  const swatchColor = p.color ?? "#00e5ff";

  return (
    <div
      role="dialog"
      aria-label={`Essential Fish Habitat details for ${p.commonName}`}
      style={{
        position: "absolute",
        top: 56,
        right: 16,
        width: 320,
        maxHeight: "calc(100vh - 80px)",
        overflowY: "auto",
        background: "rgba(2,8,24,0.94)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${swatchColor}55`,
        borderLeft: `3px solid ${swatchColor}`,
        borderRadius: 4,
        padding: "12px 14px 14px",
        zIndex: 43,
        boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
        fontFamily: MONO,
        color: "#e2e8f0",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            background: swatchColor,
            borderRadius: 2,
            marginTop: 4,
            flexShrink: 0,
            boxShadow: `0 0 6px ${swatchColor}80`,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#f8fafc", fontWeight: 600, letterSpacing: "0.04em" }}>
            {p.commonName}
          </div>
          <div style={{ fontSize: 9, color: "#64748b", fontStyle: "italic", marginTop: 2 }}>
            {p.species?.replace(/_/g, " ")}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close species details"
          style={{
            background: "transparent",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
            marginLeft: 4,
          }}
        >
          ×
        </button>
      </div>

      {/* Fields */}
      <DetailRow label="FMP" value={p.fmp} />
      {p.lifeStage && <DetailRow label="Life stage" value={p.lifeStage} />}
      {p.season && <DetailRow label="Season" value={p.season} />}
      {depthRange && <DetailRow label="Depth" value={depthRange} />}

      {p.habitatDescription && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 8, color: "#475569", letterSpacing: "0.15em", marginBottom: 4 }}>
            HABITAT
          </div>
          <div style={{ fontSize: 10, lineHeight: 1.5, color: "#cbd5e1" }}>
            {p.habitatDescription}
          </div>
        </div>
      )}

      {/* Source citation */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(0,229,255,0.1)" }}>
        <div style={{ fontSize: 8, color: "#475569", letterSpacing: "0.15em", marginBottom: 4 }}>
          SOURCE
        </div>
        <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4 }}>{p.source}</div>
        {p.source?.startsWith("TPWD") && (
          <div
            style={{
              fontSize: 9,
              color: "#fb923c",
              marginBottom: 4,
              fontStyle: "italic",
            }}
          >
            Texas Parks &amp; Wildlife — priority habitat; not federal EFH.
          </div>
        )}
        {p.creditUrl && (
          <a
            href={p.creditUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 9,
              color: "#00e5ff",
              textDecoration: "none",
              wordBreak: "break-all",
            }}
          >
            {p.source?.startsWith("TPWD") ? "↗ TPWD lake page" : "↗ NOAA EFH shapefiles"}
          </a>
        )}
      </div>
    </div>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: "flex", gap: 8, fontSize: 10, marginTop: 4 }}>
    <span style={{ color: "#64748b", minWidth: 72, fontSize: 9, letterSpacing: "0.08em" }}>
      {label.toUpperCase()}
    </span>
    <span style={{ color: "#e2e8f0", flex: 1 }}>{value}</span>
  </div>
);

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
  onDelete: (id: string) => void;
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
              style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 12, padding: 0 }}
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
            color: "#475569",
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
                <div style={{ ...MONO, fontSize: 9, color: "#475569", marginBottom: 1 }}>{label}</div>
                <div style={{ ...MONO, color: "#94a3b8" }}>{value as React.ReactNode}</div>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              if (confirm(`Delete trail "${selectedTrail.name}"?`)) {
                onDelete(selectedTrail.id);
                setSelectedId(null);
              }
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
                <div style={{ ...MONO, fontSize: 9, color: "#475569", marginTop: 2 }}>
                  {trail.pointCount} pts
                  {durationMin > 0 ? ` · ${durationMin} min` : ""}
                  {distKm !== null
                    ? ` · ${formatDistance(distKm * 1000, { units: unitsForUi })}`
                    : ""}
                </div>
              </div>

              {/* Arrow */}
              <span style={{ color: "#334155", fontSize: 11 }}>›</span>
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
            color: "#475569",
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
          <span style={{ color: "#475569" }}>N</span>
          <span>{bbox.north.toFixed(5)}°</span>
          <span style={{ color: "#475569" }}>S</span>
          <span>{bbox.south.toFixed(5)}°</span>
          <span style={{ color: "#475569" }}>E</span>
          <span>{bbox.east.toFixed(5)}°</span>
          <span style={{ color: "#475569" }}>W</span>
          <span>{bbox.west.toFixed(5)}°</span>
          <span style={{ color: "#475569" }}>SIZE</span>
          <span data-testid="overview-bbox-size-deg">{widthDeg.toFixed(4)}° × {heightDeg.toFixed(4)}°</span>
          <span style={{ color: "#475569" }}>SPAN</span>
          <span data-testid="overview-bbox-size-km">{fmtKm(widthKm)} × {fmtKm(heightKm)}</span>
          <span style={{ color: "#475569" }}>AREA</span>
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
          <div style={{ fontSize: 9, color: "#475569", textAlign: "center", padding: "16px 0" }}>
            Click "Request bathymetry" to see matching datasets.
          </div>
        )}
        {results && results.length === 0 && (
          <div style={{ fontSize: 9, color: "#475569", textAlign: "center", padding: "16px 0" }}>
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
              <div style={{ fontSize: 8, color: "#64748b", marginTop: 2, letterSpacing: "0.08em", textTransform: "uppercase" }}>
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
