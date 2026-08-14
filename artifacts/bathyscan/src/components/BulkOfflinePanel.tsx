/**
 * BulkOfflinePanel — modal overlay for bulk "Save All Offline" operations.
 *
 * Design language matches OfflinePackModal (dark #0a1628 background, cyan
 * accent, JetBrains Mono font).
 *
 * Layout:
 *   1. Header with title and close button
 *   2. Pre-flight error / quota warning banners
 *   3. Storage-quota bar
 *   4. Dataset list (checkboxes for force-update, per-row status chips)
 *   5. Start / Cancel / Resume action buttons
 *   6. Collapsible "Saved packs" management section
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useReturnFocus } from "@/hooks/useReturnFocus";
import {
  listOfflinePacks,
  deleteOfflinePack,
  isPackExpired,
  estimatePackStorageBytesFromBbox,
  type OfflinePack,
} from "@/lib/offlinePackStore";
import {
  useBulkOfflinePack,
  type BulkDataset,
  type BulkRow,
  type RowStatus,
} from "@/hooks/useBulkOfflinePack";

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function expiresLabel(iso: string): { text: string; amber: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  const hours = ms / (1000 * 60 * 60);
  if (hours <= 0) return { text: "Expired", amber: true };
  if (hours <= 48) return { text: `~${Math.round(hours)}h remaining`, amber: true };
  const d = new Date(iso);
  return {
    text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    amber: false,
  };
}

// ── Status chip ────────────────────────────────────────────────────────────

const STATUS_ICON: Record<RowStatus, string> = {
  pending: "○",
  skipped: "–",
  saving: "◌",
  done: "✓",
  "done-warning": "⚠",
  error: "✗",
  paused: "❙❙",
};

const STATUS_COLOR: Record<RowStatus, string> = {
  pending: "#475569",
  skipped: "#64748b",
  saving: "#00e5ff",
  done: "#4ade80",
  "done-warning": "#fbbf24",
  error: "#ef4444",
  paused: "#94a3b8",
};

function StatusChip({ status }: { status: RowStatus }) {
  return (
    <span
      style={{
        fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
        color: STATUS_COLOR[status],
        minWidth: 20,
        textAlign: "center",
        display: "inline-block",
        fontFamily: FONT,
      }}
      aria-label={status}
    >
      {STATUS_ICON[status]}
    </span>
  );
}

// ── Progress steps (compact) ───────────────────────────────────────────────

const STEP_LABELS = {
  terrain: "Terrain",
  tide: "Tides",
  weather: "Weather",
  saving: "Storing",
} as const;

function ProgressSteps({ row }: { row: BulkRow }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        marginTop: 3,
        flexWrap: "wrap",
      }}
    >
      {(["terrain", "tide", "weather", "saving"] as const).map((step) => {
        const prog = row.progress.find((p) => p.step === step);
        const isDone = prog?.done === true && !prog.error;
        const isErr = prog?.error;
        const isActive = prog?.done === false;
        return (
          <span
            key={step}
            style={{
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              color: isErr ? "#fca5a5" : isDone ? "#4ade80" : isActive ? "#00e5ff" : "#475569",
            }}
          >
            {isErr ? "✗" : isDone ? "✓" : isActive ? "◌" : "○"} {STEP_LABELS[step]}
          </span>
        );
      })}
    </div>
  );
}

// ── Dataset row ────────────────────────────────────────────────────────────

function DatasetRow({
  row,
  forceUpdate,
  onToggleForce,
  isRunning,
}: {
  row: BulkRow;
  forceUpdate: boolean;
  onToggleForce: () => void;
  isRunning: boolean;
}) {
  const hasExistingValid =
    !!row.existingPack && !isPackExpired(row.existingPack);

  return (
    <div
      style={{
        padding: "7px 10px",
        borderBottom: "1px solid rgba(0,229,255,0.06)",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      {/* Force-update checkbox (only when there is a valid existing pack) */}
      <div style={{ paddingTop: 1, flexShrink: 0 }}>
        {hasExistingValid && !isRunning ? (
          <label
            title="Force re-download even though a valid pack already exists"
            style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={forceUpdate}
              onChange={onToggleForce}
              style={{ accentColor: "#00e5ff" }}
              aria-label={`Force update ${row.dataset.name}`}
            />
          </label>
        ) : (
          <span style={{ width: 18, display: "inline-block" }} />
        )}
      </div>

      {/* Name + progress */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "calc(14px * var(--bs-font-scale, 1))",
            color: row.status === "error" ? "#fca5a5" : "#e2e8f0",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.dataset.name}
        </div>

        {/* Existing pack info */}
        {hasExistingValid && row.status === "pending" && (
          <div
            style={{
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              color: "#64748b",
              marginTop: 1,
            }}
          >
            Saved {formatDate(row.existingPack!.savedAt)} — will be skipped
            {!forceUpdate ? "" : " (force update enabled)"}
          </div>
        )}

        {/* Saving progress */}
        {row.status === "saving" && <ProgressSteps row={row} />}

        {/* Error message */}
        {row.status === "error" && row.error && (
          <div
            style={{
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              color: "#fca5a5",
              marginTop: 2,
            }}
          >
            {row.error}
          </div>
        )}

        {/* Warning on done-warning */}
        {row.status === "done-warning" && row.warning && (
          <div
            style={{
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              color: "#fbbf24",
              marginTop: 2,
            }}
          >
            {row.warning}
          </div>
        )}

        {/* Done — tide expiry */}
        {(row.status === "done" || row.status === "done-warning") && row.pack && (
          <div style={{ marginTop: 2 }}>
            {(() => {
              const lbl = expiresLabel(row.pack.tidePack.tidalExpiresAt);
              return (
                <span
                  style={{
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
                    color: lbl.amber ? "#fbbf24" : "#4ade80",
                  }}
                >
                  Tide valid until: {lbl.text}
                </span>
              );
            })()}
          </div>
        )}
      </div>

      {/* Status icon */}
      <StatusChip status={row.status} />
    </div>
  );
}

