/**
 * mobileMapFollow — MOBILE-ONLY: Live-tab wiring for the 2D chart.
 *
 * On desktop, Live mode drives the 3D camera through useGpsFollowCamera. On
 * mobile there is no 3D scene, so the SAME GpsFollowState machine
 * (cameraStore: following / paused / off, pause reasons "interaction" and
 * "signal-loss") must drive 2D chart centering instead. This module contains
 * the pure, testable pieces of that wiring:
 *
 *   - runMobileMapFollowTick(): the per-frame follow step, mirroring the
 *     useGpsFollowCamera frame body (shared runFollowBoundsCheck → pause /
 *     auto-resume handling → lerp) but recentering the chart transform
 *     instead of the camera. NO parallel state machine — every state read
 *     and transition goes through cameraStore.
 *   - retargetPrimaryToGpsDataset(): when the GPS fix leaves the primary
 *     dataset's grid but sits inside another proximity-activated visible
 *     dataset, request the EXISTING follow-handoff channel
 *     (uiStore.pendingFollowHandoff → App.tsx consumer → setDatasetId →
 *     re-enable follow) so the 2D chart re-targets exactly like desktop.
 *   - depthAtGpsMetres(): grid-interpolated depth under the GPS position for
 *     the glanceable Live readout (null over survey gaps / out of bounds).
 *   - startMobileGpsCameraMirror(): mirrors GPS fixes into
 *     cameraStore.cameraPosition so proximity streaming (which reads the
 *     camera position) keeps working with no 3D camera mounted.
 */
import { useCameraStore } from "@/lib/cameraStore";
import { useGpsStore, type GpsPosition } from "@/lib/gpsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useUiStore } from "@/lib/uiStore";
import {
  runFollowBoundsCheck,
  type FollowCheckState,
} from "@/lib/followBoundsCheck";
import {
  lonLatToCanvas,
  clampTransform,
  type OverviewTransform,
} from "@/lib/overviewRenderer";
import {
  lonLatToWorldXZ,
  getTerrainSurfaceY,
  worldYToMetres,
} from "@/lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";
import {
  geographicLonRange,
  isPointInGeographicBounds,
  longitudeOnBboxFrame,
} from "@/lib/geographicBounds";

/**
 * MOBILE-ONLY: per-frame lerp factor for chart recentering. Slightly snappier
 * than the desktop camera lerp (0.05) because map panning reads as "catching
 * up" rather than a physical camera glide.
 */
export const MOBILE_FOLLOW_LERP = 0.15;

/**
 * MOBILE-ONLY: the chart-transform port the follow tick drives. MobileChartView
 * adapts its transformRef/cssSizeRef to this interface; tests supply a mock.
 */
export interface MobileFollowTransformPort {
  getTransform: () => OverviewTransform | null;
  setTransform: (t: OverviewTransform) => void;
  /** Canvas size in CSS pixels. */
  getSize: () => { w: number; h: number };
}

/** True when (lon, lat) falls inside the grid's geographic bounding box. */
function insideGrid(grid: TerrainData, lon: number, lat: number): boolean {
  return isPointInGeographicBounds(lon, lat, grid);
}

/**
 * MOBILE-ONLY: compute the next chart transform that moves the GPS position
 * one lerp step toward the canvas centre. Returns null when no movement is
 * needed (already centred, or clamping absorbed the whole step — e.g. at
 * min zoom where the full dataset is visible and the transform is pinned).
 * Pure: no store access, fully unit-testable.
 */
export function computeFollowedTransform(
  grid: TerrainData,
  t: OverviewTransform,
  w: number,
  h: number,
  lon: number,
  lat: number,
  lerp: number = MOBILE_FOLLOW_LERP,
): OverviewTransform | null {
  const [px, py] = lonLatToCanvas(lon, lat, grid, t);
  const dx = (w / 2 - px) * lerp;
  const dy = (h / 2 - py) * lerp;
  // Sub-quarter-pixel steps are invisible; treat as settled to avoid marking
  // the canvas dirty every frame once centred.
  if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return null;
  const next = clampTransform(
    { ...t, offsetX: t.offsetX + dx, offsetY: t.offsetY + dy },
    grid,
    w,
    h,
  );
  if (
    next.offsetX === t.offsetX &&
    next.offsetY === t.offsetY &&
    next.scale === t.scale
  ) {
    return null;
  }
  return next;
}

/**
 * MOBILE-ONLY: when the GPS fix has left the PRIMARY dataset's grid but sits
 * inside another visible dataset (loaded by proximity streaming), request the
 * existing follow-handoff channel so the chart re-targets to that dataset.
 * Desktop renders all visible datasets at once in 3D, so it never needs this;
 * the 2D chart renders only the primary's overview grid.
 *
 * Returns true when a handoff was requested (caller should skip centering this
 * frame and wait for the new grid to commit).
 */
export function retargetPrimaryToGpsDataset(lon: number, lat: number): boolean {
  // A handoff is already in flight — the App.tsx consumer will switch the
  // dataset and re-enable follow; don't re-request every frame.
  if (useUiStore.getState().pendingFollowHandoff !== null) return true;

  const store = useTerrainStore.getState();
  const primaryId = store.primaryDatasetId;
  if (primaryId === null) return false;

  const primaryGrid = store.overviewGrid ?? store.activeGrid;
  // Primary grid missing or still contains the fix — nothing to re-target.
  if (!primaryGrid || insideGrid(primaryGrid, lon, lat)) return false;

  // Find a proximity-activated visible dataset whose LOADED grid contains the
  // fix. Entries with null grids (activation fetch still in flight) are
  // skipped — re-checked naturally on a later tick once grids commit.
  const target = store.visibleDatasets.find((v) => {
    if (v.datasetId === primaryId) return false;
    const g = v.overviewGrid ?? v.activeGrid;
    return g !== null && insideGrid(g, lon, lat);
  });
  if (!target) return false;

  useUiStore.getState().requestFollowHandoff(target.datasetId);
  return true;
}

