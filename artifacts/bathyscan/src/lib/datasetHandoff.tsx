/**
 * datasetHandoff — out-of-bounds follow-mode dataset suggestion.
 *
 * When GPS follow mode pauses because the boat left the loaded dataset's
 * bounds, this module:
 *
 * 1. Searches the loadable preset dataset list (GET /api/datasets — the only
 *    ids the terrain route accepts) for a dataset covering or near the
 *    current position.  If one is found, a toast offers a one-tap "Load &
 *    follow" handoff; the dataset switch + follow resume is handled by
 *    App.tsx via uiStore.pendingFollowHandoff.
 *
 * 2. When no preset covers the position, searches the discovery catalog
 *    (POST /api/datasets/point-radius-query) for a downloadable bathymetry
 *    survey.  If one is found, a "Download & follow" toast is shown.
 *    Accepting kicks off POST /api/datasets/catalog/:id/save, polls for the
 *    materialization to complete, then hands the newly created
 *    custom-dataset id to App.tsx via the same pendingFollowHandoff channel.
 *
 * 3. If neither search finds anything (or both are offline/error), the plain
 *    "Follow mode paused" toast is shown (previous behaviour).
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
import { authorizedFetch } from "@/lib/authorizedFetch";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Search radius around the out-of-bounds GPS position, in km. */
export const HANDOFF_SEARCH_RADIUS_KM = 25;

/** Mean km per degree of latitude; per degree of longitude at the equator. */
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;

export interface DatasetSuggestion {
  id: string;
  title: string;
}

/** A catalog survey found via the point-radius discovery search. */
export interface CatalogSuggestion {
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
 * back to the catalog search or the plain pause toast.
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

/**
 * Search the BathyScan discovery catalog for a downloadable bathymetry survey
 * covering or near the given position using the point-radius endpoint. Returns
 * null when nothing is found or on any network/server error — callers fall back
 * to the plain pause toast.
 */
export async function findCatalogSurveyForPosition(
  lon: number,
  lat: number,
): Promise<CatalogSuggestion | null> {
  try {
    const res = await fetch(`${API_BASE}/api/datasets/point-radius-query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        lat,
        lon,
        radius: HANDOFF_SEARCH_RADIUS_KM,
        unit: "km",
        dataType: "bathymetry",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      datasets: Array<{ id: string; name: string }>;
    };
    const first = data.datasets[0];
    if (!first) return null;
    return { id: first.id, title: first.name };
  } catch {
    return null;
  }
}

/** How often to poll the save-status endpoint during a catalog import (ms). */
export const CATALOG_POLL_INTERVAL_MS = 3_000;
/** Maximum total time to wait for a catalog import to complete (ms). */
export const CATALOG_POLL_MAX_MS = 5 * 60_000;

/**
 * Initiate a catalog survey download-and-follow handoff:
 *  1. POST /api/datasets/catalog/:id/save — creates the save row and kicks off
 *     background materialization.
 *  2. Poll /api/datasets/my-saves/:id/status every CATALOG_POLL_INTERVAL_MS.
 *  3. When status becomes "ready" — hand the new custom-dataset id to App.tsx
 *     via acceptFollowHandoff so terrain loads and GPS follow resumes.
 *  4. On auth failure, materialization failure, or timeout — show a descriptive
 *     error toast so the user knows what happened.
 */
export async function startCatalogDownloadHandoff(
  catalogId: string,
  title: string,
): Promise<void> {
  const progressHandle = toast({
    title: "Downloading survey…",
    description: `Importing "${title}" — this may take a minute.`,
    duration: CATALOG_POLL_MAX_MS,
  });

  try {
    const saveRes = await authorizedFetch(
      `${API_BASE}/api/datasets/catalog/${encodeURIComponent(catalogId)}/save`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
    );

    if (saveRes.status === 401) {
      progressHandle.dismiss();
      toast({
        title: "Sign in required",
        description: "Sign in to download and import nearby surveys.",
        duration: 6_000,
      });
      return;
    }

    if (!saveRes.ok) {
      progressHandle.dismiss();
      const body = await saveRes.json().catch(() => ({})) as { error?: string };
      toast({
        title: "Survey import failed",
        description:
          body.error ?? "Could not start the download — try again from Find Data.",
        duration: 8_000,
      });
      return;
    }

    const row = await saveRes.json() as {
      id: string;
      status: string;
      datasetId: string | null;
    };

    if (row.status === "ready" && row.datasetId) {
      progressHandle.dismiss();
      acceptFollowHandoff(row.datasetId);
      return;
    }

    const saveId = row.id;
    const deadline = Date.now() + CATALOG_POLL_MAX_MS;

    await new Promise<void>((resolve) => {
      const poll = async (): Promise<void> => {
        if (Date.now() > deadline) {
          progressHandle.dismiss();
          toast({
            title: "Import timed out",
            description: `"${title}" took too long — load it from Find Data when it's ready.`,
            duration: 8_000,
          });
          resolve();
          return;
        }

        try {
          const statusRes = await authorizedFetch(
            `${API_BASE}/api/datasets/my-saves/${encodeURIComponent(saveId)}/status`,
          );
          if (statusRes.ok) {
            const status = await statusRes.json() as {
              status: string;
              datasetId: string | null;
              errorMessage?: string | null;
            };

            if (status.status === "ready" && status.datasetId) {
              progressHandle.dismiss();
              acceptFollowHandoff(status.datasetId);
              resolve();
              return;
            }

            if (status.status === "failed") {
              progressHandle.dismiss();
              toast({
                title: "Survey import failed",
                description:
                  status.errorMessage ??
                  `Could not import "${title}" — try again from Find Data.`,
                duration: 8_000,
              });
              resolve();
              return;
            }
          }
        } catch {
          // Non-fatal poll error — keep trying until deadline.
        }

        setTimeout(() => void poll(), CATALOG_POLL_INTERVAL_MS);
      };

      setTimeout(() => void poll(), CATALOG_POLL_INTERVAL_MS);
    });
  } catch {
    progressHandle.dismiss();
    toast({
      title: "Survey import failed",
      description: "Network error — could not start the download.",
      duration: 6_000,
    });
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
 *
 * Priority:
 *  1. Loadable preset found → "Load & follow" toast (fastest; no import step).
 *  2. Catalog survey found  → "Download & follow" toast (import required).
 *  3. Nothing found         → plain "Follow mode paused" toast.
 */
export async function handleFollowOutOfBounds(
  lon: number,
  lat: number,
): Promise<void> {
  if (searchInFlight) return;
  searchInFlight = true;
  try {
    const suggestion = await findDatasetForPosition(lon, lat);
    if (suggestion) {
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
      return;
    }

    const catalogSurvey = await findCatalogSurveyForPosition(lon, lat);
    if (catalogSurvey) {
      toast({
        title: "Survey available nearby",
        description: `"${catalogSurvey.title}" covers your position — import it to keep following.`,
        duration: 15_000,
        action: (
          <ToastAction
            altText={`Download ${catalogSurvey.title} and keep following`}
            data-testid="follow-handoff-download"
            onClick={() =>
              void startCatalogDownloadHandoff(catalogSurvey.id, catalogSurvey.title)
            }
          >
            Download &amp; follow
          </ToastAction>
        ),
      });
      return;
    }

    showPauseToast();
  } finally {
    searchInFlight = false;
  }
}
