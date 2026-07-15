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
 *      we cancel the timer and re-insert only that specific trail into the
 *      current cache — not the full snapshot — so concurrent pending deletes
 *      are not accidentally reverted.
 *
 * Pending deletes are flushed on unmount AND on page unload (via
 * beforeunload + fetch keepalive) so the server is never left with
 * dangling rows even when the user closes the tab during the undo window.
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
import { authorizedFetch } from "@/lib/authorizedFetch";

const UNDO_TRAIL_DELETE_MS = 5000;

type PendingEntry = {
  trailId: string;
  datasetId: string;
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
      // Snapshot used ONLY for undo-rollback of this specific trail.
      const snapshotAtDelete = qc.getQueryData<GpsTrail[]>(trailsQueryKey);

      qc.setQueryData<GpsTrail[] | undefined>(trailsQueryKey, (prev) =>
        prev ? prev.filter((t) => t.id !== id) : prev,
      );

      // Closure flag — set by undo() to prevent the mutation from firing even
      // if the timer callback was already queued when the user clicked "Undo".
      let aborted = false;

      const commit = () => {
        if (aborted) return;
        pendingRef.current.delete(id);
        mutation.mutate(
          { id },
          {
            onSuccess: () => {
              void qc.invalidateQueries({ queryKey: trailsQueryKey });
              void refetchTrails();
            },
            onError: (err) => {
              const status = (err as { response?: { status?: number } })?.response?.status;
              if (status === 404) {
                // Already deleted elsewhere — inform the user and re-sync.
                toast({
                  title: "Already removed",
                  description: "This trail was already deleted from another session.",
                  duration: 4000,
                });
                void qc.invalidateQueries({ queryKey: trailsQueryKey });
                return;
              }
              if (status === 409) {
                // Conflict — inform the user and re-sync.
                toast({
                  title: "Edit conflict",
                  description: "Changes were not saved due to a conflict — the list has been refreshed.",
                  duration: 4000,
                });
                void qc.invalidateQueries({ queryKey: trailsQueryKey });
                return;
              }
              // Other error — restore only this trail into the current cache so
              // concurrent pending deletes are not accidentally reverted.
              if (snapshotAtDelete !== undefined) {
                const item = snapshotAtDelete.find((t) => t.id === id);
                if (item) {
                  const originalIdx = snapshotAtDelete.findIndex((t) => t.id === id);
                  qc.setQueryData<GpsTrail[]>(trailsQueryKey, (current) => {
                    if (!current) return snapshotAtDelete;
                    const next = [...current];
                    next.splice(Math.min(originalIdx, next.length), 0, item);
                    return next;
                  });
                }
              }
            },
          },
        );
      };

      const undo = () => {
        aborted = true;
        const entry = pendingRef.current.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pendingRef.current.delete(id);
        // Re-insert only this specific trail at its original position so other
        // concurrent pending deletes are not accidentally un-done.
        if (snapshotAtDelete !== undefined) {
          const item = snapshotAtDelete.find((t) => t.id === id);
          if (item) {
            const originalIdx = snapshotAtDelete.findIndex((t) => t.id === id);
            qc.setQueryData<GpsTrail[]>(trailsQueryKey, (current) => {
              if (!current) return snapshotAtDelete;
              const next = [...current];
              next.splice(Math.min(originalIdx, next.length), 0, item);
              return next;
            });
          }
        }
      };

      const timer = setTimeout(commit, UNDO_TRAIL_DELETE_MS);
      pendingRef.current.set(id, {
        trailId: id,
        datasetId,
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

  // Flush pending deletes on unmount (e.g. map closes mid-undo-window).
  useEffect(() => {
    const map = pendingRef.current;
    return () => {
      const entries = Array.from(map.values());
      map.clear();
      for (const entry of entries) entry.commit();
    };
  }, []);

  // Flush pending deletes on page unload using fetch keepalive so the
  // server receives the DELETE even if the browser tab is closed during
  // the 5-second undo window.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const map = pendingRef.current;
      if (map.size === 0) return;
      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      for (const entry of map.values()) {
        // Best-effort: the token lookup is async, so during unload the
        // request may go out cookie-only — the Authorization header is
        // attached whenever the token resolves in time.
        void authorizedFetch(`${apiBase}/api/trails/${encodeURIComponent(entry.trailId)}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined);
      }
      map.clear();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return requestDelete;
}
