/**
 * progressTerrainFetcher — build a TanStack queryFn that streams a terrain or
 * overview payload via fetchJsonWithProgress and pushes byte-level progress
 * into the activeLoadStore.
 *
 * Extracted from DatasetPanel.tsx so the shared proximity-streaming wiring
 * (useProximityStreamingWiring) can reuse it on the mobile chart shell, where
 * DatasetPanel never mounts. Behaviour is unchanged from the original
 * DatasetPanel-local helper.
 */
import type { TerrainData } from "@workspace/api-client-react";
import { fetchJsonWithProgress } from "@/lib/fetchWithProgress";
import { useActiveLoadStore } from "@/lib/activeLoadStore";

/**
 * Build a queryFn that streams the terrain payload via fetchJsonWithProgress
 * and pushes byte-level progress into the activeLoadStore. Used to override
 * the generated TanStack queryFn for the *pending* terrain/overview requests
 * so the DatasetPanel row can render a real loading dial. Only the terrain
 * request reports progress — the (smaller) overview request is silent.
 */
export function makeProgressTerrainFetcher(
  url: string,
  datasetId: string,
  reportProgress: boolean,
) {
  return async ({ signal }: { signal?: AbortSignal }): Promise<TerrainData> => {
    // Auth header is attached automatically by fetchJsonWithProgress.
    return fetchJsonWithProgress<TerrainData>(url, {
      signal,
      onProgress: reportProgress
        ? ({ loaded, total }) => {
            useActiveLoadStore.getState().update(datasetId, loaded, total);
          }
        : undefined,
    });
  };
}
