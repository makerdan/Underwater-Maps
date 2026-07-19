/**
 * useUndoableMarkerDelete — deferred-DELETE wrapper around
 * `useDeleteMarkersId` that mirrors the dataset/folder undo pattern in
 * DatasetFolderTree and FindDataPanel.
 *
 * Calling `requestDelete(marker, datasetId)`:
 *   1. Snapshots the current marker-list cache for that dataset.
 *   2. Optimistically removes the marker from the cache so it disappears
 *      from the marker list (DatasetPanel) and from the 3D scene
 *      (MarkerLayer) immediately.
 *   3. Pops a 5-second toast with an "Undo" action.
 *   4. After the window elapses, fires the real DELETE and invalidates the
 *      marker query on success. If the user clicks "Undo", we cancel the
 *      timer and restore only that specific marker into the current cache —
 *      not the full snapshot — so concurrent pending deletes are not
 *      accidentally reverted.
 *
 * Pending deletes are flushed on unmount AND on page unload (via
 * beforeunload + fetch keepalive) so the server is never left with
 * dangling rows even when the user closes the tab during the undo window.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDeleteMarkersId,
  getGetMarkersQueryKey,
  type Marker,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { authorizedFetch } from "@/lib/authorizedFetch";

const UNDO_DELETE_WINDOW_MS = 5000;

type PendingEntry = {
  markerId: string;
  datasetId: string;
  timer: ReturnType<typeof setTimeout>;
  commit: () => void;
};

export function useUndoableMarkerDelete() {
  const qc = useQueryClient();
  const mutation = useDeleteMarkersId();
  const { toast } = useToast();
  const pendingRef = useRef(new Map<string, PendingEntry>());
  /** Marker IDs whose DELETE request is currently in-flight (network). */
  const mutatingRef = useRef(new Set<string>());

  const requestDelete = useCallback(
    (marker: Pick<Marker, "id" | "label">, datasetId: string) => {
      if (!datasetId) return;
      const undoKey = `${datasetId}:${marker.id}`;
      // Guard against double-fire: bail if the same marker is already queued
      // in the undo window or has a network DELETE in-flight.
      if (
        pendingRef.current.has(undoKey) ||
        mutatingRef.current.has(marker.id)
      ) {
        return;
      }
      const key = getGetMarkersQueryKey({ datasetId });

      // Snapshot used ONLY for undo-rollback of this specific marker.
      // We store it so undo can re-insert the item at its original position.
      const snapshotAtDelete = qc.getQueryData<Marker[]>(key);

      qc.setQueryData<Marker[] | undefined>(key, (prev) =>
        prev ? prev.filter((m) => m.id !== marker.id) : prev,
      );

      // Closure flag — set by undo() to prevent the mutation from firing even
      // if the timer callback was already queued when the user clicked "Undo".
      let aborted = false;

      const commit = () => {
        if (aborted) return;
        pendingRef.current.delete(undoKey);
        mutatingRef.current.add(marker.id);
        mutation.mutate(
          { id: marker.id },
          {
            onSuccess: () => {
              mutatingRef.current.delete(marker.id);
              void qc.invalidateQueries({ queryKey: key });
            },
            onError: (err) => {
              mutatingRef.current.delete(marker.id);
              const status = (err as { response?: { status?: number } })?.response?.status;
              if (status === 404) {
                // Already deleted elsewhere — inform the user and re-sync.
                toast({
                  title: "Already removed",
                  description: "This marker was already deleted from another session.",
                  duration: 4000,
                });
                void qc.invalidateQueries({ queryKey: key });
                return;
              }
              if (status === 409) {
                // Conflict (e.g. concurrent edit) — inform the user and re-sync.
                toast({
                  title: "Edit conflict",
                  description: "Changes were not saved due to a conflict — the list has been refreshed.",
                  duration: 4000,
                });
                void qc.invalidateQueries({ queryKey: key });
                return;
              }
              // Other error — restore only this marker into the current cache
              // so concurrent pending deletes are not accidentally reverted.
              if (snapshotAtDelete !== undefined) {
                const item = snapshotAtDelete.find((m) => m.id === marker.id);
                if (item) {
                  const originalIdx = snapshotAtDelete.findIndex((m) => m.id === marker.id);
                  qc.setQueryData<Marker[]>(key, (current) => {
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
        const entry = pendingRef.current.get(undoKey);
        if (!entry) return;
        clearTimeout(entry.timer);
        pendingRef.current.delete(undoKey);
        // Re-insert only this specific marker at its original position so
        // other concurrent pending deletes are not accidentally un-done.
        if (snapshotAtDelete !== undefined) {
          const item = snapshotAtDelete.find((m) => m.id === marker.id);
          if (item) {
            const originalIdx = snapshotAtDelete.findIndex((m) => m.id === marker.id);
            qc.setQueryData<Marker[]>(key, (current) => {
              if (!current) return snapshotAtDelete;
              const next = [...current];
              next.splice(Math.min(originalIdx, next.length), 0, item);
              return next;
            });
          }
        }
      };

      const timer = setTimeout(commit, UNDO_DELETE_WINDOW_MS);
      pendingRef.current.set(undoKey, {
        markerId: marker.id,
        datasetId,
        timer,
        commit: () => {
          clearTimeout(timer);
          commit();
        },
      });

      const label = marker.label ?? "Marker";
      const toastHandle = toast({
        title: "Marker deleted",
        description: `"${label}" will be removed.`,
        duration: UNDO_DELETE_WINDOW_MS,
        action: (
          <ToastAction
            altText="Undo delete"
            data-testid="undo-delete-marker"
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
    [qc, mutation, toast],
  );

  // Flush pending deletes on unmount (e.g. panel closes mid-undo-window).
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
        // fetch with keepalive survives page unload; sendBeacon only supports POST.
        // Best-effort: the token lookup is async, so during unload the request
        // may go out cookie-only if the token doesn't resolve in time.
        void authorizedFetch(`${apiBase}/api/markers/${encodeURIComponent(entry.markerId)}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined);
      }
      map.clear();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const isDeletePending = useCallback(
    (markerId: string, datasetId: string): boolean => {
      const undoKey = `${datasetId}:${markerId}`;
      return pendingRef.current.has(undoKey) || mutatingRef.current.has(markerId);
    },
    [],
  );

  return { requestDelete, isDeletePending };
}
