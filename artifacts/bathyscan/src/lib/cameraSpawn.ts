/**
 * Camera spawn placement logic, extracted from `useFlyControls` so it can be
 * invoked both by the production hook (live Canvas camera) and by the
 * test-helper bridge's fly-wheel rig camera in headless e2e runs where the
 * WebGL Canvas — and therefore `useFlyControls` — never mounts.
 *
 * All spawn paths that place the camera at a *computed* location (centroid,
 * home, deepest point) derive the height from the terrain surface at the
 * spawn point plus `SPAWN_CLEARANCE_WORLD`, so the camera can never spawn
 * inside the mesh regardless of the dataset's depth range. Saved-session
 * restores are exact: the saved depth already encodes the camera's Y at save
 * time, so no offset is applied.
 */
import type * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import {
  lonLatToWorldXZ,
  getTerrainSurfaceY,
  MAX_DEPTH_WORLD,
} from "./terrain";
import type { useSettingsStore } from "./settingsStore";

/** Vertical clearance (world units) above the terrain surface for computed
 *  spawn locations. Saved-session restores do NOT apply this. */
export const SPAWN_CLEARANCE_WORLD = 10;

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

interface SpawnCamera {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/**
 * Place `camera` according to the user's `cameraSpawnBehaviour` setting and
 * write the resulting orientation into `euler` (YXZ order expected).
 */
export function applyCameraSpawn(
  camera: SpawnCamera,
  euler: THREE.Euler,
  grid: TerrainData,
  settings: SettingsState,
): void {
  const { resolution: N, depths, minDepth, maxDepth } = grid;
  const depthRange = maxDepth - minDepth || 1;
  const spawnBehaviour = settings.cameraSpawnBehaviour;

  const setPose = (x: number, y: number, z: number, yaw = 0): void => {
    camera.position.set(x, y, z);
    euler.set(-0.25, yaw, 0);
    camera.quaternion.setFromEuler(euler);
  };

  const spawnAtCentroid = (): void => {
    const centerLon = (grid.minLon + grid.maxLon) / 2;
    const centerLat = (grid.minLat + grid.maxLat) / 2;
    const { x, z } = lonLatToWorldXZ(centerLon, centerLat, grid);
    const surfY = getTerrainSurfaceY(grid, x, z);
    setPose(x, surfY + SPAWN_CLEARANCE_WORLD, z);
  };

  // "last" — resume the previously saved camera position for this dataset.
  if (spawnBehaviour === "last") {
    const sess = settings.lastSession;
    if (sess && sess.datasetId === grid.datasetId) {
      const { x, z } = lonLatToWorldXZ(sess.lon, sess.lat, grid);
      const t = Math.max(0, Math.min(1, (sess.depth - minDepth) / depthRange));
      // Exact restore — no vertical offset.
      const worldY = -t * MAX_DEPTH_WORLD;
      // Restore heading: yaw = heading * PI / 180 applied as negative
      // euler.y (camera looks along -Z in Three.js).
      setPose(x, worldY, z, -(sess.heading * Math.PI) / 180);
      return;
    }
    // No saved session yet — geographic centroid gives a meaningful
    // overview of the whole survey area on first load.
    spawnAtCentroid();
    return;
  }

  // "center" — place camera above the geographic centroid of the dataset.
  if (spawnBehaviour === "center") {
    spawnAtCentroid();
    return;
  }

  // "home" — spawn at the per-dataset saved home position if one is set.
  if (spawnBehaviour === "home") {
    const home = settings.datasetHomePositions[grid.datasetId];
    if (home) {
      const { x, z } = lonLatToWorldXZ(home.lon, home.lat, grid);
      const t = (home.depth - minDepth) / depthRange;
      const surfaceY = -Math.max(0, Math.min(1, t)) * MAX_DEPTH_WORLD;
      setPose(x, surfaceY + SPAWN_CLEARANCE_WORLD, z);
      return;
    }
    // No home set — fall through to deepest-point spawn.
  }

  // "deepest" (default fallback) — spawn above the deepest point.
  let maxIdx = 0;
  for (let i = 1; i < depths.length; i++) {
    if ((depths[i] ?? 0) > (depths[maxIdx] ?? 0)) maxIdx = i;
  }

  const col = maxIdx % N;
  const row = Math.floor(maxIdx / N);
  const lon = grid.minLon + (col / Math.max(1, N - 1)) * (grid.maxLon - grid.minLon);
  const lat = grid.minLat + (row / Math.max(1, N - 1)) * (grid.maxLat - grid.minLat);
  const { x, z } = lonLatToWorldXZ(lon, lat, grid);
  const t = ((depths[maxIdx] ?? 0) - minDepth) / depthRange;
  const surfaceY = -Math.max(0, Math.min(1, t)) * MAX_DEPTH_WORLD;
  setPose(x, surfaceY + SPAWN_CLEARANCE_WORLD, z);
}
