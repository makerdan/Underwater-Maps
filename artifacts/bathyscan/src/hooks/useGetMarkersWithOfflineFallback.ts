/**
 * useGetMarkersWithOfflineFallback — wraps useGetMarkers with an IndexedDB
 * fallback for the case where the SW cache has been evicted (SW unregistered,
 * browser storage pressure, first-install SW upgrade wipe) but the offline
 * pack record in IDB is still intact.
 *
 * Fallback logic (per dataset slot):
 *   1. useGetMarkers runs normally (SW cache hit → success, no change).
 *   2. A parallel query reads the matching OfflinePack from IDB.
 *   3. If the main query returns undefined (network fail, offline, no SW cache)
 *      AND the IDB query found a pack, return pack.markersPack ?? [].
 *   4. If both have no data (e.g. dataset truly has no saved pack) return undefined.
 *
 * No behaviour change online or when the SW cache succeeds.
 */

import { useQuery } from "@tanstack/react-query";
import {
  useGetMarkers,
  getGetMarkersQueryKey,
  type Marker,
} from "@workspace/api-client-react";
import { getOfflinePackByDatasetId } from "@/lib/offlinePackStore";

/**
 * Drop-in replacement for the fixed-slot useGetMarkers calls inside
 * useAllDatasetMarkers.  Returns `{ data: Marker[] | undefined }` where
 * `data` is:
 *  - the live API result when the query succeeds, or
 *  - the IDB pack's markersPack when the query has no data but a pack exists, or
 *  - undefined when neither source has data.
 *
 * @param datasetId  The dataset id for this slot ("" disables both queries).
 * @param enabled    Whether the main markers query is enabled (mirrors the
 *                   existing `enabled: !!idN && …` guards).
 */
export function useGetMarkersWithOfflineFallback(
  datasetId: string,
  enabled: boolean,
): { data: Marker[] | undefined } {
  const { data: mainData } = useGetMarkers(
    { datasetId },
    { query: { enabled, queryKey: getGetMarkersQueryKey({ datasetId }) } },
  );

  // Always read the IDB pack alongside the live query so the fallback is ready
  // without a second round-trip if the main query fails.  The IDB read is cheap
  // (~1 ms) and avoids a waterfall when the network is already known to be
  // down.  staleTime: Infinity — pack data only changes when the user
  // explicitly saves/deletes a pack, not on network activity.
  const { data: idbFallback } = useQuery({
    queryKey: ["offline-markers-idb-fallback", datasetId],
    queryFn: async (): Promise<Marker[] | null> => {
      if (!datasetId) return null;
      const pack = await getOfflinePackByDatasetId(datasetId);
      // null → no pack saved for this dataset (IDB cannot help)
      // Marker[] (possibly []) → pack exists; use its markers
      return pack ? (pack.markersPack ?? []) : null;
    },
    enabled: !!datasetId && enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    // IDB is always readable; skip the network-mode gate that would pause this
    // query when the React Query defaultOptions networkMode:"offlineFirst" fires.
    networkMode: "always",
  });

  // mainData wins; idbFallback kicks in only when mainData is absent.
  // null idbFallback (no pack saved) collapses to undefined via ?? so the
  // component stays in its "no markers" state rather than showing an empty list
  // that might be confused with a successful empty response.
  const data: Marker[] | undefined = mainData ?? (idbFallback ?? undefined);
  return { data };
}
