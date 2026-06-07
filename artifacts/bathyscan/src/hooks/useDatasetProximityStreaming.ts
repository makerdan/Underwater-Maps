import { useEffect, useRef } from "react";
import { useTerrainStore, MAX_ACTIVE_DATASETS } from "@/lib/terrainStore";
import type { DatasetSource } from "@/lib/terrainStore";
import { useCameraStore } from "@/lib/cameraStore";

/** Bounding box in geographic coordinates. */
export interface DatasetBbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** Earth mean radius in metres (WGS-84). */
const EARTH_RADIUS_M = 6_371_000;

/** Activate a selected-but-not-active dataset when within this many metres of its bbox. */
export const LOAD_THRESHOLD_M = 500;
/** Evict an active dataset when the camera retreats beyond this many metres from its bbox. */
export const UNLOAD_THRESHOLD_M = 3_000;
/** How often (ms) the proximity sampler fires. */
const SAMPLE_INTERVAL_MS = 500;

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/** Haversine distance in metres between two lon/lat points. */
function haversineM(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * Shortest distance in metres from (lon, lat) to the nearest edge of an
 * axis-aligned bounding box. Returns 0 when the point is inside the bbox.
 *
 * Clamps to bbox in lon/lat space and then applies Haversine — a good-enough
 * approximation for datasets typically < 10° in extent.
 */
function distToBboxM(lon: number, lat: number, bbox: DatasetBbox): number {
  const nearLon = Math.max(bbox.minLon, Math.min(bbox.maxLon, lon));
  const nearLat = Math.max(bbox.minLat, Math.min(bbox.maxLat, lat));
  if (nearLon === lon && nearLat === lat) return 0; // inside the bbox
  return haversineM(lon, lat, nearLon, nearLat);
}

export interface ProximityStreamingOptions {
  /**
   * Map from datasetId to its geographic bounding box.
   * Datasets NOT present in this map (e.g. user uploads without bbox metadata)
   * are activated as soon as a slot is available — they can't do proximity streaming.
   */
  bboxMap: Record<string, DatasetBbox>;
  /**
   * Called when the hook decides to activate a selected dataset.
   * The callback must:
   *   1. Call terrainStore.autoActivate(datasetId) to add it to visibleDatasets.
   *   2. Trigger the network load of the dataset's terrain/overview grids.
   */
  onActivate: (datasetId: string, source: DatasetSource) => void;
}

/**
 * Proximity-based dataset streaming hook.
 *
 * Samples the camera position every 500 ms (from cameraStore, updated by
 * useFlyControls inside the R3F canvas) and compares it against the bounding
 * boxes of all "selected" datasets in terrainStore.
 *
 * Rules (all distances are Haversine metres from camera to nearest bbox edge):
 *
 *   • ACTIVATE — selected-but-not-active dataset is within LOAD_THRESHOLD_M (500 m):
 *     If active slots remain, activate immediately.
 *     If slots are full (MAX_ACTIVE_DATASETS), evict the farthest active dataset
 *     to make room — the candidate is always admitted when inside threshold.
 *
 *   • EVICT — active dataset retreats beyond UNLOAD_THRESHOLD_M (3 000 m):
 *     autoEvict() removes it from visibleDatasets silently (no toast).
 *
 *   • NO BBOX — selected datasets with no bbox entry (typically user uploads)
 *     are treated as "always nearby" and activated as soon as a slot opens up.
 *
 * NOTE: distance tables are computed over the UNION of selectedIds and all
 * currently active visibleDatasets. This ensures datasets that became active
 * via setSinglePrimary or other non-streaming paths are visible to eviction
 * logic — they cannot become pinned and block streaming capacity.
 */
export function useDatasetProximityStreaming({
  bboxMap,
  onActivate,
}: ProximityStreamingOptions): void {
  // Refs let the interval callback always see the latest values without being
  // recreated on every render.
  const bboxMapRef = useRef(bboxMap);
  const onActivateRef = useRef(onActivate);

  useEffect(() => {
    bboxMapRef.current = bboxMap;
  });
  useEffect(() => {
    onActivateRef.current = onActivate;
  });

  useEffect(() => {
    const tick = () => {
      const cam = useCameraStore.getState();
      if (cam.cameraLon === null || cam.cameraLat === null) return;
      const camLon = cam.cameraLon;
      const camLat = cam.cameraLat;

      const { selectedIds, selectedSources, visibleDatasets } =
        useTerrainStore.getState();

      // Build distance tables over the UNION of selected and active datasets.
      // This ensures active-but-not-selected entries (e.g., loaded via
      // setSinglePrimary) are visible to both unload and farthest-evict logic.
      interface DistEntry {
        id: string;
        distM: number;
        isActive: boolean;
        isSelected: boolean;
        source: DatasetSource;
      }
      const withBbox: DistEntry[] = [];
      const withoutBbox: string[] = []; // selected-but-not-active, no bbox

      const allRelevantIds = new Set([
        ...selectedIds,
        ...visibleDatasets.map((v) => v.datasetId),
      ]);

      if (allRelevantIds.size === 0) return;

      for (const id of allRelevantIds) {
        const bbox = bboxMapRef.current[id];
        const isActive = visibleDatasets.some((v) => v.datasetId === id);
        const isSelected = selectedIds.includes(id);
        const source: DatasetSource =
          selectedSources[id] ??
          visibleDatasets.find((v) => v.datasetId === id)?.source ??
          "preset";

        if (!bbox) {
          // No geographic bbox — only queue for activation if selected and inactive.
          if (isSelected && !isActive) withoutBbox.push(id);
          continue;
        }
        withBbox.push({
          id,
          distM: distToBboxM(camLon, camLat, bbox),
          isActive,
          isSelected,
          source,
        });
      }

      // ── Step 1: Evict active datasets that are too far away ───────────────
      // Covers ALL active datasets (selected or not) that have a bbox.
      for (const e of withBbox) {
        if (!e.isActive) continue;
        if (e.distM > UNLOAD_THRESHOLD_M) {
          useTerrainStore.getState().autoEvict(e.id);
        }
      }

      // ── Step 2: Activate nearby selected-but-not-active datasets (with bbox) ─
      // Re-read active list after step-1 evictions.
      const inactiveNearby = withBbox
        .filter((e) => {
          const currentVisible = useTerrainStore.getState().visibleDatasets;
          return e.isSelected && !currentVisible.some((v) => v.datasetId === e.id);
        })
        .filter((e) => e.distM <= LOAD_THRESHOLD_M)
        .sort((a, b) => a.distM - b.distM); // closest first

      for (const candidate of inactiveNearby) {
        const currentVisible = useTerrainStore.getState().visibleDatasets;

        if (currentVisible.length >= MAX_ACTIVE_DATASETS) {
          // Evict the farthest active dataset. Scan ALL active entries in
          // withBbox (including non-selected ones) so pinned datasets don't
          // block streaming capacity.
          const activeWithBbox = withBbox.filter((e) =>
            currentVisible.some((v) => v.datasetId === e.id),
          );
          const farthest = activeWithBbox.sort((a, b) => b.distM - a.distM)[0];
          if (farthest) {
            useTerrainStore.getState().autoEvict(farthest.id);
          } else {
            // All active datasets have no bbox — don't evict them.
            break;
          }
        }

        onActivateRef.current(candidate.id, candidate.source);
      }

      // ── Step 3: Activate no-bbox datasets as soon as a slot is free ──────
      // User uploads have no geographic bbox. They are always considered
      // "nearby" — activate them first-come-first-served whenever slots open.
      for (const id of withoutBbox) {
        const currentVisible = useTerrainStore.getState().visibleDatasets;
        if (currentVisible.some((v) => v.datasetId === id)) continue; // race guard
        if (currentVisible.length >= MAX_ACTIVE_DATASETS) break;
        const source = selectedSources[id] ?? "user";
        onActivateRef.current(id, source as DatasetSource);
      }
    };

    const id = setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []); // intentionally empty — all live reads go through refs or store.getState()
}
