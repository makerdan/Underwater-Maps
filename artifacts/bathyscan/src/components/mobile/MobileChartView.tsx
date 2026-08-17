/**
 * MobileChartView — MOBILE-ONLY: full-screen 2D contour chart of the chosen
 * (primary) dataset. This is the mobile replacement for the 3D TourScene —
 * on phones the R3F/WebGL canvas never mounts (see the SceneArea gate in
 * App.tsx); this plain 2D canvas is the entire map surface.
 *
 * Rendering pipeline (all reused from the desktop overview renderer):
 *   1. buildHeatmapBitmap  — user-palette heatmap with the hillshade relief
 *      layer baked in (same palette + depth-domain convention as the 3D
 *      shader and the depth legend).
 *   2. buildContourLines   — marching-squares iso-depth segments at the
 *      EFFECTIVE interval (user interval ÷ density stepper).
 *   3. renderContourLines  — with MOBILE-ONLY index-contour emphasis: every
 *      5th level heavier, labels only on index levels.
 *
 * Touch smoothness design:
 *   - Contour segments are cached per (datasetId, effectiveInterval); they
 *     live in GRID space, so pan/pinch NEVER rebuilds them — gestures only
 *     mutate the transform and redraw, which is cheap.
 *   - The canvas backing store is capped at devicePixelRatio ≤ 2 to bound
 *     fill cost on high-DPR phones.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTerrainStore } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { useGpsStore } from "@/lib/gpsStore";
import { useTrailStore } from "@/lib/trailStore";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import type { FollowCheckState } from "@/lib/followBoundsCheck";
import {
  runMobileMapFollowTick,
  type MobileFollowTransformPort,
} from "@/lib/mobileMapFollow";
import {
  buildHeatmapBitmap,
  buildContourLines,
  renderContourLines,
  renderHeatmap,
  renderScaleBar,
  renderIntertidalBand,
  renderHabitatOverlay,
  renderEfhOverlay,
  renderSubstrateOverlay,
  // MOBILE-ONLY: Plan-tab polyline renderers (no 3D scene equivalent here).
  renderRoutePath,
  renderDriftPath,
  shouldDrawOverlayAtScale,
  computeInitialTransform,
  clampTransform,
  lonLatToCanvas,
  lonRangeOf,
  type OverviewTransform,
  type ContourSegment,
} from "@/lib/overviewRenderer";
import {
  applyContourDensity,
  contourIntervalToMetres,
  toValidContourDensity,
} from "@/lib/contourDensity";
import { formatDepth } from "@/lib/units";
import { useMobileChartOverlays, type MobileChartOverlays } from "./useMobileChartOverlays";
import { MobileAnalyzeLegend } from "./MobileAnalyzeLegend";
import { queryGridAtCanvasPoint, type TapQueryResult } from "./mobileTapQuery";
import type { TerrainData } from "@workspace/api-client-react";

// MOBILE-ONLY: cap the canvas backing-store resolution. High-end phones have
// DPR 3–4; rendering the heatmap at full DPR costs 4–16× the fill rate for
// no visible gain on a 6" screen.
const MAX_DPR = 2;

// MOBILE-ONLY: pinch/wheel zoom limits (same spirit as the desktop overview).
const MIN_SCALE = 1;
const MAX_SCALE = 64;

// MOBILE-ONLY: GPS overlay colours — match the desktop Overview Map's SVG
// styling (cyan fix dot, orange trail) so Live looks consistent across form
// factors.
const GPS_COLOR = "#00e5ff";
/** Approx. metres per degree of longitude at the equator (matches OverviewMap). */
const M_PER_DEG = 111_320;

/**
 * MOBILE-ONLY: draw the live GPS overlay onto the 2D chart canvas — trail
 * polyline, accuracy ring, pulse animation, fix dot (with heading tick), and
 * an edge arrow when the fix is off-screen. Canvas-2D port of the SVG overlay
 * the desktop Overview Map renders; drawn in CSS-pixel space after the base
 * layers so it always sits on top.
 */
