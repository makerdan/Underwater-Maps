/**
 * MarkerForm — floating panel for creating or editing a persisted seafloor marker.
 *
 * Create mode: Opened by pressing G or right-clicking the canvas in fly mode.
 *   Pre-fills lon/lat/depth from cameraStore.lastClickedGps.
 *   On submit, calls usePostMarkers and invalidates the markers query.
 *
 * Edit mode: Opened via the right-click "Edit marker" context menu action.
 *   Pre-fills all fields from the existing marker stored in markerEditStore.
 *   On submit, calls usePatchMarkersId and invalidates the markers query.
 */
import React, { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { set as idbSet } from "idb-keyval";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";
import { useAppState } from "@/lib/context";
import { useOfflineStore } from "@/lib/offlineStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { HelpIcon } from "@/components/help/HelpButton";
import { formatDepth } from "@/lib/units";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  usePostMarkers,
  usePatchMarkersId,
  getGetMarkersQueryKey,
  MarkerInputType,
} from "@workspace/api-client-react";
import {
  SALTWATER_MARKER_TYPES,
  FRESHWATER_MARKER_TYPES,
  SALTWATER_CATEGORY_ORDER,
  FRESHWATER_CATEGORY_ORDER,
  MARKER_CATEGORY_LABELS,
  DEPTH_POLE_DEFAULT_COLOUR,
  type MarkerTypeValue,
  type MarkerCategory,
} from "@/lib/markerConstants";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { markerLabelSchema, markerNotesSchema } from "@/lib/markerFormSchema";
import { useMarkerEditStore } from "@/lib/markerEditStore";

const PANEL: React.CSSProperties = {
  background: "rgba(2,8,24,0.92)",
  border: "1px solid rgba(0,229,255,0.25)",
  borderRadius: 8,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#e2e8f0",
  fontSize: 11,
  width: 300,
  backdropFilter: "blur(8px)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
};

