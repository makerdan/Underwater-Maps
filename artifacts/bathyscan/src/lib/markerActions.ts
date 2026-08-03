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
  queryClient: QueryClient;
  mutation: DeleteMarkerMutation;
}

/**
 * Fire the real DELETE /markers/:id mutation and, on success, invalidate all
 * marker list queries so the minimap stays in sync across every loaded dataset.
 * Mirrors the production onClick inside `useFlyControls.buildMarkerMenuItems`.
 */
export function runMarkerDelete({
  marker,
  queryClient,
  mutation,
}: RunMarkerDeleteArgs): void {
  mutation.mutate(
    { id: marker.id },
    {
      onSuccess: () => {
        // Invalidate all marker queries (primary + every secondary dataset) so
        // the minimap reflects the deletion regardless of which dataset this
        // marker belonged to.
        queryClient.invalidateQueries({
          queryKey: getGetMarkersQueryKey(),
        });
      },
    },
  );
}