function drawGpsOverlay(
  ctx: CanvasRenderingContext2D,
  grid: TerrainData,
  t: OverviewTransform,
  w: number,
  h: number,
  nowMs: number,
): void {
  // Trail polyline (renders while recording, like the desktop Overview Map).
  const trail = useTrailStore.getState();
  if (trail.recording && trail.currentPoints.length >= 2) {
    ctx.beginPath();
    for (let i = 0; i < trail.currentPoints.length; i++) {
      const p = trail.currentPoints[i]!;
      const [x, y] = lonLatToCanvas(p.lon, p.lat, grid, t);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(249,115,22,0.85)"; // TRAIL_COLOR @ 85%
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const gps = useGpsStore.getState();
  if (!gps.active || !gps.position) return;
  const pos = gps.position;
  const [cx, cy] = lonLatToCanvas(pos.longitude, pos.latitude, grid, t);

  const inView = cx >= 0 && cx <= w && cy >= 0 && cy <= h;
  if (!inView) {
    // Off-screen: draw an edge arrow pointing toward the fix (desktop parity).
    const margin = 18;
    const ex = Math.max(margin, Math.min(w - margin, cx));
    const ey = Math.max(margin, Math.min(h - margin, cy));
    const angle = Math.atan2(cy - ey, cx - ex);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = GPS_COLOR;
    ctx.fill();
    ctx.restore();
    return;
  }

  // Accuracy ring — metres → CSS px via the rendered chart width.
  const lonRange = lonRangeOf(grid);
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  if (lonRange > 0 && terrainW > 0) {
    const mPerPx = (lonRange * M_PER_DEG) / terrainW;
    const accPx = pos.accuracy / mPerPx;
    if (accPx > 8 && accPx < Math.max(w, h)) {
      ctx.beginPath();
      ctx.arc(cx, cy, accPx, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,229,255,0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,229,255,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Pulse animation (1.5 s cycle, expanding + fading — desktop parity).
  const phase = (nowMs % 1500) / 1500;
  ctx.beginPath();
  ctx.arc(cx, cy, 6 + phase * 14, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(0,229,255,${(0.5 * (1 - phase)).toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Heading tick — short bearing line when the fix provides a heading.
  if (pos.heading !== null) {
    const rad = ((pos.heading - 90) * Math.PI) / 180; // 0° = north (up)
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * 7, cy + Math.sin(rad) * 7);
    ctx.lineTo(cx + Math.cos(rad) * 16, cy + Math.sin(rad) * 16);
    ctx.strokeStyle = GPS_COLOR;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Fix dot: cyan fill + white ring.
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = GPS_COLOR;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

interface MobileChartViewProps {
  /** MOBILE-ONLY: opens the compact dataset picker (rendered by the shell). */
  onOpenPicker: () => void;
}

export const MobileChartView: React.FC<MobileChartViewProps> = ({ onOpenPicker }) => {
  // Primary dataset's low-res overview grid — same source the desktop
  // Overview Map renders. Null while nothing is loaded / still fetching.
  const overviewGrid = useTerrainStore((s) => s.overviewGrid);
  const visibleCount = useTerrainStore((s) => s.visibleDatasets.length);

  const colormapTheme = useSettingsStore((s) => s.colormapTheme);
  const contoursEnabled = useSettingsStore((s) => s.contoursEnabled);
  const contourInterval = useSettingsStore((s) => s.contourInterval);
  // MOBILE-ONLY settings key: density stepper value (1|2|3).
  const contourDensity = useSettingsStore((s) => s.contourDensity);
  const units = useSettingsStore((s) => s.units);

  // Palette fields that feed buildHeatmapBitmap — mirror the desktop
  // OverviewMap's bitmap-rebuild dependency list so palette edits update the
  // mobile chart identically.
  const paletteShallow = usePaletteStore((s) => s.shallow);
  const paletteDeep = usePaletteStore((s) => s.deep);
  const paletteBandColors = usePaletteStore((s) => s.bandColors);
  const paletteCustomStops = usePaletteStore((s) => s.customStops);
  const paletteBandBoundaries = usePaletteStore((s) => s.bandBoundaries);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render state lives in refs — gestures mutate them at pointer-event rate
  // without triggering React re-renders.
  const transformRef = useRef<OverviewTransform | null>(null);
  const bitmapRef = useRef<HTMLCanvasElement | null>(null);
  const segmentsRef = useRef<ContourSegment[]>([]);
  /** Cache key for segmentsRef: `${datasetId}|${effectiveIntervalMetres}`. */
  const segmentsKeyRef = useRef<string>("");
  const needsRenderRef = useRef(false);
  const cssSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const dprRef = useRef(1);
  /** Dataset the current transform was fitted to (re-fit on switch). */
  const fittedDatasetRef = useRef<string | null>(null);

  // Live values for the rAF loop / gesture handlers (avoid stale closures).
  const gridRef = useRef(overviewGrid);
  gridRef.current = overviewGrid;
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const themeRef = useRef(colormapTheme);
  themeRef.current = colormapTheme;

  // Effective interval in metres = unit-converted base interval ÷ density.
  const effectiveIntervalMetres = applyContourDensity(
    contourIntervalToMetres(contourInterval, units),
    toValidContourDensity(contourDensity),
  );
  const effectiveIntervalRef = useRef(effectiveIntervalMetres);
  effectiveIntervalRef.current = effectiveIntervalMetres;

  const requestRender = useCallback(() => {
    needsRenderRef.current = true;
  }, []);

  // MOBILE-ONLY: Analyze-tab overlays (habitat / EFH / substrate / intertidal)
  // rendered onto this 2D chart with NO 3D scene mounted. The hook mirrors the
  // desktop OverviewMap's data gating; drawing happens in the rAF loop below.
  const overlays = useMobileChartOverlays();
  const overlaysRef = useRef<MobileChartOverlays>(overlays);
  overlaysRef.current = overlays;
  useEffect(() => {
    // Any overlay data/gating change must repaint the chart.
    requestRender();
  }, [overlays, requestRender]);

  // MOBILE-ONLY: current tab, needed by the tap-to-query gesture (Analyze only).
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const sidebarModeRef = useRef(sidebarMode);
  sidebarModeRef.current = sidebarMode;

  // MOBILE-ONLY: tap-to-query state — the readout chip (React state) and the
  // tapped geo-point marker (ref, drawn by the rAF loop so it stays glued to
  // the chart under pan/zoom).
  const [tapQuery, setTapQuery] = useState<TapQueryResult | null>(null);
  const tapMarkerRef = useRef<{ lon: number; lat: number } | null>(null);
  const clearTapQuery = useCallback(() => {
    tapMarkerRef.current = null;
    setTapQuery(null);
    needsRenderRef.current = true;
  }, []);

  // MOBILE-ONLY: a dataset switch invalidates the tapped point (it may lie
  // outside the new grid entirely).
  const tapDatasetId = overviewGrid?.datasetId ?? null;
  useEffect(() => {
    clearTapQuery();
  }, [tapDatasetId, clearTapQuery]);

  // ── MOBILE-ONLY: GPS follow (Live mode) ──────────────────────────────────
  // The SAME GpsFollowState machine that drives the desktop 3D camera drives
  // this 2D chart's transform. The tick (runMobileMapFollowTick) runs inside
  // the rAF loop below; interaction pauses are fed from the pan/pinch/wheel
  // handlers via cameraStore.pauseFollowForInteraction() — no parallel state.
  const followCheckRef = useRef<FollowCheckState>({ toastFired: false });
  const followPortRef = useRef<MobileFollowTransformPort>({
    getTransform: () => transformRef.current,
    setTransform: (t) => {
      transformRef.current = t;
    },
    getSize: () => cssSizeRef.current,
  });

  // MOBILE-ONLY: mirror useGpsFollowCamera's dataset-switch rule — changing
  // the primary dataset clears follow mode (the App.tsx follow-handoff
  // consumer re-enables it once the handed-off dataset's terrain commits).
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);
  useEffect(() => {
    useCameraStore.getState().setGpsFollowMode(false);
    followCheckRef.current.toastFired = false;
  }, [primaryDatasetId]);

  // ── Canvas sizing (DPR-capped) ───────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const applySize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      cssSizeRef.current = { w, h };
      dprRef.current = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Re-fit the transform on resize so the dataset stays centred.
      const grid = gridRef.current;
      if (grid) {
        transformRef.current = computeInitialTransform(grid, w, h);
      }
      requestRender();
    };

    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [requestRender]);

  // ── Heatmap bitmap (palette + hillshade) ─────────────────────────────────
  useEffect(() => {
    if (!overviewGrid) {
      bitmapRef.current = null;
      requestRender();
      return;
    }
    bitmapRef.current = buildHeatmapBitmap(
      overviewGrid,
      colormapTheme,
      overviewGrid.topography,
    );
    requestRender();
  }, [
    overviewGrid,
    colormapTheme,
    paletteShallow,
    paletteDeep,
    paletteBandColors,
    paletteCustomStops,
    paletteBandBoundaries,
    requestRender,
  ]);

  // ── Contour segment cache ────────────────────────────────────────────────
  // Keyed on (datasetId, effectiveInterval). Segments live in fractional grid
  // coordinates, so pan/pinch never invalidates this cache — the only rebuild
  // triggers are dataset switches and interval/density/unit changes.
  useEffect(() => {
    if (!overviewGrid || !contoursEnabled || effectiveIntervalMetres <= 0) {
      segmentsRef.current = [];
      segmentsKeyRef.current = "";
      requestRender();
      return;
    }
    const key = `${overviewGrid.datasetId}|${effectiveIntervalMetres}`;
    if (segmentsKeyRef.current !== key) {
      segmentsRef.current = buildContourLines(overviewGrid, effectiveIntervalMetres);
      segmentsKeyRef.current = key;
    }
    requestRender();
  }, [overviewGrid, contoursEnabled, effectiveIntervalMetres, requestRender]);

  // ── Fit transform when the dataset changes ───────────────────────────────
  useEffect(() => {
    if (!overviewGrid) {
      transformRef.current = null;
      fittedDatasetRef.current = null;
      requestRender();
      return;
    }
    if (fittedDatasetRef.current !== overviewGrid.datasetId) {
      const { w, h } = cssSizeRef.current;
      if (w > 0 && h > 0) {
        transformRef.current = computeInitialTransform(overviewGrid, w, h);
        fittedDatasetRef.current = overviewGrid.datasetId;
      }
    }
    requestRender();
  }, [overviewGrid, requestRender]);

  // ── rAF render loop (dirty-flag driven) ──────────────────────────────────
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);

      // MOBILE-ONLY: per-frame GPS follow step (shared GpsFollowState machine;
      // recenters the chart transform instead of the 3D camera).
      if (runMobileMapFollowTick(followCheckRef.current, followPortRef.current)) {
        needsRenderRef.current = true;
      }
      // MOBILE-ONLY: while a GPS fix is shown, redraw continuously so the
      // pulse animation runs (same continuous-redraw rule as the desktop
      // Overview Map when GPS is active).
      const gpsState = useGpsStore.getState();
      if (gpsState.active && gpsState.position) {
        needsRenderRef.current = true;
      }

      if (!needsRenderRef.current) return;
      needsRenderRef.current = false;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const { w, h } = cssSizeRef.current;
      const dpr = dprRef.current;

      // All drawing happens in CSS-pixel space; the DPR cap is applied once
      // via setTransform so the reused desktop renderers need no changes.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#020817";
      ctx.fillRect(0, 0, w, h);

      const grid = gridRef.current;
      const t = transformRef.current;
      if (!grid || !t) return;

      if (bitmapRef.current) {
        renderHeatmap(ctx, bitmapRef.current, grid, t);
      }

      // MOBILE-ONLY: Analyze overlays on the 2D chart, drawn in the same
      // order as the desktop OverviewMap (band UNDER the contours; habitat/
      // EFH/substrate above them) so both surfaces read identically.
      const ov = overlaysRef.current;
      if (ov.mhwFt !== null) {
        // Single-dataset mode: the grid is its own coordinate frame.
        renderIntertidalBand(ctx, grid, grid, t, ov.mhwFt, ov.mhhwFt);
      }

      if (segmentsRef.current.length > 0) {
        renderContourLines(
          ctx,
          segmentsRef.current,
          grid,
          t,
          unitsRef.current,
          themeRef.current,
          undefined,
          // MOBILE-ONLY: index-contour emphasis (every 5th heavier + labeled).
          { indexIntervalMetres: effectiveIntervalRef.current },
        );
      }

      // MOBILE-ONLY: overlay layers above the contours (desktop order).
      if (ov.habitatScores) {
        renderHabitatOverlay(ctx, ov.habitatScores, grid, t);
      }
      // Same zoom LOD gate the desktop map applies to polygon overlays.
      if (shouldDrawOverlayAtScale(t.scale)) {
        if (ov.efhEnabled && ov.efhFeatures.length > 0) {
          renderEfhOverlay(ctx, ov.efhFeatures, grid, t);
        }
        if (ov.substrateEnabled && ov.substrateFeatures.length > 0) {
          renderSubstrateOverlay(ctx, ov.substrateFeatures, grid, t, null, ov.hiddenSubstrateClasses);
        }
      }
      // MOBILE-ONLY: intertidal hotspots as plain canvas dots (the desktop
      // map's interactive DOM pins are a desktop affordance).
      if (ov.intertidalEnabled && ov.intertidalPins.length > 0) {
        for (const pin of ov.intertidalPins) {
          const [px, py] = lonLatToCanvas(pin.lon, pin.lat, grid, t);
          if (px < -8 || py < -8 || px > w + 8 || py > h + 8) continue;
          const r = 3 + (pin.score / 100) * 4;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fillStyle = pin.color;
          ctx.globalAlpha = 0.45 + (pin.score / 100) * 0.45;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.stroke();
        }
      }

      // MOBILE-ONLY: Plan-tab overlays — drawn above the Analyze layers so
      // planning visuals always read clearly, but below GPS and the tap marker.
      const ov2 = overlaysRef.current;
      if (ov2.routeWaypoints && ov2.routeWaypoints.length >= 1) {
        renderRoutePath(ctx, ov2.routeWaypoints, grid, t);
      }
      if (
        ov2.driftPlannerActive &&
        (ov2.driftPath !== null || ov2.driftStartLat !== null || ov2.trollWaypoints.length > 0)
      ) {
        renderDriftPath(
          ctx,
          ov2.driftPath,
          ov2.driftStartLat,
          ov2.driftStartLon,
          ov2.reverseDriftPath,
          ov2.trollWaypoints,
          grid,
          t,
        );
      }

      // MOBILE-ONLY: tap-to-query crosshair marker, glued to the geo point.
      const marker = tapMarkerRef.current;
      if (marker) {
        const [mx, my] = lonLatToCanvas(marker.lon, marker.lat, grid, t);
        ctx.beginPath();
        ctx.arc(mx, my, 7, 0, Math.PI * 2);
        ctx.strokeStyle = "#00e5ff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx - 11, my); ctx.lineTo(mx - 4, my);
        ctx.moveTo(mx + 4, my);  ctx.lineTo(mx + 11, my);
        ctx.moveTo(mx, my - 11); ctx.lineTo(mx, my - 4);
        ctx.moveTo(mx, my + 4);  ctx.lineTo(mx, my + 11);
        ctx.stroke();
      }

      renderScaleBar(ctx, grid, t, h, unitsRef.current);

      // MOBILE-ONLY: live GPS overlay (trail, accuracy ring, pulse, fix dot,
      // off-screen edge arrow) on top of all base + overlay layers.
      drawGpsOverlay(ctx, grid, t, w, h, performance.now());
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Touch gestures: one-finger pan, two-finger pinch-zoom ────────────────
  // Pointer positions are tracked in a Map so pinch works with any two
  // pointers. Gestures only mutate transformRef + set the dirty flag — no
  // React state, no contour rebuilds — so panning stays jank-free.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  // MOBILE-ONLY: tap-candidate tracking for Analyze tap-to-query. A tap is a
  // single pointer that moves < TAP_SLOP_PX and lifts within TAP_MAX_MS —
  // anything else is a pan/pinch and never queries.
  const TAP_SLOP_PX = 8;
  const TAP_MAX_MS = 600;
  const tapCandidateRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    startedAt: number;
  } | null>(null);

  /** MOBILE-ONLY: resolve a completed tap into the depth/slope readout. */
  const handleChartTap = useCallback((clientX: number, clientY: number) => {
    // Tap-to-query is an Analyze-tab interaction only.
    if (sidebarModeRef.current !== "analyze") return;
    const grid = gridRef.current;
    const t = transformRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!grid || !t || !rect) return;
    const result = queryGridAtCanvasPoint(clientX - rect.left, clientY - rect.top, grid, t);
    if (!result) {
      // Outside the grid bbox — dismiss any existing readout, non-blocking.
      tapMarkerRef.current = null;
      setTapQuery(null);
    } else {
      tapMarkerRef.current = { lon: result.lon, lat: result.lat };
      setTapQuery(result);
    }
    needsRenderRef.current = true;
  }, []);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    const t = transformRef.current;
    const grid = gridRef.current;
    if (!t || !grid) return;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale * factor));
    const applied = newScale / t.scale;
    if (applied === 1) return;
    // MOBILE-ONLY: zooming is a user interaction — pause GPS follow via the
    // shared state machine (auto-resumes after followResumeDelaySec).
    useCameraStore.getState().pauseFollowForInteraction();
    const { w, h } = cssSizeRef.current;
    transformRef.current = clampTransform(
      {
        ...t,
        scale: newScale,
        offsetX: cx - (cx - t.offsetX) * applied,
        offsetY: cy - (cy - t.offsetY) * applied,
      },
      grid,
      w,
      h,
    );
    needsRenderRef.current = true;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
    // MOBILE-ONLY: only the FIRST pointer down can begin a tap; a second
    // pointer means pinch, which cancels the candidate.
    if (pointersRef.current.size === 0) {
      tapCandidateRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        startedAt: performance.now(),
      };
    } else {
      tapCandidateRef.current = null;
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pointers = pointersRef.current;
      const prev = pointers.get(e.pointerId);
      if (!prev) return;

      // MOBILE-ONLY: moving beyond the slop radius turns the tap into a pan.
      const cand = tapCandidateRef.current;
      if (
        cand &&
        cand.pointerId === e.pointerId &&
        Math.hypot(e.clientX - cand.x, e.clientY - cand.y) > TAP_SLOP_PX
      ) {
        tapCandidateRef.current = null;
      }

      if (pointers.size === 1) {
        // Pan
        const t = transformRef.current;
        const grid = gridRef.current;
        if (t && grid) {
          // MOBILE-ONLY: panning is a user interaction — pause GPS follow via
          // the shared state machine (auto-resumes after followResumeDelaySec).
          useCameraStore.getState().pauseFollowForInteraction();
          const { w, h } = cssSizeRef.current;
          transformRef.current = clampTransform(
            {
              ...t,
              offsetX: t.offsetX + (e.clientX - prev.x),
              offsetY: t.offsetY + (e.clientY - prev.y),
            },
            grid,
            w,
            h,
          );
          needsRenderRef.current = true;
        }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      } else if (pointers.size === 2) {
        // Pinch-zoom around the midpoint of the two pointers.
        const entries = [...pointers.entries()];
        const other = entries.find(([id]) => id !== e.pointerId)?.[1];
        if (other) {
          const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
          const rect = canvasRef.current?.getBoundingClientRect();
          const ox = rect?.left ?? 0;
          const oy = rect?.top ?? 0;
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const newDist = Math.hypot(e.clientX - other.x, e.clientY - other.y);
          if (prevDist > 0 && newDist > 0) {
            const midX = (e.clientX + other.x) / 2 - ox;
            const midY = (e.clientY + other.y) / 2 - oy;
            zoomAt(midX, midY, newDist / prevDist);
          }
        }
      }
    },
    [zoomAt],
  );

  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.delete(e.pointerId);
      // MOBILE-ONLY: resolve the tap candidate on lift (pointerup only —
      // pointercancel never queries).
      const cand = tapCandidateRef.current;
      if (cand && cand.pointerId === e.pointerId) {
        tapCandidateRef.current = null;
        if (e.type === "pointerup" && performance.now() - cand.startedAt <= TAP_MAX_MS) {
          handleChartTap(e.clientX, e.clientY);
        }
      }
    },
    [handleChartTap],
  );

  // Wheel zoom — keeps the chart usable in narrow desktop windows / dev tools
  // device emulation. Registered natively so preventDefault works (React's
  // synthetic wheel listener is passive).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(
        e.clientX - rect.left,
        e.clientY - rect.top,
        e.deltaY < 0 ? 1.2 : 1 / 1.2,
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ── Empty / loading states ───────────────────────────────────────────────
  const showEmptyState = !overviewGrid;

  return (
    <div
      ref={containerRef}
      data-testid="mobile-chart-view"
      // MOBILE-ONLY style: fills the shell's map area; touch-action none so
      // the browser never hijacks pan/pinch for page scroll/zoom.
      style={{ position: "absolute", inset: 0, background: "#020817" }}
    >
      <canvas
        ref={canvasRef}
        data-testid="mobile-chart-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none", // MOBILE-ONLY: keep pan/pinch on the chart
        }}
      />
      {/* MOBILE-ONLY: compact legend pills for active Analyze overlays. */}
      <MobileAnalyzeLegend overlays={overlays} />

      {/* MOBILE-ONLY: tap-to-query readout chip — dismissible, non-blocking
          (chart gestures keep working underneath it).
          top:100 / zIndex:60 keeps it above the open Analyze bottom sheet
          (zIndex:50, covering bottom 62%) so it is always visible. */}
      {tapQuery && (
        <div
          data-testid="mobile-tap-query"
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            top: 100,
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "rgba(2,8,18,0.92)",
            border: "1px solid rgba(0,229,255,0.35)",
            borderRadius: 999,
            padding: "6px 6px 6px 14px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            letterSpacing: "0.06em",
            color: "#e2e8f0",
            maxWidth: "calc(100% - 20px)",
            whiteSpace: "nowrap",
          }}
        >
          {tapQuery.depthM === null ? (
            <span data-testid="mobile-tap-query-depth" style={{ color: "#94a3b8" }}>
              NO DATA HERE
            </span>
          ) : (
            <>
              <span data-testid="mobile-tap-query-depth">
                <span style={{ color: "#64748b", marginRight: 5 }}>DEPTH</span>
                <span style={{ color: "#00e5ff" }}>
                  {formatDepth(tapQuery.depthM, { units }).toUpperCase()}
                </span>
              </span>
              {tapQuery.slopeDeg !== null && (
                <span data-testid="mobile-tap-query-slope">
                  <span style={{ color: "#64748b", marginRight: 5 }}>SLOPE</span>
                  <span style={{ color: "#34d399" }}>{tapQuery.slopeDeg.toFixed(1)}°</span>
                </span>
              )}
            </>
          )}
          <button
            type="button"
            aria-label="Dismiss point readout"
            data-testid="mobile-tap-query-close"
            onClick={clearTapQuery}
            style={{
              background: "rgba(148,163,184,0.12)",
              border: "none",
              borderRadius: 999,
              color: "#94a3b8",
              fontSize: "calc(15px * var(--bs-font-scale, 1))",
              width: 32,
              height: 32,
              lineHeight: 1,
              cursor: "pointer",
              flex: "0 0 auto",
            }}
          >
            ×
          </button>
        </div>
      )}

      {showEmptyState && (
        <div
          data-testid="mobile-chart-empty"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            pointerEvents: "none",
            fontFamily: "'JetBrains Mono', monospace",
            color: "#94a3b8",
            textAlign: "center",
            padding: 24,
          }}
        >
          <div style={{ fontSize: "calc(13px * var(--bs-font-scale, 1))", letterSpacing: "0.1em" }}>
            {visibleCount > 0 ? "LOADING CHART…" : "NO DATASET LOADED"}
          </div>
          {visibleCount === 0 && (
            <button
              type="button"
              onClick={onOpenPicker}
              style={{
                pointerEvents: "auto",
                background: "rgba(0,229,255,0.10)",
                border: "1px solid rgba(0,229,255,0.35)",
                borderRadius: 6,
                color: "#00e5ff",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "calc(13px * var(--bs-font-scale, 1))",
                letterSpacing: "0.08em",
                padding: "12px 20px",
                minHeight: 44, // MOBILE-ONLY: thumb-sized touch target
                cursor: "pointer",
              }}
            >
              CHOOSE A DATASET
            </button>
          )}
        </div>
      )}
    </div>
  );
};
