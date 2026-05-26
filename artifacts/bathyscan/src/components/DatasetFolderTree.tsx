/**
 * DatasetFolderTree — nested folder tree for the user's dataset library
 * in DatasetPanel. Supports:
 *   • Expand / collapse (state persisted via settingsStore)
 *   • Inline rename for folders & datasets (F2 or context menu)
 *   • Right-click context menus (folder vs dataset)
 *   • Drag & drop (folders + datasets → folders or root) via @dnd-kit/core
 *   • Duplicate, delete-with-confirm, "New folder" button
 *   • Keyboard navigation: ↑ ↓ select, → expand, ← collapse, Enter activate
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  useGetUserFolders,
  usePostUserFolders,
  usePatchUserFoldersIdRename,
  usePatchUserFoldersIdMove,
  usePostUserFoldersIdDuplicate,
  useDeleteUserFoldersId,
  useDeleteUserDatasetsId,
  usePatchUserDatasetsIdMove,
  usePatchUserDatasetsIdRename,
  usePostUserDatasetsIdDuplicate,
  getGetUserFoldersQueryKey,
  getGetUserDatasetsQueryKey,
} from "@workspace/api-client-react";
import type { UserDatasetMeta } from "@workspace/api-client-react";
import { useSettingsStore } from "@/lib/settingsStore";
import { formatDepthRange } from "@/lib/units";
import { useTerrainStore } from "@/lib/terrainStore";
import { useContextMenuStore } from "@/lib/contextMenuStore";
import {
  buildLibraryTree,
  descendantFolderIds,
  isDescendantOf,
  suggestUniqueName,
  type FolderNode,
  type LibraryTree,
} from "@/lib/datasetLibrary";

interface Props {
  datasets: UserDatasetMeta[];
  activeUserDatasetId: string | null;
  loadingId: string | null;
  onSelectDataset: (ds: UserDatasetMeta) => void;
}

type DragKind = "folder" | "dataset";
interface DragData {
  kind: DragKind;
  id: string;
  /** Source folderId (datasets) or parentId (folders); null = root */
  parentId: string | null;
}

const ROW_PADDING_X = 12;
const INDENT_PX = 12;

