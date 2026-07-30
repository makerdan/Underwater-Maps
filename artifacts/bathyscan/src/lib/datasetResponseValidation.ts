/**
 * datasetResponseValidation.ts
 *
 * Pure utilities for validating that a server-returned terrain/overview
 * response actually belongs to the dataset that was requested.
 *
 * A mismatch can happen when:
 *  - A stale React Query cache entry (keyed by a different dataset ID) is
 *    returned before the live fetch completes.
 *  - The server has a bug and returns the wrong payload.
 *
 * Both the primary-dataset loader (pending-pipeline useEffect in DatasetPanel)
 * and the VisibleDatasetsLoader use this to guard their commit paths.
 */

export type DatasetIdMatchResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Validates that the datasetId fields embedded in terrain and overview
 * responses both equal the ID that was requested.
 *
 * @param requestedId  The ID sent in the fetch request (pendingId / datasetId).
 * @param terrain      Terrain response — only its `datasetId` field is read.
 * @param overview     Overview response — only its `datasetId` field is read.
 * @returns `{ ok: true }` on success, or `{ ok: false, message }` on mismatch.
 */
export function checkDatasetIdMatch(
  requestedId: string,
  terrain: { datasetId?: string },
  overview: { datasetId?: string },
): DatasetIdMatchResult {
  const tId = terrain.datasetId;
  const oId = overview.datasetId;

  if (tId !== requestedId) {
    return {
      ok: false,
      message:
        `Server returned terrain for dataset "${tId ?? "(none)"}" ` +
        `but "${requestedId}" was requested`,
    };
  }
  if (oId !== requestedId) {
    return {
      ok: false,
      message:
        `Server returned overview for dataset "${oId ?? "(none)"}" ` +
        `but "${requestedId}" was requested`,
    };
  }
  return { ok: true };
}