export const MarkerForm: React.FC = () => {
  const editMarker = useMarkerEditStore((s) => s.marker);
  const closeEdit = useMarkerEditStore((s) => s.close);
  const requestClose = useMarkerEditStore((s) => s.requestClose);
  const setBeforeClose = useMarkerEditStore((s) => s.setBeforeClose);
  const isEditMode = editMarker !== null;

  const gps = useCameraStore((s) => s.lastClickedGps);
  const setMarkerFormOpen = useUiStore((s) => s.setMarkerFormOpen);
  const units = useSettingsStore((s) => s.units);
  const { terrain } = useAppState();
  const qc = useQueryClient();
  const settingsWaterType = useSettingsStore((s) => s.waterType);
  const waterType = (terrain?.waterType as "saltwater" | "freshwater" | undefined) ?? settingsWaterType;
  const visibleMarkerTypes = waterType === "freshwater" ? FRESHWATER_MARKER_TYPES : SALTWATER_MARKER_TYPES;
  const categoryOrder = waterType === "freshwater" ? FRESHWATER_CATEGORY_ORDER : SALTWATER_CATEGORY_ORDER;
  const pickerRef = useRef<HTMLDivElement>(null);

  const [markerType, setMarkerType] = useState<MarkerTypeValue>(MarkerInputType.custom);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [labelError, setLabelError] = useState("");
  const [notesError, setNotesError] = useState("");
  const [poleColour, setPoleColour] = useState(DEPTH_POLE_DEFAULT_COLOUR);

  // In edit mode: populate from the stored marker.
  // In create mode: reset when GPS changes, honouring one-shot prefill.
  useEffect(() => {
    if (isEditMode && editMarker) {
      setLabel(editMarker.label);
      const existingNotes =
        editMarker.type === "depth_pole"
          ? ""
          : (editMarker.notes ?? "");
      setNotes(existingNotes);
      setLabelError("");
      setNotesError("");
      const candidateType = editMarker.type as MarkerTypeValue | undefined;
      const isValidType =
        candidateType !== undefined &&
        visibleMarkerTypes.some((t) => t.value === candidateType);
      setMarkerType(isValidType ? candidateType! : (MarkerInputType.custom as MarkerTypeValue));
      if (editMarker.type === "depth_pole" && editMarker.notes) {
        try {
          const parsed = JSON.parse(editMarker.notes) as { colour?: string };
          setPoleColour(parsed.colour ?? DEPTH_POLE_DEFAULT_COLOUR);
        } catch {
          setPoleColour(DEPTH_POLE_DEFAULT_COLOUR);
        }
      } else {
        setPoleColour(DEPTH_POLE_DEFAULT_COLOUR);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMarker]);

  useEffect(() => {
    if (isEditMode) return;
    const prefill = useUiStore.getState().markerFormPrefill;
    setLabel(prefill?.label ?? "");
    setNotes("");
    setLabelError("");
    setNotesError("");
    const candidateType = prefill?.type as MarkerTypeValue | undefined;
    const isValidType =
      candidateType !== undefined &&
      visibleMarkerTypes.some((t) => t.value === candidateType);
    setMarkerType(isValidType ? candidateType! : (MarkerInputType.custom as MarkerTypeValue));
    setPoleColour(DEPTH_POLE_DEFAULT_COLOUR);
  }, [gps, visibleMarkerTypes, isEditMode]);

  const postMarkers = usePostMarkers();
  const patchMarker = usePatchMarkersId();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const [savedOffline, setSavedOffline] = useState(false);
  const { toast } = useToast();

  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (offlineTimerRef.current !== null) clearTimeout(offlineTimerRef.current);
    };
  }, []);

  // Stable ref so the guard always reads the latest form state without
  // needing to re-register itself on every keystroke.
  const isDirtyRef = useRef(false);
  useEffect(() => {
    if (!isEditMode || !editMarker) {
      isDirtyRef.current = false;
      return;
    }
    let dirty = label !== editMarker.label || markerType !== editMarker.type;
    if (!dirty) {
      if (markerType === "depth_pole") {
        let savedColour = DEPTH_POLE_DEFAULT_COLOUR;
        if (editMarker.notes) {
          try {
            const parsed = JSON.parse(editMarker.notes) as { colour?: string };
            savedColour = parsed.colour ?? DEPTH_POLE_DEFAULT_COLOUR;
          } catch { /* ignore */ }
        }
        dirty = poleColour !== savedColour;
      } else {
        dirty = notes !== (editMarker.notes ?? "");
      }
    }
    isDirtyRef.current = dirty;
  });

  // Scroll the active category into view when the edit form opens.
  useEffect(() => {
    if (!isEditMode || !editMarker || !pickerRef.current) return;
    const activeType = (visibleMarkerTypes as ReadonlyArray<{ value: string; category: string }>).find(
      (t) => t.value === editMarker.type,
    );
    if (!activeType) return;
    const catEl = pickerRef.current.querySelector<HTMLElement>(
      `[data-category="${activeType.category}"]`,
    );
    if (catEl) {
      catEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMarker]);

  // Always clear the beforeClose guard — dirty-form protection is handled
  // locally via the AlertDialog below so we don't rely on window.confirm.
  useEffect(() => {
    setBeforeClose(null);
    return () => setBeforeClose(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controls the "Discard unsaved changes?" in-app dialog.
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  const handleClose = () => {
    if (isEditMode) {
      if (isDirtyRef.current) {
        setDiscardDialogOpen(true);
        return;
      }
      requestClose();
    } else {
      setMarkerFormOpen(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const labelResult = markerLabelSchema.safeParse(label);
    if (!labelResult.success) {
      setLabelError(labelResult.error.issues[0]?.message ?? "Invalid label");
      return;
    }
    setLabelError("");

    let notesForBody: string | null = null;
    if (markerType === "depth_pole") {
      notesForBody = JSON.stringify({ colour: poleColour });
    } else {
      const notesResult = markerNotesSchema.safeParse(notes);
      if (!notesResult.success) {
        setNotesError(notesResult.error.issues[0]?.message ?? "Invalid notes");
        return;
      }
      setNotesError("");
      notesForBody = notesResult.data.length > 0 ? notesResult.data : null;
    }

    // ── Edit mode ────────────────────────────────────────────────────────────
    if (isEditMode && editMarker) {
      patchMarker.mutate(
        {
          id: editMarker.id,
          data: {
            label: labelResult.data,
            type: markerType as MarkerInputType,
            notes: notesForBody,
          },
        },
        {
          onSuccess: () => {
            void qc.invalidateQueries({
              queryKey: getGetMarkersQueryKey({ datasetId: editMarker.datasetId }),
            });
            closeEdit();
          },
          onError: (err) => {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 404 || status === 409) {
              toast({
                title: "Marker no longer exists",
                description: "This marker was already deleted or modified elsewhere. Refreshing…",
                variant: "destructive",
              });
              void qc.invalidateQueries({
                queryKey: getGetMarkersQueryKey({ datasetId: editMarker.datasetId }),
              });
              closeEdit();
            }
          },
        },
      );
      return;
    }

    // ── Create mode ──────────────────────────────────────────────────────────
    if (!gps || !terrain) return;

    const markerBody = {
      datasetId: terrain.datasetId,
      lon: gps.lon,
      lat: gps.lat,
      depth: gps.depth,
      type: markerType as MarkerInputType,
      label: labelResult.data,
      notes: notesForBody,
    };

    if (!isOnline) {
      const pendingKey = `pending-marker-${crypto.randomUUID()}`;
      void idbSet(pendingKey, markerBody).then(() => {
        setSavedOffline(true);
        offlineTimerRef.current = setTimeout(() => {
          setSavedOffline(false);
          setMarkerFormOpen(false);
        }, 1800);
      });
      return;
    }

    const queueOffline = async () => {
      const pendingKey = `pending-marker-${crypto.randomUUID()}`;
      await idbSet(pendingKey, markerBody);
      // Best-effort Background Sync registration
      if ("serviceWorker" in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          if ("sync" in reg) {
            await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register("sync-markers");
          }
        } catch {
          // Background Sync not supported; online handler will retry
        }
      }
      setSavedOffline(true);
      offlineTimerRef.current = setTimeout(() => {
        setSavedOffline(false);
        setMarkerFormOpen(false);
      }, 1800);
    };

    postMarkers.mutate(
      { data: markerBody },
      {
        onSuccess: () => {
          void qc.invalidateQueries({
            queryKey: getGetMarkersQueryKey({ datasetId: terrain.datasetId }),
          });
          setMarkerFormOpen(false);
        },
        onError: (err) => {
          // Queue to IndexedDB on any network-level failure
          const isNetworkErr =
            err instanceof TypeError ||
            (err instanceof Error && /network|fetch|failed to fetch/i.test(err.message));
          if (isNetworkErr) {
            void queueOffline();
          }
        },
      },
    );
  };

  const handleCancel = handleClose;

  if (!isEditMode && (!gps || !terrain)) return null;

  // ── Discard-changes confirmation dialog ──────────────────────────────────
  const discardDialog = (
    <AlertDialog
      open={discardDialogOpen}
      onOpenChange={(open) => { if (!open) setDiscardDialogOpen(false); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved edits to this marker. Closing now will discard them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDiscardDialogOpen(false)}>
            Keep Editing
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setDiscardDialogOpen(false);
              requestClose();
            }}
          >
            Discard Changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // In edit mode use the stored marker's coordinates; in create mode use GPS.
  const displayGps = isEditMode && editMarker
    ? { lon: editMarker.lon, lat: editMarker.lat, depth: editMarker.depth }
    : gps;

  const selectedType = visibleMarkerTypes.find((t) => t.value === markerType);

  return (
    <>
    {discardDialog}
    <div className="marker-form-panel" style={PANEL}>
      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid rgba(0,229,255,0.12)",
          padding: "10px 14px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.2em",
            color: "#00e5ff",
            textShadow: "0 0 6px rgba(0,229,255,0.5)",
            fontWeight: 700,
          }}
        >
          {isEditMode ? "✏ EDIT MARKER" : "▼ DROP MARKER"}
        </span>
        <HelpIcon articleId="markers" label="Markers" />
        <ViewscreenTooltip label="Close without saving" side="left">
          <button
            onClick={handleCancel}
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              fontSize: 14,
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 2px",
            }}
            aria-label="Cancel"
          >
            ×
          </button>
        </ViewscreenTooltip>
      </div>

      {/* Offline save feedback */}
      {savedOffline && (
        <div
          style={{
            padding: "8px 14px",
            background: "rgba(234,179,8,0.08)",
            borderBottom: "1px solid rgba(234,179,8,0.2)",
            fontSize: 9,
            color: "#fbbf24",
            letterSpacing: "0.12em",
          }}
        >
          ⚡ Saved locally — will sync when online
        </div>
      )}

      {/* Offline notice */}
      {!isOnline && !savedOffline && (
        <div
          style={{
            padding: "5px 14px",
            background: "rgba(239,68,68,0.06)",
            borderBottom: "1px solid rgba(239,68,68,0.15)",
            fontSize: 9,
            color: "#f87171",
            letterSpacing: "0.1em",
          }}
        >
          Offline — marker will be queued for sync
        </div>
      )}

      {/* Coordinates (read-only) */}
      <div
        style={{
          padding: "7px 14px 6px",
          borderBottom: "1px solid rgba(0,229,255,0.08)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
        }}
      >
        {[
          { key: "lon",   val: displayGps ? displayGps.lon.toFixed(4) : "—" },
          { key: "lat",   val: displayGps ? displayGps.lat.toFixed(4) : "—" },
          { key: "depth", val: displayGps ? formatDepth(displayGps.depth, { units }) : "—" },
        ].map(({ key, val }) => (
          <div key={key}>
            <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#64748b", marginBottom: 1 }}>
              {key.toUpperCase()}
            </div>
            <div style={{ fontSize: 10, color: "#cbd5e1" }}>{val}</div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Type selector — categorised scrollable picker */}
        <div style={{ padding: "9px 14px 4px" }}>
          <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#64748b", marginBottom: 5 }}>
            TYPE
          </div>
          <div
            ref={pickerRef}
            style={{
              maxHeight: 140,
              overflowY: "auto",
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(0,229,255,0.2) transparent",
            }}
          >
            {categoryOrder.map((cat) => {
              const typesInCat = (visibleMarkerTypes as ReadonlyArray<{ value: string; label: string; color: string; icon: string; category: MarkerCategory }>).filter((t) => t.category === cat);
              if (typesInCat.length === 0) return null;
              return (
                <div key={cat} data-category={cat}>
                  <div
                    style={{
                      fontSize: 7,
                      letterSpacing: "0.18em",
                      color: "#475569",
                      fontWeight: 700,
                      padding: "5px 0 3px",
                      marginTop: 2,
                      borderTop: "1px solid rgba(0,229,255,0.06)",
                    }}
                  >
                    {MARKER_CATEGORY_LABELS[cat]}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 3 }}>
                    {typesInCat.map((t) => {
                      const active = markerType === t.value;
                      return (
                        <ViewscreenTooltip key={t.value} label={`Mark this point as ${t.label.toLowerCase()}`} side="top">
                          <button
                            type="button"
                            onClick={() => setMarkerType(t.value as MarkerTypeValue)}
                            style={{
                              fontSize: 9,
                              padding: "3px 7px",
                              borderRadius: 3,
                              border: `1px solid ${active ? t.color : "rgba(0,229,255,0.12)"}`,
                              background: active ? `${t.color}18` : "transparent",
                              color: active ? t.color : "#94a3b8",
                              cursor: "pointer",
                              letterSpacing: "0.08em",
                              transition: "all 0.1s",
                              fontFamily: "inherit",
                            }}
                          >
                            {t.icon} {t.label}
                          </button>
                        </ViewscreenTooltip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Label */}
        <div style={{ padding: "8px 14px 4px" }}>
          <label
            style={{ display: "block", fontSize: 8, letterSpacing: "0.12em", color: "#64748b", marginBottom: 4 }}
          >
            LABEL *
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value.slice(0, 60));
              if (e.target.value.trim()) setLabelError("");
            }}
            placeholder="e.g. Large school of rockfish"
            maxLength={60}
            style={{
              width: "100%",
              background: "rgba(0,229,255,0.04)",
              border: `1px solid ${labelError ? "#ef4444" : "rgba(0,229,255,0.15)"}`,
              borderRadius: 3,
              color: "#e2e8f0",
              fontSize: 11,
              padding: "5px 8px",
              fontFamily: "inherit",
              boxSizing: "border-box",
              outline: "none",
            }}
          />
          {labelError && (
            <div style={{ fontSize: 9, color: "#ef4444", marginTop: 3 }}>⚠ {labelError}</div>
          )}
          <div style={{ fontSize: 8, color: "#1e293b", marginTop: 2, textAlign: "right" }}>
            {label.length}/60
          </div>
        </div>

        {/* Depth Pole colour picker (only for depth_pole type) */}
        {markerType === "depth_pole" && (
          <div style={{ padding: "4px 14px 8px" }}>
            <label
              style={{ display: "block", fontSize: 8, letterSpacing: "0.12em", color: "#64748b", marginBottom: 6 }}
            >
              POLE COLOUR
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="color"
                value={poleColour}
                onChange={(e) => setPoleColour(e.target.value)}
                style={{
                  width: 36,
                  height: 28,
                  padding: 0,
                  border: "1px solid rgba(0,229,255,0.25)",
                  borderRadius: 3,
                  cursor: "pointer",
                  background: "none",
                }}
              />
              <span style={{ fontSize: 10, color: "#cbd5e1", fontFamily: "monospace" }}>{poleColour}</span>
            </div>
          </div>
        )}

        {/* Notes (hidden for depth_pole since colour is stored there) */}
        {markerType !== "depth_pole" && (
          <div style={{ padding: "4px 14px 8px" }}>
            <label
              style={{ display: "block", fontSize: 8, letterSpacing: "0.12em", color: "#64748b", marginBottom: 4 }}
            >
              NOTES (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value.slice(0, 280));
                if (notesError) setNotesError("");
              }}
              placeholder="e.g. Good rockfish spot at incoming tide, 18m depth"
              maxLength={280}
              rows={3}
              style={{
                width: "100%",
                background: "rgba(0,229,255,0.04)",
                border: `1px solid ${notesError ? "#ef4444" : "rgba(0,229,255,0.12)"}`,
                borderRadius: 3,
                color: "#e2e8f0",
                fontSize: 11,
                padding: "5px 8px",
                fontFamily: "inherit",
                resize: "none",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            {notesError && (
              <div style={{ fontSize: 9, color: "#ef4444", marginTop: 3 }}>⚠ {notesError}</div>
            )}
            <div style={{ fontSize: 8, color: notes.length >= 250 ? "#f59e0b" : "#475569", textAlign: "right" }}>
              {notes.length}/280
            </div>
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            borderTop: "1px solid rgba(0,229,255,0.08)",
            padding: "8px 14px",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={handleCancel}
            style={{
              fontSize: 9,
              letterSpacing: "0.12em",
              padding: "5px 14px",
              borderRadius: 3,
              border: "1px solid rgba(0,229,255,0.12)",
              background: "transparent",
              color: "#94a3b8",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            CANCEL
          </button>
          <button
            type="submit"
            disabled={postMarkers.isPending || patchMarker.isPending}
            style={{
              fontSize: 9,
              letterSpacing: "0.12em",
              padding: "5px 14px",
              borderRadius: 3,
              border: `1px solid ${selectedType?.color ?? "#00e5ff"}`,
              background: `${selectedType?.color ?? "#00e5ff"}18`,
              color: selectedType?.color ?? "#00e5ff",
              cursor: (postMarkers.isPending || patchMarker.isPending) ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: (postMarkers.isPending || patchMarker.isPending) ? 0.6 : 1,
            }}
          >
            {(postMarkers.isPending || patchMarker.isPending) ? "SAVING..." : isEditMode ? "SAVE CHANGES" : "SAVE MARKER"}
          </button>
        </div>
      </form>
    </div>
    </>
  );
};
