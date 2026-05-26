/**
 * useUndoableTrailDelete — deferred-DELETE wrapper around `useDeleteTrailsId`
 * that mirrors the marker and folder undo patterns used elsewhere in the app.
 *
 * Calling `requestDelete(id, name)`:
 *   1. Snapshots the current trail-list cache for the active dataset.
 *   2. Optimistically removes the trail from the cache so it disappears
 *      from the TrailListPanel immediately.
 *   3. Pops a 5-second toast with an "Undo" action.
 *   4. After the window elapses, fires the real DELETE and invalidates +
 *      refetches the trail query on success. If the user clicks "Undo",
 *      the timer is cancelled and the snapshot is restored with no DELETE sent.
 *
 * Pending deletes are flushed on unmount so the server always receives the
 * DELETE even if the overview map closes before the window elapses.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDeleteTrailsId,
  getGetTrailsQueryKey,
  type GpsTrail,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

const UNDO_TRAIL_DELETE_MS = 5000;

type PendingEntry = {
  timer: ReturnType<typeof setTimeout>;
  commit: () => void;
};

export function useUndoableTrailDelete(
  datasetId: string,
  refetchTrails: () => unknown,
) {
  const qc = useQueryClient();
  const mutation = useDeleteTrailsId();
  const { toast } = useToast();
  const pendingRef = useRef(new Map<string, PendingEntry>());

  const trailsQueryKey = getGetTrailsQueryKey({ datasetId });

  const requestDelete = useCallback(
    (id: string, name: string) => {
      const snapshot = qc.getQueryData<GpsTrail[]>(trailsQueryKey);

      qc.setQueryData<GpsTrail[] | undefined>(trailsQueryKey, (prev) =>
        prev ? prev.filter((t) => t.id !== id) : prev,
      );

      const commit = () => {
        pendingRef.current.delete(id);
        mutation.mutate(
          { id },
          {
            onSuccess: () => {
              qc.invalidateQueries({ queryKey: trailsQueryKey });
              void refetchTrails();
            },
            onError: () => {
              if (snapshot !== undefined) qc.setQueryData(trailsQueryKey, snapshot);
            },
          },
        );
      };

      const undo = () => {
        const entry = pendingRef.current.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pendingRef.current.delete(id);
        if (snapshot !== undefined) qc.setQueryData(trailsQueryKey, snapshot);
      };

      const timer = setTimeout(commit, UNDO_TRAIL_DELETE_MS);
      pendingRef.current.set(id, {
        timer,
        commit: () => {
          clearTimeout(timer);
          commit();
        },
      });

      const toastHandle = toast({
        title: "Trail deleted",
        description: `"${name}" will be removed.`,
        duration: UNDO_TRAIL_DELETE_MS,
        action: (
          <ToastAction
            altText="Undo delete"
            data-testid="undo-delete-trail"
            onClick={() => {
              undo();
              toastHandle.dismiss();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    // trailsQueryKey is derived from datasetId — include datasetId in deps
    // so the callback is re-created when the active dataset changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, mutation, toast, datasetId, refetchTrails],
  );

  useEffect(() => {
    const map = pendingRef.current;
    return () => {
      const entries = Array.from(map.values());
      map.clear();
      for (const entry of entries) entry.commit();
    };
  }, []);

  return requestDelete;
}
