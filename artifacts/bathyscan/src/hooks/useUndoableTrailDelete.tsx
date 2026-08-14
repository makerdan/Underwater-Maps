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
 * Pending deletes are flushed on unmount (timer cancelled, commit called once)
 * AND on page unload via navigator.sendBeacon to a POST soft-delete endpoint,
 * so the server is never left with dangling rows even when the user closes the
 * tab during the 5-second undo window.
 *
 * Bug fixes over the original implementation:
 *  1. commit() is one-shot — a `committed` guard prevents duplicate DELETEs
 *     if the timer fires and then the unmount flush also calls commit().
 *  2. Same-ID replace cancels the prior timer before overwriting the entry
 *     so the first timer can't fire while the second toast is active.
 *  3. beforeunload uses navigator.sendBeacon (POST to /soft-delete) with a
 *     synchronous-XHR fallback instead of an unawaited authorizedFetch; this
 *     survives tab-close without needing an async token lookup.
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
  trailId: string;
  datasetId: string;
  timer: ReturnType<typeof setTimeout>;
  /** Cancels the pending timer and runs commit exactly once. */
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
      // ── Cancel any prior pending delete for the same ID ──────────────────
      // If a second requestDelete arrives for an ID that is already pending,
      // the original timer must be cancelled before we overwrite the entry.
      // Without this, the first timer fires while the second toast is active,
      // deleting the trail while the user still has an "Undo" option showing.
      const existing = pendingRef.current.get(id);
      if (existing) {
        clearTimeout(existing.timer);
        pendingRef.current.delete(id);
      }

      // Snapshot used ONLY for undo-rollback of this specific trail.
      const snapshotAtDelete = qc.getQueryData<GpsTrail[]>(trailsQueryKey);

      qc.setQueryData<GpsTrail[] | undefined>(trailsQueryKey, (prev) =>
        prev ? prev.filter((t) => t.id !== id) : prev,
      );

      // Closure flags:
      //  aborted   — set by undo() to prevent mutation even if the timer
      //              callback was already queued when the user clicked "Undo".
      //  committed — one-shot guard so commit() is idempotent; prevents a
      //              double DELETE when the timer fires and the unmount flush
      //              also tries to call commit().
      let aborted = false;
      let committed = false;

      const commit = () => {
        if (aborted || committed) return;
        committed = true;
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
          // Cancel the pending timer before calling the inner commit so the
          // unmount flush doesn't leave a live timer that fires afterward.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trailsQueryKey is derived from datasetId (already in deps); listing the key itself would cause an extra recreation on every render
    [qc, mutation, toast, datasetId, refetchTrails],
  );

  // Flush pending deletes on unmount (e.g. map closes mid-undo-window).
  // Cancel each timer first so the one-shot `commit` is the only caller.
  useEffect(() => {
    const map = pendingRef.current;
    return () => {
      const entries = Array.from(map.values());
      map.clear();
      for (const entry of entries) {
        // entry.commit() calls clearTimeout internally, then runs the
        // one-shot inner commit. No duplicate DELETE can occur even if the
        // timer already fired, because the `committed` flag guards it.
        entry.commit();
      }
    };
  }, []);

  // Flush pending deletes on page unload using navigator.sendBeacon so the
  // server receives the delete intent even when the tab closes before an
  // async token lookup can complete.
  //
  // sendBeacon sends a POST to /api/trails/:id/soft-delete which the server
  // handles identically to DELETE /api/trails/:id.  Cookies are included
  // automatically by the browser so authentication works without a token.
  //
  // Falls back to a synchronous XHR if sendBeacon is unavailable (rare).
  useEffect(() => {
    const handleBeforeUnload = () => {
      const map = pendingRef.current;
      if (map.size === 0) return;
      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      for (const entry of map.values()) {
        const url = `${apiBase}/api/trails/${encodeURIComponent(entry.trailId)}/soft-delete`;
        if (typeof navigator.sendBeacon === "function") {
          // sendBeacon is non-blocking and survives tab close.
          navigator.sendBeacon(url);
        } else {
          // Synchronous XHR fallback — blocks unload long enough to dispatch.
          try {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", url, false /* synchronous */);
            xhr.send();
          } catch {
            // Nothing we can do during unload; swallow silently.
          }
        }
      }
      map.clear();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return requestDelete;
}
