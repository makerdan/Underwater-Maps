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
import { useContextMenuStore } from "@/lib/contextMenuStore";
import {
  buildLibraryTree,
  isDescendantOf,
  suggestUniqueName,
  type FolderNode,
} from "@/lib/datasetLibrary";

interface Props {
  datasets: UserDatasetMeta[];
  activeUserDatasetId: string | null;
  loadingId: string | null;
  deletingId: string | null;
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
  deletingId,
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
    | { kind: "folder"; id: string; name: string; hasChildren: boolean }
    | { kind: "dataset"; id: string; name: string }
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
      deleteDataset.mutate({ id: confirmDelete.id }, { onSuccess: invalidateAll });
    } else {
      // Always "contents" mode — recursive delete of folder + everything inside
      deleteFolder.mutate(
        { id: confirmDelete.id, data: { mode: "contents" } },
        { onSuccess: invalidateAll },
      );
    }
    setConfirmDelete(null);
  };

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
      { label: "", separator: true, onClick: () => {} },
      {
        label: "Delete folder…",
        icon: "✕",
        onClick: () =>
          setConfirmDelete({
            kind: "folder",
            id: node.folder.id,
            name: node.folder.name,
            hasChildren: node.children.length > 0 || node.datasets.length > 0,
          }),
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

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (renaming) return;
    const focusables = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? [],
    );
    if (focusables.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? focusables.indexOf(active) : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusables[Math.min(focusables.length - 1, idx + 1) || 0]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusables[Math.max(0, idx - 1)]?.focus();
    } else if (e.key === "ArrowRight" && active?.dataset["kind"] === "folder") {
      e.preventDefault();
      const id = active.dataset["id"]!;
      setExpand(id, true);
    } else if (e.key === "ArrowLeft" && active?.dataset["kind"] === "folder") {
      e.preventDefault();
      const id = active.dataset["id"]!;
      setExpand(id, false);
    } else if (e.key === "Enter" && active) {
      e.preventDefault();
      if (active.dataset["kind"] === "folder") {
        toggleExpand(active.dataset["id"]!);
      } else if (active.dataset["kind"] === "dataset") {
        const id = active.dataset["id"]!;
        const ds = datasets.find((d) => d.id === id);
        if (ds) onSelectDataset(ds);
      }
    } else if (e.key === "F2" && active) {
      e.preventDefault();
      const id = active.dataset["id"]!;
      const kind = active.dataset["kind"] as "folder" | "dataset" | undefined;
      if (kind === "folder") {
        const node = tree.byId.get(id);
        if (node) beginRename("folder", id, node.folder.name);
      } else if (kind === "dataset") {
        const ds = datasets.find((d) => d.id === id);
        if (ds) beginRename("dataset", id, ds.name);
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
      />
    );
  };

  const renderDatasetRow = (ds: UserDatasetMeta, depth: number) => {
    const active = ds.id === activeUserDatasetId;
    const loading = ds.id === loadingId;
    const deleting = ds.id === deletingId;
    const isRenaming = renaming?.kind === "dataset" && renaming.id === ds.id;
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
  renameInput: React.ReactNode;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

const FolderRow: React.FC<FolderRowProps> = ({
  node,
  isExpanded,
  isRenaming,
  isDraggingThis,
  renameInput,
  onToggle,
  onContextMenu,
  onDoubleClick,
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
  };

  return (
    <div
      ref={composedRef}
      data-tree-row
      data-kind="folder"
      data-id={node.folder.id}
      data-testid={`folder-row-${node.folder.id}`}
      {...attributes}
      {...listeners}
      tabIndex={0}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: `4px ${ROW_PADDING_X}px 4px ${ROW_PADDING_X + indent}px`,
        cursor: "pointer",
        fontSize: 11,
        color: "#cbd5e1",
        background: isOver ? "rgba(0,229,255,0.12)" : "transparent",
        outline: "none",
        opacity: isDraggingThis ? 0.4 : 1,
        userSelect: "none",
      }}
    >
      <span style={{ color: "#64748b", width: 10, textAlign: "center" }}>
        {isExpanded ? "▾" : "▸"}
      </span>
      <span style={{ color: "#00e5ff" }}>▣</span>
      {isRenaming ? (
        <div style={{ flex: 1 }}>{renameInput}</div>
      ) : (
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
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
}) => {
  const indent = depth * INDENT_PX;
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

  return (
    <div
      ref={setNodeRef}
      data-tree-row
      data-kind="dataset"
      data-id={ds.id}
      data-testid={`btn-user-dataset-${ds.id}`}
      {...attributes}
      {...listeners}
      tabIndex={0}
      role="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      style={{
        display: "block",
        padding: `4px ${ROW_PADDING_X}px 4px ${ROW_PADDING_X + indent + 16}px`,
        background: active ? "rgba(0,229,255,0.07)" : "transparent",
        borderLeft: active
          ? "2px solid rgba(0,229,255,0.6)"
          : "2px solid transparent",
        cursor: "pointer",
        opacity: deleting || isDragging ? 0.4 : 1,
        outline: "none",
        userSelect: "none",
      }}
    >
      <div className="flex items-center justify-between">
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
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
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
        }}
      >
        <span>
          {ds.minDepth}m – {ds.maxDepth}m
        </span>
        <span style={{ color: "#1e293b" }}>{date}</span>
      </div>
    </div>
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

const ConfirmDialog: React.FC<{
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ title, message, onCancel, onConfirm }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      data-testid="confirm-delete-dialog"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={onCancel}
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
            data-testid="confirm-delete-cancel"
            style={{
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.4)",
              color: "#94a3b8",
              padding: "4px 12px",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            data-testid="confirm-delete-confirm"
            autoFocus
            style={{
              background: "rgba(239,68,68,0.18)",
              border: "1px solid rgba(239,68,68,0.55)",
              color: "#fca5a5",
              padding: "4px 12px",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};
