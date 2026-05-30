/**
 * SimulatedDataConfirmDialog — blocking confirmation shown before the viewer
 * switches to a dataset that would resolve to procedurally-generated
 * ("synthetic") bathymetry.
 *
 * The dialog is driven by `simulatedDataStore`. Every dataset-switch entry
 * point in the app goes through `requestDatasetSwitch`, which only opens the
 * dialog when the server preflight reports `synthetic` or `unknown`. The
 * user can choose Cancel (no switch) or Load anyway (proceed; existing HUD
 * "SIMULATED DATA" badge stays visible). A "Don't ask again this session"
 * checkbox suppresses subsequent prompts for the current tab only.
 */
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useSimulatedDataStore } from "@/lib/simulatedDataStore";
import { useToast } from "@/hooks/use-toast";
import { useUiStore } from "@/lib/uiStore";

export const SimulatedDataConfirmDialog: React.FC = () => {
  const pending = useSimulatedDataStore((s) => s.pending);
  const suppressed = useSimulatedDataStore((s) => s.suppressed);
  const setSuppressed = useSimulatedDataStore((s) => s.setSuppressed);
  const { toast } = useToast();
  const setFindDataPanelOpen = useUiStore((s) => s.setFindDataPanelOpen);

  // Close on Escape — treat as Cancel.
  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleCancel();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return null;

  const { datasetName, preview, onConfirm, onCancel } = pending;
  const reason =
    preview.syntheticReason ??
    (preview.dataSource === "synthetic"
      ? "upstream bathymetry services unreachable"
      : "could not verify data source");
  const isUnknown = preview.dataSource === "unknown";
  const bboxLabel =
    preview.bbox.maxLon !== 0 || preview.bbox.minLon !== 0
      ? `${preview.bbox.minLon.toFixed(2)}, ${preview.bbox.minLat.toFixed(2)} → ${preview.bbox.maxLon.toFixed(2)}, ${preview.bbox.maxLat.toFixed(2)}`
      : null;

  function handleCancel() {
    onCancel();
    toast({
      title: "Load cancelled",
      description: "Refine your query and try again.",
    });
    try {
      // Re-open Find Data so the user can restructure the query.
      if (setFindDataPanelOpen) setFindDataPanelOpen(true);
    } catch {
      // ignore — Find Data store optional
    }
  }

  function handleConfirm() {
    onConfirm();
  }

  const body = (
    <div
      data-testid="simulated-data-dialog"
      role="dialog"
      aria-label="Simulated depth data warning"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,8,24,0.7)",
        backdropFilter: "blur(4px)",
        zIndex: 9500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: "#cbd5e1",
        fontSize: 11,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        style={{
          width: 480,
          maxWidth: "92vw",
          maxHeight: "86vh",
          overflow: "auto",
          background: "rgba(2,8,24,0.96)",
          border: "1px solid rgba(245,158,11,0.45)",
          borderRadius: 8,
          boxShadow: "0 12px 48px rgba(0,0,0,0.7)",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid rgba(245,158,11,0.25)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              color: "#f59e0b",
              letterSpacing: "0.18em",
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            ⚠ SIMULATED DEPTH DATA
          </span>
          <button
            onClick={handleCancel}
            aria-label="Cancel"
            data-testid="simulated-data-close"
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 14 }}>
          <p style={{ margin: "0 0 10px", color: "#e2e8f0", lineHeight: 1.5 }}>
            The depth values for this dataset will be{" "}
            <strong style={{ color: "#f59e0b" }}>simulated</strong>, not
            measured. {isUnknown
              ? "The preflight could not confirm a real data source."
              : "Real bathymetry was not available."}
          </p>

          <div
            data-testid="simulated-data-reason"
            style={{
              padding: "8px 10px",
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 4,
              color: "#fbbf24",
              marginBottom: 12,
              fontSize: 10,
              lineHeight: 1.5,
            }}
          >
            Reason: {reason}
          </div>

          <div
            style={{
              padding: "8px 10px",
              background: "rgba(0,229,255,0.04)",
              border: "1px solid rgba(0,229,255,0.15)",
              borderRadius: 4,
              marginBottom: 12,
              fontSize: 10,
              display: "grid",
              gap: 4,
            }}
          >
            <div>
              <span style={{ color: "#cbd5e1" }}>Dataset: </span>
              <span
                style={{ color: "#cbd5e1" }}
                data-testid="simulated-data-dataset"
              >
                {datasetName}
              </span>
            </div>
            {bboxLabel && (
              <div>
                <span style={{ color: "#cbd5e1" }}>BBox: </span>
                <span style={{ color: "#cbd5e1" }}>{bboxLabel}</span>
              </div>
            )}
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 10,
              color: "#e2e8f0",
              marginBottom: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={suppressed}
              onChange={(e) => setSuppressed(e.target.checked)}
              data-testid="simulated-data-suppress"
            />
            Don't ask again this session
          </label>

          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <button
              onClick={handleCancel}
              data-testid="simulated-data-cancel"
              autoFocus
              style={btnStyle("ghost")}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              data-testid="simulated-data-confirm"
              style={btnStyle("warning")}
            >
              Load anyway
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};

function btnStyle(variant: "warning" | "ghost"): React.CSSProperties {
  if (variant === "warning") {
    return {
      padding: "6px 14px",
      background: "rgba(245,158,11,0.15)",
      border: "1px solid rgba(245,158,11,0.5)",
      borderRadius: 3,
      color: "#f59e0b",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 11,
      letterSpacing: "0.1em",
    };
  }
  return {
    padding: "6px 14px",
    background: "transparent",
    border: "1px solid rgba(148,163,184,0.3)",
    borderRadius: 3,
    color: "#e2e8f0",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11,
    letterSpacing: "0.1em",
  };
}
