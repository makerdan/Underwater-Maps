/**
 * ReassignMarkersDialog — modal that lets users reassign existing unassigned
 * markers to a saved dataset without re-importing a file.
 *
 * Flow:
 *   1. Fetches all "ready" saves from the user's catalog.
 *   2. User picks a target dataset via radio buttons.
 *   3. The dialog live-fetches unassigned markers inside that dataset's
 *      coverage bbox and shows the count.
 *   4. On confirm it PATCHes each marker's datasetId in a loop (same pattern
 *      as the GpsImportDialog reassign step).
 *   5. On completion it invalidates the target dataset's markers query key
 *      and the unassigned-markers queries, then fires a toast.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useReturnFocus } from "@/hooks/useReturnFocus";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDatasetsMySaves,
  useGetMarkers,
  usePatchMarkersId,
  getGetMarkersQueryKey,
  getGetDatasetsMySavesQueryKey,
  type UserCatalogSave,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  /** When provided, only shows saves whose coverage bbox overlaps this dataset. */
  filterByDatasetId?: string;
  onClose: () => void;
}

export const ReassignMarkersDialog: React.FC<Props> = ({ onClose }) => {
  useReturnFocus();
  const qc = useQueryClient();
  const { toast } = useToast();
  const patchMarkersId = usePatchMarkersId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const [selectedSave, setSelectedSave] = useState<UserCatalogSave | null>(null);
  const [isReassigning, setIsReassigning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Escape key closes the dialog — suppressed while reassignment is in-flight,
  // mirroring the close-button and backdrop guards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isReassigning) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isReassigning]);

  // Fetch user's saved catalog datasets.
  const { data: mySavesData, isLoading: savesLoading } = useGetDatasetsMySaves(undefined, {
    query: { queryKey: getGetDatasetsMySavesQueryKey(), staleTime: 60_000 },
  });
  const mySaves = (mySavesData ?? []).filter((s) => s.status === "ready");

  // Fetch unassigned markers in the selected dataset's coverage bbox.
  // Custom-dataset-backed saves may have no catalog entry (orphan saves) —
  // fall back to the bbox derived from the dataset's own terrain metadata so
  // unassigned markers in a custom-dataset area are still surfaced.
  const bbox = selectedSave?.catalog?.coverageBbox ?? selectedSave?.terrainBbox ?? null;
  const bboxParams = useMemo(
    () =>
      bbox
        ? {
            minLat: bbox.minLat,
            minLon: bbox.minLon,
            maxLat: bbox.maxLat,
            maxLon: bbox.maxLon,
          }
        : undefined,
    [bbox?.minLat, bbox?.minLon, bbox?.maxLat, bbox?.maxLon], // eslint-disable-line react-hooks/exhaustive-deps -- individual bbox fields used to avoid re-creating params object when bbox reference changes but values are the same
  );

  const { data: unassignedMarkers, isLoading: markersLoading } = useGetMarkers(
    bboxParams,
    {
      query: {
        queryKey: getGetMarkersQueryKey(bboxParams),
        enabled: !!bbox,
      },
    },
  );
  const markerCount = unassignedMarkers?.length ?? 0;

  const doReassign = useCallback(async () => {
    if (!selectedSave?.datasetId || !unassignedMarkers?.length) return;
    setIsReassigning(true);
    setProgress({ done: 0, total: unassignedMarkers.length });

    let ok = 0;
    let fail = 0;
    for (const marker of unassignedMarkers) {
      try {
        await patchMarkersId.mutateAsync({
          id: marker.id,
          data: { datasetId: selectedSave.datasetId },
        });
        ok++;
      } catch {
        // best-effort: continue on individual failures
        fail++;
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }

    // Invalidate the target dataset's markers list.
    void qc.invalidateQueries({
      queryKey: getGetMarkersQueryKey({ datasetId: selectedSave.datasetId }),
    });
    // Invalidate the bbox-based unassigned query.
    if (bboxParams) {
      void qc.invalidateQueries({ queryKey: getGetMarkersQueryKey(bboxParams) });
    }
    // Invalidate generic unassigned query used by MarkersPanel in no-dataset mode.
    void qc.invalidateQueries({ queryKey: getGetMarkersQueryKey({}) });

    setIsReassigning(false);
    setProgress(null);

    const name =
      selectedSave.displayLabel ??
      selectedSave.catalog?.name ??
      selectedSave.catalogId;
    toast({
      title: "Reassignment complete",
      description:
        fail === 0
          ? `${ok} marker${ok === 1 ? "" : "s"} reassigned to "${name}".`
          : `${ok} reassigned, ${fail} failed.`,
      ...(fail > 0 ? { variant: "destructive" as const } : {}),
    });
    onClose();
  }, [
    selectedSave,
    unassignedMarkers,
    patchMarkersId,
    qc,
    bboxParams,
    toast,
    onClose,
  ]);

  const canConfirm =
    !!selectedSave && !markersLoading && markerCount > 0 && !isReassigning;

  const body = (
    <div
      data-testid="reassign-markers-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Reassign unassigned markers to a dataset"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,8,24,0.7)",
        backdropFilter: "blur(4px)",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#cbd5e1",
        fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
      }}
      onClick={(e) => {
        if (!isReassigning && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        style={{
          width: 480,
           maxWidth: "calc(100vw - 16px)",
           maxHeight: "calc(100dvh - 16px)",
          overflow: "auto",
           overscrollBehavior: "contain",
          background: "rgba(2,8,24,0.96)",
          border: "1px solid rgba(0,229,255,0.3)",
          borderRadius: 8,
          boxShadow: "0 12px 48px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid rgba(0,229,255,0.15)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              color: "#00e5ff",
              letterSpacing: "0.18em",
              fontWeight: 700,
              fontSize: "calc(16.5px * var(--bs-font-scale, 1))",
            }}
          >
            ↗ REASSIGN MARKERS
          </span>
          {isReassigning && progress && (
            <span
              data-testid="reassign-markers-progress"
              style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8" }}
            >
              {progress.done} / {progress.total}
            </span>
          )}
          <button
            onClick={isReassigning ? undefined : onClose}
            disabled={isReassigning}
            aria-label="Close reassign markers dialog"
            data-testid="reassign-markers-close-btn"
            style={{
              background: "none",
              border: "none",
              color: isReassigning ? "#334155" : "#94a3b8",
              fontSize: "calc(24px * var(--bs-font-scale, 1))",
              cursor: isReassigning ? "not-allowed" : "pointer",
              opacity: isReassigning ? 0.35 : 1,
              minWidth: 44,
              minHeight: 44,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 14 }}>
          <p style={{ margin: "0 0 14px", color: "#e2e8f0", lineHeight: 1.6 }}>
            Pick a saved dataset below. Any unassigned markers inside that
            dataset's coverage area will be moved to it.
          </p>

          {/* Dataset list */}
          {savesLoading ? (
            <div
              data-testid="reassign-markers-saves-loading"
              style={{ color: "#94a3b8", fontSize: "calc(14px * var(--bs-font-scale, 1))" }}
            >
              Loading your saved datasets…
            </div>
          ) : mySaves.length === 0 ? (
            <div
              data-testid="reassign-markers-no-saves"
              style={{
                color: "#94a3b8",
                fontSize: "calc(14px * var(--bs-font-scale, 1))",
                padding: "10px 0",
              }}
            >
              No saved datasets found. Save a dataset from the Search tab first.
            </div>
          ) : (
            <div
              role="radiogroup"
              aria-label="Select target dataset"
              data-testid="reassign-markers-dataset-list"
            >
              {mySaves.map((save) => {
                const name =
                  save.displayLabel ?? save.catalog?.name ?? save.catalogId;
                return (
                  <label
                    key={save.id}
                    data-testid={`reassign-save-option-${save.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                      cursor: "pointer",
                      fontSize: "calc(14px * var(--bs-font-scale, 1))",
                      color: "#e2e8f0",
                    }}
                  >
                    <input
                      type="radio"
                      name="reassign-save-select"
                      checked={selectedSave?.id === save.id}
                      onChange={() => setSelectedSave(save)}
                      data-testid={`reassign-save-radio-${save.id}`}
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          )}

          {/* Live count of markers that will be reassigned */}
          {selectedSave && (
            <div
              data-testid="reassign-markers-count"
              style={{
                marginTop: 12,
                padding: "8px 10px",
                background: "rgba(0,229,255,0.04)",
                border: "1px solid rgba(0,229,255,0.15)",
                borderRadius: 4,
                fontSize: "calc(14px * var(--bs-font-scale, 1))",
              }}
            >
              {!selectedSave.catalog?.coverageBbox && !selectedSave.terrainBbox ? (
                <span style={{ color: "#fbbf24" }}>
                  This dataset has no coverage area on record — cannot find
                  markers to reassign.
                </span>
              ) : markersLoading ? (
                <span style={{ color: "#94a3b8" }}>
                  Counting unassigned markers in this area…
                </span>
              ) : markerCount === 0 ? (
                <span style={{ color: "#94a3b8" }}>
                  No unassigned markers found in this dataset's area.
                </span>
              ) : (
                <span style={{ color: "#e2e8f0" }}>
                  <strong style={{ color: "#00e5ff" }}>{markerCount}</strong>{" "}
                  unassigned marker{markerCount === 1 ? "" : "s"} in this area
                  will be reassigned to{" "}
                  <strong>
                    {selectedSave.displayLabel ??
                      selectedSave.catalog?.name ??
                      selectedSave.catalogId}
                  </strong>
                  .
                </span>
              )}
            </div>
          )}

          {/* Footer buttons */}
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 20,
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={onClose}
              disabled={isReassigning}
              data-testid="reassign-markers-cancel-btn"
              style={{
                padding: "7px 18px",
                background: "transparent",
                border: "1px solid rgba(148,163,184,0.3)",
                borderRadius: 4,
                color: "#94a3b8",
                cursor: isReassigning ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                fontSize: "calc(14px * var(--bs-font-scale, 1))",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void doReassign()}
              disabled={!canConfirm}
              data-testid="reassign-markers-confirm-btn"
              style={{
                padding: "7px 18px",
                background: canConfirm
                  ? "rgba(0,229,255,0.14)"
                  : "rgba(0,229,255,0.06)",
                border: "1px solid rgba(0,229,255,0.4)",
                borderRadius: 4,
                color: canConfirm ? "#00e5ff" : "#334155",
                cursor: canConfirm ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                fontSize: "calc(14px * var(--bs-font-scale, 1))",
                letterSpacing: "0.08em",
              }}
            >
              {isReassigning ? "Reassigning…" : "Reassign"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};
