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
 *      timer and restore the cache to the snapshot.
 *
 * Pending deletes are flushed on unmount so the server eventually receives
 * the DELETE even if the user navigates away or closes the panel.
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

const UNDO_DELETE_WINDOW_MS = 5000;

type PendingEntry = {
  timer: ReturnType<typeof setTimeout>;
  commit: () => void;
};

export function useUndoableMarkerDelete() {
  const qc = useQueryClient();
  const mutation = useDeleteMarkersId();
  const { toast } = useToast();
  const pendingRef = useRef(new Map<string, PendingEntry>());

  const requestDelete = useCallback(
    (marker: Pick<Marker, "id" | "label">, datasetId: string) => {
      if (!datasetId) return;
      const key = getGetMarkersQueryKey({ datasetId });
      const snapshot = qc.getQueryData<Marker[]>(key);

      qc.setQueryData<Marker[] | undefined>(key, (prev) =>
        prev ? prev.filter((m) => m.id !== marker.id) : prev,
      );

      const undoKey = `${datasetId}:${marker.id}`;

      const commit = () => {
        pendingRef.current.delete(undoKey);
        mutation.mutate(
          { id: marker.id },
          {
            onSuccess: () => {
              void qc.invalidateQueries({ queryKey: key });
            },
            onError: () => {
              // Restore on failure so the user can see (and retry) the
              // marker the server still has.
              if (snapshot !== undefined) qc.setQueryData(key, snapshot);
            },
          },
        );
      };

      const undo = () => {
        const entry = pendingRef.current.get(undoKey);
        if (!entry) return;
        clearTimeout(entry.timer);
        pendingRef.current.delete(undoKey);
        if (snapshot !== undefined) qc.setQueryData(key, snapshot);
      };

      const timer = setTimeout(commit, UNDO_DELETE_WINDOW_MS);
      pendingRef.current.set(undoKey, {
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
