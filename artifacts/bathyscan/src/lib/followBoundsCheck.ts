/**
 * followBoundsCheck — pure GPS-follow bounds/health check shared by the R3F
 * useGpsFollowCamera hook (per-frame) and the dev-only stub-canvas watcher
 * (per GPS update, used when WebGL is unavailable in headless e2e).
 *
 * Returns what the caller should do with follow mode; also fires the
 * out-of-bounds dataset handoff toast at most once per follow session via
 * the caller-owned `state.toastFired` flag.
 */
import { useGpsStore } from "./gpsStore";
import { useCameraStore } from "./cameraStore";
import { useTerrainStore } from "./terrainStore";
import { handleFollowOutOfBounds } from "./datasetHandoff";

export interface FollowCheckState {
  toastFired: boolean;
}

/**
 * Runs the GPS-loss / out-of-bounds checks for follow mode. When follow must
 * be disabled it calls setGpsFollowMode(false) itself (and, on an
 * out-of-bounds exit, triggers the dataset handoff toast once).
 *
 * @returns true when follow mode remains active and in-bounds (the caller
 *          may proceed with camera tracking), false otherwise.
 */
export function runFollowBoundsCheck(state: FollowCheckState): boolean {
  const followMode = useCameraStore.getState().gpsFollowMode;
  if (!followMode) {
    state.toastFired = false;
    return false;
  }

  const gpsActive = useGpsStore.getState().active;
  const position = useGpsStore.getState().position;
  const activeGrid = useTerrainStore.getState().activeGrid;

  if (!gpsActive || !position || !activeGrid) {
    useCameraStore.getState().setGpsFollowMode(false);
    return false;
  }

  const { longitude: lon, latitude: lat } = position;

  // Multi-primary: stay in follow mode if the GPS position is within ANY
  // visible dataset's bounds. Only deactivate when outside all of them.
  // Fallback: if visibleDatasets is empty (e.g. legacy setState path), check
  // against activeGrid directly so the single-dataset path keeps working.
  const visibleDatasets = useTerrainStore.getState().visibleDatasets;
  const gridsToCheck =
    visibleDatasets.length > 0
      ? visibleDatasets.filter((v) => v.activeGrid).map((v) => v.activeGrid!)
      : [activeGrid];
  const insideAny = gridsToCheck.some(
    (g) =>
      lat >= g.minLat && lat <= g.maxLat && lon >= g.minLon && lon <= g.maxLon,
  );

  if (!insideAny) {
    useCameraStore.getState().setGpsFollowMode(false);
    if (!state.toastFired) {
      state.toastFired = true;
      // Nearby-dataset search around the exit position; shows either a
      // one-tap "Load & follow" handoff toast or the plain pause toast.
      void handleFollowOutOfBounds(lon, lat);
    }
    return false;
  }

  state.toastFired = false;
  return true;
}
