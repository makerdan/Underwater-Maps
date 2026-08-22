/**
 * MySavesSection — the unified "My Datasets" tree (catalog saves + uploads).
 *
 * Extracted from FindDataPanel so it can live in the left-side DatasetPanel
 * (Explore > Your Data) and be the single place users manage their saved data.
 *
 * Props:
 *   onLoadCatalogSave   — called when the user clicks "Load" on a catalog save
 *   onLoadUserDataset   — called when the user clicks "Load" on an upload
 *   onDatasetsRemoved   — called after upload dataset(s) are deleted (for
 *                         clearing active-dataset state in DatasetPanel)
 *   onBrowseDatasets    — called when the user clicks the empty-state "Browse" button
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDatasetsMySaves,
  useGetUserDatasets,
  useGetUserFolders,
  useDeleteDatasetsMySavesId,
  usePostDatasetsMySavesIdRetry,
  useDeleteUserDatasetsId,
  usePatchUserDatasetsIdRename,
  usePatchUserDatasetsIdMove,
  usePatchDatasetsMySavesIdRename,
  usePatchDatasetsMySavesIdMove,
  usePostUserFolders,
  usePatchUserFoldersIdRename,
  useDeleteUserFoldersId,
  getGetDatasetsMySavesQueryKey,
  getGetUserDatasetsQueryKey,
  getGetUserFoldersQueryKey,
  type UserCatalogSave,
  type UserDatasetMeta,
  type DatasetFolder,
} from "@workspace/api-client-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useContextMenuStore } from "@/lib/contextMenuStore";
import { useAuth } from "@/lib/clerkCompat";
import { useSettingsStore } from "@/lib/settingsStore";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { buildMergedTree, type MergedFolderNode, type MergedEntry } from "@/lib/datasetLibrary";
import { AddToCollectionDialog, type AddToCollectionTarget } from "@/components/CollectionsSection";
import {
  useOfflinePackStatuses,
  rollupPackStatus,
  type PackStatus,
  type PackRollupStatus,
} from "@/hooks/useOfflinePackStatus";
import { useOfflineScopeStore } from "@/lib/offlineScopeStore";
import { OVERLAY_Z } from "@/lib/overlayScale";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNDO_DELETE_WINDOW_MS = 5_000;

/**
 * True when a mutation error is an ApiError-style 404 — the row is already
 * gone server-side (deleted from another tab/session, or removed by the
 * my-saves cascade delete). Deletes treat this as "already deleted" rather
 * than a hard failure so the list self-heals instead of keeping a ghost row.
 */
function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { status?: unknown }).status === 404
  );
}
const STATUS_COLORS: Record<string, string> = {
  queued: "#f59e0b",
  processing: "#60a5fa",
  ready: "#4ade80",
  failed: "#f87171",
};

const DATA_TYPE_ICONS: Record<string, string> = {
  bathymetry: "🌊",
  substrate: "🪨",
  habitat: "🐟",
  lidar: "📡",
  chart: "🗺️",
  intertidal: "🏖️",
};

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(0,229,255,0.08)",
  borderRadius: 6,
  padding: "10px 12px",
  marginBottom: 8,
};

// ---------------------------------------------------------------------------
// WaterTypeBadge — small FRESH/SALT chip shown on save + upload cards
// ---------------------------------------------------------------------------

const WaterTypeBadge: React.FC<{
  waterType: string | undefined;
  testId: string;
}> = ({ waterType, testId }) => {
  if (waterType !== "saltwater" && waterType !== "freshwater") return null;
  const fresh = waterType === "freshwater";
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: "calc(9.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: fresh ? "#86efac" : "#7dd3fc",
        border: `1px solid ${fresh ? "rgba(74,222,128,0.4)" : "rgba(56,189,248,0.4)"}`,
        borderRadius: 3,
        padding: "0px 5px", flexShrink: 0, lineHeight: 1.6,
      }}
    >
      {fresh ? "🏞 Fresh" : "🌊 Salt"}
    </span>
  );
};

// ---------------------------------------------------------------------------
// OfflineStatusBadge — per-dataset pack indicator (downloaded / stale)
// ---------------------------------------------------------------------------

const OfflineStatusBadge: React.FC<{
  status: PackStatus;
  datasetId: string;
}> = ({ status, datasetId }) => {
  if (status === "none") return null;
  const stale = status === "stale";
  return (
    <span
      data-testid={`offline-status-${datasetId}`}
      title={stale ? "Offline copy saved, but its tide data has expired — re-download to refresh" : "Saved for offline use"}
      style={{
        fontSize: "calc(9.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: stale ? "#fbbf24" : "#4ade80",
        border: `1px solid ${stale ? "rgba(251,191,36,0.4)" : "rgba(74,222,128,0.4)"}`,
        borderRadius: 3,
        padding: "0px 5px", flexShrink: 0, lineHeight: 1.6,
      }}
    >
      {stale ? "⟳ Stale" : "✓ Offline"}
    </span>
  );
};

