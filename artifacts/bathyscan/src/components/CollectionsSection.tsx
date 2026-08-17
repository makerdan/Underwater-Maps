/**
 * CollectionsSection — user-defined dataset collections in the library panel.
 *
 * Collections are named, server-persisted groups of library datasets
 * (uploaded datasets and saved catalog entries). Membership is independent
 * of folder location and a dataset can belong to any number of collections.
 *
 * This file exports:
 *   • CollectionsSection      — the "COLLECTIONS" section (create / rename /
 *                               delete / expand / remove members / empty state)
 *   • AddToCollectionDialog   — reusable picker dialog to add one or more
 *                               library items to a collection (used by
 *                               MySavesSection card buttons and the folder
 *                               tree's multi-select flow)
 *
 * All state is server-persisted per user via /api/user/collections.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUserCollections,
  usePostUserCollections,
  usePatchUserCollectionsIdRename,
  useDeleteUserCollectionsId,
  usePostUserCollectionsIdMembers,
  useDeleteUserCollectionsIdMembersMemberId,
  useGetDatasetsMySaves,
  getGetUserCollectionsQueryKey,
  getGetDatasetsMySavesQueryKey,
  type DatasetCollection,
  type DatasetCollectionMember,
  type UserCatalogSave,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/clerkCompat";
import {
  useOfflinePackStatuses,
  rollupPackStatus,
  type PackRollupStatus,
} from "@/hooks/useOfflinePackStatus";
import { useOfflineScopeStore } from "@/lib/offlineScopeStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the machine-readable error code from an ApiError, if present. */
function apiErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const code = (data as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

function friendlyError(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  if (code === "duplicate_name") return "A collection with that name already exists.";
  if (code === "invalid_name") return "Please enter a valid name (max 120 characters).";
  if (code === "not_found") return "That collection no longer exists.";
  return err instanceof Error ? err.message : fallback;
}

const MEMBER_KIND_ICONS: Record<string, string> = {
  dataset: "⬆",
  catalogSave: "💾",
};

// ---------------------------------------------------------------------------
// AddToCollectionDialog
// ---------------------------------------------------------------------------

export interface AddToCollectionTarget {
  datasetId?: string;
  catalogSaveId?: string;
}

export const AddToCollectionDialog: React.FC<{
  /** Display name for the item(s) being added, e.g. `"Lake Upload"` or `3 datasets`. */
  label: string;
  targets: AddToCollectionTarget[];
  onClose: () => void;
}> = ({ label, targets, onClose }) => {
  const qc = useQueryClient();
  const { data: collections = [] } = useGetUserCollections({
    query: { queryKey: getGetUserCollectionsQueryKey() },
  });
  const createMutation = usePostUserCollections();
  const addMemberMutation = usePostUserCollectionsIdMembers();

  const sorted = useMemo(
    () => [...collections].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [collections],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { listRef.current?.focus(); }, []);

  const handleConfirm = useCallback(async () => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      let collectionId = selectedId;
      const trimmed = newName.trim();
      if (!collectionId && trimmed) {
        const created = await createMutation.mutateAsync({ data: { name: trimmed } });
        collectionId = created.id;
      }
      if (!collectionId) {
        setError("Pick a collection or enter a name for a new one.");
        setPending(false);
        return;
      }
      // Adds are idempotent server-side — re-adding an existing member is a no-op.
      for (const target of targets) {
        await addMemberMutation.mutateAsync({ id: collectionId, data: target });
      }
      await qc.invalidateQueries({ queryKey: getGetUserCollectionsQueryKey() });
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Could not add to collection"));
      setPending(false);
    }
  }, [pending, selectedId, newName, targets, createMutation, addMemberMutation, qc, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); if (!pending) onClose(); }
    else if (e.key === "Enter") { e.preventDefault(); void handleConfirm(); }
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Add "${label}" to a collection`}
      data-testid="add-to-collection-dialog"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
      onClick={pending ? undefined : onClose}
      aria-busy={pending || undefined}
    >
      {/* width caps at 90vw so the dialog stays usable at phone widths */}
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(0,10,20,0.95)", border: "1px solid rgba(0,229,255,0.35)", borderRadius: 6, padding: 18, width: 340, maxWidth: "90vw", color: "#cbd5e1", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "calc(14px * var(--bs-font-scale, 1))" }}>
        <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", fontWeight: 700, marginBottom: 12, letterSpacing: "0.05em" }}>
          Add &quot;{label}&quot; to collection
        </div>

        {sorted.length > 0 && (
          <div ref={listRef} role="listbox" tabIndex={0} onKeyDown={onKeyDown} style={{ maxHeight: 200, overflowY: "auto", outline: "none", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 4, marginBottom: 10 }}>
            {sorted.map((c) => (
              <div
                key={c.id}
                role="option"
                aria-selected={c.id === selectedId}
                data-testid={`add-to-collection-option-${c.id}`}
                onClick={() => { setSelectedId(c.id === selectedId ? null : c.id); setNewName(""); }}
                style={{ padding: "7px 12px", cursor: "pointer", background: c.id === selectedId ? "rgba(0,229,255,0.12)" : "transparent", color: c.id === selectedId ? "#00e5ff" : "#cbd5e1", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", opacity: pending ? 0.6 : 1, borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              >🗂 {c.name} <span style={{ color: "#64748b" }}>({c.members.length})</span></div>
            ))}
          </div>
        )}

        <input
          data-testid="input-new-collection-name"
          placeholder={sorted.length > 0 ? "…or create a new collection" : "New collection name"}
          value={newName}
          disabled={pending}
          onChange={(e) => { setNewName(e.target.value); if (e.target.value.trim()) setSelectedId(null); }}
          onKeyDown={onKeyDown}
          style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,229,255,0.2)", borderRadius: 3, color: "#e2e8f0", padding: "5px 8px", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", outline: "none", fontFamily: "inherit" }}
        />

        {error && (
          <div data-testid="add-to-collection-error" style={{ marginTop: 8, color: "#fca5a5", fontSize: "calc(12.5px * var(--bs-font-scale, 1))" }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={pending} style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "4px 14px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, color: "#94a3b8", cursor: pending ? "not-allowed" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>Cancel</button>
          <button
            data-testid="btn-confirm-add-to-collection"
            onClick={() => void handleConfirm()}
            disabled={pending || (!selectedId && !newName.trim())}
            style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "4px 14px", background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, color: "#00e5ff", cursor: pending ? "wait" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase", opacity: (!selectedId && !newName.trim()) ? 0.4 : 1 }}
          >
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// CollectionRow
// ---------------------------------------------------------------------------

const CollectionRow: React.FC<{
  collection: DatasetCollection;
  expanded: boolean;
  onToggle: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (collection: DatasetCollection) => void;
  onRemoveMember: (collectionId: string, memberId: string) => void;
  removingMemberIds: Set<string>;
  /** Download this collection's datasets for offline use. */
  onDownloadOffline?: () => void;
  /** Rollup offline status across the collection's members ("none" hides the badge). */
  offlineRollup?: PackRollupStatus;
}> = ({ collection, expanded, onToggle, onRename, onDelete, onRemoveMember, removingMemberIds, onDownloadOffline, offlineRollup = "none" }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commitRename = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === collection.name) { setEditing(false); setRenameError(null); return; }
    setRenaming(true);
    try {
      await onRename(collection.id, trimmed);
      setEditing(false);
      setRenameError(null);
    } catch (err) {
      setRenameError(friendlyError(err, "Could not rename collection"));
    } finally {
      setRenaming(false);
    }
  }, [editValue, collection.id, collection.name, onRename]);

  return (
    <div data-testid={`collection-row-${collection.id}`} style={{ marginBottom: 2 }}>
      <div className="flex items-center gap-1" style={{ padding: "3px 4px", borderRadius: 3 }}>
        <button
          data-testid={`btn-expand-collection-${collection.id}`}
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex-1 flex items-center gap-1 text-left hover:bg-white/5"
          style={{ background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", padding: "2px 4px", minWidth: 0 }}
        >
          <span style={{ flexShrink: 0 }}>{expanded ? "▾" : "▸"} 🗂</span>
          {editing ? (
            <input
              ref={inputRef}
              data-testid="input-rename-collection"
              value={editValue}
              disabled={renaming}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                else if (e.key === "Escape") { e.preventDefault(); setEditing(false); setRenameError(null); }
              }}
              onBlur={() => void commitRename()}
              style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 2, color: "#e2e8f0", padding: "0px 4px", fontSize: "calc(13.5px * var(--bs-font-scale, 1))", outline: "none", fontFamily: "inherit" }}
            />
          ) : (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {collection.name} <span style={{ color: "#64748b" }}>({collection.members.length})</span>
            </span>
          )}
          {!editing && offlineRollup !== "none" && (
            <span
              data-testid={`offline-rollup-collection-${collection.id}`}
              title={
                offlineRollup === "downloaded"
                  ? "All datasets in this collection are saved offline"
                  : offlineRollup === "stale"
                    ? "All datasets are saved offline, but some tide data has expired"
                    : "Some datasets in this collection are saved offline"
              }
              style={{
                fontSize: "calc(9.5px * var(--bs-font-scale, 1))", letterSpacing: "0.1em",
                textTransform: "uppercase", flexShrink: 0, lineHeight: 1.6,
                borderRadius: 3, padding: "0px 5px",
                color: offlineRollup === "downloaded" ? "#4ade80" : offlineRollup === "stale" ? "#fbbf24" : "#94a3b8",
                border: `1px solid ${offlineRollup === "downloaded" ? "rgba(74,222,128,0.4)" : offlineRollup === "stale" ? "rgba(251,191,36,0.4)" : "rgba(148,163,184,0.4)"}`,
              }}
            >
              {offlineRollup === "downloaded" ? "✓ Offline" : offlineRollup === "stale" ? "⟳ Stale" : "◐ Partial"}
            </span>
          )}
        </button>
        {!editing && (
          <>
            {onDownloadOffline && (
              <button
                data-testid={`btn-download-collection-${collection.id}`}
                aria-label={`Download collection "${collection.name}" for offline use`}
                title="Download this collection for offline use"
                onClick={onDownloadOffline}
                style={{ background: "transparent", border: "none", color: "#67e8f9", cursor: "pointer", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "2px 4px", flexShrink: 0 }}
              >⬇</button>
            )}
            <button
              data-testid={`btn-rename-collection-${collection.id}`}
              aria-label={`Rename collection "${collection.name}"`}
              title="Rename"
              onClick={() => { setEditValue(collection.name); setEditing(true); }}
              style={{ background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "2px 4px", flexShrink: 0 }}
            >✎</button>
            <button
              data-testid={`btn-delete-collection-${collection.id}`}
              aria-label={`Delete collection "${collection.name}"`}
              title="Delete collection"
              onClick={() => onDelete(collection)}
              style={{ background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "2px 4px", flexShrink: 0 }}
            >✕</button>
          </>
        )}
      </div>
      {renameError && (
        <div data-testid="collection-rename-error" style={{ padding: "0 26px 4px", color: "#fca5a5", fontSize: "calc(12px * var(--bs-font-scale, 1))" }}>{renameError}</div>
      )}
      {expanded && (
        <div style={{ paddingLeft: 26 }}>
          {collection.members.length === 0 ? (
            <div data-testid={`collection-members-empty-${collection.id}`} style={{ color: "#64748b", fontSize: "calc(12.5px * var(--bs-font-scale, 1))", padding: "2px 4px 6px" }}>
              No datasets yet — use 🗂 on a dataset to add it.
            </div>
          ) : (
            collection.members.map((m) => (
              <div key={m.id} data-testid={`collection-member-${m.id}`} className="flex items-center gap-1" style={{ padding: "1px 4px" }}>
                <span style={{ flexShrink: 0, fontSize: "calc(11px * var(--bs-font-scale, 1))" }} title={m.kind === "dataset" ? "Uploaded dataset" : "Saved catalog entry"}>
                  {MEMBER_KIND_ICONS[m.kind] ?? "•"}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#94a3b8", fontSize: "calc(12.5px * var(--bs-font-scale, 1))" }}>
                  {m.name}
                </span>
                <button
                  data-testid={`btn-remove-member-${m.id}`}
                  aria-label={`Remove "${m.name}" from collection`}
                  title="Remove from collection (does not delete the dataset)"
                  disabled={removingMemberIds.has(m.id)}
                  onClick={() => onRemoveMember(collection.id, m.id)}
                  style={{ background: "transparent", border: "none", color: "#475569", cursor: removingMemberIds.has(m.id) ? "wait" : "pointer", fontSize: "calc(11px * var(--bs-font-scale, 1))", padding: "1px 4px", flexShrink: 0, opacity: removingMemberIds.has(m.id) ? 0.5 : 1 }}
                >✕</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// CollectionsSection
// ---------------------------------------------------------------------------

export const CollectionsSection: React.FC = () => {
  const { isSignedIn, isLoaded } = useAuth();
  const qc = useQueryClient();

  const { data: collections = [], isPending } = useGetUserCollections({
    query: { queryKey: getGetUserCollectionsQueryKey(), enabled: isLoaded && isSignedIn === true },
  });

  // Saves list (unfiltered) so catalogSave members can be mapped to their
  // materialized dataset ids for offline-status rollups.
  const { data: allSaves = [] } = useGetDatasetsMySaves(undefined, {
    query: { queryKey: getGetDatasetsMySavesQueryKey(), enabled: isLoaded && isSignedIn === true },
  });
  const packStatuses = useOfflinePackStatuses();

  const savesById = useMemo(() => {
    const map = new Map<string, UserCatalogSave>();
    for (const s of allSaves) map.set(s.id, s);
    return map;
  }, [allSaves]);

  const memberDatasetId = useCallback((m: DatasetCollectionMember): string | null => {
    if (m.kind === "dataset") return m.refId;
    return savesById.get(m.refId)?.datasetId ?? null;
  }, [savesById]);

  const collectionRollup = useCallback((c: DatasetCollection): PackRollupStatus => {
    const statuses = c.members
      .map(memberDatasetId)
      .filter((id): id is string => id !== null)
      .map((id) => packStatuses.get(id) ?? "none");
    return rollupPackStatus(statuses);
  }, [memberDatasetId, packStatuses]);

  const createMutation = usePostUserCollections();
  const renameMutation = usePatchUserCollectionsIdRename();
  const deleteMutation = useDeleteUserCollectionsId();
  const removeMemberMutation = useDeleteUserCollectionsIdMembersMemberId();

  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createValue, setCreateValue] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState<DatasetCollection | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [removingMemberIds, setRemovingMemberIds] = useState<Set<string>>(() => new Set());
  const createInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (creating) createInputRef.current?.focus(); }, [creating]);

  const sorted = useMemo(
    () => [...collections].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [collections],
  );

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: getGetUserCollectionsQueryKey() }),
    [qc],
  );

  const handleCreate = useCallback(async () => {
    const trimmed = createValue.trim();
    if (!trimmed || createPending) return;
    setCreatePending(true);
    setCreateError(null);
    try {
      await createMutation.mutateAsync({ data: { name: trimmed } });
      await invalidate();
      setCreateValue("");
      setCreating(false);
    } catch (err) {
      setCreateError(friendlyError(err, "Could not create collection"));
    } finally {
      setCreatePending(false);
    }
  }, [createValue, createPending, createMutation, invalidate]);

  const handleRename = useCallback(async (id: string, name: string) => {
    await renameMutation.mutateAsync({ id, data: { name } });
    await invalidate();
  }, [renameMutation, invalidate]);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync({ id: confirmDelete.id });
      await invalidate();
      setConfirmDelete(null);
    } catch (err) {
      setDeleteError(friendlyError(err, "Could not delete collection"));
    } finally {
      setDeletePending(false);
    }
  }, [confirmDelete, deletePending, deleteMutation, invalidate]);

  const handleRemoveMember = useCallback(async (collectionId: string, memberId: string) => {
    setRemovingMemberIds((s) => new Set(s).add(memberId));
    try {
      await removeMemberMutation.mutateAsync({ id: collectionId, memberId });
      await invalidate();
    } catch {
      // Refetch resolves any stale view (e.g. member already removed elsewhere).
      await invalidate();
    } finally {
      setRemovingMemberIds((s) => { const n = new Set(s); n.delete(memberId); return n; });
    }
  }, [removeMemberMutation, invalidate]);

  // Hidden entirely for signed-out users — collections are per-account state.
  if (!isLoaded || !isSignedIn) return null;

  return (
    <div data-testid="collections-section" style={{ marginTop: 10 }}>
      <div className="flex items-center justify-between" style={{ padding: "0 2px" }}>
        <button
          data-testid="btn-collections-toggle"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 hover:bg-white/5"
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "calc(12.5px * var(--bs-font-scale, 1))", letterSpacing: "0.12em", padding: "2px 4px" }}
        >
          {open ? "▼" : "▶"} COLLECTIONS {sorted.length > 0 ? `(${sorted.length})` : ""}
        </button>
        <button
          data-testid="btn-new-collection"
          onClick={() => { setOpen(true); setCreating(true); setCreateError(null); }}
          title="New collection"
          style={{ background: "transparent", border: "1px solid rgba(0,229,255,0.3)", color: "#00e5ff", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "0 6px", borderRadius: 2, cursor: "pointer", lineHeight: 1.6 }}
        >+ new</button>
      </div>

      {open && (
        <div style={{ padding: "4px 4px 0" }}>
          {creating && (
            <div style={{ marginBottom: 6 }}>
              <div className="flex items-center gap-1">
                <input
                  ref={createInputRef}
                  data-testid="input-new-collection"
                  placeholder="Collection name"
                  value={createValue}
                  disabled={createPending}
                  onChange={(e) => setCreateValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void handleCreate(); }
                    else if (e.key === "Escape") { e.preventDefault(); setCreating(false); setCreateValue(""); setCreateError(null); }
                  }}
                  style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,229,255,0.25)", borderRadius: 3, color: "#e2e8f0", padding: "3px 8px", fontSize: "calc(13px * var(--bs-font-scale, 1))", outline: "none", fontFamily: "inherit" }}
                />
                <button
                  data-testid="btn-create-collection"
                  onClick={() => void handleCreate()}
                  disabled={createPending || !createValue.trim()}
                  style={{ background: "rgba(0,229,255,0.1)", border: "1px solid rgba(0,229,255,0.3)", borderRadius: 3, color: "#00e5ff", fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "3px 10px", cursor: createPending ? "wait" : "pointer", letterSpacing: "0.08em", textTransform: "uppercase", opacity: !createValue.trim() ? 0.4 : 1, flexShrink: 0 }}
                >{createPending ? "…" : "Create"}</button>
              </div>
              {createError && (
                <div data-testid="collections-create-error" style={{ marginTop: 4, color: "#fca5a5", fontSize: "calc(12px * var(--bs-font-scale, 1))" }}>{createError}</div>
              )}
            </div>
          )}

          {sorted.length === 0 && !creating && !isPending && (
            <div data-testid="collections-empty" style={{ color: "#64748b", fontSize: "calc(12.5px * var(--bs-font-scale, 1))", padding: "2px 4px 6px" }}>
              Group datasets across folders — e.g. everything for one trip. Click “+ new” to start.
            </div>
          )}

          {sorted.map((c) => (
            <CollectionRow
              key={c.id}
              collection={c}
              expanded={expandedIds.has(c.id)}
              onToggle={() => setExpandedIds((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
              onRename={handleRename}
              onDelete={setConfirmDelete}
              onRemoveMember={(collectionId, memberId) => void handleRemoveMember(collectionId, memberId)}
              removingMemberIds={removingMemberIds}
              onDownloadOffline={() => useOfflineScopeStore.getState().requestScopeDownload({ kind: "collection", collectionId: c.id })}
              offlineRollup={collectionRollup(c)}
            />
          ))}
        </div>
      )}

      {confirmDelete && (
        <div
          role="dialog" aria-modal="true" aria-label={`Delete collection "${confirmDelete.name}"`}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
          onClick={deletePending ? undefined : () => setConfirmDelete(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(0,10,20,0.95)", border: "1px solid rgba(0,229,255,0.35)", borderRadius: 6, padding: 18, width: 340, maxWidth: "90vw", color: "#cbd5e1", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "calc(14px * var(--bs-font-scale, 1))" }}>
            <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", fontWeight: 700, marginBottom: 10, letterSpacing: "0.05em" }}>
              Delete &quot;{confirmDelete.name}&quot;?
            </div>
            <div style={{ color: "#94a3b8", fontSize: "calc(13px * var(--bs-font-scale, 1))", marginBottom: 12 }}>
              The collection will be removed. Its {confirmDelete.members.length} dataset{confirmDelete.members.length === 1 ? "" : "s"} stay in your library.
            </div>
            {deleteError && (
              <div data-testid="collections-delete-error" style={{ marginBottom: 8, color: "#fca5a5", fontSize: "calc(12.5px * var(--bs-font-scale, 1))" }}>{deleteError}</div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button data-testid="btn-cancel-delete-collection" onClick={() => setConfirmDelete(null)} disabled={deletePending} style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "4px 14px", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, color: "#94a3b8", cursor: deletePending ? "not-allowed" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>Cancel</button>
              <button data-testid="btn-confirm-delete-collection" onClick={() => void handleConfirmDelete()} disabled={deletePending} style={{ fontSize: "calc(12px * var(--bs-font-scale, 1))", padding: "4px 14px", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 3, color: "#f87171", cursor: deletePending ? "wait" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {deletePending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