/**
 * MOBILE-ONLY: one follow step for the 2D chart, called from the
 * MobileChartView rAF loop. Mirrors the useGpsFollowCamera per-frame body:
 *
 *   1. Shared runFollowBoundsCheck (signal-loss pause, out-of-bounds disable
 *      + handoff toast) — identical to desktop.
 *   2. When paused: honour the followResumeDelaySec inactivity window, then
 *      resumeFollow() — identical to desktop.
 *   3. When following: recenter the chart transform on the fix (instead of
 *      lerping the 3D camera), re-targeting the primary dataset first when
 *      the fix has moved onto a different visible dataset.
 *
 * Returns true when the transform changed (caller marks the canvas dirty).
 */
export function runMobileMapFollowTick(
  checkState: FollowCheckState,
  port: MobileFollowTransformPort,
  now: () => number = Date.now,
): boolean {
  // Shared desktop/mobile bounds + signal-loss machinery. Returns false when
  // follow is off, paused for signal loss, or was just disabled.
  if (!runFollowBoundsCheck(checkState)) return false;

  const position = useGpsStore.getState().position;
  if (!position) return false;

  const cam = useCameraStore.getState();
  if (cam.gpsFollowState === "paused") {
    // Same auto-resume rule as useGpsFollowCamera: wait out the inactivity
    // delay after the user's last pan/pinch, then resume following.
    const delayMs = useSettingsStore.getState().followResumeDelaySec * 1000;
    if (now() - cam.followLastInteractionAt < delayMs) return false;
    cam.resumeFollow();
  } else if (cam.gpsFollowState !== "following") {
    return false;
  }

  const { longitude: lon, latitude: lat } = position;

  // Re-target the chart when the fix has crossed onto another visible
  // (proximity-activated) dataset; skip centering until the new grid lands.
  if (retargetPrimaryToGpsDataset(lon, lat)) return false;

  const grid = useTerrainStore.getState().overviewGrid;
  if (!grid) return false;

  const t = port.getTransform();
  if (!t) return false;
  const { w, h } = port.getSize();
  if (w <= 0 || h <= 0) return false;

  const next = computeFollowedTransform(grid, t, w, h, lon, lat);
  if (!next) return false;
  port.setTransform(next);
  return true;
}

/**
 * MOBILE-ONLY: grid-interpolated depth (metres) under a GPS position for the
 * Live readout. Unlike the LivePanel row (which clamps to the nearest edge
 * cell), this returns null when the fix is outside the grid's bbox or over a
 * survey gap (all four surrounding cells no-data) — a chart-plotter must show
 * "—" rather than a made-up nearby depth.
 */
export function depthAtGpsMetres(
  grid: TerrainData | null,
  lon: number,
  lat: number,
): number | null {
  if (!grid || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (!insideGrid(grid, lon, lat)) return null;

  const N = grid.resolution;
  const depths = grid.depths as (number | null)[];
  if (!N || N < 2 || !depths?.length) return null;

  // Survey-gap check on the four cells surrounding the fix. Row 0 = SOUTH
  // (served-grid contract), matching lonLatToWorldXZ's linear lat → row map.
  const lonRange = geographicLonRange(grid);
  const latRange = grid.maxLat - grid.minLat || 1;
  const frameLon = longitudeOnBboxFrame(lon, grid);
  const fracCol = ((frameLon - grid.minLon) / lonRange) * (N - 1);
  const fracRow = ((lat - grid.minLat) / latRange) * (N - 1);
  const col0 = Math.max(0, Math.min(N - 2, Math.floor(fracCol)));
  const row0 = Math.max(0, Math.min(N - 2, Math.floor(fracRow)));
  const corners = [
    depths[row0 * N + col0],
    depths[row0 * N + col0 + 1],
    depths[(row0 + 1) * N + col0],
    depths[(row0 + 1) * N + col0 + 1],
  ];
  if (corners.every((d) => d === null || d === undefined || !Number.isFinite(d))) {
    return null;
  }

  // Shared interpolation path — same maths the 3D surface and LivePanel use.
  const { x, z } = lonLatToWorldXZ(lon, lat, grid);
  return worldYToMetres(getTerrainSurfaceY(grid, x, z), grid);
}

/**
 * MOBILE-ONLY: mirror GPS fixes into cameraStore.cameraPosition. Proximity
 * streaming (useDatasetProximityStreaming) and the shared follow bounds check
 * read the CAMERA position; on desktop useFlyControls publishes it every
 * frame, but on mobile no 3D camera exists — the user's GPS position IS the
 * "camera". Returns an unsubscribe function.
 */
export function startMobileGpsCameraMirror(): () => void {
  const mirror = (pos: GpsPosition | null) => {
    if (!pos) return;
    useCameraStore.getState().setCameraGeo({
      lon: pos.longitude,
      lat: pos.latitude,
      depth: null,
      heading: pos.heading ?? 0,
      altitude: 0,
    });
  };
  // Seed immediately in case a fix already exists when the shell mounts.
  mirror(useGpsStore.getState().position);
  return useGpsStore.subscribe((state, prev) => {
    if (state.position !== prev.position) mirror(state.position);
  });
}