// Rollup variant for folder / collection rows.
const OfflineRollupBadge: React.FC<{
  rollup: PackRollupStatus;
  testId: string;
}> = ({ rollup, testId }) => {
  if (rollup === "none") return null;
  const color =
    rollup === "downloaded" ? "#4ade80" : rollup === "stale" ? "#fbbf24" : "#94a3b8";
  const border =
    rollup === "downloaded"
      ? "rgba(74,222,128,0.4)"
      : rollup === "stale"
        ? "rgba(251,191,36,0.4)"
        : "rgba(148,163,184,0.4)";
  const label = rollup === "downloaded" ? "✓ Offline" : rollup === "stale" ? "⟳ Stale" : "◐ Partial";
  const title =
    rollup === "downloaded"
      ? "All datasets in here are saved offline"
      : rollup === "stale"
        ? "All datasets in here are saved offline, but some tide data has expired"
        : "Some datasets in here are saved offline";
  return (
    <span
      data-testid={testId}
      title={title}
      style={{
        fontSize: "calc(9.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${border}`,
        borderRadius: 3,
        padding: "0px 5px", flexShrink: 0, lineHeight: 1.6,
      }}
    >
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// SaveCard
// ---------------------------------------------------------------------------

const SaveCard: React.FC<{
  save: UserCatalogSave;
  onLoadUserDataset: (save: UserCatalogSave) => void;
  onRetry: (saveId: string) => void;
  retrying: boolean;
  onDelete: (save: UserCatalogSave) => void;
  deleting: boolean;
  onRename: (saveId: string, displayLabel: string | null) => Promise<void>;
  onAddToView?: (dsId: string) => void;
  atViewCap?: boolean;
  visibleDatasetIds?: Set<string>;
  onOfflineDownload?: (dataset: { id: string; name: string; bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null; resolutionM?: number | null }) => void;
  /** Offline pack status for the materialized dataset ("none" hides the badge). */
  offlineStatus?: PackStatus;
}> = ({ save, onLoadUserDataset, onRetry, retrying, onDelete, deleting, onRename, onAddToView, atViewCap = false, visibleDatasetIds, onOfflineDownload, offlineStatus = "none" }) => {
  const statusColor = STATUS_COLORS[save.status] ?? "#e2e8f0";
  const icon = save.catalog ? (DATA_TYPE_ICONS[save.catalog.dataType] ?? "📦") : "📦";
  const displayName = save.displayLabel ?? save.catalog?.name ?? save.catalogId;

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const startEdit = useCallback(() => {
    setEditValue(displayName);
    setRenameError(null);
    setEditing(true);
  }, [displayName]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setRenameError(null);
  }, []);

  const commitEdit = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed) { setRenameError("Name cannot be empty"); return; }
    if (trimmed === displayName) { setEditing(false); setRenameError(null); return; }
    setRenaming(true);
    try {
      await onRename(save.id, trimmed);
      setEditing(false);
      setRenameError(null);
    } catch (err) {
      setRenameError(err instanceof Error && err.message ? err.message : "Could not rename save");
    } finally {
      setRenaming(false);
    }
  }, [editValue, save.id, displayName, onRename]);

  return (
    <div
      style={{ ...CARD, borderLeft: `2px solid ${statusColor}40`, opacity: deleting ? 0.5 : 1 }}
      data-testid={`save-card-${save.id}`}
      aria-busy={deleting || renaming || undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "calc(18px * var(--bs-font-scale, 1))" }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitEdit();
                if (e.key === "Escape") cancelEdit();
              }}
              disabled={renaming}
              autoFocus
              aria-label={`Rename catalog save ${displayName}`}
              data-testid={`input-rename-save-${save.id}`}
              style={{
                width: "100%", boxSizing: "border-box",
                fontSize: "calc(14px * var(--bs-font-scale, 1))", fontFamily: "inherit",
                color: "#e2e8f0", background: "rgba(0,229,255,0.06)",
                border: "1px solid rgba(0,229,255,0.35)", borderRadius: 3,
                padding: "2px 6px", marginBottom: 1,
              }}
            />
          ) : (
            <div
              title={displayName}
              data-testid={`text-save-name-${save.id}`}
              style={{
                fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#e2e8f0", fontWeight: 600,
                marginBottom: 1, minWidth: 0, overflowWrap: "anywhere",
              }}
            >
              {displayName}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span
              data-testid={`provenance-catalog-${save.id}`}
              style={{
                fontSize: "calc(9.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em",
                textTransform: "uppercase", color: "#67e8f9",
                border: "1px solid rgba(0,229,255,0.35)", borderRadius: 3,
                padding: "0px 5px", flexShrink: 0, lineHeight: 1.6,
              }}
            >
              Catalog
            </span>
            <WaterTypeBadge
              waterType={save.catalog?.waterType}
              testId={`watertype-save-${save.id}`}
            />
            {save.datasetId && (
              <OfflineStatusBadge status={offlineStatus} datasetId={save.datasetId} />
            )}
            <span style={{
              fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {save.displayLabel ? (save.catalog?.name ?? save.catalogId) : (save.catalog?.sourceAgency ?? "—")}
            </span>
          </div>
        </div>
        {save.status !== "ready" && (
          <span style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.1em", textTransform: "uppercase", color: statusColor }}>
            {save.status}
          </span>
        )}
        {!editing && (
          <ViewscreenTooltip label="Rename this saved dataset" side="left">
            <button
              type="button"
              data-testid={`btn-rename-save-${save.id}`}
              aria-label={`Rename catalog save ${displayName}`}
              disabled={deleting}
              onClick={startEdit}
              style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: deleting ? "wait" : "pointer", fontSize: "calc(14px * var(--bs-font-scale, 1))", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
            >✎</button>
          </ViewscreenTooltip>
        )}
        <ViewscreenTooltip label="Delete this saved dataset" side="left">
          <button
            type="button"
            data-testid={`btn-delete-save-${save.id}`}
            aria-label={`Delete saved dataset ${displayName}`}
            disabled={deleting}
            onClick={() => onDelete(save)}
            style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: deleting ? "wait" : "pointer", fontSize: "calc(18px * var(--bs-font-scale, 1))", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
          >×</button>
        </ViewscreenTooltip>
      </div>
      {editing && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button type="button" onClick={() => void commitEdit()} disabled={renaming}
            data-testid={`btn-rename-save-commit-${save.id}`}
            style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))", padding: "2px 10px", background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, color: "#00e5ff", cursor: renaming ? "wait" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
          >{renaming ? "Saving…" : "Save"}</button>
          <button type="button" onClick={cancelEdit} disabled={renaming}
            data-testid={`btn-rename-save-cancel-${save.id}`}
            style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))", padding: "2px 10px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, color: "#e2e8f0", cursor: renaming ? "wait" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
          >Cancel</button>
        </div>
      )}
      {renameError && (
        <ErrorMessage data-testid={`rename-save-error-${save.id}`} message={renameError} style={{ marginTop: 6, fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#fca5a5" }} />
      )}
      {save.status === "ready" && save.datasetId && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", letterSpacing: "0.1em", textTransform: "uppercase", color: statusColor }}>
            {save.status}
          </span>
          <ViewscreenTooltip label="Open this dataset in the viewer" side="top">
            <button
              onClick={() => onLoadUserDataset(save)}
              style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "3px 12px", background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, color: "#00e5ff", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
            >Load into viewer</button>
          </ViewscreenTooltip>
          {onOfflineDownload && (
            <ViewscreenTooltip label="Save this dataset for offline use" side="top">
              <button
                data-testid={`btn-offline-save-${save.id}`}
                onClick={() => onOfflineDownload({
                  id: save.datasetId!,
                  name: save.displayLabel ?? save.catalog?.name ?? save.catalogId,
                  bbox: save.catalog?.coverageBbox ?? null,
                  resolutionM: save.catalog?.resolutionMMin ?? null,
                })}
                aria-label="Save this dataset for offline use"
                style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "3px 6px", background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, color: "#67e8f9", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
              >⬇</button>
            </ViewscreenTooltip>
          )}
          {onAddToView && save.status === "ready" && save.datasetId && (() => {
            const isAlreadyInView = visibleDatasetIds?.has(save.datasetId!) ?? false;
            return (
              <ViewscreenTooltip
                label={isAlreadyInView ? "Remove from 3D view" : atViewCap ? "View limit reached" : "Add alongside current dataset in 3D view"}
                side="top"
              >
                <button
                  onClick={() => onAddToView(save.datasetId!)}
                  data-testid={`btn-add-to-view-save-${save.id}`}
                  disabled={atViewCap && !isAlreadyInView}
                  style={{
                    fontSize: "calc(12px * var(--bs-font-scale, 1))",
                    padding: "3px 10px",
                    background: isAlreadyInView ? "rgba(0,229,255,0.15)" : "rgba(0,229,255,0.06)",
                    border: isAlreadyInView ? "1px solid rgba(0,229,255,0.5)" : "1px solid rgba(0,229,255,0.3)",
                    borderRadius: 3,
                    color: isAlreadyInView ? "#00e5ff" : "#67e8f9",
                    cursor: (atViewCap && !isAlreadyInView) ? "not-allowed" : "pointer",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    opacity: (atViewCap && !isAlreadyInView) ? 0.4 : 1,
                  }}
                >{isAlreadyInView ? "IN VIEW" : "ADD"}</button>
              </ViewscreenTooltip>
            );
          })()}
        </div>
      )}
      {save.status === "failed" && (
        <>
          {save.errorMessage && (
            <ErrorMessage message={save.errorMessage} style={{ marginTop: 6, fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#f87171", lineHeight: 1.4 }} />
          )}
          <ViewscreenTooltip label="Try materializing this dataset again" side="top">
            <button
              onClick={() => !retrying && onRetry(save.id)}
              disabled={retrying}
              data-testid={`save-retry-${save.id}`}
              style={{ marginTop: 8, fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "3px 12px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 3, color: retrying ? "#cbd5e1" : "#f87171", cursor: retrying ? "default" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
            >{retrying ? "Retrying…" : "Retry"}</button>
          </ViewscreenTooltip>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// UploadCard
// ---------------------------------------------------------------------------

const UploadCard: React.FC<{
  dataset: UserDatasetMeta;
  onLoad: (id: string) => void;
  onDelete: (dataset: UserDatasetMeta) => void;
  onRename: (id: string, name: string) => Promise<void>;
  deleting: boolean;
  onAddToView?: (dsId: string) => void;
  isAlreadyInView?: boolean;
  atViewCap?: boolean;
  onOfflineDownload?: (dataset: { id: string; name: string; bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null; resolutionM?: number | null }) => void;
  /** Offline pack status for this upload ("none" hides the badge). */
  offlineStatus?: PackStatus;
}> = ({ dataset, onLoad, onDelete, onRename, deleting, onAddToView, isAlreadyInView = false, atViewCap = false, onOfflineDownload, offlineStatus = "none" }) => {
  const createdDate = useMemo(() => {
    const d = new Date(dataset.createdAt);
    if (Number.isNaN(d.getTime())) return dataset.createdAt.slice(0, 10);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }, [dataset.createdAt]);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const startEdit = useCallback(() => {
    setEditValue(dataset.name); setRenameError(null); setEditing(true);
  }, [dataset.name]);
  const cancelEdit = useCallback(() => { setEditing(false); setRenameError(null); }, []);

  const commitEdit = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed) { setRenameError("Name cannot be empty"); return; }
    if (trimmed === dataset.name) { setEditing(false); setRenameError(null); return; }
    setRenaming(true);
    try {
      await onRename(dataset.id, trimmed);
      setEditing(false); setRenameError(null);
    } catch (err) {
      setRenameError(err instanceof Error && err.message ? err.message : "Could not rename dataset");
    } finally { setRenaming(false); }
  }, [editValue, dataset.id, dataset.name, onRename]);

  return (
    <div
      style={{ ...CARD, borderLeft: "2px solid rgba(167,139,250,0.4)", opacity: deleting ? 0.5 : 1 }}
      data-testid={`upload-card-${dataset.id}`}
      aria-busy={deleting || renaming || undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "calc(18px * var(--bs-font-scale, 1))" }}>📤</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void commitEdit(); if (e.key === "Escape") cancelEdit(); }}
              disabled={renaming}
              autoFocus
              aria-label={`Rename uploaded dataset ${dataset.name}`}
              data-testid={`input-rename-upload-${dataset.id}`}
              style={{ width: "100%", boxSizing: "border-box", fontSize: "calc(14px * var(--bs-font-scale, 1))", fontFamily: "inherit", color: "#e2e8f0", background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.35)", borderRadius: 3, padding: "2px 6px", marginBottom: 1 }}
            />
          ) : (
            <div
              title={dataset.name}
              data-testid={`text-upload-name-${dataset.id}`}
              style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#e2e8f0", fontWeight: 600, marginBottom: 1, minWidth: 0, overflowWrap: "anywhere" }}
            >
              {dataset.name}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span
              data-testid={`provenance-upload-${dataset.id}`}
              style={{ fontSize: "calc(9.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em", textTransform: "uppercase", color: "#c4b5fd", border: "1px solid rgba(167,139,250,0.45)", borderRadius: 3, padding: "0px 5px", flexShrink: 0, lineHeight: 1.6 }}
            >Upload</span>
            <WaterTypeBadge
              waterType={dataset.waterType}
              testId={`watertype-upload-${dataset.id}`}
            />
            <OfflineStatusBadge status={offlineStatus} datasetId={dataset.id} />
            <span style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8" }}>{createdDate}</span>
          </div>
        </div>
        {!editing && (
          <ViewscreenTooltip label="Rename this uploaded dataset" side="left">
            <button
              type="button"
              data-testid={`btn-rename-upload-${dataset.id}`}
              aria-label={`Rename uploaded dataset ${dataset.name}`}
              disabled={deleting}
              onClick={startEdit}
              style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: deleting ? "wait" : "pointer", fontSize: "calc(14px * var(--bs-font-scale, 1))", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
            >✎</button>
          </ViewscreenTooltip>
        )}
        <ViewscreenTooltip label="Delete this uploaded dataset" side="left">
          <button
            type="button"
            data-testid={`btn-delete-upload-${dataset.id}`}
            aria-label={`Delete uploaded dataset ${dataset.name}`}
            disabled={deleting}
            onClick={() => onDelete(dataset)}
            style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: deleting ? "wait" : "pointer", fontSize: "calc(18px * var(--bs-font-scale, 1))", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
          >×</button>
        </ViewscreenTooltip>
      </div>
      {editing && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button type="button" onClick={() => void commitEdit()} disabled={renaming}
            data-testid={`btn-rename-save-${dataset.id}`}
            style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))", padding: "2px 10px", background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, color: "#00e5ff", cursor: renaming ? "wait" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
          >{renaming ? "Saving…" : "Save"}</button>
          <button type="button" onClick={cancelEdit} disabled={renaming}
            data-testid={`btn-rename-cancel-${dataset.id}`}
            style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))", padding: "2px 10px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, color: "#e2e8f0", cursor: renaming ? "wait" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
          >Cancel</button>
        </div>
      )}
      {renameError && (
        <ErrorMessage data-testid={`rename-upload-error-${dataset.id}`} message={renameError} style={{ marginTop: 6, fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#fca5a5" }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <ViewscreenTooltip label="Open this dataset in the viewer" side="top">
          <button
            onClick={() => onLoad(dataset.id)}
            data-testid={`btn-load-upload-${dataset.id}`}
            style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "3px 12px", background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, color: "#00e5ff", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
          >Load</button>
        </ViewscreenTooltip>
        {onOfflineDownload && (
          <ViewscreenTooltip label="Save this dataset for offline use" side="top">
            <button
              data-testid={`btn-offline-upload-${dataset.id}`}
              onClick={() => onOfflineDownload({ id: dataset.id, name: dataset.name, bbox: dataset.bbox ?? null, resolutionM: null })}
              aria-label="Save this dataset for offline use"
              style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "3px 6px", background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, color: "#67e8f9", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
            >⬇</button>
          </ViewscreenTooltip>
        )}
        {onAddToView && (
          <ViewscreenTooltip
            label={isAlreadyInView ? "Remove from 3D view" : atViewCap ? "View limit reached" : "Add alongside current dataset in 3D view"}
            side="top"
          >
            <button
              onClick={() => onAddToView(dataset.id)}
              data-testid={`btn-add-to-view-upload-${dataset.id}`}
              disabled={atViewCap && !isAlreadyInView}
              style={{
                fontSize: "calc(12px * var(--bs-font-scale, 1))",
                padding: "3px 10px",
                background: isAlreadyInView ? "rgba(0,229,255,0.15)" : "rgba(0,229,255,0.06)",
                border: isAlreadyInView ? "1px solid rgba(0,229,255,0.5)" : "1px solid rgba(0,229,255,0.3)",
                borderRadius: 3,
                color: isAlreadyInView ? "#00e5ff" : "#67e8f9",
                cursor: (atViewCap && !isAlreadyInView) ? "not-allowed" : "pointer",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                opacity: (atViewCap && !isAlreadyInView) ? 0.4 : 1,
              }}
            >{isAlreadyInView ? "IN VIEW" : "ADD"}</button>
          </ViewscreenTooltip>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// MoveToFolderDialog
// ---------------------------------------------------------------------------

const MoveToFolderDialog: React.FC<{
  name: string;
  currentFolderId: string | null;
  folders: DatasetFolder[];
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: (folderId: string | null) => void;
}> = ({ name, currentFolderId, folders, isPending = false, onCancel, onConfirm }) => {
  const options = useMemo(() => {
    const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return [{ id: null, name: "📂 Root level" }, ...sorted.map((f) => ({ id: f.id as string | null, name: `📁 ${f.name}` }))];
  }, [folders]);

  const currentIdx = options.findIndex((o) => o.id === currentFolderId);
  const [selectedIdx, setSelectedIdx] = useState(Math.max(currentIdx, 0));
  const selected = options[selectedIdx];
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { listRef.current?.focus(); }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (selected && !isPending) onConfirm(selected.id); }
    else if (e.key === "Escape") { e.preventDefault(); if (!isPending) onCancel(); }
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Move "${name}"`}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
      onClick={isPending ? undefined : onCancel}
      aria-busy={isPending || undefined}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(0,10,20,0.95)", border: "1px solid rgba(0,229,255,0.35)", borderRadius: 6, padding: 18, width: 340, maxWidth: "90vw", color: "#cbd5e1", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "calc(14px * var(--bs-font-scale, 1))" }}>
        <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", fontWeight: 700, marginBottom: 12, letterSpacing: "0.05em" }}>
          Move &quot;{name}&quot;
        </div>
        <div ref={listRef} role="listbox" tabIndex={0} onKeyDown={onKeyDown} style={{ maxHeight: 240, overflowY: "auto", outline: "none", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 4 }}>
          {options.map((opt, idx) => (
            <div
              key={String(opt.id)}
              role="option"
              aria-selected={idx === selectedIdx}
              onClick={() => setSelectedIdx(idx)}
              onDoubleClick={() => { if (!isPending) onConfirm(opt.id); }}
              style={{ padding: "7px 12px", cursor: "pointer", background: idx === selectedIdx ? "rgba(0,229,255,0.12)" : "transparent", color: idx === selectedIdx ? "#00e5ff" : "#cbd5e1", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", opacity: isPending ? 0.6 : 1, borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >{opt.name}</div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={isPending} style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "4px 14px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, color: "#94a3b8", cursor: isPending ? "not-allowed" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>Cancel</button>
          <button onClick={() => selected && onConfirm(selected.id)} disabled={isPending || !selected} style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "4px 14px", background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, color: "#00e5ff", cursor: isPending ? "wait" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {isPending ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DraggableSaveCard
// ---------------------------------------------------------------------------

const DraggableSaveCard: React.FC<{
  save: UserCatalogSave;
  onLoadUserDataset: (save: UserCatalogSave) => void;
  onRetry: (id: string) => void;
  retrying: boolean;
  onDelete: (save: UserCatalogSave) => void;
  deleting: boolean;
  onRename: (id: string, label: string | null) => Promise<void>;
  onMoveTo: (save: UserCatalogSave) => void;
  onAddToView?: (dsId: string) => void;
  atViewCap?: boolean;
  visibleDatasetIds?: Set<string>;
  onOfflineDownload?: (dataset: { id: string; name: string; bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null; resolutionM?: number | null }) => void;
  onAddToCollection?: (save: UserCatalogSave) => void;
  offlineStatus?: PackStatus;
  /** Multi-select: true when this card is checked. */
  isSelected?: boolean;
  /** Multi-select: called with the save id when the checkbox is toggled. */
  onToggleSelect?: (id: string) => void;
}> = ({ save, onLoadUserDataset, onRetry, retrying, onDelete, deleting, onRename, onMoveTo, onAddToView, atViewCap, visibleDatasetIds, onOfflineDownload, onAddToCollection, offlineStatus, isSelected = false, onToggleSelect }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `save-${save.id}`,
    data: { kind: "save", saveId: save.id },
  });
  const displayName = save.displayLabel ?? save.catalog?.name ?? save.catalogId;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
      {onToggleSelect && (
        <button
          data-testid={`select-save-${save.id}`}
          onClick={() => onToggleSelect(save.id)}
          aria-label={isSelected ? `Deselect ${displayName}` : `Select ${displayName}`}
          aria-pressed={isSelected}
          title={isSelected ? "Deselect" : "Select for bulk action"}
          style={{
            flexShrink: 0,
            marginTop: 10,
            width: 18, height: 18,
            background: isSelected ? "rgba(0,229,255,0.15)" : "rgba(0,0,0,0.2)",
            border: `1px solid ${isSelected ? "#00e5ff" : "rgba(0,229,255,0.3)"}`,
            borderRadius: 2,
            color: "#00e5ff",
            fontSize: "calc(11px * var(--bs-font-scale, 1))",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1,
            padding: 0,
          }}
        >
          {isSelected ? "✓" : ""}
        </button>
      )}
      <div ref={setNodeRef} {...attributes} {...listeners} style={{ flex: 1, opacity: isDragging ? 0.4 : 1, position: "relative", cursor: isDragging ? "grabbing" : "grab" }}>
        <button aria-label={`Drag ${displayName} to a folder`} title="Drag to a folder"
          style={{ position: "absolute", top: 6, right: 88, background: "transparent", border: "none", color: "#67e8f9", cursor: "grab", fontSize: "calc(13px * var(--bs-font-scale, 1))", padding: "2px 4px", zIndex: 1, lineHeight: 1, pointerEvents: "none" }}
        >⠿</button>
        <button aria-label={`Move "${displayName}" to folder`} title="Move to folder" onClick={() => onMoveTo(save)}
          style={{ position: "absolute", top: 6, right: 63, background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "2px 4px", zIndex: 1, lineHeight: 1 }}
        >📁</button>
        {onAddToCollection && (
          <button aria-label={`Add "${displayName}" to collection`} title="Add to collection" data-testid={`btn-add-to-collection-save-${save.id}`} onClick={() => onAddToCollection(save)}
            style={{ position: "absolute", top: 6, right: 113, background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "2px 4px", zIndex: 1, lineHeight: 1 }}
          >🗂</button>
        )}
        <SaveCard
          save={save} onLoadUserDataset={onLoadUserDataset} onRetry={onRetry}
          retrying={retrying} onDelete={onDelete} deleting={deleting} onRename={onRename}
          onAddToView={onAddToView} atViewCap={atViewCap} visibleDatasetIds={visibleDatasetIds}
          onOfflineDownload={onOfflineDownload} offlineStatus={offlineStatus}
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DraggableUploadCard
// ---------------------------------------------------------------------------

const DraggableUploadCard: React.FC<{
  dataset: UserDatasetMeta;
  onLoad: (id: string, createdAt?: string | null) => void;
  onDelete: (dataset: UserDatasetMeta) => void;
  onRename: (id: string, name: string) => Promise<void>;
  deleting: boolean;
  onMoveTo: (dataset: UserDatasetMeta) => void;
  onAddToView?: (dsId: string) => void;
  isAlreadyInView?: boolean;
  atViewCap?: boolean;
  onOfflineDownload?: (dataset: { id: string; name: string; bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null; resolutionM?: number | null }) => void;
  onAddToCollection?: (dataset: UserDatasetMeta) => void;
  offlineStatus?: PackStatus;
  /** Multi-select: true when this card is checked. */
  isSelected?: boolean;
  /** Multi-select: called with the dataset id when the checkbox is toggled. */
  onToggleSelect?: (id: string) => void;
}> = ({ dataset, onLoad, onDelete, onRename, deleting, onMoveTo, onAddToView, isAlreadyInView = false, atViewCap = false, onOfflineDownload, onAddToCollection, offlineStatus, isSelected = false, onToggleSelect }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `upload-${dataset.id}`,
    data: { kind: "upload", datasetId: dataset.id },
  });
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
      {onToggleSelect && (
        <button
          data-testid={`select-upload-${dataset.id}`}
          onClick={() => onToggleSelect(dataset.id)}
          aria-label={isSelected ? `Deselect ${dataset.name}` : `Select ${dataset.name}`}
          aria-pressed={isSelected}
          title={isSelected ? "Deselect" : "Select for bulk action"}
          style={{
            flexShrink: 0,
            marginTop: 10,
            width: 18, height: 18,
            background: isSelected ? "rgba(0,229,255,0.15)" : "rgba(0,0,0,0.2)",
            border: `1px solid ${isSelected ? "#00e5ff" : "rgba(0,229,255,0.3)"}`,
            borderRadius: 2,
            color: "#00e5ff",
            fontSize: "calc(11px * var(--bs-font-scale, 1))",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1,
            padding: 0,
          }}
        >
          {isSelected ? "✓" : ""}
        </button>
      )}
      <div ref={setNodeRef} {...attributes} {...listeners} style={{ flex: 1, opacity: isDragging ? 0.4 : 1, position: "relative", cursor: isDragging ? "grabbing" : "grab" }}>
        <button aria-label={`Drag ${dataset.name} to a folder`} title="Drag to a folder"
          style={{ position: "absolute", top: 6, right: 88, background: "transparent", border: "none", color: "#67e8f9", cursor: "grab", fontSize: "calc(13px * var(--bs-font-scale, 1))", padding: "2px 4px", zIndex: 1, lineHeight: 1, pointerEvents: "none" }}
        >⠿</button>
        <button aria-label={`Move "${dataset.name}" to folder`} title="Move to folder" data-testid={`btn-move-upload-${dataset.id}`} onClick={() => onMoveTo(dataset)}
          style={{ position: "absolute", top: 6, right: 63, background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "2px 4px", zIndex: 1, lineHeight: 1 }}
        >📁</button>
        {onAddToCollection && (
          <button aria-label={`Add "${dataset.name}" to collection`} title="Add to collection" data-testid={`btn-add-to-collection-upload-${dataset.id}`} onClick={() => onAddToCollection(dataset)}
            style={{ position: "absolute", top: 6, right: 113, background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "2px 4px", zIndex: 1, lineHeight: 1 }}
          >🗂</button>
        )}
        <UploadCard
          dataset={dataset} onLoad={(id) => onLoad(id, dataset.createdAt)}
          onDelete={onDelete} onRename={onRename} deleting={deleting}
          onAddToView={onAddToView} isAlreadyInView={isAlreadyInView} atViewCap={atViewCap}
          onOfflineDownload={onOfflineDownload} offlineStatus={offlineStatus}
        />
      </div>
    </div>
  );
};

const LibraryRootDropTarget: React.FC = () => {
  const { setNodeRef, isOver } = useDroppable({
    id: "library-root",
    data: { kind: "library-root" },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="library-root-drop-target"
      aria-label="Library root drop target"
      style={{
        marginTop: 8,
        padding: "7px 8px",
        borderRadius: 4,
        border: isOver ? "1px dashed rgba(0,229,255,0.75)" : "1px dashed rgba(100,116,139,0.4)",
        background: isOver ? "rgba(0,229,255,0.12)" : "rgba(15,23,42,0.2)",
        color: isOver ? "#67e8f9" : "#64748b",
        fontSize: "calc(11.5px * var(--bs-font-scale, 1))",
        textAlign: "center",
        transition: "background 0.12s, border 0.12s, color 0.12s",
      }}
    >
      {isOver ? "Release to move to library root" : "Library root — drop here to move out of a folder"}
    </div>
  );
};
const SaveFolderSection: React.FC<{
  node: MergedFolderNode;
  isExpanded: boolean;
  onToggle: () => void;
  renderItem: (item: MergedEntry, depth: number) => React.ReactNode;
  renderSubFolder: (child: MergedFolderNode) => React.ReactNode;
  onShowMenu?: (e: React.MouseEvent, node: MergedFolderNode) => void;
  onNewFolder?: () => void;
  onRenameStart?: () => void;
  onDelete?: (node: MergedFolderNode) => void;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameChange?: (v: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  /** Download this folder's datasets (including subfolders) for offline use. */
  onDownloadOffline?: () => void;
  /** Rollup offline status across the folder subtree ("none" hides the badge). */
  offlineRollup?: PackRollupStatus;
  /** Multi-select: true when this folder is checked. */
  isSelected?: boolean;
  /** Multi-select: called with the folder id when the checkbox is toggled. */
  onToggleSelect?: (id: string) => void;
}> = ({ node, isExpanded, onToggle, renderItem, renderSubFolder, onShowMenu, onNewFolder, onRenameStart, onDelete, isRenaming = false, renameValue = "", onRenameChange, onRenameCommit, onRenameCancel, onDownloadOffline, offlineRollup = "none", isSelected = false, onToggleSelect }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-${node.folder.id}`,
    data: { kind: "folder", folderId: node.folder.id },
  });
  const totalCount = node.items.length + node.children.length;
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (isRenaming) renameInputRef.current?.select(); }, [isRenaming]);

  return (
    <div ref={setNodeRef} style={{ marginLeft: Math.max(0, node.depth - 1) * 14 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 4, cursor: "pointer", background: isOver ? "rgba(0,229,255,0.12)" : "transparent", border: isOver ? "1px dashed rgba(0,229,255,0.65)" : "1px solid transparent", transition: "background 0.12s, border 0.12s", userSelect: "none" }}
        onClick={isRenaming ? undefined : onToggle}
        onContextMenu={onShowMenu ? (e) => onShowMenu(e, node) : undefined}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`Folder: ${node.folder.name}`}
      >
        {onToggleSelect && (
          <button
            data-testid={`select-folder-${node.folder.id}`}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(node.folder.id); }}
            aria-label={isSelected ? `Deselect folder ${node.folder.name}` : `Select folder ${node.folder.name}`}
            aria-pressed={isSelected}
            title={isSelected ? "Deselect folder" : "Select folder for bulk action"}
            style={{
              flexShrink: 0,
              width: 15, height: 15,
              background: isSelected ? "rgba(0,229,255,0.15)" : "rgba(0,0,0,0.2)",
              border: `1px solid ${isSelected ? "#00e5ff" : "rgba(0,229,255,0.3)"}`,
              borderRadius: 2,
              color: "#00e5ff",
              fontSize: "calc(10px * var(--bs-font-scale, 1))",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              lineHeight: 1,
              padding: 0,
            }}
          >
            {isSelected ? "✓" : ""}
          </button>
        )}
        <span style={{ fontSize: "calc(13px * var(--bs-font-scale, 1))", color: "#94a3b8" }}>{isExpanded ? "▾" : "▸"}</span>
        <span style={{ fontSize: "calc(14px * var(--bs-font-scale, 1))" }}>📁</span>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => onRenameChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onRenameCommit?.(); }
              else if (e.key === "Escape") { e.preventDefault(); onRenameCancel?.(); }
            }}
            onBlur={onRenameCancel}
            onClick={(e) => e.stopPropagation()}
            data-testid={`save-folder-rename-input-${node.folder.id}`}
            style={{ flex: 1, fontSize: "calc(13.5px * var(--bs-font-scale, 1))", fontWeight: 600, color: "#e2e8f0", background: "rgba(0,229,255,0.07)", border: "1px solid rgba(0,229,255,0.4)", borderRadius: 3, padding: "1px 5px", outline: "none", fontFamily: "inherit", minWidth: 0 }}
          />
        ) : (
          <span style={{ flex: 1, fontSize: "calc(13.5px * var(--bs-font-scale, 1))", fontWeight: 600, color: "#cbd5e1", overflowWrap: "anywhere" }}>
            {node.folder.name}
          </span>
        )}
        {!isRenaming && (
          <OfflineRollupBadge rollup={offlineRollup} testId={`offline-rollup-folder-${node.folder.id}`} />
        )}
        {!isRenaming && totalCount > 0 && (
          <span style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))", color: "#64748b" }}>{totalCount}</span>
        )}
        {!isRenaming && (
          <>
            {onDownloadOffline && (
              <button
                data-testid={`save-folder-download-${node.folder.id}`}
                onClick={(e) => { e.stopPropagation(); onDownloadOffline(); }}
                title="Download this folder for offline use (includes subfolders)"
                aria-label={`Download folder ${node.folder.name} for offline use`}
                style={{ background: "transparent", border: "none", color: "#67e8f9", cursor: "pointer", fontSize: "calc(14px * var(--bs-font-scale, 1))", padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
              >⬇</button>
            )}
            {onNewFolder && (
              <button
                data-testid={`save-folder-new-subfolder-${node.folder.id}`}
                onClick={(e) => { e.stopPropagation(); onNewFolder(); }}
                title="New folder inside"
                style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: "calc(14px * var(--bs-font-scale, 1))", padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
              >⊕</button>
            )}
            {onRenameStart && (
              <button
                data-testid={`save-folder-rename-${node.folder.id}`}
                onClick={(e) => { e.stopPropagation(); onRenameStart(); }}
                title="Rename folder"
                style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: "calc(14px * var(--bs-font-scale, 1))", padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
              >✎</button>
            )}
            {onDelete && (
              <button
                data-testid={`save-folder-delete-${node.folder.id}`}
                onClick={(e) => { e.stopPropagation(); onDelete(node); }}
                title="Delete folder"
                style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: "calc(14px * var(--bs-font-scale, 1))", padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
              >×</button>
            )}
          </>
        )}
      </div>
      {isExpanded && (
        <div style={{ marginLeft: 14 }} data-testid={`save-folder-contents-${node.folder.id}`}>
          {node.children.map((child) => renderSubFolder(child))}
            {node.items.map((item) => renderItem(item, node.depth))}
          {node.children.length === 0 && node.items.length === 0 && (
            <div style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#475569", padding: "4px 8px" }}>
              No datasets in this folder
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// MySavesSection — main export
// ---------------------------------------------------------------------------

export interface MySavesSectionProps {
  /** Called when the user clicks "Load" on a ready catalog save. */
  onLoadCatalogSave: (save: UserCatalogSave) => void;
  /** Called when the user clicks "Load" on an uploaded dataset. */
  onLoadUserDataset: (id: string, createdAt?: string | null) => void;
  /**
   * Called after an upload dataset is permanently deleted so the parent can
   * clean up active-dataset state (clear terrain, cancel in-flight loads).
   */
  onDatasetsRemoved?: (ids: string[]) => void;
  /** Called when the user clicks the empty-state browse button. */
  onBrowseDatasets?: () => void;
  /**
   * Label for the empty-state browse button.
   * Defaults to "BROWSE DATASETS →".
   * Override in DatasetPanel context where clicking opens the Find Data panel
   * rather than switching a tab within the same panel.
   */
  browseLabel?: string;
  /**
   * Called when the user clicks "ADD" on an uploaded dataset row to add it to
   * the current 3D view alongside the primary dataset. When undefined the ADD
   * button is not rendered on any row.
   */
  onAddToView?: (dsId: string) => void;
  /** Dataset IDs currently visible (active) in the 3D scene. */
  visibleDatasetIds?: Set<string>;
  /** True when MAX_ACTIVE_DATASETS cap is reached (disables ADD for non-active rows). */
  atViewCap?: boolean;
  /**
   * Called when the user clicks "⬇ Offline" on a SaveCard (ready catalog save) or
   * an UploadCard. Opens OfflinePackModal for the selected dataset.
   * When undefined the offline button is not rendered on any row.
   */
  onOfflineDownload?: (dataset: { id: string; name: string; bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null; resolutionM?: number | null }) => void;
}

export const MySavesSection: React.FC<MySavesSectionProps> = ({
  onLoadCatalogSave,
  onLoadUserDataset,
  onDatasetsRemoved,
  onBrowseDatasets,
  browseLabel = "BROWSE DATASETS →",
  onAddToView,
  visibleDatasetIds,
  atViewCap = false,
  onOfflineDownload,
}) => {
  const { isSignedIn, isLoaded } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const waterType = useSettingsStore((s) => s.waterType);
  // Live offline-pack statuses (per materialized dataset id); refreshes on
  // pack save/delete via the offlinePackStore listener registry.
  const packStatuses = useOfflinePackStatuses();

  // ── Queries ──────────────────────────────────────────────────────────────
  // The active SALT/FRESH mode is passed to the server so only matching saves
  // return (orphan saves — no catalog entry — always pass). waterType is part
  // of the query key, so toggling the mode fetches from a separate cache slot.
  const {
    data: mySaves = [],
    refetch: refetchSaves,
    isPending: isSavePending,
  } = useGetDatasetsMySaves({ waterType }, {
    query: {
      queryKey: getGetDatasetsMySavesQueryKey({ waterType }),
      enabled: isLoaded && isSignedIn === true,
      refetchInterval: (q) => {
        const data = q.state.data as UserCatalogSave[] | undefined;
        if (!data) return false;
        return data.some((s) => s.status === "queued" || s.status === "processing") ? 2_000 : false;
      },
    },
  });

  const { data: userDatasets = [], isPending: isUploadPending } = useGetUserDatasets({
    query: { queryKey: getGetUserDatasetsQueryKey(), enabled: isLoaded && isSignedIn === true },
  });

  const { data: userFolders = [] } = useGetUserFolders({
    query: { enabled: isLoaded && isSignedIn === true, queryKey: getGetUserFoldersQueryKey() },
  });

  // Invalidate userDatasets list when a catalog save transitions to "ready"
  // (its backing custom_datasets row becomes available).
  const readyDatasetIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isSignedIn) return;
    let anyNew = false;
    for (const save of mySaves) {
      if (save.status === "ready" && save.datasetId) {
        if (!readyDatasetIdsRef.current.has(save.datasetId)) {
          readyDatasetIdsRef.current.add(save.datasetId);
          anyNew = true;
        }
      }
    }
    if (anyNew) void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
  }, [mySaves, qc, isSignedIn]);

  // Dataset IDs already represented as catalog saves — exclude from uploads section.
  const catalogSaveDatasetIds = useMemo(
    () => new Set(mySaves.map((s) => s.datasetId).filter(Boolean) as string[]),
    [mySaves],
  );
  // Upload-only datasets are filtered by the active water mode client-side.
  // Rows with no waterType (older responses / missing grids) stay visible in
  // both modes — never silently hide a dataset we can't classify.
  const uploadOnlyDatasets = useMemo(
    () =>
      userDatasets.filter(
        (d) =>
          !catalogSaveDatasetIds.has(d.id) &&
          (!d.waterType || d.waterType === waterType),
      ),
    [userDatasets, catalogSaveDatasetIds, waterType],
  );

  // ── Multi-select ──────────────────────────────────────────────────────────
  // selectedIds holds a mix of: save IDs, dataset (upload) IDs, and folder IDs.
  // resolveOfflineScope handles all three when kind === "selection".
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Add to collection ─────────────────────────────────────────────────────
  // Dialog state for adding a single card (save or upload) to a collection.
  const [addToCollection, setAddToCollection] = useState<{ label: string; targets: AddToCollectionTarget[] } | null>(null);

  // ── Delete — catalog saves (with undo) ───────────────────────────────────
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState<UserCatalogSave | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDeleteSaveIds, setPendingDeleteSaveIds] = useState<Set<string>>(() => new Set());
  const pendingDeletesRef = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>());

  const deleteSaveMutation = useDeleteDatasetsMySavesId();

  const commitDeleteSave = useCallback(async (target: UserCatalogSave) => {
    pendingDeletesRef.current.delete(target.id);
    setDeletingIds((s) => new Set(s).add(target.id));
    try {
      await deleteSaveMutation.mutateAsync({ id: target.id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() }),
      ]);
    } catch (err) {
      if (isNotFoundError(err)) {
        // Already gone server-side — treat as success: refresh the lists so
        // the ghost row disappears, and clear any linked active dataset.
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() }),
        ]);
        if (target.datasetId) onDatasetsRemoved?.([target.datasetId]);
      } else {
        setDeleteError(err instanceof Error ? err.message : "Could not delete saved dataset");
        setPendingDeleteSaveIds((s) => { const n = new Set(s); n.delete(target.id); return n; });
        // Self-heal: refresh the lists so stale rows reflect true server state.
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() }),
        ]);
      }
    } finally {
      setDeletingIds((s) => { const n = new Set(s); n.delete(target.id); return n; });
      setPendingDeleteSaveIds((s) => { if (!s.has(target.id)) return s; const n = new Set(s); n.delete(target.id); return n; });
    }
  }, [deleteSaveMutation, qc, onDatasetsRemoved]);

  const handleConfirmDelete = useCallback(() => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    setDeleteError(null);
    setPendingDeleteSaveIds((s) => new Set(s).add(target.id));

    const undo = () => {
      const entry = pendingDeletesRef.current.get(target.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingDeletesRef.current.delete(target.id);
      setPendingDeleteSaveIds((s) => { const n = new Set(s); n.delete(target.id); return n; });
    };

    const timer = setTimeout(() => { void commitDeleteSave(target); }, UNDO_DELETE_WINDOW_MS);
    pendingDeletesRef.current.set(target.id, { timer, commit: () => { clearTimeout(timer); void commitDeleteSave(target); } });

    const name = target.catalog?.name ?? target.catalogId;
    const toastHandle = toast({
      title: "Saved dataset deleted",
      description: `"${name}" will be removed.`,
      duration: UNDO_DELETE_WINDOW_MS,
      action: (
        <ToastAction altText="Undo delete" data-testid="undo-delete-save" onClick={() => { undo(); toastHandle.dismiss(); }}>
          Undo
        </ToastAction>
      ),
    });
  }, [confirmDelete, commitDeleteSave, toast]);

  // Flush any pending-delete timers on unmount
  useEffect(() => {
    const map = pendingDeletesRef.current;
    return () => {
      const entries = Array.from(map.values());
      map.clear();
      for (const entry of entries) entry.commit();
    };
  }, []);

  // ── Delete — upload datasets ──────────────────────────────────────────────
  const [deletingUploadIds, setDeletingUploadIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteUpload, setConfirmDeleteUpload] = useState<UserDatasetMeta | null>(null);
  const [deleteUploadError, setDeleteUploadError] = useState<string | null>(null);
  const deleteUploadMutation = useDeleteUserDatasetsId();

  const handleConfirmDeleteUpload = useCallback(async () => {
    if (!confirmDeleteUpload) return;
    const target = confirmDeleteUpload;
    setConfirmDeleteUpload(null);
    setDeletingUploadIds((s) => new Set(s).add(target.id));
    try {
      await deleteUploadMutation.mutateAsync({ id: target.id });
      await qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
      onDatasetsRemoved?.([target.id]);
    } catch (err) {
      if (isNotFoundError(err)) {
        // Already gone server-side — treat as success: refresh the lists so
        // the ghost row disappears, and clear the active-dataset state.
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() }),
        ]);
        onDatasetsRemoved?.([target.id]);
      } else {
        setDeleteUploadError(err instanceof Error ? err.message : "Could not delete uploaded dataset");
        // Self-heal: refresh the lists so stale rows reflect true server state.
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() }),
          qc.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() }),
        ]);
      }
    } finally {
      setDeletingUploadIds((s) => { const n = new Set(s); n.delete(target.id); return n; });
    }
  }, [confirmDeleteUpload, deleteUploadMutation, qc, onDatasetsRemoved]);

  // ── Retry ─────────────────────────────────────────────────────────────────
  const retryMutation = usePostDatasetsMySavesIdRetry();
  const [retryingIds, setRetryingIds] = useState<Set<string>>(() => new Set());

  const handleRetry = useCallback(async (saveId: string) => {
    if (!isSignedIn) return;
    setRetryingIds((s) => new Set(s).add(saveId));
    try {
      await retryMutation.mutateAsync({ id: saveId });
      void refetchSaves();
    } catch (err) {
      // Surface the failure so the user knows the retry didn't go through
      // and can try again once the button re-enables (UX audit NEW-001).
      toast({
        title: "Retry failed",
        description:
          err instanceof Error && err.message
            ? err.message
            : "Could not retry this save. Please try again.",
        variant: "destructive",
      });
    } finally {
      setRetryingIds((s) => { const n = new Set(s); n.delete(saveId); return n; });
    }
  }, [isSignedIn, retryMutation, refetchSaves, toast]);

  // ── Rename ────────────────────────────────────────────────────────────────
  const renameSaveMutation = usePatchDatasetsMySavesIdRename();
  const renameUploadMutation = usePatchUserDatasetsIdRename();

  const handleRenameSave = useCallback(async (saveId: string, displayLabel: string | null) => {
    await renameSaveMutation.mutateAsync({ id: saveId, data: { displayLabel } });
    await qc.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() });
  }, [renameSaveMutation, qc]);

  const handleRenameUpload = useCallback(async (id: string, name: string) => {
    await renameUploadMutation.mutateAsync({ id, data: { name } });
    await qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
  }, [renameUploadMutation, qc]);

  // ── Move ──────────────────────────────────────────────────────────────────
  const moveSaveMutation = usePatchDatasetsMySavesIdMove();
  const moveUploadMutation = usePatchUserDatasetsIdMove();

  const handleMoveSave = useCallback(async (saveId: string, folderId: string | null) => {
    await moveSaveMutation.mutateAsync({ id: saveId, data: { folderId } });
    await qc.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() });
  }, [moveSaveMutation, qc]);

  const handleMoveUpload = useCallback(async (datasetId: string, folderId: string | null) => {
    await moveUploadMutation.mutateAsync({ id: datasetId, data: { folderId } });
    await qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
  }, [moveUploadMutation, qc]);

  // ── Folders ───────────────────────────────────────────────────────────────
  const postFolderMutation = usePostUserFolders();
  const renameFolderMutation = usePatchUserFoldersIdRename();
  const deleteFolderMutation = useDeleteUserFoldersId();

  const [renamingSaveFolder, setRenamingSaveFolder] = useState<{ id: string; value: string } | null>(null);
  const [confirmDeleteSaveFolder, setConfirmDeleteSaveFolder] = useState<{ id: string; name: string; hasSaves: boolean } | null>(null);
  const [saveFolderDeleteError, setSaveFolderDeleteError] = useState<string | null>(null);

  const handleSaveFolderMenu = useCallback((e: React.MouseEvent, node: MergedFolderNode) => {
    e.preventDefault();
    e.stopPropagation();
    const hasSaves = node.items.length > 0 || node.children.length > 0;
    useContextMenuStore.getState().show(e.clientX, e.clientY, [
      { label: "Rename", icon: "✎", onClick: () => setRenamingSaveFolder({ id: node.folder.id, value: node.folder.name }) },
      { label: "Download offline", icon: "⬇", onClick: () => useOfflineScopeStore.getState().requestScopeDownload({ kind: "folder", folderId: node.folder.id }) },
      { label: "", separator: true, onClick: () => {} },
      { label: "Delete folder…", icon: "✕", onClick: () => { setSaveFolderDeleteError(null); setConfirmDeleteSaveFolder({ id: node.folder.id, name: node.folder.name, hasSaves }); } },
    ]);
  }, []);

  const handleSaveFolderRenameCommit = useCallback(async () => {
    if (!renamingSaveFolder) return;
    const { id, value } = renamingSaveFolder;
    const trimmed = value.trim();
    if (!trimmed) { setRenamingSaveFolder(null); return; }
    setRenamingSaveFolder(null);
    try {
      await renameFolderMutation.mutateAsync({ id, data: { name: trimmed } });
      await qc.invalidateQueries({ queryKey: getGetUserFoldersQueryKey() });
    } catch (err) {
      toast({ title: "Rename failed", description: err instanceof Error ? err.message : "Could not rename folder. Please try again.", variant: "destructive" });
    }
  }, [renamingSaveFolder, renameFolderMutation, qc, toast]);

  const handleSaveFolderDelete = useCallback(async () => {
    if (!confirmDeleteSaveFolder) return;
    const { id } = confirmDeleteSaveFolder;
    setSaveFolderDeleteError(null);
    try {
      await deleteFolderMutation.mutateAsync({ id, data: { mode: "promote" } });
      setConfirmDeleteSaveFolder(null);
      await qc.invalidateQueries({ queryKey: getGetUserFoldersQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetDatasetsMySavesQueryKey() });
    } catch (err) {
      setSaveFolderDeleteError(err instanceof Error ? err.message : "Could not delete folder. Please try again.");
    }
  }, [confirmDeleteSaveFolder, deleteFolderMutation, qc]);

  const saveFolderExpanded = useSettingsStore((s) => s.saveFolderExpanded);
  const handleToggleSaveFolder = useCallback((folderId: string) => {
    useSettingsStore.setState((prev) => ({
      saveFolderExpanded: { ...prev.saveFolderExpanded, [folderId]: !(prev.saveFolderExpanded[folderId] ?? false) },
    }));
  }, []);

  // ── Move-to-folder dialog ─────────────────────────────────────────────────
  const [moveTarget, setMoveTarget] = useState<
    | { kind: "save"; save: UserCatalogSave }
    | { kind: "upload"; dataset: UserDatasetMeta }
    | null
  >(null);

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const [activeDrag, setActiveDrag] = useState<{ label: string } | null>(null);
  const saveDndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const visibleSaves = mySaves
    .filter((s) => !pendingDeleteSaveIds.has(s.id))
    .sort((a, b) => {
      const t = new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
      if (t !== 0) return t;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const handleSaveDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { kind: "save"; saveId: string } | { kind: "upload"; datasetId: string } | undefined;
    if (data?.kind === "save") {
      const save = visibleSaves.find((s) => s.id === data.saveId);
      if (save) setActiveDrag({ label: save.displayLabel ?? save.catalog?.name ?? save.catalogId });
    } else if (data?.kind === "upload") {
      const ds = userDatasets.find((d) => d.id === data.datasetId);
      if (ds) setActiveDrag({ label: ds.name });
    }
  }, [visibleSaves, userDatasets]);

  const handleSaveDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDrag(null);
    if (!event.over) return;
    const dragData = event.active.data.current as { kind: "save"; saveId: string } | { kind: "upload"; datasetId: string } | undefined;
    if (!dragData) return;
    const dropData = event.over.data.current as { kind: string; folderId?: string } | undefined;
    if (dropData?.kind !== "folder" && dropData?.kind !== "library-root") return;
    const targetFolderId = dropData.kind === "folder" ? (dropData.folderId ?? null) : null;
    const label = activeDrag?.label ?? "dataset";
    const move = dragData.kind === "save"
      ? handleMoveSave(dragData.saveId, targetFolderId)
      : handleMoveUpload(dragData.datasetId, targetFolderId);
    void move.catch((err: unknown) => {
      toast({
        title: "Move failed",
        description: `Could not move "${label}". ${err instanceof Error ? err.message : "Try again."}`,
        variant: "destructive",
      });
    });
  }, [activeDrag, handleMoveSave, handleMoveUpload, toast]);

  const handleSaveDragCancel = useCallback(() => {
    setActiveDrag(null);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isLoaded) return null;

  if (!isSignedIn) {
    return (
      <div style={{ padding: "12px 8px", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#f59e0b", textAlign: "center" }}>
        Sign in to see saved datasets
      </div>
    );
  }

  const isListPending = isSavePending || isUploadPending;
  const isEmpty = !isListPending && visibleSaves.length === 0 && uploadOnlyDatasets.length === 0 && userFolders.length === 0;

  const mergedTree = buildMergedTree(userFolders, visibleSaves, uploadOnlyDatasets);

  // Rollup offline status per folder subtree: gather every materialized
  // dataset id under the node, then map through the live pack statuses.
  const subtreeStatuses = (node: MergedFolderNode): PackStatus[] => {
    const out: PackStatus[] = [];
    const visit = (n: MergedFolderNode) => {
      for (const item of n.items) {
        const dsId = item.kind === "save" ? item.save.datasetId : item.dataset.id;
        if (dsId) out.push(packStatuses.get(dsId) ?? "none");
      }
      for (const child of n.children) visit(child);
    };
    visit(node);
    return out;
  };

  const renderItem = (item: MergedEntry, depth = 0): React.ReactNode => (
    <div key={item.kind === "save" ? `save-${item.save.id}` : `upload-${item.dataset.id}`} style={{ marginLeft: depth * 14 }}>
      {item.kind === "save" ? (
        <DraggableSaveCard
          save={item.save}
          onLoadUserDataset={onLoadCatalogSave}
          onRetry={handleRetry}
          retrying={retryingIds.has(item.save.id)}
          onDelete={(s) => { setDeleteError(null); setConfirmDelete(s); }}
          deleting={deletingIds.has(item.save.id)}
          onRename={handleRenameSave}
          onMoveTo={(s) => setMoveTarget({ kind: "save", save: s })}
          onAddToView={onAddToView}
          atViewCap={atViewCap}
          visibleDatasetIds={visibleDatasetIds}
          onOfflineDownload={onOfflineDownload}
          onAddToCollection={(s) => setAddToCollection({
            label: s.displayLabel ?? s.catalog?.name ?? s.catalogId,
            targets: [{ catalogSaveId: s.id }],
          })}
          offlineStatus={item.save.datasetId ? (packStatuses.get(item.save.datasetId) ?? "none") : "none"}
          isSelected={selectedIds.has(item.save.id)}
          onToggleSelect={toggleSelection}
        />
      ) : (
        <DraggableUploadCard
          dataset={item.dataset}
          onLoad={onLoadUserDataset}
          onDelete={(d) => { setDeleteUploadError(null); setConfirmDeleteUpload(d); }}
          onRename={handleRenameUpload}
          deleting={deletingUploadIds.has(item.dataset.id)}
          onMoveTo={(d) => setMoveTarget({ kind: "upload", dataset: d })}
          onAddToView={onAddToView}
          isAlreadyInView={visibleDatasetIds?.has(item.dataset.id) ?? false}
          atViewCap={atViewCap}
          onOfflineDownload={onOfflineDownload}
          onAddToCollection={(d) => setAddToCollection({
            label: d.name,
            targets: [{ datasetId: d.id }],
          })}
          offlineStatus={packStatuses.get(item.dataset.id) ?? "none"}
          isSelected={selectedIds.has(item.dataset.id)}
          onToggleSelect={toggleSelection}
        />
      )}
    </div>
  );

  const renderFolderNode = (node: MergedFolderNode): React.ReactNode => (
    <SaveFolderSection
      key={node.folder.id}
      node={node}
      isExpanded={saveFolderExpanded[node.folder.id] ?? false}
      onToggle={() => handleToggleSaveFolder(node.folder.id)}
      renderItem={renderItem}
      renderSubFolder={renderFolderNode}
      onShowMenu={handleSaveFolderMenu}
      onRenameStart={() => setRenamingSaveFolder({ id: node.folder.id, value: node.folder.name })}
      onDelete={(node) => { setSaveFolderDeleteError(null); setConfirmDeleteSaveFolder({ id: node.folder.id, name: node.folder.name, hasSaves: node.items.length > 0 || node.children.length > 0 }); }}
      onNewFolder={async () => {
        const name = `New folder ${userFolders.length + 1}`;
        const newFolder = await postFolderMutation.mutateAsync({ data: { name, parentId: node.folder.id } });
        await qc.invalidateQueries({ queryKey: getGetUserFoldersQueryKey() });
        // Ensure the parent folder is expanded so the new subfolder is visible
        useSettingsStore.setState((prev) => ({
          saveFolderExpanded: { ...prev.saveFolderExpanded, [node.folder.id]: true },
        }));
        setRenamingSaveFolder({ id: newFolder.id, value: newFolder.name });
      }}
      isRenaming={renamingSaveFolder?.id === node.folder.id}
      renameValue={renamingSaveFolder?.id === node.folder.id ? renamingSaveFolder.value : ""}
      onRenameChange={(v) => setRenamingSaveFolder((prev) => prev ? { ...prev, value: v } : null)}
      onRenameCommit={() => void handleSaveFolderRenameCommit()}
      onRenameCancel={() => setRenamingSaveFolder(null)}
      onDownloadOffline={() => useOfflineScopeStore.getState().requestScopeDownload({ kind: "folder", folderId: node.folder.id })}
      offlineRollup={rollupPackStatus(subtreeStatuses(node))}
      isSelected={selectedIds.has(node.folder.id)}
      onToggleSelect={toggleSelection}
    />
  );

  return (
    <div style={{ padding: "8px 8px 0" }}>
      {/* Section header row */}
      <div style={{ fontSize: "calc(11px * var(--bs-font-scale, 1))", letterSpacing: "0.15em", textTransform: "uppercase", color: "#64748b", marginBottom: 8, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <button
          onClick={async () => {
            const name = `New folder ${userFolders.length + 1}`;
            const newFolder = await postFolderMutation.mutateAsync({ data: { name } });
            await qc.invalidateQueries({ queryKey: getGetUserFoldersQueryKey() });
            setRenamingSaveFolder({ id: newFolder.id, value: newFolder.name });
          }}
          disabled={postFolderMutation.isPending}
          title="New root folder"
          style={{ background: "transparent", border: "1px solid rgba(0,229,255,0.3)", color: "#00e5ff", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "1px 6px", borderRadius: 2, cursor: postFolderMutation.isPending ? "not-allowed" : "pointer", opacity: postFolderMutation.isPending ? 0.5 : 1, letterSpacing: "0.08em" }}
        >+ folder</button>
      </div>

      {/* Loading state */}
      {isListPending && (
        <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", marginBottom: 8 }}>Loading…</div>
      )}

      {/* Delete errors */}
      {deleteError && (
        <div data-testid="save-delete-error" style={{ marginBottom: 8, padding: "6px 8px", border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.08)", borderRadius: 4, fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#fca5a5", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <ErrorMessage message={deleteError} style={{ flex: 1 }} />
          <button onClick={() => setDeleteError(null)} aria-label="Dismiss error" style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: "calc(15px * var(--bs-font-scale, 1))" }}>×</button>
        </div>
      )}
      {deleteUploadError && (
        <div data-testid="upload-delete-error" style={{ marginBottom: 8, padding: "6px 8px", border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.08)", borderRadius: 4, fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#fca5a5", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <ErrorMessage message={deleteUploadError} style={{ flex: 1 }} />
          <button onClick={() => setDeleteUploadError(null)} aria-label="Dismiss error" style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: "calc(15px * var(--bs-font-scale, 1))" }}>×</button>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", textAlign: "center", padding: "16px 0 8px" }}>
          <div style={{ fontSize: "calc(28px * var(--bs-font-scale, 1))", marginBottom: 6, opacity: 0.5 }}>🌊</div>
          <div style={{ color: "#64748b", marginBottom: onBrowseDatasets ? 10 : 0, lineHeight: 1.5 }}>
            No datasets yet — upload sonar data or save datasets from the catalog
          </div>
          {onBrowseDatasets && (
            <button
              onClick={onBrowseDatasets}
              data-testid="empty-state-browse-btn"
              style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", letterSpacing: "0.12em", padding: "4px 10px", background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.28)", borderRadius: 3, color: "#00e5ff", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}
            >
              {browseLabel}
            </button>
          )}
        </div>
      )}

      {/* Multi-select action bar — shown whenever at least one item is checked */}
      {selectedIds.size > 0 && (
        <div
          data-testid="multiselect-action-bar"
          style={{
            display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
            padding: "5px 4px 7px",
            borderBottom: "1px solid rgba(0,229,255,0.12)",
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", color: "#94a3b8", flexShrink: 0 }}>
            {selectedIds.size} selected
          </span>
          <button
            data-testid="btn-download-selected-offline"
            onClick={() => {
              useOfflineScopeStore.getState().requestScopeDownload({ kind: "selection", ids: [...selectedIds] });
              clearSelection();
            }}
            title="Download selected datasets for offline use"
            style={{
              background: "transparent",
              border: "1px solid rgba(0,229,255,0.3)",
              color: "#67e8f9",
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              padding: "1px 7px",
              borderRadius: 2,
              cursor: "pointer",
              lineHeight: 1.6,
              letterSpacing: "0.05em",
              flexShrink: 0,
            }}
          >
            ⬇ Download offline
          </button>
          <button
            data-testid="btn-cancel-selection"
            onClick={clearSelection}
            title="Clear selection"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              fontSize: "calc(12px * var(--bs-font-scale, 1))",
              padding: "1px 4px",
              cursor: "pointer",
              lineHeight: 1.6,
              flexShrink: 0,
            }}
          >
            ✕ Cancel
          </button>
        </div>
      )}

      {/* Merged tree */}
      {!isEmpty && (
        <DndContext sensors={saveDndSensors} onDragStart={handleSaveDragStart} onDragEnd={handleSaveDragEnd} onDragCancel={handleSaveDragCancel}>
          <div>
            {mergedTree.roots.map(renderFolderNode)}
            {mergedTree.rootItems.map((item) => renderItem(item, 0))}
            <LibraryRootDropTarget />
          </div>
          <DragOverlay dropAnimation={null}>
            {activeDrag && (
              <div style={{ background: "rgba(0,10,20,0.9)", border: "1px solid rgba(0,229,255,0.4)", borderRadius: 4, padding: "6px 12px", color: "#e2e8f0", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", fontFamily: "'JetBrains Mono', monospace", pointerEvents: "none" }}>
                📦 {activeDrag.label}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Move-to-folder dialog */}
      {moveTarget && (
        <MoveToFolderDialog
          name={moveTarget.kind === "save" ? (moveTarget.save.displayLabel ?? moveTarget.save.catalog?.name ?? moveTarget.save.catalogId) : moveTarget.dataset.name}
          currentFolderId={moveTarget.kind === "save" ? (moveTarget.save.folderId ?? null) : (moveTarget.dataset.folderId ?? null)}
          folders={userFolders}
          isPending={moveTarget.kind === "save" ? moveSaveMutation.isPending : moveUploadMutation.isPending}
          onCancel={() => setMoveTarget(null)}
          onConfirm={async (folderId) => {
            if (moveTarget.kind === "save") await handleMoveSave(moveTarget.save.id, folderId);
            else await handleMoveUpload(moveTarget.dataset.id, folderId);
            setMoveTarget(null);
          }}
        />
      )}

      {/* Add-to-collection dialog */}
      {addToCollection && (
        <AddToCollectionDialog
          label={addToCollection.label}
          targets={addToCollection.targets}
          onClose={() => setAddToCollection(null)}
        />
      )}

      {/* Confirm delete catalog save */}
      {confirmDelete && (
        <div
          role="dialog" aria-label="Confirm delete saved dataset"
          data-testid="confirm-delete-save"
          style={{ position: "fixed", inset: 0, background: "rgba(0,4,10,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: OVERLAY_Z.dialog }}
          onClick={() => setConfirmDelete(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(0,12,24,0.98)", border: "1px solid rgba(0,229,255,0.25)", borderRadius: 6, padding: "16px 18px", maxWidth: 340, fontFamily: "'JetBrains Mono', monospace", color: "#cbd5e1" }}>
            <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#e2e8f0", fontWeight: 700, marginBottom: 8, letterSpacing: "0.05em" }}>
              Delete &ldquo;{confirmDelete.displayLabel ?? confirmDelete.catalog?.name ?? confirmDelete.catalogId}&rdquo;?
            </div>
            <div style={{ fontSize: "calc(14px * var(--bs-font-scale, 1))", color: "#94a3b8", lineHeight: 1.5, marginBottom: 14 }}>
              This will remove the save entry and its underlying dataset. You can re-save it from the catalog later.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} data-testid="confirm-delete-cancel" style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", padding: "5px 12px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, color: "#e2e8f0", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>Cancel</button>
              <button onClick={handleConfirmDelete} data-testid="confirm-delete-confirm" style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", padding: "5px 12px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.5)", borderRadius: 3, color: "#fca5a5", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete upload */}
      {confirmDeleteUpload && (
        <div
          role="dialog" aria-label="Confirm delete uploaded dataset"
          data-testid="confirm-delete-upload"
          style={{ position: "fixed", inset: 0, background: "rgba(0,4,10,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
          onClick={() => setConfirmDeleteUpload(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(0,12,24,0.98)", border: "1px solid rgba(0,229,255,0.25)", borderRadius: 6, padding: "16px 18px", maxWidth: 340, fontFamily: "'JetBrains Mono', monospace", color: "#cbd5e1" }}>
            <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#e2e8f0", fontWeight: 700, marginBottom: 8, letterSpacing: "0.05em" }}>
              Delete &ldquo;{confirmDeleteUpload.name}&rdquo;?
            </div>
            <div style={{ fontSize: "calc(14px * var(--bs-font-scale, 1))", color: "#94a3b8", lineHeight: 1.5, marginBottom: 14 }}>
              This will permanently remove the uploaded dataset. This action cannot be undone.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDeleteUpload(null)} data-testid="confirm-delete-upload-cancel" style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", padding: "5px 12px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, color: "#e2e8f0", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>Cancel</button>
              <button onClick={() => void handleConfirmDeleteUpload()} data-testid="confirm-delete-upload-confirm" style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", padding: "5px 12px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.5)", borderRadius: 3, color: "#fca5a5", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete save folder */}
      {confirmDeleteSaveFolder && (
        <div
          role="dialog" aria-label="Confirm delete save folder" data-testid="confirm-delete-save-folder"
          style={{ position: "fixed", inset: 0, background: "rgba(0,4,10,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
          onClick={() => setConfirmDeleteSaveFolder(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(0,12,24,0.98)", border: "1px solid rgba(0,229,255,0.25)", borderRadius: 6, padding: "16px 18px", maxWidth: 340, fontFamily: "'JetBrains Mono', monospace", color: "#cbd5e1" }}>
            <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#e2e8f0", fontWeight: 700, marginBottom: 8, letterSpacing: "0.05em" }}>
              Delete &ldquo;{confirmDeleteSaveFolder.name}&rdquo;?
            </div>
            <div style={{ fontSize: "calc(14px * var(--bs-font-scale, 1))", color: "#94a3b8", lineHeight: 1.5, marginBottom: 14 }}>
              {confirmDeleteSaveFolder.hasSaves
                ? "Datasets inside this folder (uploads and catalog saves) will be moved to the root level. The folder itself will be removed."
                : "This empty folder will be removed."}
            </div>
            {saveFolderDeleteError && (
              <ErrorMessage message={saveFolderDeleteError} style={{ fontSize: "calc(13px * var(--bs-font-scale, 1))", color: "#fca5a5", marginBottom: 10 }} />
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDeleteSaveFolder(null)} data-testid="confirm-delete-save-folder-cancel" style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", padding: "5px 12px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, color: "#e2e8f0", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>Cancel</button>
              <button onClick={() => void handleSaveFolderDelete()} data-testid="confirm-delete-save-folder-confirm" disabled={deleteFolderMutation.isPending} style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", padding: "5px 12px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.5)", borderRadius: 3, color: "#fca5a5", cursor: deleteFolderMutation.isPending ? "not-allowed" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase", opacity: deleteFolderMutation.isPending ? 0.5 : 1 }}>
                {deleteFolderMutation.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