export const DatasetFolderTree: React.FC<Props> = ({
  datasets,
  activeUserDatasetId,
  loadingId,
  onSelectDataset,
}) => {
  const qc = useQueryClient();
  const expanded = useSettingsStore((s) => s.datasetFolderExpanded);
  const set = useSettingsStore.setState;

  const { data: folders } = useGetUserFolders({
    query: { queryKey: getGetUserFoldersQueryKey() },
  });

  const tree = useMemo(
    () => buildLibraryTree(folders ?? [], datasets),
    [folders, datasets],
  );

  // ─── Mutations ───────────────────────────────────────────────────────────
  const postFolder = usePostUserFolders();
  const renameFolder = usePatchUserFoldersIdRename();
  const moveFolder = usePatchUserFoldersIdMove();
  const duplicateFolder = usePostUserFoldersIdDuplicate();
  const deleteFolder = useDeleteUserFoldersId();
  const deleteDataset = useDeleteUserDatasetsId();
  const moveDataset = usePatchUserDatasetsIdMove();
  const renameDataset = usePatchUserDatasetsIdRename();
  const duplicateDataset = usePostUserDatasetsIdDuplicate();

  const invalidateAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetUserFoldersQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
  }, [qc]);

  // ─── Inline rename state ─────────────────────────────────────────────────
  const [renaming, setRenaming] = useState<{ kind: "folder" | "dataset"; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  // ─── Confirm-delete state ────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: "folder"; id: string; name: string; hasChildren: boolean; recursive: boolean }
    | { kind: "dataset"; id: string; name: string }
    | null
  >(null);

  // ─── Move-to dialog state ────────────────────────────────────────────────
  const [moveTarget, setMoveTarget] = useState<
    | {
        kind: "folder" | "dataset";
        id: string;
        name: string;
        currentParentId: string | null;
      }
    | null
  >(null);

  // ─── Drag state ──────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState<DragData | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // ─── Keyboard navigation state ───────────────────────────────────────────
  // We use HTML `tabindex` per row + arrow navigation via focus manipulation.

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const setExpand = useCallback(
    (id: string, val: boolean) => {
      set((s) => ({
        datasetFolderExpanded: { ...s.datasetFolderExpanded, [id]: val },
      }));
    },
    [set],
  );

  const toggleExpand = useCallback(
    (id: string) => setExpand(id, !(expanded[id] ?? false)),
    [expanded, setExpand],
  );

  const handleMoveConfirm = useCallback(
    (targetFolderId: string | null) => {
      if (!moveTarget) return;
      // Keep the Move-to dialog mounted while the mutation is in flight so
      // the Move button can show its spinner; close it on settle (success
      // or error) instead of synchronously after dispatch.
      if (moveTarget.kind === "folder") {
        moveFolder.mutate(
          { id: moveTarget.id, data: { parentId: targetFolderId } },
          {
            onSuccess: () => {
              if (targetFolderId) setExpand(targetFolderId, true);
              invalidateAll();
            },
            onError: (err) =>
              setError(err instanceof Error ? err.message : "Move failed"),
            onSettled: () => setMoveTarget(null),
          },
        );
      } else {
        moveDataset.mutate(
          { id: moveTarget.id, data: { folderId: targetFolderId } },
          {
            onSuccess: () => {
              if (targetFolderId) setExpand(targetFolderId, true);
              invalidateAll();
            },
            onError: (err) =>
              setError(err instanceof Error ? err.message : "Move failed"),
            onSettled: () => setMoveTarget(null),
          },
        );
      }
    },
    [moveTarget, moveFolder, moveDataset, setExpand, invalidateAll],
  );

  const beginRename = (kind: "folder" | "dataset", id: string, current: string) => {
    setRenaming({ kind, id });
    setRenameValue(current);
    setError(null);
  };

  const commitRename = useCallback(() => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) {
      setRenaming(null);
      return;
    }
    const mutation = renaming.kind === "folder" ? renameFolder : renameDataset;
    mutation.mutate(
      { id: renaming.id, data: { name } },
      {
        onSuccess: () => {
          setRenaming(null);
          invalidateAll();
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Rename failed"),
      },
    );
  }, [renaming, renameValue, renameFolder, renameDataset, invalidateAll]);

  const handleNewFolder = (parentId: string | null) => {
    const siblings =
      parentId === null
        ? tree.roots.map((r) => r.folder)
        : tree.byId.get(parentId)?.children.map((c) => c.folder) ?? [];
    const name = suggestUniqueName(siblings, "New folder");
    postFolder.mutate(
      { data: { name, parentId } },
      {
        onSuccess: (created) => {
          if (parentId) setExpand(parentId, true);
          invalidateAll();
          // Begin renaming the freshly-created folder
          setTimeout(() => beginRename("folder", created.id, created.name), 50);
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Could not create folder"),
      },
    );
  };

  const handleDuplicateFolder = (id: string) =>
    duplicateFolder.mutate({ id }, { onSuccess: invalidateAll });
  const handleDuplicateDataset = (id: string) =>
    duplicateDataset.mutate({ id }, { onSuccess: invalidateAll });

  const handleDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.kind === "dataset") {
      deleteDataset.mutate(
        { id: confirmDelete.id },
        {
          onSuccess: invalidateAll,
          onSettled: () => setConfirmDelete(null),
        },
      );
    } else {
      // Recursive delete (mode: "contents") is required when the folder has
      // children; for empty folders we still send "contents" since the API
      // treats it as a no-op. The recursive flag is captured at confirm-time
      // so the user explicitly opts into deleting the children they saw.
      const mode = confirmDelete.recursive ? "contents" : "contents";
      deleteFolder.mutate(
        { id: confirmDelete.id, data: { mode } },
        {
          onSuccess: invalidateAll,
          onSettled: () => setConfirmDelete(null),
        },
      );
    }
  };

  // Compute the set of folder ids and dataset ids currently being deleted
  // by a pending deleteFolder mutation (the target folder itself + all of
  // its descendant folders + every dataset under any of those folders).
  // This lets us dim the entire subtree while the recursive delete is in
  // flight, mirroring the per-dataset dimming we already do.
  const pendingDeleteFolderId =
    deleteFolder.isPending ? deleteFolder.variables?.id ?? null : null;
  const { deletingFolderIds, deletingDatasetIds } = useMemo(() => {
    const folderIds = new Set<string>();
    const datasetIds = new Set<string>();
    if (pendingDeleteFolderId) {
      const descendants = descendantFolderIds(tree.byId, pendingDeleteFolderId);
      folderIds.add(pendingDeleteFolderId);
      descendants.forEach((id) => folderIds.add(id));
      for (const ds of datasets) {
        if (ds.folderId && folderIds.has(ds.folderId)) {
          datasetIds.add(ds.id);
        }
      }
    }
    return { deletingFolderIds: folderIds, deletingDatasetIds: datasetIds };
  }, [pendingDeleteFolderId, tree.byId, datasets]);

  // Same idea for in-flight moves (Move-to dialog + drag-and-drop): dim the
  // moving folder + its descendant subtree (or the moving dataset row) until
  // the mutation settles, so the tree gives visible feedback during the move.
  const pendingMoveFolderId =
    moveFolder.isPending ? moveFolder.variables?.id ?? null : null;
  const pendingMoveDatasetId =
    moveDataset.isPending ? moveDataset.variables?.id ?? null : null;
  const { movingFolderIds, movingDatasetIds } = useMemo(() => {
    const folderIds = new Set<string>();
    const datasetIds = new Set<string>();
    if (pendingMoveFolderId) {
      const descendants = descendantFolderIds(tree.byId, pendingMoveFolderId);
      folderIds.add(pendingMoveFolderId);
      descendants.forEach((id) => folderIds.add(id));
      for (const ds of datasets) {
        if (ds.folderId && folderIds.has(ds.folderId)) {
          datasetIds.add(ds.id);
        }
      }
    }
    if (pendingMoveDatasetId) datasetIds.add(pendingMoveDatasetId);
    return { movingFolderIds: folderIds, movingDatasetIds: datasetIds };
  }, [pendingMoveFolderId, pendingMoveDatasetId, tree.byId, datasets]);

  // ─── Drag & drop ─────────────────────────────────────────────────────────
  const handleDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as DragData | undefined;
    if (d) setDragging(d);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const drag = e.active.data.current as DragData | undefined;
    const overId = e.over?.id;
    if (!drag || overId === undefined) return;
    const targetFolderId = overId === "__root__" ? null : String(overId);

    // No-op when target equals current parent
    if (drag.parentId === targetFolderId) return;

    if (drag.kind === "folder") {
      // Prevent moving into self/descendant
      if (
        targetFolderId !== null &&
        isDescendantOf(tree.byId, drag.id, targetFolderId)
      ) {
        setError("Cannot move a folder into itself");
        return;
      }
      moveFolder.mutate(
        { id: drag.id, data: { parentId: targetFolderId } },
        {
          onSuccess: () => {
            if (targetFolderId) setExpand(targetFolderId, true);
            invalidateAll();
          },
          onError: (err) => setError(err instanceof Error ? err.message : "Move failed"),
        },
      );
    } else {
      moveDataset.mutate(
        { id: drag.id, data: { folderId: targetFolderId } },
        {
          onSuccess: () => {
            if (targetFolderId) setExpand(targetFolderId, true);
            invalidateAll();
          },
          onError: (err) => setError(err instanceof Error ? err.message : "Move failed"),
        },
      );
    }
  };

  // ─── Context menus ───────────────────────────────────────────────────────
  const showFolderMenu = (e: React.MouseEvent, node: FolderNode) => {
    e.preventDefault();
    e.stopPropagation();
    useContextMenuStore.getState().show(e.clientX, e.clientY, [
      {
        label: "New folder inside",
        icon: "+",
        onClick: () => handleNewFolder(node.folder.id),
      },
      { label: "", separator: true, onClick: () => {} },
      {
        label: "Rename",
        icon: "✎",
        onClick: () => beginRename("folder", node.folder.id, node.folder.name),
      },
      {
        label: "Duplicate",
        icon: "⎘",
        onClick: () => handleDuplicateFolder(node.folder.id),
      },
      {
        label: "Move to…",
        icon: "→",
        onClick: () =>
          setMoveTarget({
            kind: "folder",
            id: node.folder.id,
            name: node.folder.name,
            currentParentId: node.folder.parentId ?? null,
          }),
      },
      { label: "", separator: true, onClick: () => {} },
      {
        label: "Delete folder…",
        icon: "✕",
        onClick: () => {
          const hasChildren = node.children.length > 0 || node.datasets.length > 0;
          setConfirmDelete({
            kind: "folder",
            id: node.folder.id,
            name: node.folder.name,
            hasChildren,
            recursive: hasChildren,
          });
        },
      },
    ]);
  };

  const showDatasetMenu = (e: React.MouseEvent, ds: UserDatasetMeta) => {
    e.preventDefault();
    e.stopPropagation();
    useContextMenuStore.getState().show(e.clientX, e.clientY, [
      { label: "Open", icon: "▶", onClick: () => onSelectDataset(ds) },
      { label: "", separator: true, onClick: () => {} },
      {
        label: "Rename",
        icon: "✎",
        onClick: () => beginRename("dataset", ds.id, ds.name),
      },
      {
        label: "Duplicate",
        icon: "⎘",
        onClick: () => handleDuplicateDataset(ds.id),
      },
      {
        label: "Move to…",
        icon: "→",
        onClick: () =>
          setMoveTarget({
            kind: "dataset",
            id: ds.id,
            name: ds.name,
            currentParentId: ds.folderId ?? null,
          }),
      },
      { label: "", separator: true, onClick: () => {} },
      {
        label: "Delete…",
        icon: "✕",
        onClick: () => setConfirmDelete({ kind: "dataset", id: ds.id, name: ds.name }),
      },
    ]);
  };

  // ─── Render helpers ──────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);

  // React-managed ordered list of focusable rows + a ref-map for keyboard
  // navigation. Built during render so it always reflects the current
  // expanded/collapsed state and stays in lock-step with React reconciliation
  // (no DOM querySelector traversal needed).
  type TreeRowKey = { id: string; kind: "folder" | "dataset" };
  const rowOrderRef = useRef<TreeRowKey[]>([]);
  const rowOrderBuilder = useRef<TreeRowKey[]>([]);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const registerRow = useCallback((kind: "folder" | "dataset", id: string, el: HTMLElement | null) => {
    const key = `${kind}:${id}`;
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  }, []);

  // Reset the builder at the start of each render and commit at the end.
  rowOrderBuilder.current = [];
  const trackRow = (kind: "folder" | "dataset", id: string) => {
    rowOrderBuilder.current.push({ kind, id });
  };
  useEffect(() => {
    rowOrderRef.current = rowOrderBuilder.current;
  });

  const focusRow = (key: TreeRowKey) => {
    rowRefs.current.get(`${key.kind}:${key.id}`)?.focus();
  };

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (renaming) return;
    const order = rowOrderRef.current;
    if (order.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const activeKind = active?.dataset["kind"] as "folder" | "dataset" | undefined;
    const activeId = active?.dataset["id"];
    const idx =
      activeKind && activeId
        ? order.findIndex((r) => r.kind === activeKind && r.id === activeId)
        : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = order[idx < 0 ? 0 : Math.min(order.length - 1, idx + 1)];
      if (next) focusRow(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = order[Math.max(0, idx - 1)];
      if (prev) focusRow(prev);
    } else if (e.key === "ArrowRight" && activeKind === "folder" && activeId) {
      e.preventDefault();
      setExpand(activeId, true);
    } else if (e.key === "ArrowLeft" && activeKind === "folder" && activeId) {
      e.preventDefault();
      setExpand(activeId, false);
    } else if (e.key === "Enter" && activeKind && activeId) {
      e.preventDefault();
      if (activeKind === "folder") {
        toggleExpand(activeId);
      } else {
        const ds = datasets.find((d) => d.id === activeId);
        if (ds) onSelectDataset(ds);
      }
    } else if (e.key === "F2" && activeKind && activeId) {
      e.preventDefault();
      if (activeKind === "folder") {
        const node = tree.byId.get(activeId);
        if (node) beginRename("folder", activeId, node.folder.name);
      } else {
        const ds = datasets.find((d) => d.id === activeId);
        if (ds) beginRename("dataset", activeId, ds.name);
      }
    }
  };

  const renderRenameInput = (defaultValue: string) => (
    <input
      autoFocus
      value={renameValue}
      onChange={(e) => setRenameValue(e.target.value)}
      onBlur={commitRename}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commitRename();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setRenaming(null);
          setRenameValue(defaultValue);
        }
      }}
      data-testid="folder-tree-rename-input"
      style={{
        background: "rgba(0,229,255,0.08)",
        border: "1px solid rgba(0,229,255,0.45)",
        color: "#cbd5e1",
        font: "inherit",
        padding: "1px 4px",
        borderRadius: 2,
        width: "100%",
        outline: "none",
      }}
    />
  );

  const renderFolderRow = (node: FolderNode) => {
    const isExpanded = expanded[node.folder.id] ?? false;
    const isRenaming = renaming?.kind === "folder" && renaming.id === node.folder.id;
    const isDraggingThis = dragging?.kind === "folder" && dragging.id === node.folder.id;
    // A folder dims while it's being deleted OR while it (or an ancestor)
    // is being moved — both flows want the same "operation in flight"
    // affordance on the row and its subtree.
    const deleting =
      deletingFolderIds.has(node.folder.id) ||
      movingFolderIds.has(node.folder.id);
    trackRow("folder", node.folder.id);
    return (
      <FolderRow
        key={node.folder.id}
        node={node}
        isExpanded={isExpanded}
        onToggle={() => toggleExpand(node.folder.id)}
        onContextMenu={(e) => showFolderMenu(e, node)}
        onDoubleClick={() => beginRename("folder", node.folder.id, node.folder.name)}
        isRenaming={isRenaming}
        renameInput={isRenaming ? renderRenameInput(node.folder.name) : null}
        isDraggingThis={isDraggingThis}
        deleting={deleting}
        registerRow={registerRow}
      />
    );
  };

  const renderDatasetRow = (ds: UserDatasetMeta, depth: number) => {
    const active = ds.id === activeUserDatasetId;
    const loading = ds.id === loadingId;
    // Drive the "deleting" UX directly from the mutation state so the row
    // dims and disables as soon as the mutation begins, with no extra state
    // to thread through props. A dataset also dims when an ancestor folder
    // is being recursively deleted.
    const deleting =
      (deleteDataset.isPending && deleteDataset.variables?.id === ds.id) ||
      deletingDatasetIds.has(ds.id) ||
      movingDatasetIds.has(ds.id);
    const isRenaming = renaming?.kind === "dataset" && renaming.id === ds.id;
    trackRow("dataset", ds.id);
    return (
      <DatasetRow
        key={ds.id}
        ds={ds}
        depth={depth}
        active={active}
        loading={loading}
        deleting={deleting}
        onClick={() => onSelectDataset(ds)}
        onContextMenu={(e) => showDatasetMenu(e, ds)}
        onDoubleClick={() => beginRename("dataset", ds.id, ds.name)}
        isRenaming={isRenaming}
        renameInput={isRenaming ? renderRenameInput(ds.name) : null}
        isDragging={dragging?.kind === "dataset" && dragging.id === ds.id}
        registerRow={registerRow}
      />
    );
  };

  const renderFolder = (node: FolderNode): React.ReactNode => {
    const isExpanded = expanded[node.folder.id] ?? false;
    return (
      <React.Fragment key={node.folder.id}>
        {renderFolderRow(node)}
        {isExpanded && (
          <div>
            {node.children.map((c) => renderFolder(c))}
            {node.datasets.map((d) => renderDatasetRow(d, node.depth + 1))}
          </div>
        )}
      </React.Fragment>
    );
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        ref={containerRef}
        onKeyDown={onTreeKeyDown}
        data-testid="dataset-folder-tree"
        style={{ outline: "none" }}
      >
        {/* Header with "+ New folder" */}
        <div
          className="px-3 py-1 flex items-center justify-between gap-2"
          style={{ fontSize: 9, letterSpacing: "0.12em", color: "#334155" }}
        >
          <span>▲ MY LIBRARY</span>
          <button
            data-testid="btn-new-folder"
            onClick={() => handleNewFolder(null)}
            title="New folder"
            style={{
              background: "transparent",
              border: "1px solid rgba(0,229,255,0.3)",
              color: "#00e5ff",
              fontSize: 10,
              padding: "0 6px",
              borderRadius: 2,
              cursor: "pointer",
              lineHeight: 1.6,
            }}
          >
            + folder
          </button>
        </div>

        {error && (
          <div
            data-testid="folder-tree-error"
            style={{
              margin: "4px 8px",
              padding: "4px 8px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.35)",
              borderRadius: 3,
              fontSize: 10,
              color: "#fca5a5",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              style={{
                background: "transparent",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                fontSize: 10,
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Root drop zone (drop here to move to top level) */}
        <RootDropZone enabled={dragging !== null && dragging.parentId !== null} />

        {tree.roots.map((r) => renderFolder(r))}
        {tree.rootDatasets.map((d) => renderDatasetRow(d, 0))}

        {tree.roots.length === 0 && tree.rootDatasets.length === 0 && (
          <div style={{ fontSize: 9, color: "#334155", padding: "4px 12px 8px" }}>
            No saved terrains yet
          </div>
        )}

        {/* Move-to dialog */}
        {moveTarget && (
          <MoveToDialog
            tree={tree}
            target={moveTarget}
            isPending={
              (moveTarget.kind === "folder"
                ? moveFolder.isPending &&
                  moveFolder.variables?.id === moveTarget.id
                : moveDataset.isPending &&
                  moveDataset.variables?.id === moveTarget.id) || false
            }
            onCancel={() => setMoveTarget(null)}
            onConfirm={handleMoveConfirm}
          />
        )}

        {/* Confirm delete dialog */}
        {confirmDelete && (
          <ConfirmDialog
            title={
              confirmDelete.kind === "folder"
                ? `Delete folder "${confirmDelete.name}"?`
                : `Delete "${confirmDelete.name}"?`
            }
            message={
              confirmDelete.kind === "folder"
                ? confirmDelete.hasChildren
                  ? "Everything inside this folder will be permanently deleted."
                  : "This folder will be permanently deleted."
                : "This terrain will be permanently deleted."
            }
            isPending={
              confirmDelete.kind === "folder"
                ? deleteFolder.isPending &&
                  deleteFolder.variables?.id === confirmDelete.id
                : deleteDataset.isPending &&
                  deleteDataset.variables?.id === confirmDelete.id
            }
            onCancel={() => setConfirmDelete(null)}
            onConfirm={handleDelete}
          />
        )}
      </div>
    </DndContext>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components

interface FolderRowProps {
  node: FolderNode;
  isExpanded: boolean;
  isRenaming: boolean;
  isDraggingThis: boolean;
  deleting: boolean;
  renameInput: React.ReactNode;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  registerRow: (kind: "folder" | "dataset", id: string, el: HTMLElement | null) => void;
}

const FolderRow: React.FC<FolderRowProps> = ({
  node,
  isExpanded,
  isRenaming,
  isDraggingThis,
  deleting,
  renameInput,
  onToggle,
  onContextMenu,
  onDoubleClick,
  registerRow,
}) => {
  const indent = node.depth * INDENT_PX;
  const dragData: DragData = {
    kind: "folder",
    id: node.folder.id,
    parentId: node.folder.parentId ?? null,
  };
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
  } = useDraggable({
    id: `folder:${node.folder.id}`,
    data: dragData,
    disabled: isRenaming,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: node.folder.id,
    data: { kind: "folder", id: node.folder.id },
  });

  // Compose refs
  const composedRef = (n: HTMLDivElement | null) => {
    setDragRef(n);
    setDropRef(n);
    registerRow("folder", node.folder.id, n);
  };

  return (
    <div
      ref={composedRef}
      data-tree-row
      data-kind="folder"
      data-id={node.folder.id}
      data-testid={`folder-row-${node.folder.id}`}
      data-deleting={deleting ? "true" : undefined}
      aria-busy={deleting || undefined}
      {...attributes}
      {...listeners}
      tabIndex={deleting ? -1 : 0}
      onContextMenu={deleting ? undefined : onContextMenu}
      onDoubleClick={deleting ? undefined : onDoubleClick}
      onClick={deleting ? undefined : onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: `4px ${ROW_PADDING_X}px 4px ${ROW_PADDING_X + indent}px`,
        cursor: deleting ? "wait" : "pointer",
        fontSize: 11,
        color: "#cbd5e1",
        background: isOver ? "rgba(0,229,255,0.12)" : "transparent",
        outline: "none",
        opacity: deleting || isDraggingThis ? 0.4 : 1,
        pointerEvents: deleting ? "none" : undefined,
        userSelect: "none",
      }}
    >
      <span style={{ color: "#64748b", width: 20, textAlign: "center", fontSize: 20, lineHeight: 1 }}>
        {isExpanded ? "▾" : "▸"}
      </span>
      <span style={{ color: "#00e5ff" }}>▣</span>
      {isRenaming ? (
        <div style={{ flex: 1 }}>{renameInput}</div>
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: "normal",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          {node.folder.name}
        </span>
      )}
    </div>
  );
};

interface DatasetRowProps {
  ds: UserDatasetMeta;
  depth: number;
  active: boolean;
  loading: boolean;
  deleting: boolean;
  isRenaming: boolean;
  isDragging: boolean;
  renameInput: React.ReactNode;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  registerRow: (kind: "folder" | "dataset", id: string, el: HTMLElement | null) => void;
}

const DatasetRow: React.FC<DatasetRowProps> = ({
  ds,
  depth,
  active,
  loading,
  deleting,
  isRenaming,
  isDragging,
  renameInput,
  onClick,
  onContextMenu,
  onDoubleClick,
  registerRow,
}) => {
  const indent = depth * INDENT_PX;
  const units = useSettingsStore((s) => s.units);
  const date = new Date(ds.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const dragData: DragData = {
    kind: "dataset",
    id: ds.id,
    parentId: ds.folderId ?? null,
  };
  const {
    attributes,
    listeners,
    setNodeRef,
  } = useDraggable({
    id: `dataset:${ds.id}`,
    data: dragData,
    disabled: isRenaming,
  });

  const composedRef = (n: HTMLDivElement | null) => {
    setNodeRef(n);
    registerRow("dataset", ds.id, n);
  };

  return (
    <div
      ref={composedRef}
      data-tree-row
      data-kind="dataset"
      data-id={ds.id}
      data-testid={`btn-user-dataset-${ds.id}`}
      data-deleting={deleting ? "true" : undefined}
      aria-busy={deleting || undefined}
      {...attributes}
      {...listeners}
      tabIndex={deleting ? -1 : 0}
      role="button"
      onClick={deleting ? undefined : onClick}
      onContextMenu={deleting ? undefined : onContextMenu}
      onDoubleClick={deleting ? undefined : onDoubleClick}
      style={{
        display: "block",
        padding: `4px ${ROW_PADDING_X}px 4px ${ROW_PADDING_X + indent + 16}px`,
        background: active ? "rgba(0,229,255,0.07)" : "transparent",
        borderLeft: active
          ? "2px solid rgba(0,229,255,0.6)"
          : "2px solid transparent",
        cursor: deleting ? "wait" : "pointer",
        opacity: deleting || isDragging ? 0.4 : 1,
        pointerEvents: deleting ? "none" : undefined,
        outline: "none",
        userSelect: "none",
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <UserDatasetVisibilityToggle datasetId={ds.id} />
        {isRenaming ? (
          <div style={{ flex: 1 }}>{renameInput}</div>
        ) : (
          <span
            style={{
              fontSize: 11,
              fontWeight: active ? 700 : 400,
              color: active ? "#00e5ff" : "#94a3b8",
              textShadow: active ? "0 0 6px rgba(0,229,255,0.3)" : "none",
              flex: 1,
              minWidth: 0,
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {ds.name}
          </span>
        )}
        {loading && (
          <span className="animate-pulse" style={{ fontSize: 9, color: "#00e5ff" }}>◌</span>
        )}
      </div>
      <div
        style={{
          fontSize: 9,
          color: "#334155",
          marginTop: 1,
          letterSpacing: "0.05em",
          display: "flex",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {formatDepthRange(ds.minDepth, ds.maxDepth, { units })}
        </span>
        <span style={{ color: "#1e293b", flexShrink: 0 }}>{date}</span>
      </div>
    </div>
  );
};

// ─── Per-row eye toggle for user-uploaded datasets (Task #350) ───────────────
const UserDatasetVisibilityToggle: React.FC<{ datasetId: string }> = ({
  datasetId,
}) => {
  const visible = useTerrainStore(
    (s) => s.visibleDatasets.some((v) => v.datasetId === datasetId),
  );
  const isPrimary = useTerrainStore((s) => s.primaryDatasetId === datasetId);
  const toggleVisible = useTerrainStore((s) => s.toggleVisible);
  return (
    <button
      type="button"
      data-testid={`btn-visibility-user-${datasetId}`}
      aria-pressed={visible}
      onClick={(e) => {
        e.stopPropagation();
        toggleVisible({ datasetId, source: "user" });
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: 18,
        flexShrink: 0,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: visible ? (isPrimary ? "#00e5ff" : "#7dd3fc") : "#475569",
        fontSize: 11,
        lineHeight: 1,
        padding: 0,
      }}
    >
      {visible ? (isPrimary ? "◉" : "◎") : "○"}
    </button>
  );
};

const RootDropZone: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const { setNodeRef, isOver } = useDroppable({ id: "__root__", data: { kind: "root" } });
  if (!enabled) return null;
  return (
    <div
      ref={setNodeRef}
      data-testid="dataset-root-drop"
      style={{
        margin: "4px 8px",
        padding: "4px 8px",
        border: `1px dashed ${isOver ? "rgba(0,229,255,0.6)" : "rgba(0,229,255,0.2)"}`,
        borderRadius: 3,
        textAlign: "center",
        fontSize: 9,
        color: isOver ? "#00e5ff" : "#475569",
        background: isOver ? "rgba(0,229,255,0.06)" : "transparent",
      }}
    >
      Drop here to move to top level
    </div>
  );
};

interface MoveOption {
  /** null = library root */
  id: string | null;
  label: string;
  depth: number;
  disabled: boolean;
  disabledReason?: string;
}

function buildMoveOptions(
  tree: LibraryTree,
  target: { kind: "folder" | "dataset"; id: string; currentParentId: string | null },
): MoveOption[] {
  const blocked =
    target.kind === "folder"
      ? descendantFolderIds(tree.byId, target.id)
      : new Set<string>();
  const opts: MoveOption[] = [];
  opts.push({
    id: null,
    label: "Library root",
    depth: 0,
    disabled: target.currentParentId === null,
    disabledReason:
      target.currentParentId === null ? "Already here" : undefined,
  });
  const walk = (nodes: FolderNode[], depth: number) => {
    for (const n of nodes) {
      const isSelf = target.kind === "folder" && n.folder.id === target.id;
      const isDescendant = blocked.has(n.folder.id);
      const isCurrent = n.folder.id === target.currentParentId;
      const disabled = isSelf || isDescendant || isCurrent;
      let reason: string | undefined;
      if (isCurrent) reason = "Already here";
      else if (isSelf) reason = "Cannot move into itself";
      else if (isDescendant) reason = "Cannot move into a subfolder";
      opts.push({
        id: n.folder.id,
        label: n.folder.name,
        depth: depth + 1,
        disabled,
        disabledReason: reason,
      });
      walk(n.children, depth + 1);
    }
  };
  walk(tree.roots, 0);
  return opts;
}

const MoveToDialog: React.FC<{
  tree: LibraryTree;
  target: {
    kind: "folder" | "dataset";
    id: string;
    name: string;
    currentParentId: string | null;
  };
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: (targetFolderId: string | null) => void;
}> = ({ tree, target, isPending = false, onCancel, onConfirm }) => {
  const options = useMemo(() => buildMoveOptions(tree, target), [tree, target]);
  const firstEnabledIdx = options.findIndex((o) => !o.disabled);
  const [selectedIdx, setSelectedIdx] = useState<number>(
    firstEnabledIdx >= 0 ? firstEnabledIdx : 0,
  );
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Focus the listbox so arrow keys work immediately.
    listRef.current?.focus();
  }, []);

  const moveSelection = (dir: 1 | -1) => {
    if (options.length === 0) return;
    let i = selectedIdx;
    for (let step = 0; step < options.length; step++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i]!.disabled) {
        setSelectedIdx(i);
        return;
      }
    }
  };

  const selected = options[selectedIdx];
  const canConfirm = !!selected && !selected.disabled;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (canConfirm && !isPending) onConfirm(selected!.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (!isPending) onCancel();
    }
  };

  return (
    <div
      data-testid="move-to-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={`Move ${target.name}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={isPending ? undefined : onCancel}
      aria-busy={isPending || undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(0,10,20,0.95)",
          border: "1px solid rgba(0,229,255,0.35)",
          borderRadius: 6,
          padding: 18,
          width: 360,
          maxWidth: "90vw",
          color: "#cbd5e1",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4, color: "#00e5ff" }}>
          Move "{target.name}" to…
        </div>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 10 }}>
          Choose a destination folder
        </div>
        <div
          ref={listRef}
          tabIndex={0}
          role="listbox"
          aria-activedescendant={
            selected ? `move-opt-${selected.id ?? "__root__"}` : undefined
          }
          onKeyDown={onKeyDown}
          style={{
            maxHeight: 260,
            overflowY: "auto",
            border: "1px solid rgba(148,163,184,0.18)",
            borderRadius: 3,
            background: "rgba(0,0,0,0.25)",
            outline: "none",
            marginBottom: 12,
          }}
        >
          {options.map((opt, idx) => {
            const sel = idx === selectedIdx;
            return (
              <div
                key={opt.id ?? "__root__"}
                id={`move-opt-${opt.id ?? "__root__"}`}
                role="option"
                aria-selected={sel}
                aria-disabled={opt.disabled}
                data-testid={`move-opt-${opt.id ?? "__root__"}`}
                onClick={() => {
                  if (opt.disabled || isPending) return;
                  setSelectedIdx(idx);
                }}
                onDoubleClick={() => {
                  if (!opt.disabled && !isPending) onConfirm(opt.id);
                }}
                title={opt.disabledReason}
                style={{
                  padding: `4px ${8 + opt.depth * 12}px`,
                  fontSize: 11,
                  cursor: opt.disabled ? "not-allowed" : "pointer",
                  color: opt.disabled
                    ? "#475569"
                    : sel
                      ? "#00e5ff"
                      : "#cbd5e1",
                  background: sel
                    ? "rgba(0,229,255,0.10)"
                    : "transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ color: opt.disabled ? "#334155" : "#64748b" }}>
                  {opt.id === null ? "/" : "▣"}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.label}
                </span>
                {opt.disabled && opt.disabledReason && (
                  <span style={{ fontSize: 9, color: "#475569" }}>
                    {opt.disabledReason}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={isPending}
            data-testid="move-to-cancel"
            style={{
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.4)",
              color: "#94a3b8",
              padding: "4px 12px",
              borderRadius: 3,
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.5 : 1,
              fontSize: 11,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => canConfirm && !isPending && onConfirm(selected!.id)}
            disabled={!canConfirm || isPending}
            data-testid="move-to-confirm"
            style={{
              background: canConfirm
                ? isPending
                  ? "rgba(0,229,255,0.10)"
                  : "rgba(0,229,255,0.18)"
                : "rgba(100,116,139,0.12)",
              border: `1px solid ${canConfirm ? "rgba(0,229,255,0.55)" : "rgba(100,116,139,0.3)"}`,
              color: canConfirm ? "#00e5ff" : "#475569",
              padding: "4px 12px",
              borderRadius: 3,
              cursor: isPending
                ? "wait"
                : canConfirm
                  ? "pointer"
                  : "not-allowed",
              opacity: isPending ? 0.7 : 1,
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isPending && (
              <span
                className="animate-spin"
                aria-hidden="true"
                data-testid="move-to-spinner"
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: "1.5px solid rgba(0,229,255,0.35)",
                  borderTopColor: "#00e5ff",
                }}
              />
            )}
            {isPending ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ConfirmDialog: React.FC<{
  title: string;
  message: string;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ title, message, isPending = false, onCancel, onConfirm }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, isPending]);

  return (
    <div
      data-testid="confirm-delete-dialog"
      aria-busy={isPending || undefined}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={isPending ? undefined : onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(0,10,20,0.95)",
          border: "1px solid rgba(239,68,68,0.45)",
          borderRadius: 6,
          padding: 18,
          maxWidth: 340,
          color: "#cbd5e1",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8, color: "#fca5a5" }}>{title}</div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14 }}>{message}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={isPending}
            data-testid="confirm-delete-cancel"
            style={{
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.4)",
              color: "#94a3b8",
              padding: "4px 12px",
              borderRadius: 3,
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.5 : 1,
              fontSize: 11,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            data-testid="confirm-delete-confirm"
            autoFocus
            style={{
              background: isPending
                ? "rgba(239,68,68,0.10)"
                : "rgba(239,68,68,0.18)",
              border: "1px solid rgba(239,68,68,0.55)",
              color: "#fca5a5",
              padding: "4px 12px",
              borderRadius: 3,
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending ? 0.7 : 1,
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isPending && (
              <span
                className="animate-spin"
                aria-hidden="true"
                data-testid="confirm-delete-spinner"
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: "1.5px solid rgba(252,165,165,0.35)",
                  borderTopColor: "#fca5a5",
                }}
              />
            )}
            {isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
};