// ── Saved-packs management row ─────────────────────────────────────────────

function SavedPackRow({
  pack,
  onDelete,
  deleting,
}: {
  pack: OfflinePack;
  onDelete: () => void;
  deleting: boolean;
}) {
  const lbl = expiresLabel(pack.tidePack.tidalExpiresAt);
  const expired = isPackExpired(pack);
  return (
    <div
      style={{
        padding: "6px 10px",
        borderBottom: "1px solid rgba(0,229,255,0.06)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
            color: "#e2e8f0",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {pack.datasetName}
        </div>
        <div
          style={{
            fontSize: "calc(12px * var(--bs-font-scale, 1))",
            color: "#64748b",
            marginTop: 1,
          }}
        >
          Saved {formatDate(pack.savedAt)} ·{" "}
          {formatBytes(pack.storageBytesEstimate)} ·{" "}
          <span style={{ color: lbl.amber || expired ? "#fbbf24" : "#64748b" }}>
            {expired ? "Expired" : `Tide: ${lbl.text}`}
          </span>
        </div>
      </div>
      <button
        onClick={onDelete}
        disabled={deleting}
        style={{
          background: "none",
          border: "1px solid rgba(239,68,68,0.4)",
          borderRadius: 3,
          color: "#f87171",
          fontSize: "calc(12px * var(--bs-font-scale, 1))",
          padding: "2px 8px",
          cursor: deleting ? "not-allowed" : "pointer",
          opacity: deleting ? 0.5 : 1,
          flexShrink: 0,
        }}
        aria-label={`Delete offline pack for ${pack.datasetName}`}
      >
        Delete
      </button>
    </div>
  );
}

// ── Quota bar ──────────────────────────────────────────────────────────────

function QuotaBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const available = total > used ? total - used : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "calc(12px * var(--bs-font-scale, 1))",
          color: "#64748b",
          marginBottom: 3,
        }}
      >
        <span>{formatBytes(used)} used</span>
        <span>{formatBytes(available)} available</span>
      </div>
      <div
        style={{
          height: 4,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: pct > 80 ? "#f87171" : "#00e5ff",
            borderRadius: 2,
            transition: "width 0.3s",
          }}
        />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  datasets: BulkDataset[];
  onClose: () => void;
}

