/**
 * Pure helpers backing marker context-menu actions.
 *
 * Factored out of `useFlyControls` so the production delete handler can be
 * exercised end-to-end from Playwright (via `window.__bathyTest`) without
 * needing the WebGL canvas + raycaster pipeline.
 */
import type { QueryClient, UseMutationResult } from "@tanstack/react-query";
import {
  getGetMarkersQueryKey,
  type Marker,
} from "@workspace/api-client-react";

export type DeleteMarkerMutation = Pick<
  UseMutationResult<void, unknown, { id: string }, unknown>,
  "mutate"
>;

export interface RunMarkerDeleteArgs {
  marker: Pick<Marker, "id">;
  /**
   * The dataset whose marker list should be invalidated. Captured at action
   * time by the caller so a mid-flight dataset switch can't redirect the
   * invalidation to the wrong query key.
   */
  datasetId: string;
  queryClient: QueryClient;
  mutation: DeleteMarkerMutation;
}

/**
 * Fire the real DELETE /markers/:id mutation and, on success, invalidate the
 * marker list query for the captured dataset. Mirrors the production onClick
 * inside `useFlyControls.buildMarkerMenuItems`.
 */
export function runMarkerDelete({
  marker,
  datasetId,
  queryClient,
  mutation,
}: RunMarkerDeleteArgs): void {
  mutation.mutate(
    { id: marker.id },
    {
      onSuccess: () => {
        if (datasetId) {
          queryClient.invalidateQueries({
            queryKey: getGetMarkersQueryKey({ datasetId }),
          });
        }
      },
    },
  );
}
