/**
 * MobileDatasetPicker — MOBILE-ONLY: compact dataset switcher for the mobile
 * Chart View. The full Explore sidebar (DatasetPanel) is not shown on mobile;
 * this reduced picker lists the catalog datasets for the active water type
 * plus the signed-in user's uploaded datasets, and switches the chosen
 * dataset with a single tap.
 *
 * Offline-download support: each row carries an offline-status badge and a
 * per-dataset "⬇" download button; each section has a "⬇ All" shortcut.
 * Tapping either calls the `onDownloadOffline` prop with a ready-to-run
 * `BulkDataset[]` array — the shell host renders `BulkOfflinePanel` from there.
 *
 * Loading plumbing is entirely reused: in Replace mode (default) selecting an
 * entry calls terrainStore.setSinglePrimary(); in Add mode (available once at
 * least one dataset is loaded) it calls addSelected() to stack datasets up to
 * the active cap, mirroring the desktop DatasetPanel multi-dataset flow. The
 * always-mounted VisibleDatasetsLoader fetches the terrain + overview grids
 * exactly as it does for desktop flows.
 */
import React from "react";
import {
  useGetDatasets,
  getGetDatasetsQueryKey,
  useGetUserDatasets,
  getGetUserDatasetsQueryKey,
  useGetUserFolders,
  getGetUserFoldersQueryKey,
  type DatasetMeta,
  type UserDatasetMeta,
} from "@workspace/api-client-react";
import { useTerrainStore, MAX_ACTIVE_DATASETS, type DatasetSource } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useAuth } from "@/lib/clerkCompat";
import { useOfflinePackStatuses, type PackStatus } from "@/hooks/useOfflinePackStatus";
import type { BulkDataset } from "@/hooks/useBulkOfflinePack";
import { buildLibraryTree, type FolderNode } from "@/lib/datasetLibrary";

// ── Helpers to build BulkDataset from catalog/user items ──────────────────

function catalogToBulkDataset(d: DatasetMeta): BulkDataset {
  return { id: d.id, name: d.name, bbox: d.bbox };
}

function userToBulkDataset(d: UserDatasetMeta): BulkDataset {
  return {
    id: d.id,
    name: d.name,
    bbox: d.bbox ?? undefined,
    ...(d.resolutionM != null ? { resolutionM: d.resolutionM } : {}),
  };
}

// ── Picker mode ────────────────────────────────────────────────────────────

/** MOBILE-ONLY: picker tap semantics — "replace" evicts, "add" stacks. */
export type MobilePickerMode = "replace" | "add";

/** Tooltip shown on rows that cannot be added because the active cap is hit. */
const CAP_REACHED_TITLE = "Cap reached — remove a dataset to add another";

// ── Loaded badge ───────────────────────────────────────────────────────────

/** MOBILE-ONLY: inline "● Loaded" indicator for currently-visible datasets. */
function LoadedBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
        color: "#00e5ff",
        background: "rgba(0,229,255,0.12)",
        border: "1px solid rgba(0,229,255,0.3)",
        borderRadius: 4,
        padding: "1px 5px",
        marginLeft: 8,
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', monospace",
      }}
      title="Currently loaded in the chart"
    >
      ● Loaded
    </span>
  );
}

// ── Remove (unload) button ─────────────────────────────────────────────────

