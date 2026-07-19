/**
 * QuickDropButton — floating, thumb-reachable one-tap GPS catch drop.
 *
 * Visible only while GPS tracking is active with a fix and a terrain dataset
 * is loaded. A single tap drops a marker at the current GPS position with no
 * dialog: the server auto-names it "Catch N" (per-user monotonic sequence)
 * and the client attaches a frozen conditions snapshot (GPS quality, terrain
 * depth, cached tide/current/weather from offline packs — never a live
 * fetch). A toast with Undo appears after the drop.
 *
 * Long-press (≥ 500 ms) drops the marker AND opens the marker editor so the
 * angler can immediately tweak notes/type.
 *
 * Offline behaviour: the full body (quickCatch + conditions) is queued in
 * IndexedDB under a `pending-marker-*` key; the server assigns the catch
 * number when the queue flushes on reconnect, so the offline toast promises
 * a sync rather than a number.
 */
import React, { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { set as idbSet } from "idb-keyval";
import {
  usePostMarkers,
  getGetMarkersQueryKey,
  type Marker,
  type MarkerInput,
} from "@workspace/api-client-react";
import { useGpsStore } from "@/lib/gpsStore";
import { useAppState } from "@/lib/context";
import { useOfflineStore } from "@/lib/offlineStore";
import { useMarkerEditStore } from "@/lib/markerEditStore";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { gatherConditionsSnapshot } from "@/lib/quickDrop";
import { useUndoableMarkerDelete } from "@/hooks/useUndoableMarkerDelete";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useUiStore } from "@/lib/uiStore";

const LONG_PRESS_MS = 500;

export const QuickDropButton: React.FC = () => {
  const gpsActive = useGpsStore((s) => s.active);
  // Glove-friendly Live mode: grow the drop button for wet/gloved thumbs.
  const gloveUi = useUiStore((s) => s.sidebarMode) === "live";
  const position = useGpsStore((s) => s.position);
  const { terrain } = useAppState();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const openEditor = useMarkerEditStore((s) => s.open);
  const qc = useQueryClient();
  const { toast } = useToast();
  const postMarkers = usePostMarkers();
  const { requestDelete } = useUndoableMarkerDelete();

  const [busy, setBusy] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  if (!gpsActive || !position || !terrain) return null;

  const drop = async (openAfter: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const conditions = await gatherConditionsSnapshot(position, terrain);
      const body = {
        datasetId: terrain.datasetId,
        lon: position.longitude,
        lat: position.latitude,
        depth: conditions.depthM ?? 0,
        type: "custom",
        // Placeholder — the server overrides with "Catch N" when quickCatch
        // is set (label stays required in the schema).
        label: "Catch",
        quickCatch: true,
        conditions,
      } as MarkerInput;

      const queueOffline = async () => {
        const pendingKey = `pending-marker-${crypto.randomUUID()}`;
        await idbSet(pendingKey, body);
        toast({
          title: "Catch saved offline",
          description: "It will sync and get its catch number when you're back online.",
          duration: 4000,
        });
      };

      if (!isOnline) {
        await queueOffline();
        return;
      }

      await new Promise<void>((resolve) => {
        postMarkers.mutate(
          { data: body },
          {
            onSuccess: (created: Marker) => {
              // Optimistically insert so the marker appears immediately.
              const key = getGetMarkersQueryKey({ datasetId: terrain.datasetId });
              qc.setQueryData<Marker[] | undefined>(key, (prev) =>
                prev ? [...prev, created] : prev,
              );
              void qc.invalidateQueries({ queryKey: key });

              if (openAfter) {
                openEditor(created);
              } else {
                toast({
                  title: `${created.label} dropped`,
                  description: "Marker saved at your GPS position with a conditions snapshot.",
                  duration: 5000,
                  action: (
                    <ToastAction
                      altText="Undo catch drop"
                      data-testid="undo-quick-drop"
                      onClick={() => requestDelete(created, terrain.datasetId)}
                    >
                      Undo
                    </ToastAction>
                  ),
                });
              }
              resolve();
            },
            onError: (err: unknown) => {
              const isNetworkErr =
                err instanceof TypeError ||
                (err instanceof Error && /network|fetch|failed to fetch/i.test(err.message));
              if (isNetworkErr) {
                void queueOffline().finally(resolve);
              } else {
                toast({
                  title: "Couldn't drop catch",
                  description: "The marker was not saved — please try again.",
                  variant: "destructive",
                  duration: 4000,
                });
                resolve();
              }
            },
          },
        );
      });
    } finally {
      setBusy(false);
    }
  };

  const onPointerDown = () => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      void drop(true);
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const onPointerUp = () => {
    cancelLongPress();
    if (!longPressFired.current) void drop(false);
  };

  return (
    <ViewscreenTooltip label="Drop a catch at your GPS position (hold to edit after)" side="left">
      <button
        data-testid="quick-drop-button"
        aria-label="Drop catch marker at current GPS position"
        disabled={busy}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "absolute",
          bottom: 148,
          right: 16,
          zIndex: 32,
          width: gloveUi ? 84 : 64,
          height: gloveUi ? 84 : 64,
          borderRadius: "50%",
          border: "2px solid rgba(0,229,255,0.5)",
          background: busy ? "rgba(2,8,24,0.7)" : "rgba(0,229,255,0.18)",
          color: "#00e5ff",
          fontSize: gloveUi ? 36 : 28,
          cursor: busy ? "wait" : "pointer",
          backdropFilter: "blur(6px)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          touchAction: "manipulation",
          userSelect: "none",
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {busy ? "…" : "🎣"}
      </button>
    </ViewscreenTooltip>
  );
};
