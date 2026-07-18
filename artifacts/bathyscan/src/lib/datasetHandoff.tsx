/**
 * datasetHandoff — out-of-bounds follow-mode dataset suggestion.
 *
 * When GPS follow mode pauses because the boat left the loaded dataset's
 * bounds, this module searches the loadable preset dataset list (GET
 * /api/datasets — the only ids the terrain route accepts; the discovery
 * catalog's point-radius search returns catalog slugs that are NOT loadable)
 * for a dataset covering or near the current position. If one is found, a
 * toast offers a one-tap "Load & follow" handoff; otherwise the plain
 * "Follow mode paused" toast is shown (previous behaviour).
 *
 * The actual dataset switch + follow resume is performed by App.tsx, which
 * consumes uiStore.pendingFollowHandoff (dataset loading is orchestrated by
 * AppState.datasetId → useActiveDatasetSync, which lives in React land).
 */
import React from "react";
import { getDatasets, type DatasetMeta } from "@workspace/api-client-react";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

/** Search radius around the out-of-bounds GPS position, in km. */
export const HANDOFF_SEARCH_RADIUS_KM = 25;

/** Mean km per degree of latitude; per degree of longitude at the equator. */
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;

export interface DatasetSuggestion {
  id: string;
  title: string;
}

/**
 * Distance (km, approximate) from a point to a dataset's bbox. Zero when the
 * point is inside the bbox. Uses a latitude-corrected equirectangular
 * approximation — plenty for a 25 km "is it nearby" test.
 */
export interface BboxLike {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function isBboxLike(v: unknown): v is BboxLike {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b["minLon"] === "number" &&
    typeof b["minLat"] === "number" &&
    typeof b["maxLon"] === "number" &&
    typeof b["maxLat"] === "number"
  );
}

export function distanceToBboxKm(
  lon: number,
  lat: number,
  bbox: BboxLike,
): number {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const dLatDeg = lat < minLat ? minLat - lat : lat > maxLat ? lat - maxLat : 0;
  const dLonDeg = lon < minLon ? minLon - lon : lon > maxLon ? lon - maxLon : 0;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dxKm = dLonDeg * KM_PER_DEG_LON_EQUATOR * Math.max(cosLat, 0.01);
  const dyKm = dLatDeg * KM_PER_DEG_LAT;
  return Math.hypot(dxKm, dyKm);
}

/**
 * Find a loadable preset dataset covering (or within HANDOFF_SEARCH_RADIUS_KM
 * of) the given position that is not already visible. Returns null when
 * nothing is found or on any error (offline, server down) — callers fall
 * back to the plain pause toast.
 */
export async function findDatasetForPosition(
  lon: number,
  lat: number,
): Promise<DatasetSuggestion | null> {
  try {
    const datasets: DatasetMeta[] = await getDatasets();
    const visible = new Set(
      useTerrainStore.getState().visibleDatasets.map((v) => v.datasetId),
    );
    let best: { d: DatasetMeta; dist: number } | null = null;
    for (const d of datasets) {
      if (!d.id || visible.has(d.id) || !isBboxLike(d.bbox)) continue;
      const dist = distanceToBboxKm(lon, lat, d.bbox);
      if (dist > HANDOFF_SEARCH_RADIUS_KM) continue;
      if (!best || dist < best.dist) best = { d, dist };
    }
    return best ? { id: best.d.id, title: best.d.name ?? best.d.id } : null;
  } catch {
    return null;
  }
}

/** Accept the handoff: hand the dataset id to App.tsx for switch + refollow. */
export function acceptFollowHandoff(datasetId: string): void {
  useUiStore.getState().requestFollowHandoff(datasetId);
}

function showPauseToast(): void {
  toast({
    title: "Follow mode paused",
    description: "GPS position left the dataset — follow mode paused.",
    duration: 4000,
  });
}

let searchInFlight = false;

/** Test-only: reset the in-flight dedupe guard between tests. */
export function __resetHandoffForTests(): void {
  searchInFlight = false;
}

/**
 * Called by useGpsFollowCamera when the GPS position exits every visible
 * dataset's bounds. Runs the suggestion search and shows the appropriate
 * toast. Fire-and-forget; concurrent calls are deduped.
 */
export async function handleFollowOutOfBounds(
  lon: number,
  lat: number,
): Promise<void> {
  if (searchInFlight) return;
  searchInFlight = true;
  try {
    const suggestion = await findDatasetForPosition(lon, lat);
    if (!suggestion) {
      showPauseToast();
      return;
    }
    toast({
      title: "Left dataset area",
      description: `Follow paused — "${suggestion.title}" covers your position.`,
      duration: 12000,
      action: (
        <ToastAction
          altText={`Load ${suggestion.title} and keep following`}
          data-testid="follow-handoff-load"
          onClick={() => acceptFollowHandoff(suggestion.id)}
        >
          Load &amp; follow
        </ToastAction>
      ),
    });
  } finally {
    searchInFlight = false;
  }
}