/** MOBILE-ONLY: 44×44 touch-target "×" that unloads a visible dataset. */
function RemoveLoadedBtn({
  datasetId,
  name,
  onClick,
}: {
  datasetId: string;
  name: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Unload ${name}`}
      data-testid={`mobile-dataset-remove-${datasetId}`}
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        color: "#f87171",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "calc(18px * var(--bs-font-scale, 1))",
        minWidth: 44,
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      ×
    </button>
  );
}

// ── Offline status badge ───────────────────────────────────────────────────

/** MOBILE-ONLY: compact inline offline-status indicator. */
function OfflineStatusBadge({ status }: { status: PackStatus }) {
  if (status === "none") return null;
  const isStale = status === "stale";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
        color: isStale ? "#fbbf24" : "#4ade80",
        background: isStale ? "rgba(251,191,36,0.12)" : "rgba(74,222,128,0.12)",
        border: `1px solid ${isStale ? "rgba(251,191,36,0.3)" : "rgba(74,222,128,0.3)"}`,
        borderRadius: 4,
        padding: "1px 5px",
        marginLeft: 8,
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', monospace",
      }}
      title={isStale ? "Offline pack saved but tide data has expired" : "Available offline"}
    >
      {isStale ? "⟳ Stale" : "✓ Offline"}
    </span>
  );
}

// ── Download button ────────────────────────────────────────────────────────

/** MOBILE-ONLY: 44×44 touch-target download icon button. */
function DownloadBtn({
  onClick,
  label,
}: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        color: "#94a3b8",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "calc(18px * var(--bs-font-scale, 1))",
        minWidth: 44,
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      ⬇
    </button>
  );
}

// ── Dataset row ───────────────────────────────────────────────────────────

/** MOBILE-ONLY: a single user-dataset row, indented to `depth` levels. */
function UserDatasetRow({
  dataset: d,
  isActive,
  status,
  onSelect,
  onDownload,
  depth,
  isLoadedVisible,
  dimmed,
  onRemove,
}: {
  dataset: UserDatasetMeta;
  isActive: boolean;
  status: PackStatus;
  onSelect: () => void;
  onDownload: () => void;
  depth: number;
  /** True when this dataset is currently in terrainStore.visibleDatasets. */
  isLoadedVisible: boolean;
  /** True when Add mode is at the active cap and this row cannot be added. */
  dimmed: boolean;
  /** Unload handler — shown as a "×" button when the dataset is loaded. */
  onRemove: () => void;
}) {
  const paddingLeft = 16 + depth * 24;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid rgba(0,229,255,0.08)",
        background: isActive ? "rgba(0,229,255,0.12)" : "transparent",
      }}
    >
      {/* Selection target */}
      <button
        type="button"
        data-testid={`mobile-dataset-option-${d.id}`}
        onClick={onSelect}
        aria-disabled={dimmed || undefined}
        title={dimmed ? CAP_REACHED_TITLE : undefined}
        style={{
          flex: 1,
          textAlign: "left",
          background: "transparent",
          border: "none",
          color: isActive ? "#00e5ff" : "#cbd5e1",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "calc(14px * var(--bs-font-scale, 1))",
          padding: `14px 16px 14px ${paddingLeft}px`,
          minHeight: 48,
          cursor: dimmed ? "default" : "pointer",
          opacity: dimmed ? 0.4 : 1,
          display: "flex",
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {d.name}
        </span>
        {isLoadedVisible && <LoadedBadge />}
        <OfflineStatusBadge status={status} />
      </button>
      {/* Unload button for currently-loaded datasets */}
      {isLoadedVisible && (
        <RemoveLoadedBtn
          datasetId={d.id}
          name={d.name}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        />
      )}
      {/* Per-dataset download */}
      <DownloadBtn
        label={`Download ${d.name} offline`}
        onClick={(e) => {
          e.stopPropagation();
          onDownload();
        }}
      />
    </div>
  );
}

// ── Folder grouping ───────────────────────────────────────────────────────

interface MobileDatasetPickerProps {
  onClose: () => void;
  /**
   * Called when the user requests an offline download. Receives a
   * ready-to-use BulkDataset[] and a human-readable scope label.
   * The shell host is responsible for rendering BulkOfflinePanel.
   */
  onDownloadOffline: (datasets: BulkDataset[], scopeLabel: string) => void;
  /**
   * Picker tap semantics — "replace" (default) evicts everything and loads
   * the tapped dataset; "add" stacks datasets up to the active cap. Owned by
   * the shell host so it can reset to "replace" whenever the picker closes.
   */
  mode: MobilePickerMode;
  /** Fired when the user switches the Replace/Add segmented control. */
  onModeChange: (mode: MobilePickerMode) => void;
}

// ── Subtree dataset collector ─────────────────────────────────────────────

/** Collect all datasets in a folder subtree (depth-first, folder order). */
function collectSubtreeDatasets(node: FolderNode): UserDatasetMeta[] {
  const out: UserDatasetMeta[] = [...node.datasets];
  for (const child of node.children) {
    out.push(...collectSubtreeDatasets(child));
  }
  return out;
}

// ── Recursive folder section ──────────────────────────────────────────────

interface FolderSectionProps {
  node: FolderNode;
  packStatuses: Map<string, PackStatus>;
  primaryDatasetId: string | null | undefined;
  onSelect: (datasetId: string) => void;
  onDownloadOffline: (datasets: BulkDataset[], scopeLabel: string) => void;
  sectionDownloadBtnStyle: React.CSSProperties;
  /** IDs of datasets currently in terrainStore.visibleDatasets. */
  visibleIds: ReadonlySet<string>;
  /** True when Add mode is at the active cap (un-loaded rows get dimmed). */
  dimUnloaded: boolean;
  /** Unload a currently-visible dataset (toggleVisible remove path). */
  onRemove: (datasetId: string) => void;
}

/**
 * MOBILE-ONLY: renders one folder level plus its datasets and sub-folders,
 * recursively. Each level is indented by `node.depth` so deeply nested
 * hierarchies remain legible on a phone-sized display.
 */
function FolderSection({
  node,
  packStatuses,
  primaryDatasetId,
  onSelect,
  onDownloadOffline,
  sectionDownloadBtnStyle,
  visibleIds,
  dimUnloaded,
  onRemove,
}: FolderSectionProps) {
  const subtreeDatasets = collectSubtreeDatasets(node);
  // Folder header indentation: 16 px base + 16 px per depth level.
  const headerIndentPx = 16 + node.depth * 16;
  // Dataset rows sit one level deeper than the folder header.
  const datasetDepth = node.depth + 1;

  return (
    <React.Fragment>
      {/* Folder sub-header with its own ⬇ All (scoped to full subtree) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingRight: 4,
          borderBottom: "1px solid rgba(0,229,255,0.08)",
        }}
      >
        <div
          style={{
            padding: `8px 16px 6px ${headerIndentPx}px`,
            color: "#475569",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "calc(10px * var(--bs-font-scale, 1))",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ opacity: 0.6 }}>📁</span>
          {node.folder.name}
        </div>
        <button
          type="button"
          aria-label={`Download all datasets in ${node.folder.name} offline`}
          data-testid={`mobile-picker-download-folder-${node.folder.id}`}
          style={sectionDownloadBtnStyle}
          onClick={() => {
            onDownloadOffline(subtreeDatasets.map(userToBulkDataset), node.folder.name);
          }}
        >
          ⬇ All
        </button>
      </div>

      {/* Datasets directly in this folder */}
      {node.datasets.map((d) => (
        <UserDatasetRow
          key={d.id}
          dataset={d}
          isActive={d.id === primaryDatasetId}
          status={packStatuses.get(d.id) ?? "none"}
          onSelect={() => onSelect(d.id)}
          onDownload={() => onDownloadOffline([userToBulkDataset(d)], d.name)}
          depth={datasetDepth}
          isLoadedVisible={visibleIds.has(d.id)}
          dimmed={dimUnloaded && !visibleIds.has(d.id)}
          onRemove={() => onRemove(d.id)}
        />
      ))}

      {/* Sub-folders (recursive) */}
      {node.children.map((child) => (
        <FolderSection
          key={child.folder.id}
          node={child}
          packStatuses={packStatuses}
          primaryDatasetId={primaryDatasetId}
          onSelect={onSelect}
          onDownloadOffline={onDownloadOffline}
          sectionDownloadBtnStyle={sectionDownloadBtnStyle}
          visibleIds={visibleIds}
          dimUnloaded={dimUnloaded}
          onRemove={onRemove}
        />
      ))}
    </React.Fragment>
  );
}

export const MobileDatasetPicker: React.FC<MobileDatasetPickerProps> = ({
  onClose,
  onDownloadOffline,
  mode,
  onModeChange,
}) => {
  const waterType = useSettingsStore((s) => s.waterType);
  const maxActiveDatasets = useSettingsStore((s) => s.maxActiveDatasets);
  const { isLoaded, isSignedIn } = useAuth();
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);
  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  const packStatuses = useOfflinePackStatuses();

  // Which datasets are currently loaded (all visible datasets are primary).
  const visibleIds = React.useMemo(
    () => new Set(visibleDatasets.map((v) => v.datasetId)),
    [visibleDatasets],
  );
  const activeCap = maxActiveDatasets ?? MAX_ACTIVE_DATASETS;
  const atCap = visibleDatasets.length >= activeCap;
  // Un-loaded rows are dimmed (and taps no-op) only in Add mode at the cap.
  const dimUnloaded = mode === "add" && atCap;

  const { data: datasets, isLoading: datasetsLoading } = useGetDatasets(
    { waterType },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType }) } },
  );
  const { data: userDatasets } = useGetUserDatasets({
    query: {
      enabled: isLoaded && isSignedIn === true,
      queryKey: getGetUserDatasetsQueryKey(),
    },
  });
  const { data: folders = [] } = useGetUserFolders({
    query: {
      enabled: isLoaded && isSignedIn === true,
      queryKey: getGetUserFoldersQueryKey(),
    },
  });

  const libraryTree = React.useMemo(
    () => buildLibraryTree(folders, userDatasets ?? []),
    [userDatasets, folders],
  );

  const select = (datasetId: string, source: DatasetSource) => {
    if (mode === "add") {
      // Add mode: stack the tapped dataset alongside what's loaded and keep
      // the picker open so several datasets can be added in one session.
      if (visibleIds.has(datasetId)) return; // already loaded — no-op
      if (atCap) return; // cap guard — row is dimmed; tap is a no-op
      useTerrainStore.getState().addSelected(datasetId, source);
      return;
    }
    // Replace mode (default): replace ALL visible datasets with the chosen
    // one and let VisibleDatasetsLoader stream its grids in.
    useTerrainStore.getState().setSinglePrimary(datasetId, source);
    onClose();
  };

  // Unload a currently-visible dataset without closing the picker.
  const removeLoaded = (datasetId: string, source: DatasetSource) => {
    useTerrainStore.getState().toggleVisible({ datasetId, source });
  };

  // ── Styles ───────────────────────────────────────────────────────────────

  const headerRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 4,
  };

  const headerStyle: React.CSSProperties = {
    padding: "10px 16px 6px",
    color: "#64748b",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    flex: 1,
  };

  const sectionDownloadBtnStyle: React.CSSProperties = {
    background: "none",
    border: "1px solid rgba(0,229,255,0.2)",
    borderRadius: 5,
    color: "#64748b",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "calc(11px * var(--bs-font-scale, 1))",
    padding: "3px 10px",
    marginRight: 8,
    minHeight: 32,
    cursor: "pointer",
    letterSpacing: "0.05em",
  };

  return (
    // MOBILE-ONLY: full-screen scrim + bottom sheet-style list.
    <div
      data-testid="mobile-dataset-picker"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        background: "rgba(2,8,24,0.72)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Choose dataset"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: "70%",
          overflowY: "auto",
          background: "rgba(2,8,18,0.97)",
          borderTop: "1px solid rgba(0,229,255,0.25)",
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid rgba(0,229,255,0.15)",
          }}
        >
          <span
            style={{
              color: "#00e5ff",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(12.5px * var(--bs-font-scale, 1))",
              letterSpacing: "0.2em",
            }}
          >
            CHOOSE DATASET
          </span>
          <button
            type="button"
            aria-label={mode === "add" ? "Done adding datasets" : "Close dataset picker"}
            data-testid="mobile-dataset-picker-close"
            onClick={onClose}
            style={{
              background: "none",
              border: mode === "add" ? "1px solid rgba(0,229,255,0.4)" : "none",
              borderRadius: mode === "add" ? 8 : 0,
              color: mode === "add" ? "#00e5ff" : "#94a3b8",
              fontFamily: mode === "add" ? "'JetBrains Mono', monospace" : undefined,
              fontSize:
                mode === "add"
                  ? "calc(12px * var(--bs-font-scale, 1))"
                  : "calc(22px * var(--bs-font-scale, 1))",
              letterSpacing: mode === "add" ? "0.1em" : undefined,
              minWidth: 44,
              minHeight: 44,
              padding: mode === "add" ? "0 14px" : undefined,
              cursor: "pointer",
            }}
          >
            {mode === "add" ? "DONE" : "×"}
          </button>
        </div>

        {/* ── Replace / Add segmented control — only when something is loaded ── */}
        {visibleDatasets.length > 0 && (
          <div
            role="group"
            aria-label="Picker mode"
            data-testid="mobile-picker-mode-toggle"
            style={{
              display: "flex",
              margin: "10px 16px",
              border: "1px solid rgba(0,229,255,0.25)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {(["replace", "add"] as const).map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`mobile-picker-mode-${m}`}
                aria-pressed={mode === m}
                onClick={() => onModeChange(m)}
                style={{
                  flex: "1 1 0",
                  minHeight: 44, // MOBILE-ONLY: thumb-sized touch target
                  background: mode === m ? "rgba(0,229,255,0.18)" : "transparent",
                  border: "none",
                  borderRight:
                    m === "replace" ? "1px solid rgba(0,229,255,0.12)" : "none",
                  color: mode === m ? "#00e5ff" : "#94a3b8",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "calc(12px * var(--bs-font-scale, 1))",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {datasetsLoading && (
          <div
            style={{
              padding: "16px",
              color: "#64748b",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
            }}
          >
            Loading datasets…
          </div>
        )}

        {/* ── My datasets section ─────────────────────────────────────── */}
        {(userDatasets?.length ?? 0) > 0 && (
          <>
            {/* Root-level header + "⬇ All" downloads EVERYTHING in My datasets */}
            <div style={headerRowStyle}>
              <div style={headerStyle}>My datasets</div>
              <button
                type="button"
                aria-label="Download all my datasets offline"
                data-testid="mobile-picker-download-all-user"
                style={sectionDownloadBtnStyle}
                onClick={() => {
                  const bulk = (userDatasets ?? []).map(userToBulkDataset);
                  onDownloadOffline(bulk, "My datasets");
                }}
              >
                ⬇ All
              </button>
            </div>

            {/* ── Root-level datasets (no folder) ─────────────────────── */}
            {libraryTree.rootDatasets.map((d) => (
              <UserDatasetRow
                key={d.id}
                dataset={d}
                isActive={d.id === primaryDatasetId}
                status={packStatuses.get(d.id) ?? "none"}
                onSelect={() => select(d.id, "user")}
                onDownload={() => onDownloadOffline([userToBulkDataset(d)], d.name)}
                depth={0}
                isLoadedVisible={visibleIds.has(d.id)}
                dimmed={dimUnloaded && !visibleIds.has(d.id)}
                onRemove={() => removeLoaded(d.id, "user")}
              />
            ))}

            {/* ── Folder tree (recursive, supports nested sub-folders) ── */}
            {libraryTree.roots.map((node) => (
              <FolderSection
                key={node.folder.id}
                node={node}
                packStatuses={packStatuses}
                primaryDatasetId={primaryDatasetId}
                onSelect={(datasetId) => select(datasetId, "user")}
                onDownloadOffline={onDownloadOffline}
                sectionDownloadBtnStyle={sectionDownloadBtnStyle}
                visibleIds={visibleIds}
                dimUnloaded={dimUnloaded}
                onRemove={(datasetId) => removeLoaded(datasetId, "user")}
              />
            ))}
          </>
        )}

        {/* ── Catalog section ─────────────────────────────────────────── */}
        {(datasets?.length ?? 0) > 0 && (
          <>
            <div style={headerRowStyle}>
              <div style={headerStyle}>Catalog</div>
              <button
                type="button"
                aria-label="Download all catalog datasets offline"
                data-testid="mobile-picker-download-all-catalog"
                style={sectionDownloadBtnStyle}
                onClick={() => {
                  const bulk = (datasets ?? []).map(catalogToBulkDataset);
                  onDownloadOffline(bulk, "All catalog datasets");
                }}
              >
                ⬇ All
              </button>
            </div>

            {datasets!.map((d) => {
              const status = packStatuses.get(d.id) ?? "none";
              const isActive = d.id === primaryDatasetId;
              const isLoadedVisible = visibleIds.has(d.id);
              const dimmed = dimUnloaded && !isLoadedVisible;
              return (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    borderBottom: "1px solid rgba(0,229,255,0.08)",
                    background: isActive ? "rgba(0,229,255,0.12)" : "transparent",
                  }}
                >
                  {/* Selection target */}
                  <button
                    type="button"
                    data-testid={`mobile-dataset-option-${d.id}`}
                    onClick={() => select(d.id, "preset")}
                    aria-disabled={dimmed || undefined}
                    title={dimmed ? CAP_REACHED_TITLE : undefined}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: isActive ? "#00e5ff" : "#cbd5e1",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "calc(14px * var(--bs-font-scale, 1))",
                      padding: "14px 16px",
                      minHeight: 48,
                      cursor: dimmed ? "default" : "pointer",
                      opacity: dimmed ? 0.4 : 1,
                      display: "flex",
                      alignItems: "center",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {d.name}
                    </span>
                    {isLoadedVisible && <LoadedBadge />}
                    <OfflineStatusBadge status={status} />
                  </button>
                  {/* Unload button for currently-loaded datasets */}
                  {isLoadedVisible && (
                    <RemoveLoadedBtn
                      datasetId={d.id}
                      name={d.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeLoaded(d.id, "preset");
                      }}
                    />
                  )}
                  {/* Per-dataset download */}
                  <DownloadBtn
                    label={`Download ${d.name} offline`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownloadOffline([catalogToBulkDataset(d)], d.name);
                    }}
                  />
                </div>
              );
            })}
          </>
        )}

        {!datasetsLoading && (datasets?.length ?? 0) === 0 && (userDatasets?.length ?? 0) === 0 && (
          <div
            style={{
              padding: "16px",
              color: "#64748b",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "calc(10.5px * var(--bs-font-scale, 1))",
            }}
          >
            No datasets available for this water type.
          </div>
        )}
      </div>
    </div>
  );
};