export const BulkOfflinePanel: React.FC<Props> = ({ datasets, onClose }) => {
  useReturnFocus();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [packsOpen, setPacksOpen] = useState(false);
  const [savedPacks, setSavedPacks] = useState<OfflinePack[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [showPauseCloseConfirm, setShowPauseCloseConfirm] = useState(false);

  const bulk = useBulkOfflinePack(datasets);

  const isRunning = bulk.phase === "running";
  const isPaused = bulk.phase === "paused";
  const isPreflighting = bulk.phase === "preflighting";
  const isIdle =
    bulk.phase === "idle" ||
    bulk.phase === "done" ||
    bulk.phase === "cancelled" ||
    bulk.phase === "preflight-error";

  // ── beforeunload guard while batch is running ─────────────────────────────

  useEffect(() => {
    if (!isRunning) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // returnValue is required for legacy browser support.
      e.returnValue =
        "A save is in progress — leaving will not cancel saved packs but the batch will stop.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isRunning]);

  // ── Escape + focus ────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isRunning) return;
      if (isPaused) {
        setShowPauseCloseConfirm(true);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", handleKey);
    overlayRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, isRunning, isPaused]);

  // ── Load quota on mount ───────────────────────────────────────────────────

  useEffect(() => {
    void bulk.refreshQuota();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount; refreshQuota is a stable useCallback ref
  }, []);

  // ── Load saved packs when management section opens ────────────────────────

  const loadSavedPacks = useCallback(async () => {
    try {
      const packs = await listOfflinePacks();
      setSavedPacks(packs.sort((a, b) => a.datasetName.localeCompare(b.datasetName)));
      setPacksError(null);
    } catch (e) {
      setPacksError(e instanceof Error ? e.message : "Could not load saved packs");
    }
  }, []);

  useEffect(() => {
    if (packsOpen) {
      void loadSavedPacks();
    }
  }, [packsOpen, loadSavedPacks]);

  // Refresh saved packs after a batch completes.
  useEffect(() => {
    if (bulk.phase === "done" && packsOpen) {
      void loadSavedPacks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-runs on phase change; loadSavedPacks and packsOpen are read inside, not reactive triggers
  }, [bulk.phase]);

  // ── Delete pack ───────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await deleteOfflinePack(id);
        await loadSavedPacks();
        await bulk.refreshQuota();
      } catch (e) {
        setPacksError(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setDeletingId(null);
      }
    },
    [loadSavedPacks, bulk],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const noneToSave = datasets.length === 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        fontFamily: FONT,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRunning) onClose();
      }}
    >
      <div
        ref={overlayRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Save all datasets offline"
        style={{
          background: "#0a1628",
          border: "1px solid rgba(0,229,255,0.2)",
          borderRadius: 8,
          width: 500,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100dvh - 48px)",
          overflow: "auto",
          outline: "none",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: "14px 16px 10px",
            borderBottom: "1px solid rgba(0,229,255,0.1)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                letterSpacing: "0.2em",
                color: "#00e5ff",
                textTransform: "uppercase",
                marginBottom: 2,
              }}
            >
              ⬇ SAVE ALL OFFLINE
            </div>
            <div
              style={{
                fontSize: "calc(15px * var(--bs-font-scale, 1))",
                color: "#94a3b8",
              }}
            >
              {datasets.length} dataset{datasets.length !== 1 ? "s" : ""}
            </div>
          </div>
          <button
            onClick={() => {
              if (isRunning) return;
              if (isPaused) { setShowPauseCloseConfirm(true); return; }
              onClose();
            }}
            disabled={isRunning}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              fontSize: "calc(27px * var(--bs-font-scale, 1))",
              cursor: isRunning ? "not-allowed" : "pointer",
              lineHeight: 1,
              padding: "0 2px",
              opacity: isRunning ? 0.4 : 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "12px 16px" }}>
          {/* ── Close-while-paused confirmation ── */}
          {showPauseCloseConfirm && (
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirm close"
              data-testid="pause-close-confirm"
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.4)",
                borderRadius: 5,
                padding: "12px 14px",
                marginBottom: 10,
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                color: "#fca5a5",
              }}
            >
              <div style={{ marginBottom: 8 }}>
                ⚠ The batch is paused. Closing now will discard the paused session — rows that
                have not been saved yet will need to be re-started from scratch.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  data-testid="pause-close-confirm-yes"
                  onClick={onClose}
                  style={{
                    padding: "4px 14px",
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.4)",
                    borderRadius: 3,
                    color: "#f87171",
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
                    cursor: "pointer",
                    fontFamily: FONT,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Close anyway
                </button>
                <button
                  data-testid="pause-close-confirm-cancel"
                  onClick={() => setShowPauseCloseConfirm(false)}
                  style={{
                    padding: "4px 14px",
                    background: "none",
                    border: "1px solid rgba(100,116,139,0.4)",
                    borderRadius: 3,
                    color: "#94a3b8",
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
                    cursor: "pointer",
                    fontFamily: FONT,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Keep open
                </button>
              </div>
            </div>
          )}

          {/* ── Preflighting indicator ── */}
          {isPreflighting && (
            <div
              role="status"
              style={{
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                color: "#94a3b8",
                padding: "8px 0",
                marginBottom: 10,
              }}
            >
              ◌ Checking storage…
            </div>
          )}

          {/* ── Pre-flight error banner ── */}
          {bulk.preflightError && (
            <div
              role="alert"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.4)",
                borderRadius: 5,
                padding: "8px 12px",
                marginBottom: 10,
                fontSize: "calc(14px * var(--bs-font-scale, 1))",
                color: "#fca5a5",
              }}
            >
              ⚠ {bulk.preflightError}
            </div>
          )}

          {/* ── Quota warning banner (advisory) ── */}
          {bulk.quotaWarning && !bulk.preflightError && (
            <div
              role="status"
              style={{
                background: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 5,
                padding: "7px 12px",
                marginBottom: 10,
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                color: "#fbbf24",
              }}
            >
              ⚠ {bulk.quotaWarning}
            </div>
          )}

          {/* ── Network-loss banner (mid-batch pause) ── */}
          {isPaused && (
            <div
              role="alert"
              style={{
                background: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: 5,
                padding: "7px 12px",
                marginBottom: 10,
                fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                color: "#fbbf24",
              }}
            >
              ❙❙ Connection lost — resume when back online
            </div>
          )}

          {/* ── Storage quota bar ── */}
          {bulk.storageQuota && (
            <QuotaBar
              used={bulk.storageQuota.used}
              total={bulk.storageQuota.total}
            />
          )}

          {/* ── Estimated download size for this batch ── */}
          {(() => {
            const datasetsWithBbox = datasets.filter((ds) => ds.bbox);
            if (datasetsWithBbox.length === 0) return null;
            const totalEstBytes = datasetsWithBbox.reduce(
              (sum, ds) =>
                sum + estimatePackStorageBytesFromBbox({ bbox: ds.bbox! }),
              0,
            );
            return (
              <div
                style={{
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  color: "#64748b",
                  marginBottom: 8,
                }}
              >
                ~{formatBytes(totalEstBytes)} estimated for{" "}
                {datasetsWithBbox.length === datasets.length
                  ? "all datasets"
                  : `${datasetsWithBbox.length} of ${datasets.length} datasets`}
              </div>
            );
          })()}

          {/* ── Tide window ── */}
          {isIdle && datasets.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
                    color: "#94a3b8",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  TIDE WINDOW
                </span>
                <span
                  style={{
                    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                    color: "#00e5ff",
                  }}
                >
                  {bulk.days} days
                </span>
              </div>
              <input
                type="range"
                min={3}
                max={14}
                value={bulk.days}
                onChange={(e) => bulk.setDays(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#00e5ff" }}
                aria-label="Days of tide predictions"
              />
            </div>
          )}

          {/* ── No datasets ── */}
          {noneToSave && (
            <div
              style={{
                textAlign: "center",
                padding: "24px 0",
                color: "#475569",
                fontSize: "calc(14px * var(--bs-font-scale, 1))",
              }}
            >
              No uploaded datasets to save offline.
            </div>
          )}

          {/* ── Dataset list ── */}
          {bulk.rows.length > 0 && (
            <div
              style={{
                border: "1px solid rgba(0,229,255,0.12)",
                borderRadius: 6,
                marginBottom: 10,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "rgba(0,229,255,0.04)",
                  padding: "6px 10px",
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.15em",
                  color: "#00e5ff",
                  textTransform: "uppercase",
                  borderBottom: "1px solid rgba(0,229,255,0.1)",
                }}
              >
                DATASETS
                {bulk.phase === "done" && (
                  <span style={{ color: "#4ade80", marginLeft: 8 }}>
                    — complete
                  </span>
                )}
              </div>
              {bulk.rows.map((row) => (
                <DatasetRow
                  key={row.dataset.id}
                  row={row}
                  forceUpdate={bulk.forceUpdateIds.has(row.dataset.id)}
                  onToggleForce={() => bulk.toggleForceUpdate(row.dataset.id)}
                  isRunning={isRunning || isPaused}
                />
              ))}
            </div>
          )}

          {/* ── Dataset list (idle, before run) ── */}
          {bulk.rows.length === 0 && datasets.length > 0 && (
            <div
              style={{
                border: "1px solid rgba(0,229,255,0.12)",
                borderRadius: 6,
                marginBottom: 10,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "rgba(0,229,255,0.04)",
                  padding: "6px 10px",
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.15em",
                  color: "#00e5ff",
                  textTransform: "uppercase",
                  borderBottom: "1px solid rgba(0,229,255,0.1)",
                }}
              >
                DATASETS ({datasets.length})
              </div>
              {datasets.map((ds) => (
                <div
                  key={ds.id}
                  style={{
                    padding: "7px 10px",
                    borderBottom: "1px solid rgba(0,229,255,0.06)",
                    fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                    color: "#94a3b8",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {ds.name}
                </div>
              ))}
            </div>
          )}

          {/* ── Action buttons ── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {isIdle && !noneToSave && (
              <button
                onClick={() => void bulk.start()}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  background: "rgba(0,229,255,0.1)",
                  border: "1px solid rgba(0,229,255,0.35)",
                  borderRadius: 4,
                  color: "#00e5ff",
                  fontSize: "calc(14px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                {bulk.phase === "done"
                  ? "Run Again"
                  : bulk.phase === "cancelled"
                    ? "Restart"
                    : bulk.phase === "preflight-error"
                      ? "Retry"
                      : "Start"}
              </button>
            )}

            {isPaused && (
              <button
                onClick={bulk.resume}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  background: "rgba(0,229,255,0.1)",
                  border: "1px solid rgba(0,229,255,0.35)",
                  borderRadius: 4,
                  color: "#00e5ff",
                  fontSize: "calc(14px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Resume
              </button>
            )}

            {(isRunning || isPaused) && (
              <button
                onClick={bulk.cancel}
                style={{
                  flex: isRunning ? 1 : "0 0 auto",
                  padding: "8px 12px",
                  background: "rgba(239,68,68,0.07)",
                  border: "1px solid rgba(239,68,68,0.35)",
                  borderRadius: 4,
                  color: "#f87171",
                  fontSize: "calc(14px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Cancel
              </button>
            )}
          </div>

          {/* ── Saved Packs management ── */}
          <div
            style={{
              border: "1px solid rgba(0,229,255,0.12)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => setPacksOpen((v) => !v)}
              style={{
                width: "100%",
                background: "rgba(0,229,255,0.04)",
                border: "none",
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
                letterSpacing: "0.15em",
                color: "#00e5ff",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: FONT,
                textAlign: "left",
              }}
              aria-expanded={packsOpen}
            >
              <span>{packsOpen ? "▲" : "▾"}</span>
              <span>MANAGE OFFLINE STORAGE</span>
            </button>

            {packsOpen && (
              <div>
                {packsError && (
                  <div
                    style={{
                      padding: "6px 10px",
                      color: "#fca5a5",
                      fontSize: "calc(13px * var(--bs-font-scale, 1))",
                    }}
                  >
                    ⚠ {packsError}
                  </div>
                )}
                {savedPacks.length === 0 && !packsError && (
                  <div
                    style={{
                      padding: "12px 10px",
                      color: "#475569",
                      fontSize: "calc(13.5px * var(--bs-font-scale, 1))",
                      textAlign: "center",
                    }}
                  >
                    No saved packs
                  </div>
                )}
                {savedPacks.map((pack) => (
                  <SavedPackRow
                    key={pack.id}
                    pack={pack}
                    onDelete={() => void handleDelete(pack.id)}
                    deleting={deletingId === pack.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
