import React, { useCallback, useEffect, useRef, useState } from "react";
import { subscribeToReconnect, markServerUnreachable, queryClient } from "@/lib/queryClient";
import { useDropzone } from "react-dropzone";
import type { FileRejection } from "react-dropzone";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/clerkCompat";
import {
  useGetDatasets,
  getGetDatasetsQueryKey,
  useGetDatasetsIdOverview,
  useGetDatasetsIdTerrain,
  useGetUserDatasets,
  useGetUserDatasetsIdTerrain,
  useGetUserDatasetsIdOverview,
  useGetMarkers,
  getGetDatasetsIdTerrainQueryKey,
  getGetDatasetsIdOverviewQueryKey,
  getGetUserDatasetsQueryKey,
  getGetUserDatasetsIdTerrainQueryKey,
  getGetUserDatasetsIdOverviewQueryKey,
  getGetMarkersQueryKey,
  getGetSettingsQueryKey,
  usePostDatasetsUpload,
  getGetSubstrateQueryKey,
  getAuthToken,
  hasAuthTokenGetter,
  getDatasetsIdPreview,
  getGetDatasetsIdPreviewQueryKey,
} from "@workspace/api-client-react";
import type { DatasetMeta, UserDatasetMeta } from "@workspace/api-client-react";
import { authorizedFetch } from "@/lib/authorizedFetch";
import { useAppState } from "@/lib/context";
import { requestDatasetSwitch, useSimulatedDataStore } from "@/lib/simulatedDataStore";
import { useTerrainStore, MAX_ACTIVE_DATASETS } from "@/lib/terrainStore";
import type { DatasetSource } from "@/lib/terrainStore";
import { useDatasetProximityStreaming } from "@/hooks/useDatasetProximityStreaming";
import type { DatasetBbox } from "@/hooks/useDatasetProximityStreaming";
import { useUiStore } from "@/lib/uiStore";
import { lonLatToWorldXZ, MAX_DEPTH_WORLD } from "@/lib/terrain";
import { MARKER_COLOR, MARKER_ICON, SALTWATER_MARKER_TYPES, FRESHWATER_MARKER_TYPES } from "@/lib/markerConstants";
import { useMarkerEditStore } from "@/lib/markerEditStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useOfflineStore } from "@/lib/offlineStore";
import { useSettingsStore } from "@/lib/settingsStore";
import type { CameraBookmark } from "@/lib/settingsStore";
import { formatDepthRange } from "@/lib/units";
import { ProvenancePanel } from "@/components/ProvenancePanel";
import { DatasetFolderTree } from "@/components/DatasetFolderTree";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { WaterTypeToggle } from "@/components/WaterTypeToggle";
import { HelpIcon } from "@/components/help/HelpButton";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useUndoableMarkerDelete } from "@/hooks/useUndoableMarkerDelete";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { GpsImportDialog } from "@/components/GpsImportDialog";
import { GpsExportDialog } from "@/components/GpsExportDialog";
import { LoadingDial } from "@/components/LoadingDial";
import { SUPPORTED_EXTENSIONS } from "@/components/FileUpload";
import { useActiveLoadStore } from "@/lib/activeLoadStore";
import { fetchJsonWithProgress } from "@/lib/fetchWithProgress";
import { OfflinePackModal } from "@/components/OfflinePackModal";
import { GeoreferenceModal } from "@/components/GeoreferenceModal";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import {
  getGetDatasetsIdTerrainUrl,
  getGetDatasetsIdOverviewUrl,
  getGetUserDatasetsIdTerrainUrl,
  getGetUserDatasetsIdOverviewUrl,
} from "@workspace/api-client-react";
import type { TerrainData } from "@workspace/api-client-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Auto-retry backoff schedule for transient save-to-account failures.
// Module-scope so reading it inside the upload callback doesn't require
// a hook deps entry.
const AUTO_RETRY_DELAYS_MS = [500, 1500];

/**
 * Build a human-readable import summary for an archive upload result.
 *
 * Distinguishes three cases so the user always understands what was captured:
 *   - substrate-only  → "Imported 47 substrate annotations"
 *   - sounding-only   → "Imported 12,340 depth soundings"
 *   - mixed           → "Imported 12,340 depth soundings · 47 substrate annotations"
 *   - unknown (no count data, e.g. non-archive file) → generic fallback
 */
function buildImportDescription(soundingCount?: number, substrateCount?: number): string {
  const hasSoundings = typeof soundingCount === "number" && soundingCount > 0;
  const hasSubstrate = typeof substrateCount === "number" && substrateCount > 0;
  if (hasSoundings && hasSubstrate) {
    return `Imported ${soundingCount.toLocaleString()} depth soundings · ${substrateCount.toLocaleString()} substrate annotations`;
  }
  if (hasSoundings) {
    return `Imported ${soundingCount.toLocaleString()} depth soundings`;
  }
  if (hasSubstrate) {
    return `Imported ${substrateCount.toLocaleString()} substrate annotations`;
  }
  return "Your file has finished processing";
}

// Stable empty-array fallback used by the bookmarks selector so that
// getSnapshot always returns the same reference when there are no bookmarks.
// A new [] literal inside the selector would cause React 18 Concurrent Mode
// to see two different snapshot values and throw "getSnapshot should be cached".
const EMPTY_BOOKMARKS: CameraBookmark[] = [];

/**
 * Build a queryFn that streams the terrain payload via fetchJsonWithProgress
 * and pushes byte-level progress into the activeLoadStore. Used to override
 * the generated TanStack queryFn for the *pending* terrain/overview requests
 * so the row in this panel can render a real loading dial. Only the terrain
 * request reports progress — the (smaller) overview request is silent.
 */
function makeProgressTerrainFetcher(
  url: string,
  datasetId: string,
  reportProgress: boolean,
) {
  return async ({ signal }: { signal?: AbortSignal }): Promise<TerrainData> => {
    // Auth header is attached automatically by fetchJsonWithProgress.
    return fetchJsonWithProgress<TerrainData>(url, {
      signal,
      onProgress: reportProgress
        ? ({ loaded, total }) => {
            useActiveLoadStore.getState().update(datasetId, loaded, total);
          }
        : undefined,
    });
  };
}

const CHUNKED_THRESHOLD = 10 * 1024 * 1024; // files above 10 MB use chunked path
const CHUNK_SIZE = 5 * 1024 * 1024;          // 5 MB per chunk
const GCS_THRESHOLD = 50 * 1024 * 1024;      // files above 50 MB go straight to GCS

const UPLOAD_SESSION_KEY = "bathyscan_upload_session";
interface SavedUploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  totalChunks: number;
}
function saveUploadSession(s: SavedUploadSession) {
  try { sessionStorage.setItem(UPLOAD_SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function clearUploadSession() {
  try { sessionStorage.removeItem(UPLOAD_SESSION_KEY); } catch { /* ignore */ }
}
function loadUploadSession(): SavedUploadSession | null {
  try {
    const raw = sessionStorage.getItem(UPLOAD_SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedUploadSession) : null;
  } catch { return null; }
}

const PANEL: React.CSSProperties = {
  background: "rgba(0,10,20,0.82)",
  border: "1px solid rgba(0,229,255,0.18)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#e2e8f0",
  fontSize: 16.5,
  minWidth: 268,
  maxWidth: 308,
  backdropFilter: "blur(6px)",
};

const ACTION_BTN_STYLE: React.CSSProperties = {
  fontSize: 13.5,
  letterSpacing: "0.06em",
  padding: "3px 7px",
  background: "rgba(0,229,255,0.06)",
  border: "1px solid rgba(0,229,255,0.28)",
  borderRadius: 3,
  color: "#00e5ff",
  cursor: "pointer",
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
};

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

function formatEta(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  if (seconds < 5) return "Almost done…";
  if (seconds < 60) return `~${seconds} sec remaining`;
  const mins = Math.round(seconds / 60);
  return `~${mins} min remaining`;
}

// ─── Visible-datasets summary header ─────────────────────────────────────────
const VisibleDatasetsHeader: React.FC<{
  onHideAllOthers: () => void;
}> = ({ onHideAllOthers }) => {
  const activeCount = useTerrainStore((s) => s.visibleDatasets.length);
  const selectedCount = useTerrainStore((s) => s.selectedIds.length);
  if (activeCount <= 1 && selectedCount <= 1) return null;
  const atCap = activeCount >= MAX_ACTIVE_DATASETS;
  const streamingMode = selectedCount > activeCount;
  return (
    <div
      data-testid="visible-datasets-header"
      style={{
        padding: "4px 12px 6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 13.5,
        letterSpacing: "0.1em",
        color: "#7dd3fc",
        background: "rgba(0,229,255,0.04)",
        borderBottom: "1px solid rgba(0,229,255,0.08)",
      }}
    >
      <span data-testid="visible-datasets-count">
        {streamingMode
          ? `STREAMING · ${activeCount}/${selectedCount} ACTIVE`
          : `VISIBLE DATASETS (${activeCount})${atCap ? " · CAP" : ""}`}
      </span>
      <button
        data-testid="btn-hide-all-others"
        onClick={onHideAllOthers}
        style={{
          fontSize: 13.5,
          color: "#00e5ff",
          background: "transparent",
          border: "1px solid rgba(0,229,255,0.35)",
          borderRadius: 3,
          padding: "1px 6px",
          cursor: "pointer",
          letterSpacing: "0.08em",
        }}
      >
        HIDE ALL OTHERS
      </button>
    </div>
  );
};

// ─── Remove-from-view confirmation dialog ────────────────────────────────────
const RemoveDatasetConfirmDialog: React.FC<{
  datasetName: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ datasetName, onConfirm, onCancel }) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-dataset-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={containerRef}
        style={{
          background: "rgba(0,10,20,0.92)",
          border: "1px solid rgba(0,229,255,0.35)",
          borderRadius: 6,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          padding: "20px 24px",
          maxWidth: 300,
          width: "90%",
          backdropFilter: "blur(8px)",
          boxShadow: "0 0 24px rgba(0,229,255,0.12)",
        }}
      >
        <div
          id="remove-dataset-dialog-title"
          style={{
            fontSize: 16.5,
            letterSpacing: "0.12em",
            color: "#00e5ff",
            textShadow: "0 0 6px rgba(0,229,255,0.5)",
            marginBottom: 12,
          }}
        >
          REMOVE DATASET
        </div>
        <div
          style={{
            fontSize: 16.5,
            color: "#e2e8f0",
            marginBottom: 18,
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
        >
          Remove{" "}
          <span style={{ color: "#7dd3fc", fontWeight: 700 }}>{datasetName}</span>{" "}
          from the current view?
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            ref={cancelRef}
            data-testid="remove-dataset-cancel"
            onClick={onCancel}
            style={{
              fontSize: 15,
              letterSpacing: "0.08em",
              color: "#94a3b8",
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.3)",
              borderRadius: 3,
              padding: "4px 12px",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          >
            CANCEL
          </button>
          <button
            data-testid="remove-dataset-confirm"
            onClick={onConfirm}
            style={{
              fontSize: 15,
              letterSpacing: "0.08em",
              color: "#001a1f",
              background: "#00e5ff",
              border: "1px solid #00e5ff",
              borderRadius: 3,
              padding: "4px 12px",
              cursor: "pointer",
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          >
            CONFIRM
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Compact list of visible (active) + selected-but-not-active datasets ─────
const VisibleDatasetRows: React.FC<{
  allDatasets: Array<{ id: string; name: string }>;
}> = ({ allDatasets }) => {
  const visibleDatasets = useTerrainStore((s) => s.visibleDatasets);
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);
  const primaryActiveGrid = useTerrainStore((s) => s.activeGrid);
  const toggleVisible = useTerrainStore((s) => s.toggleVisible);
  const removeSelected = useTerrainStore((s) => s.removeSelected);
  const selectedIds = useTerrainStore((s) => s.selectedIds);
  const selectedSources = useTerrainStore((s) => s.selectedSources);

  const count = visibleDatasets.length;
  const [pending, setPending] = useState<{
    datasetId: string;
    source: DatasetSource;
    name: string;
    isSelectedOnly?: boolean;
  } | null>(null);

  const handleConfirm = useCallback(() => {
    if (pending) {
      if (pending.isSelectedOnly) {
        removeSelected(pending.datasetId);
      } else {
        toggleVisible({ datasetId: pending.datasetId, source: pending.source });
      }
    }
    setPending(null);
  }, [pending, toggleVisible, removeSelected]);

  const handleCancel = useCallback(() => setPending(null), []);

  // Datasets that are selected by user intent but NOT currently active in the scene.
  const activeIds = new Set(visibleDatasets.map((v) => v.datasetId));
  const selectedButNotActive = selectedIds.filter((id) => !activeIds.has(id));

  if (count === 0 && selectedButNotActive.length === 0) return null;

  const nameMap = new Map(allDatasets.map((d) => [d.id, d.name]));

  // Pre-compute depth ranges for the depth-scale badge.
  const primaryDepthRange = primaryActiveGrid
    ? (primaryActiveGrid.maxDepth - primaryActiveGrid.minDepth) || 1
    : null;

  return (
    <>
      {/* ── Active datasets (in GPU memory, rendered in scene) ── */}
      {visibleDatasets.map((vd) => {
        const name = nameMap.get(vd.datasetId) ?? vd.datasetId;
        // Multi-primary: all visible datasets share equal primary status.
        // `primaryDatasetId` is the legacy first-entry alias used only for the
        // depth-scale badge (non-first datasets may have compressed Y-axes).
        const isFirstEntry = vd.datasetId === primaryDatasetId;
        const isLoading = !vd.activeGrid;

        // Depth-scale badge: show when a non-first dataset's depth range exceeds
        // the first entry's (meaning its Y-axis will be clamped/compressed).
        let showDepthScaleBadge = false;
        if (!isFirstEntry && vd.activeGrid && primaryDepthRange !== null) {
          const secDepthRange = (vd.activeGrid.maxDepth - vd.activeGrid.minDepth) || 1;
          const naturalYScale = secDepthRange / primaryDepthRange;
          showDepthScaleBadge = naturalYScale > 1;
        }

        return (
          <div
            key={vd.datasetId}
            data-testid={`visible-dataset-row-${vd.datasetId}`}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "2px 8px 2px 8px",
              gap: 4,
              fontSize: 15,
              color: "#e2e8f0",
              borderBottom: "1px solid rgba(0,229,255,0.05)",
              background: "rgba(0,229,255,0.08)",
            }}
          >
            {/* Active: filled star indicator */}
            <span
              data-testid={`star-primary-${vd.datasetId}`}
              title="Active — rendered in scene"
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                color: "#00e5ff",
                textShadow: "0 0 6px rgba(0,229,255,0.6)",
                lineHeight: 1,
              }}
            >
              ★
            </span>

            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                letterSpacing: "0.04em",
              }}
            >
              {name}
            </span>

            {/* Loading indicator for any dataset whose grid hasn't arrived yet */}
            {isLoading && (
              <span
                data-testid={`loading-badge-${vd.datasetId}`}
                style={{
                  flexShrink: 0,
                  fontSize: 12,
                  letterSpacing: "0.06em",
                  color: "#64748b",
                  padding: "1px 4px",
                  border: "1px solid rgba(100,116,139,0.35)",
                  borderRadius: 2,
                }}
              >
                LOADING…
              </span>
            )}

            {/* Depth-scale adjustment badge */}
            {showDepthScaleBadge && (
              <span
                data-testid={`depth-scale-badge-${vd.datasetId}`}
                title="This dataset's depth range exceeds the primary's — Y-axis is compressed to fit"
                style={{
                  flexShrink: 0,
                  fontSize: 12,
                  letterSpacing: "0.04em",
                  color: "#f59e0b",
                  padding: "1px 4px",
                  border: "1px solid rgba(245,158,11,0.4)",
                  borderRadius: 2,
                }}
              >
                ⚠ Scale
              </span>
            )}

            <ViewscreenTooltip label="Remove from view" side="right">
              <button
                type="button"
                data-testid={`btn-remove-visible-${vd.datasetId}`}
                aria-label={`Remove ${name} from view`}
                onClick={(e) => {
                  e.stopPropagation();
                  setPending({ datasetId: vd.datasetId, source: vd.source, name });
                }}
                style={{
                  flexShrink: 0,
                  width: 18,
                  height: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "none",
                  color: "#64748b",
                  cursor: "pointer",
                  fontSize: 16.5,
                  lineHeight: 1,
                  padding: 0,
                  borderRadius: 2,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#64748b";
                }}
              >
                ✕
              </button>
            </ViewscreenTooltip>
          </div>
        );
      })}

      {/* ── Selected-but-not-active datasets (queued for proximity streaming) ── */}
      {selectedButNotActive.length > 0 && (
        <>
          {count > 0 && (
            <div style={{
              padding: "2px 8px",
              fontSize: 12,
              letterSpacing: "0.1em",
              color: "#475569",
              background: "rgba(0,229,255,0.02)",
              borderTop: "1px solid rgba(0,229,255,0.06)",
            }}>
              SELECTED · WILL LOAD WHEN NEARBY
            </div>
          )}
          {selectedButNotActive.map((id) => {
            const name = nameMap.get(id) ?? id;
            const source = selectedSources[id] ?? "preset";
            return (
              <div
                key={id}
                data-testid={`selected-dataset-row-${id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "2px 8px 2px 8px",
                  gap: 4,
                  fontSize: 15,
                  color: "#64748b",
                  borderBottom: "1px solid rgba(0,229,255,0.04)",
                  background: "rgba(0,229,255,0.03)",
                }}
              >
                {/* Selected-only: dimmed open-circle indicator */}
                <span
                  data-testid={`circle-selected-${id}`}
                  title="Selected — will activate when camera approaches"
                  style={{
                    flexShrink: 0,
                    width: 18,
                    height: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16.5,
                    color: "rgba(0,229,255,0.35)",
                    lineHeight: 1,
                  }}
                >
                  ○
                </span>

                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    letterSpacing: "0.04em",
                  }}
                >
                  {name}
                </span>

                <span
                  data-testid={`queued-badge-${id}`}
                  title="Will load automatically when camera enters proximity"
                  style={{
                    flexShrink: 0,
                    fontSize: 10.5,
                    letterSpacing: "0.06em",
                    color: "rgba(0,229,255,0.3)",
                    padding: "1px 4px",
                    border: "1px dashed rgba(0,229,255,0.2)",
                    borderRadius: 2,
                  }}
                >
                  QUEUED
                </span>

                <ViewscreenTooltip label="Deselect dataset" side="right">
                  <button
                    type="button"
                    data-testid={`btn-deselect-${id}`}
                    aria-label={`Deselect ${name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPending({ datasetId: id, source, name, isSelectedOnly: true });
                    }}
                    style={{
                      flexShrink: 0,
                      width: 18,
                      height: 18,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "transparent",
                      border: "none",
                      color: "#334155",
                      cursor: "pointer",
                      fontSize: 16.5,
                      lineHeight: 1,
                      padding: 0,
                      borderRadius: 2,
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = "#334155";
                    }}
                  >
                    ✕
                  </button>
                </ViewscreenTooltip>
              </div>
            );
          })}
        </>
      )}

      {pending && (
        <RemoveDatasetConfirmDialog
          datasetName={pending.name}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  );
};

interface DatasetPanelProps {
  embedded?: boolean;
}

export const DatasetPanel: React.FC<DatasetPanelProps> = ({ embedded = false }) => {
  const {
    datasetId,
    setDatasetId,
    setTerrain,
    terrain,
    pendingExternalUserDatasetId,
    setPendingExternalUserDatasetId,
  } = useAppState();
  const { isSignedIn, isLoaded } = useAuth();
  const qc = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const { toast } = useToast();

  // ─── Multi-dataset store selectors (placed early; callbacks added after datasets are fetched)

  const hideAllOthers = useTerrainStore((s) => s.hideAllOthers);
  const evictedId = useTerrainStore((s) => s.evictedId);
  const clearEviction = useTerrainStore((s) => s.clearEviction);
  const visibleDatasetsForToast = useTerrainStore((s) => s.visibleDatasets);

  // Track which dataset IDs are available in the service-worker cache
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (isOnline || !("caches" in window)) return;
    let mounted = true;
    void (async () => {
      const ids = new Set<string>();
      try {
        const names = await caches.keys();
        for (const name of names) {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          for (const req of keys) {
            const m = /\/datasets\/([^/]+)\/(terrain|overview)/.exec(req.url);
            if (m?.[1]) ids.add(m[1]);
          }
        }
      } catch {
        // Cache Storage not available
      }
      if (mounted) setCachedIds(ids);
    })();
    return () => { mounted = false; };
  }, [isOnline]);

  const storeCollapsed = usePanelCollapseStore((s) => s.collapsed.datasets);
  const collapsed = embedded ? false : storeCollapsed;
  const togglePanel = usePanelCollapseStore((s) => s.toggle);
  const myLibraryCollapsed = usePanelCollapseStore((s) => s.collapsed.myLibrary);
  const setPanelCollapsed = usePanelCollapseStore((s) => s.setCollapsed);
  const uploadOpen = !usePanelCollapseStore((s) => s.collapsed.uploadTerrainAccordion);
  const setUploadOpen = useCallback(
    (v: boolean) => setPanelCollapsed("uploadTerrainAccordion", !v),
    [setPanelCollapsed],
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [savingToAccount, setSavingToAccount] = useState(false);
  const autoRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (autoRetryTimer.current) clearTimeout(autoRetryTimer.current);
  }, []);

  // GCS upload poll/watchdog refs — cleared on unmount to avoid state updates after destroy
  const gcsPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gcsWatchdogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to the in-flight GCS XHR so it can be aborted immediately on unmount.
  const gcsXhrRef = useRef<XMLHttpRequest | null>(null);
  // Set to true on unmount; guards all async GCS state setters so they become
  // no-ops after the component is destroyed and cannot trigger React warnings.
  const gcsUnmountedRef = useRef(false);
  useEffect(() => {
    gcsUnmountedRef.current = false;
    return () => {
      gcsUnmountedRef.current = true;
      if (gcsXhrRef.current) { gcsXhrRef.current.abort(); gcsXhrRef.current = null; }
      if (gcsPollIntervalRef.current) { clearInterval(gcsPollIntervalRef.current); gcsPollIntervalRef.current = null; }
      if (gcsWatchdogTimeoutRef.current) { clearTimeout(gcsWatchdogTimeoutRef.current); gcsWatchdogTimeoutRef.current = null; }
    };
  }, []);

  // Chunked upload session refs — stable across renders, used by retry logic
  const chunkedUploadIdRef = useRef<string | null>(null);
  // Index of the chunk that failed (null = not failed yet, >= totalChunks = finalize failed)
  const chunkedFailedAtRef = useRef<number | null>(null);

  // ─── Preset dataset pending fetch ─────────────────────────────────────────
  const [pendingId, setPendingId] = useState<string | null>(null);

  // ─── MY LIBRARY multi-select action-bar state ─────────────────────────────
  const [presetSelectedIds, setPresetSelectedIds] = useState<Set<string>>(() => new Set());
  const [librarySelectedIds, setLibrarySelectedIds] = useState<Set<string>>(() => new Set());
  const [libraryBulkDeleteSignal, setLibraryBulkDeleteSignal] = useState(0);
  const [libraryMoveSignal, setLibraryMoveSignal] = useState<{
    id: string; name: string; folderId: string | null; seq: number;
  } | null>(null);
  const [libraryRenameSignal, setLibraryRenameSignal] = useState<{
    id: string; name: string; seq: number;
  } | null>(null);

  const togglePresetSelected = useCallback((id: string) => {
    setPresetSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const [exampleDatasetsFolderExpanded, setExampleDatasetsFolderExpanded] = useState(true);
  const [presetDeleteConfirm, setPresetDeleteConfirm] = useState(false);

  // ─── User dataset pending + active tracking ────────────────────────────────
  const [pendingUserDatasetId, setPendingUserDatasetId] = useState<string | null>(null);
  const [activeUserDatasetId, setActiveUserDatasetId] = useState<string | null>(null);
  const [userLoadError, setUserLoadError] = useState<{ id: string; name: string } | null>(null);
  const [presetLoadError, setPresetLoadError] = useState<{ id: string; name: string } | null>(null);

  // ─── Upload progress (simulated, small-file path) ─────────────────────────
  const [uploadProgress, setUploadProgress] = useState(0);
  const [smallFileEta, setSmallFileEta] = useState<number | null>(null);
  const uploadStartedAt = useRef<number | null>(null);
  const uploadFileSizeBytesRef = useRef<number>(0);

  // ─── Chunked-upload state (large-file path > CHUNKED_THRESHOLD) ───────────
  type ChunkedPhase = "idle" | "uploading" | "processing" | "error";
  const [chunkedPhase, setChunkedPhase] = useState<ChunkedPhase>("idle");
  const [chunkedUploadProgress, setChunkedUploadProgress] = useState(0);
  const [chunkedJobId, setChunkedJobId] = useState<string | null>(null);
  const [chunkedJobProgress, setChunkedJobProgress] = useState(0);
  const [chunkedJobEta, setChunkedJobEta] = useState<number | null>(null);
  const [chunkedError, setChunkedError] = useState<string | null>(null);
  const [lastChunkedFile, setLastChunkedFile] = useState<File | null>(null);

  // ─── GCS upload state (oversized files > GCS_THRESHOLD via presigned URL) ──
  // processing_timeout: upload succeeded, background conversion is still running
  // after the 15-minute poll window.  The user can drop a new file while this
  // state is active — it is distinct from "error" (which blocks further uploads)
  // and distinct from "idle" (which gives no indication a job is pending).
  type GcsPhase = "idle" | "uploading" | "processing" | "processing_timeout" | "error";
  const [gcsPhase, setGcsPhase] = useState<GcsPhase>("idle");
  const [gcsUploadProgress, setGcsUploadProgress] = useState(0);
  const [gcsError, setGcsError] = useState<string | null>(null);
  // Server-reported sub-status while gcsPhase === "processing".
  // "queued"  → waiting for a concurrency slot on the server ("Waiting in line…")
  // "processing" → pipeline is actively running ("Processing in background…")
  // null → unknown / just switched to processing phase
  const [gcsServerStatus, setGcsServerStatus] = useState<"queued" | "processing" | null>(null);

  // Server-reported sub-status while chunkedPhase === "processing".
  // Mirrors gcsServerStatus: "queued" → waiting for a concurrency slot;
  // "processing" → slot acquired and pipeline running; null → not yet known.
  const [chunkedServerStatus, setChunkedServerStatus] = useState<"queued" | "processing" | null>(null);

  // ─── Interrupted upload session (survives page reload via sessionStorage) ──
  // On mount we check for a saved session from a previous upload that was
  // interrupted by a page reload (e.g. from a server restart during dev).
  // We show a banner so the user knows they can resume by re-selecting the file.
  const [interruptedSession, setInterruptedSession] = useState<SavedUploadSession | null>(() => loadUploadSession());
  // Once the user picks a file whose name+size matches the saved session,
  // we resume from the server-acknowledged chunk rather than starting fresh.
  const pendingResumeRef = useRef<SavedUploadSession | null>(null);

  const waterType = useSettingsStore((s) => s.waterType);
  const units = useSettingsStore((s) => s.units);

  // Accent colour tracks waterType: cyan for saltwater, green for freshwater.
  const accent = waterType === "freshwater" ? "#4ade80" : "#00e5ff";

  // ─── Warn before unload while a chunked upload is active ──────────────────
  useEffect(() => {
    if (chunkedPhase !== "uploading" && chunkedPhase !== "processing") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // required for Chrome/Edge to show the native dialog
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [chunkedPhase]);

  // ─── Upload error popup ────────────────────────────────────────────────────
  const [copiedErrorHint, setCopiedErrorHint] = useState(false);

  // Coalesce all three upload-error states into one dismissable message.
  const activeUploadError: string | null =
    gcsPhase === "error" && gcsError ? gcsError :
    chunkedPhase === "error" && chunkedError ? chunkedError :
    uploadError ?? null;

  const dismissUploadError = useCallback(() => {
    setCopiedErrorHint(false);
    if (gcsPhase === "error") { setGcsPhase("idle"); setGcsError(null); }
    if (chunkedPhase === "error") { setChunkedPhase("idle"); setChunkedError(null); }
    setUploadError(null);
  }, [gcsPhase, chunkedPhase]);

  useEffect(() => {
    if (!activeUploadError) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); dismissUploadError(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [activeUploadError, dismissUploadError]);

  // ─── Fetch dataset lists ───────────────────────────────────────────────────
  const { data: datasets, isLoading: datasetsLoading } = useGetDatasets(
    { waterType },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType }) } },
  );
  const { data: userDatasets, isLoading: userDatasetsLoading } = useGetUserDatasets({
    query: { enabled: isLoaded && isSignedIn === true, queryKey: getGetUserDatasetsQueryKey() },
  });

  // ─── Eviction toast: fires when terrainStore silently evicts a dataset ─────
  useEffect(() => {
    if (!evictedId) return;
    const allDs: Array<{ id: string; name: string }> = [
      ...(datasets ?? []).map((d) => ({ id: d.id, name: d.name })),
      ...(userDatasets ?? []).map((d) => ({ id: d.id, name: d.name })),
    ];
    const name = allDs.find((d) => d.id === evictedId)?.name ?? evictedId;
    toast({ title: `${name} unloaded — streaming another dataset into view.`, duration: 4000 });
    clearEviction();
  }, [evictedId, datasets, userDatasets, toast, clearEviction]);

  // Hide all non-primary datasets and show a toast with the count removed.
  const handleHideAllOthers = useCallback(() => {
    const countBefore = visibleDatasetsForToast.length;
    const primaryId = useTerrainStore.getState().primaryDatasetId;
    const allDs: Array<{ id: string; name: string }> = [
      ...(datasets ?? []).map((d) => ({ id: d.id, name: d.name })),
      ...(userDatasets ?? []).map((d) => ({ id: d.id, name: d.name })),
    ];
    hideAllOthers();
    const removed = countBefore - 1;
    if (removed > 0) {
      const primaryName = allDs.find((d) => d.id === primaryId)?.name ?? "primary";
      toast({
        title: `${removed} dataset${removed > 1 ? "s" : ""} hidden. Only ${primaryName} remains visible.`,
        duration: 4000,
      });
    }
  }, [hideAllOthers, visibleDatasetsForToast, datasets, userDatasets, toast]);

  // ─── Proximity streaming ──────────────────────────────────────────────────
  // Build a map from datasetId → bbox for preset catalog datasets that have a
  // geographic bounding box. User datasets do not have a bbox so they activate
  // immediately when added to the selected pool (handled in addSelected).
  const bboxMap = React.useMemo<Record<string, DatasetBbox>>(() => {
    if (!datasets) return {};
    const out: Record<string, DatasetBbox> = {};
    for (const d of datasets) {
      if (d.bbox) {
        out[d.id] = {
          minLon: d.bbox.minLon,
          maxLon: d.bbox.maxLon,
          minLat: d.bbox.minLat,
          maxLat: d.bbox.maxLat,
        };
      }
    }
    return out;
  }, [datasets]);

  // Called by the proximity hook when a selected-but-not-active dataset should
  // be loaded into the scene. Adds it to visibleDatasets (with null grids) and
  // fetches the terrain+overview via React Query (uses cache when available).
  const handleProximityActivate = useCallback(
    async (datasetId: string, source: DatasetSource) => {
      useTerrainStore.getState().autoActivate(datasetId);
      try {
        if (source === "preset") {
          const [terrainData, overviewData] = await Promise.all([
            queryClient.fetchQuery({
              queryKey: getGetDatasetsIdTerrainQueryKey(datasetId),
              queryFn: makeProgressTerrainFetcher(
                getGetDatasetsIdTerrainUrl(datasetId),
                datasetId,
                false,
              ),
              staleTime: Infinity,
            }),
            queryClient.fetchQuery({
              queryKey: getGetDatasetsIdOverviewQueryKey(datasetId),
              queryFn: makeProgressTerrainFetcher(
                getGetDatasetsIdOverviewUrl(datasetId),
                datasetId,
                false,
              ),
              staleTime: Infinity,
            }),
          ]);
          useTerrainStore.getState().setDatasetGrids(datasetId, {
            activeGrid: terrainData as TerrainData,
            overviewGrid: overviewData as TerrainData,
          });
        } else {
          // User dataset: load via user-dataset endpoints
          const [terrainData, overviewData] = await Promise.all([
            queryClient.fetchQuery({
              queryKey: getGetUserDatasetsIdTerrainQueryKey(datasetId),
              queryFn: makeProgressTerrainFetcher(
                getGetUserDatasetsIdTerrainUrl(datasetId),
                datasetId,
                false,
              ),
              staleTime: Infinity,
            }),
            queryClient.fetchQuery({
              queryKey: getGetUserDatasetsIdOverviewQueryKey(datasetId),
              queryFn: makeProgressTerrainFetcher(
                getGetUserDatasetsIdOverviewUrl(datasetId),
                datasetId,
                false,
              ),
              staleTime: Infinity,
            }),
          ]);
          useTerrainStore.getState().setDatasetGrids(datasetId, {
            activeGrid: terrainData as TerrainData,
            overviewGrid: overviewData as TerrainData,
          });
        }
      } catch {
        // Load failed — remove from selected pool so it doesn't spin forever.
        useTerrainStore.getState().removeSelected(datasetId);
      }
    },
    [],
  );

  useDatasetProximityStreaming({ bboxMap, onActivate: handleProximityActivate });

  // ─── Parallel fetch for pending PRESET dataset ─────────────────────────────
  const { data: pendingTerrain, isError: terrainFetchError } = useGetDatasetsIdTerrain(
    pendingId ?? "",
    undefined,
    {
      query: {
        enabled: !!pendingId,
        queryKey: getGetDatasetsIdTerrainQueryKey(pendingId ?? ""),
        queryFn: makeProgressTerrainFetcher(
          getGetDatasetsIdTerrainUrl(pendingId ?? ""),
          pendingId ?? "",
          true,
        ),
      },
    },
  );

  const { data: pendingOverview, isError: overviewFetchError } = useGetDatasetsIdOverview(
    pendingId ?? "",
    {
      query: {
        enabled: !!pendingId,
        queryKey: getGetDatasetsIdOverviewQueryKey(pendingId ?? ""),
        queryFn: makeProgressTerrainFetcher(
          getGetDatasetsIdOverviewUrl(pendingId ?? ""),
          pendingId ?? "",
          false,
        ),
      },
    },
  );

  useEffect(() => {
    if (!pendingId) return;
    if (terrainFetchError || overviewFetchError) {
      const failedId = pendingId;
      const name = datasets?.find((d) => d.id === failedId)?.name ?? failedId;
      setPresetLoadError({ id: failedId, name });
      setLoadingId(null);
      setPendingId(null);
      useActiveLoadStore.getState().fail(failedId);
    }
  }, [pendingId, terrainFetchError, overviewFetchError, datasets]);

  useEffect(() => {
    if (!pendingId || !pendingTerrain || !pendingOverview) return;
    if (pendingTerrain.datasetId !== pendingId || pendingOverview.datasetId !== pendingId) return;

    setDatasetId(pendingId);
    setTerrain(pendingTerrain);
    setActiveUserDatasetId(null);
    if (!useTerrainStore.getState().multiDatasetMode) {
      useTerrainStore.getState().setSinglePrimary(pendingId, "preset");
    }
    useTerrainStore.getState().setGrids({ activeGrid: pendingTerrain, overviewGrid: pendingOverview });
    useClassificationStore.getState().clearZoneMap();
    void useClassificationStore.getState().classify(pendingTerrain);
    useActiveLoadStore.getState().complete(pendingId);
    setLoadingId(null);
    setPendingId(null);
  }, [pendingTerrain, pendingOverview, pendingId, setDatasetId, setTerrain]);

  // ─── Parallel fetch for pending USER dataset ──────────────────────────────
  const { data: userPendingTerrain, isError: userTerrainError } = useGetUserDatasetsIdTerrain(
    pendingUserDatasetId ?? "",
    {
      query: {
        enabled: !!pendingUserDatasetId,
        queryKey: getGetUserDatasetsIdTerrainQueryKey(pendingUserDatasetId ?? ""),
        queryFn: makeProgressTerrainFetcher(
          getGetUserDatasetsIdTerrainUrl(pendingUserDatasetId ?? ""),
          pendingUserDatasetId ?? "",
          true,
        ),
      },
    },
  );

  const { data: userPendingOverview, isError: userOverviewError } = useGetUserDatasetsIdOverview(
    pendingUserDatasetId ?? "",
    {
      query: {
        enabled: !!pendingUserDatasetId,
        queryKey: getGetUserDatasetsIdOverviewQueryKey(pendingUserDatasetId ?? ""),
        queryFn: makeProgressTerrainFetcher(
          getGetUserDatasetsIdOverviewUrl(pendingUserDatasetId ?? ""),
          pendingUserDatasetId ?? "",
          false,
        ),
      },
    },
  );

  useEffect(() => {
    if (!pendingUserDatasetId) return;
    if (userTerrainError || userOverviewError) {
      const failedId = pendingUserDatasetId;
      const name = userDatasets?.find((d) => d.id === failedId)?.name ?? failedId;
      setUserLoadError({ id: failedId, name });
      setLoadingId(null);
      setPendingUserDatasetId(null);
      useActiveLoadStore.getState().fail(failedId);
    }
  }, [pendingUserDatasetId, userTerrainError, userOverviewError, userDatasets]);

  useEffect(() => {
    if (!pendingUserDatasetId || !userPendingTerrain || !userPendingOverview) return;

    // Some stored payloads embed a stale `datasetId` — duplicate/folder-clone
    // write paths used to copy terrainJson as-is, and pre-stamping rows still
    // carry the original id. The row id we just fetched against is the source
    // of truth, so rebrand the in-memory grids onto pendingUserDatasetId
    // rather than silently bailing (which would leave the scene blank).
    const terrainStamped =
      userPendingTerrain.datasetId === pendingUserDatasetId
        ? userPendingTerrain
        : { ...userPendingTerrain, datasetId: pendingUserDatasetId };
    const overviewStamped =
      userPendingOverview.datasetId === pendingUserDatasetId
        ? userPendingOverview
        : { ...userPendingOverview, datasetId: pendingUserDatasetId };

    setTerrain(terrainStamped);
    setDatasetId(null);
    setActiveUserDatasetId(pendingUserDatasetId);
    if (!useTerrainStore.getState().multiDatasetMode) {
      useTerrainStore.getState().setSinglePrimary(pendingUserDatasetId, "user");
    }
    useTerrainStore.getState().setGrids({
      activeGrid: terrainStamped,
      overviewGrid: overviewStamped,
    });
    useClassificationStore.getState().clearZoneMap();
    void useClassificationStore.getState().classify(terrainStamped);
    useActiveLoadStore.getState().complete(pendingUserDatasetId);
    setLoadingId(null);
    setPendingUserDatasetId(null);
  }, [userPendingTerrain, userPendingOverview, pendingUserDatasetId, setTerrain, setDatasetId]);

  // ─── Overview for the active dataset (initial / background) ───────────────
  // Use a non-empty sentinel key when there is no real dataset ID so the
  // query key never collapses to an empty string — which would collide with
  // any other query that happens to run with id="". The query is disabled
  // when there is no real ID, so the sentinel value is never fetched.
  const _OVERVIEW_NO_ID_SENTINEL = "__no_dataset__";
  const activeId = pendingId ? null : datasetId;
  const activeOverviewQueryId = activeId ?? _OVERVIEW_NO_ID_SENTINEL;
  const { data: activeOverviewData } = useGetDatasetsIdOverview(activeOverviewQueryId, {
    query: {
      enabled: !!activeId,
      queryKey: getGetDatasetsIdOverviewQueryKey(activeOverviewQueryId),
    },
  });

  const activeOverviewWrittenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeOverviewData || !terrain || activeOverviewWrittenRef.current === activeId) return;
    activeOverviewWrittenRef.current = activeId;
    useTerrainStore.getState().setGrids({ activeGrid: terrain, overviewGrid: activeOverviewData });
  }, [activeOverviewData, terrain, activeId]);

  // ─── Dataset click handlers ────────────────────────────────────────────────
  const beginActiveLoad = (id: string) => {
    // Cancel any previous load's dial (the previous request is aborted by
    // TanStack Query when its `enabled` flag flips, via the AbortSignal it
    // already passed to our progress wrapper).
    const prev = useActiveLoadStore.getState().active;
    if (prev && prev.datasetId !== id) {
      useActiveLoadStore.getState().fail(prev.datasetId);
    }
    useActiveLoadStore.getState().start({ datasetId: id, bucket: id });
  };

  const handleSelectPreset = (ds: DatasetMeta) => {
    if (ds.id === datasetId && !pendingId) return;
    void requestDatasetSwitch({
      datasetId: ds.id,
      datasetName: ds.name,
      onConfirm: () => {
        setPresetLoadError(null);
        setUserLoadError(null);
        setLoadingId(ds.id);
        beginActiveLoad(ds.id);
        setPendingId(ds.id);
        setPendingUserDatasetId(null);
      },
    });
  };

  const handleSelectUserDataset = (ds: UserDatasetMeta) => {
    if (ds.id === activeUserDatasetId && !pendingUserDatasetId) return;
    setUserLoadError(null);
    setPresetLoadError(null);
    void qc.invalidateQueries({ queryKey: getGetSubstrateQueryKey(ds.id) });
    setLoadingId(ds.id);
    beginActiveLoad(ds.id);
    setPendingUserDatasetId(ds.id);
    setPendingId(null);
  };

  // ─── Cross-panel handoff (FileUpload / FindDataPanel → DatasetPanel) ──────
  // Other panels can ask us to load a freshly-materialized user dataset by
  // setting `pendingExternalUserDatasetId` on the global app context. We
  // route it through the same /user/datasets/:id/{terrain,overview} pipeline
  // as a click on a "My Library" row, then clear the handoff field.
  useEffect(() => {
    if (!pendingExternalUserDatasetId) return;
    if (
      pendingExternalUserDatasetId === activeUserDatasetId &&
      !pendingUserDatasetId
    ) {
      setPendingExternalUserDatasetId(null);
      return;
    }
    // Guard: if a previous upload handoff is still being loaded, reject the
    // second one with a toast so the user knows to wait.
    if (pendingUserDatasetId) {
      // Silently drop duplicate handoffs for the same id that is already loading.
      if (pendingExternalUserDatasetId !== pendingUserDatasetId) {
        // Use a microtask to avoid state updates during render.
        setTimeout(() => {
          const { dismiss, ...toastHandle } = toast({
            title: "Upload in progress",
            description: "Please wait — still loading the previous upload.",
          });
          void dismiss; void toastHandle;
        }, 0);
      }
      setPendingExternalUserDatasetId(null);
      return;
    }
    setUserLoadError(null);
    setPresetLoadError(null);
    setLoadingId(pendingExternalUserDatasetId);
    setPendingUserDatasetId(pendingExternalUserDatasetId);
    setPendingId(null);
    setPendingExternalUserDatasetId(null);
    // Make sure /user/datasets list reflects the brand-new row.
    void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetSubstrateQueryKey(pendingExternalUserDatasetId) });
  }, [
    pendingExternalUserDatasetId,
    activeUserDatasetId,
    pendingUserDatasetId,
    qc,
    setPendingExternalUserDatasetId,
    toast,
  ]);

  const handleRetryUserDataset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userLoadError) return;
    const id = userLoadError.id;
    void qc.invalidateQueries({ queryKey: getGetUserDatasetsIdTerrainQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetUserDatasetsIdOverviewQueryKey(id) });
    setUserLoadError(null);
    setLoadingId(id);
    beginActiveLoad(id);
    setPendingUserDatasetId(id);
    setPendingId(null);
  };

  const handleRetryPreset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!presetLoadError) return;
    const id = presetLoadError.id;
    void qc.invalidateQueries({ queryKey: getGetDatasetsIdTerrainQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetDatasetsIdOverviewQueryKey(id) });
    setPresetLoadError(null);
    setLoadingId(id);
    beginActiveLoad(id);
    setPendingId(id);
    setPendingUserDatasetId(null);
  };

  // ─── Delete user dataset — clean up active state when the row goes away ──
  // DatasetFolderTree owns the delete mutation (single-row and recursive
  // folder delete). When it finishes, it tells us which dataset ids were
  // removed so we can drop active-dataset state and clear the scene if the
  // user just deleted the dataset they were looking at.
  const handleDatasetsRemoved = useCallback(
    (removedIds: string[]) => {
      if (removedIds.length === 0) return;
      const removed = new Set(removedIds);
      if (activeUserDatasetId && removed.has(activeUserDatasetId)) {
        setActiveUserDatasetId(null);
        setTerrain(null);
        useTerrainStore.getState().setGrids({ activeGrid: null, overviewGrid: null });
        try {
          useClassificationStore.getState().clearZoneMap?.();
        } catch {
          // noop
        }
        activeOverviewWrittenRef.current = null;
      }
      // Also cancel any in-flight load targeting a removed id so we don't
      // commit grids for a row that no longer exists.
      if (pendingUserDatasetId && removed.has(pendingUserDatasetId)) {
        setPendingUserDatasetId(null);
        setLoadingId(null);
        useActiveLoadStore.getState().fail(pendingUserDatasetId);
      }
    },
    [activeUserDatasetId, pendingUserDatasetId, setTerrain],
  );

  // ─── Chunked-upload job polling (simple path, runs on jobId change) ──────
  // Backs off on network errors; clears when the health-poll reconnects.
  useEffect(() => {
    if (!chunkedJobId) return;

    let active = true;
    let backoffMs = 2_000;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active) return;
      try {
        const resp = await authorizedFetch(`${API_BASE}/api/datasets/upload/jobs/${chunkedJobId}`);
        backoffMs = 2_000; // reset back-off on any successful network response
        if (!resp.ok) {
          scheduleNext();
          return;
        }
        const data = await resp.json() as {
          status: string;
          progress: number;
          error?: string;
          datasetId?: string;
        };
        if (data.status === "done" && data.datasetId) {
          active = false;
          setChunkedJobId(null);
          setChunkedPhase("idle");
          setLastChunkedFile(null);
          setChunkedError(null);
          void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetSubstrateQueryKey(data.datasetId) });
          setActiveUserDatasetId(data.datasetId);
          setLoadingId(data.datasetId);
          setPendingUserDatasetId(data.datasetId);
          setPendingId(null);
          setUploadOpen(false);
        } else if (data.status === "error") {
          active = false;
          setChunkedJobId(null);
          setChunkedPhase("error");
          setChunkedError(data.error ?? "Server-side processing failed.");
        } else {
          scheduleNext();
        }
      } catch {
        // Network error — back off and wait for the server to return.
        backoffMs = Math.min(backoffMs * 2, 15_000);
        scheduleNext();
      }
    };

    const scheduleNext = () => {
      if (!active) return;
      timerId = setTimeout(() => { void poll(); }, backoffMs);
    };

    void poll();

    const unsubscribeReconnect = subscribeToReconnect(() => {
      // Server came back — reset back-off and poll immediately.
      backoffMs = 2_000;
      if (timerId !== null) { clearTimeout(timerId); timerId = null; }
      void poll();
    });

    return () => {
      active = false;
      if (timerId !== null) clearTimeout(timerId);
      unsubscribeReconnect();
    };
  }, [chunkedJobId, qc, setUploadOpen]);

  // ─── Upload ────────────────────────────────────────────────────────────────
  const postDatasetsUpload = usePostDatasetsUpload();

  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (postDatasetsUpload.isPending) {
      setUploadProgress(0);
      setSmallFileEta(null);
      // Calibrate estimated duration from file size: assume ~400 KB/s
      // end-to-end (network + server parse).  Floor at 3 s so tiny files
      // still show a visible countdown instead of jumping to "Almost done".
      const startedAt = uploadStartedAt.current ?? Date.now();
      const estimatedMs = Math.max(3_000, (uploadFileSizeBytesRef.current / (400 * 1024)) * 1_000);
      progressTimer.current = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const pct = Math.min(88, (elapsed / estimatedMs) * 88);
        setUploadProgress(pct);
        const remainingSecs = Math.max(0, Math.round((estimatedMs - elapsed) / 1_000));
        setSmallFileEta(remainingSecs);
      }, 100);
    } else {
      if (progressTimer.current) {
        clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
      setSmallFileEta(null);
      if (postDatasetsUpload.isSuccess) {
        setUploadProgress(100);
        const t = setTimeout(() => setUploadProgress(0), 700);
        return () => clearTimeout(t);
      } else {
        setUploadProgress(0);
      }
    }
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, [postDatasetsUpload.isPending, postDatasetsUpload.isSuccess]);

  const uploadFile = useCallback(
    (
      file: File,
      { isRetry, autoAttempt = 0 }: { isRetry?: boolean; autoAttempt?: number } = {},
    ) => {
      uploadStartedAt.current = Date.now();
      uploadFileSizeBytesRef.current = file.size;
      postDatasetsUpload.mutate(
        { data: { file, resolution: 256 } },
        {
          onSuccess: (data) => {
            const isFirstTry = !isRetry && autoAttempt === 0;
            if (isFirstTry) {
              setDatasetId(null);
              setTerrain(data.terrain);
              if (!useTerrainStore.getState().multiDatasetMode) {
                const uploadedId = data.terrain.datasetId ?? data.savedDatasetId ?? "__upload__";
                useTerrainStore.getState().setSinglePrimary(uploadedId, "user");
              }
              useTerrainStore.getState().setGrids({
                activeGrid: data.terrain,
                overviewGrid: data.overview,
              });
              useClassificationStore.getState().clearZoneMap();
              void useClassificationStore.getState().classify(data.terrain);
            }
            if (data.savedDatasetId) {
              setActiveUserDatasetId(data.savedDatasetId);
              // Optimistically insert the freshly-saved row into the
              // MY LIBRARY cache so it appears immediately, without
              // waiting for a refetch round-trip (Task #133).
              if (data.savedDatasetMeta) {
                const meta = data.savedDatasetMeta;
                qc.setQueryData<UserDatasetMeta[]>(
                  getGetUserDatasetsQueryKey(),
                  (prev) => {
                    const list = prev ?? [];
                    if (list.some((r) => r.id === meta.id)) return list;
                    return [meta, ...list];
                  },
                );
              }
              void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
              void qc.invalidateQueries({ queryKey: getGetSubstrateQueryKey(data.savedDatasetId) });
              // Invalidate markers for the new dataset so any pre-existing
              // markers stored server-side appear immediately in the viewer.
              void qc.invalidateQueries({
                queryKey: getGetMarkersQueryKey({ datasetId: data.savedDatasetId }),
              });
              // Invalidate settings so any server-side defaults for the new
              // dataset (e.g. waterType) are reflected without a manual reload.
              void qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
              setSaveError(null);
              setLastUploadedFile(null);
              setSavingToAccount(false);
              if (isFirstTry) setUploadOpen(false);
            } else if (data.saveError) {
              // Transparent retry-with-backoff before showing the warning.
              if (autoAttempt < AUTO_RETRY_DELAYS_MS.length) {
                if (isFirstTry) setActiveUserDatasetId(null);
                setSavingToAccount(true);
                setSaveError(null);
                setLastUploadedFile(file);
                const delay = AUTO_RETRY_DELAYS_MS[autoAttempt]!;
                if (autoRetryTimer.current) clearTimeout(autoRetryTimer.current);
                autoRetryTimer.current = setTimeout(() => {
                  autoRetryTimer.current = null;
                  uploadFile(file, { isRetry: true, autoAttempt: autoAttempt + 1 });
                }, delay);
              } else {
                setSavingToAccount(false);
                setSaveError(data.saveError);
                setLastUploadedFile(file);
                if (isFirstTry) setActiveUserDatasetId(null);
              }
            } else {
              if (isFirstTry) setActiveUserDatasetId(null);
              setSaveError(null);
              setLastUploadedFile(null);
              setSavingToAccount(false);
              if (isFirstTry) setUploadOpen(false);
            }
          },
          onError: (err) => {
            setSavingToAccount(false);
            const e = err as { data?: { detail?: string; details?: string; error?: string }; message?: string };
            const detail = e?.data?.detail ?? e?.data?.details;
            const msg = detail ?? (err instanceof Error ? err.message : "Parse failed");
            if (isRetry) {
              setSaveError(msg);
            } else {
              setUploadError(msg);
            }
          },
        },
      );
    },
    [postDatasetsUpload, setDatasetId, setTerrain, qc, setUploadOpen],
  );

  // ─── Chunked upload helpers ────────────────────────────────────────────────
  // doSendChunks sends slices [fromIndex, totalChunks) for the given uploadId.
  // Returns true on success; on any chunk failure sets error state and returns false,
  // storing the failed chunk index in chunkedFailedAtRef so a retry can resume there.
  const doSendChunks = useCallback(async (
    file: File,
    uploadId: string,
    fromIndex: number,
  ): Promise<boolean> => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    for (let i = fromIndex; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const fd = new FormData();
      fd.append("uploadId", uploadId);
      fd.append("chunkIndex", String(i));
      fd.append("totalChunks", String(totalChunks));
      fd.append("file", chunk, file.name);

      // Persist the session on chunk 0 so a page reload can show a resume banner.
      if (i === 0) {
        saveUploadSession({
          uploadId,
          fileName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          totalChunks,
        });
        setInterruptedSession(null);
      }

      let resp: Response;
      try {
        resp = await authorizedFetch(`${API_BASE}/api/datasets/upload/chunk`, {
          method: "POST",
          body: fd,
        });
      } catch (networkErr) {
        // Network-level failure (server unreachable). Store the chunk index so
        // auto-resume or manual retry can restart from exactly this point.
        chunkedFailedAtRef.current = i;
        setChunkedPhase("error");
        setChunkedError(
          networkErr instanceof TypeError
            ? "Connection lost while uploading — reconnecting…"
            : `Upload failed at chunk ${i + 1} of ${totalChunks}`,
        );
        return false;
      }

      if (!resp.ok) {
        // Cast via unknown — resp.json() returns any; the intermediate unknown
        // step makes the advisory shape explicit without bypassing type safety.
        const errBody = await resp.json().catch(() => ({})) as unknown as { details?: string; error?: string };
        chunkedFailedAtRef.current = i;
        setChunkedPhase("error");
        setChunkedError(errBody.details ?? errBody.error ?? `Upload failed at chunk ${i + 1} of ${totalChunks}`);
        return false;
      }
      setChunkedUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
    }
    return true;
  }, []);

  // doFinalizeChunks asks the server to assemble chunks and queue the job.
  // Returns true on success; sets error state and returns false otherwise.
  const doFinalizeChunks = useCallback(async (file: File, uploadId: string): Promise<boolean> => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const finalResp = await authorizedFetch(`${API_BASE}/api/datasets/upload/chunk/finalize`, {
      method: "POST",
      body: JSON.stringify({ uploadId, fileName: file.name, totalChunks, resolution: 256 }),
      headers: { "Content-Type": "application/json" },
    });

    if (!finalResp.ok) {
      // Cast via unknown — advisory shape for json() which returns any.
      const errBody = await finalResp.json().catch(() => ({})) as unknown as { details?: string; error?: string };
      // Use totalChunks as sentinel: all chunks are present, only finalize failed
      chunkedFailedAtRef.current = totalChunks;
      setChunkedPhase("error");
      setChunkedError(errBody.details ?? errBody.error ?? "Failed to start server processing");
      return false;
    }

    const finalBody = await finalResp.json().catch(() => ({})) as unknown as { jobId?: unknown };
    const jobId = finalBody?.jobId;
    if (typeof jobId !== "string" || !jobId) {
      chunkedFailedAtRef.current = totalChunks;
      setChunkedPhase("error");
      setChunkedError("Server accepted the upload but returned an invalid job ID — please retry.");
      return false;
    }
    // Finalize accepted and jobId confirmed — the session is safely handed off to the server.
    clearUploadSession();
    setChunkedPhase("processing");
    setChunkedJobId(jobId);
    return true;
  }, []);

  // ─── GCS upload entry-point for oversized files (>50 MB) ─────────────────
  // 1. Request a presigned PUT URL from the server.
  // 2. PUT the file directly to GCS via XHR (gives real progress events).
  // 3. Switch to "Processing in background" state.
  // 4. Poll GET /api/user/datasets every 10 s until the new row appears.
  const gcsUploadFile = useCallback(async (file: File) => {
    setGcsPhase("uploading");
    setGcsUploadProgress(0);
    setGcsError(null);

    // Resolve the auth token before making any authenticated requests.
    // getAuthToken() reads the same getter wired by ClerkAuthTokenWirer so it
    // always reflects the current session without needing a React hook.
    const authToken = await getAuthToken();
    if (!authToken && hasAuthTokenGetter()) {
      // A getter is registered (i.e. we are in a real auth context) but it
      // returned no token — the session has probably expired.
      setGcsPhase("error");
      setGcsError("Authentication required. Please sign in and try again.");
      return;
    }
    const authHeader: Record<string, string> = authToken
      ? { Authorization: `Bearer ${authToken}` }
      : {};

    // Step 1: get presigned URL — retry up to 2 extra times on 401 to handle
    // Clerk's short-lived token expiry window (~60 s). If the token expired just
    // before this call, waiting 3 s lets the SDK issue a fresh one automatically.
    let uploadUrl: string;
    let objectKey: string;
    try {
      let currentAuthHeader = authHeader;
      let lastResp: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const resp = await fetch(`${API_BASE}/api/datasets/upload/request-gcs-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...currentAuthHeader },
          body: JSON.stringify({ fileName: file.name }),
        });
        if (resp.status === 401 && attempt < 2 && hasAuthTokenGetter()) {
          // Token expired mid-request. Give Clerk 3 s to refresh it, then retry.
          await new Promise<void>((r) => setTimeout(r, 3_000));
          const freshToken = await getAuthToken();
          currentAuthHeader = freshToken ? { Authorization: `Bearer ${freshToken}` } : {};
          continue;
        }
        lastResp = resp;
        break;
      }
      if (!lastResp) {
        throw new Error("Upload request did not complete — please retry.");
      }
      if (!lastResp.ok) {
        // Cast via unknown — advisory shape for json() which returns any.
        const err = await lastResp.json().catch(() => ({})) as unknown as { details?: string; error?: string };
        throw new Error(err.details ?? err.error ?? "Failed to get upload URL");
      }
      const rawData = await lastResp.json().catch(() => ({})) as unknown as { uploadUrl?: unknown; objectKey?: unknown };
      if (typeof rawData?.uploadUrl !== "string" || !rawData.uploadUrl ||
          typeof rawData?.objectKey !== "string" || !rawData.objectKey) {
        throw new Error("Server returned an invalid upload URL response — please retry.");
      }
      uploadUrl = rawData.uploadUrl;
      objectKey = rawData.objectKey;
    } catch (err) {
      setGcsPhase("error");
      setGcsError(err instanceof Error ? err.message : "Failed to request upload URL");
      return;
    }

    // Step 2: PUT directly to GCS with XHR for real progress
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        // Store the live XHR so the unmount cleanup can call xhr.abort().
        gcsXhrRef.current = xhr;
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable && !gcsUnmountedRef.current) {
            setGcsUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.addEventListener("load", () => {
          gcsXhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`GCS upload failed with status ${xhr.status}`));
          }
        });
        xhr.addEventListener("error", () => { gcsXhrRef.current = null; reject(new Error("Network error during upload")); });
        xhr.addEventListener("abort", () => { gcsXhrRef.current = null; reject(new Error("Upload aborted")); });
        xhr.send(file);
      });
    } catch (err) {
      // Silently discard if the component was unmounted (abort triggers this path).
      if (gcsUnmountedRef.current) return;
      setGcsPhase("error");
      setGcsError(err instanceof Error ? err.message : "Upload to cloud storage failed");
      return;
    }

    // Step 3: switch to background-processing state
    // Guard: the component may have been unmounted between the XHR resolving
    // and this synchronous continuation running (e.g. fast navigation away).
    if (gcsUnmountedRef.current) return;
    setGcsPhase("processing");
    setGcsUploadProgress(100);
    setGcsServerStatus(null);

    // Step 4: poll the job-status endpoint every 10 s using the specific
    // objectKey so we resolve exactly the right dataset, even if another
    // upload finishes concurrently.
    const pollIntervalId = setInterval(() => {
      void fetch(`${API_BASE}/api/datasets/upload/gcs-job-status?objectKey=${encodeURIComponent(objectKey)}`, {
        headers: authHeader,
      })
        .then((r) => {
          // Check r.ok before calling r.json() — a non-2xx response with a
          // non-JSON body (e.g. HTML error page) would throw an unhandled
          // parse error rather than flowing to the .catch transient-error path.
          if (!r.ok) throw new Error(`Poll failed: HTTP ${r.status}`);
          // Use .catch(() => null) so a malformed 2xx body (non-JSON or empty)
          // produces null rather than throwing into the .catch transient handler.
          // The second .then validates the shape before accessing any fields.
          return r.json().catch(() => null) as Promise<{ status: string; datasetId?: string; error?: string; skippedCount?: number; skippedFormats?: string[]; soundingCount?: number; substrateCount?: number; parseWarnings?: string[] } | null>;
        })
        .then((job) => {
          // Drop the result silently if the component unmounted while the
          // fetch was in-flight — the interval is already cleared by cleanup.
          if (gcsUnmountedRef.current) return;
          // Null means the 2xx body was not valid JSON — stop polling immediately.
          // This is distinct from a transient network error; treat it as a real failure.
          if (job === null || typeof job?.status !== "string") {
            clearInterval(pollIntervalId);
            gcsPollIntervalRef.current = null;
            clearTimeout(gcsWatchdogTimeoutRef.current ?? undefined);
            gcsWatchdogTimeoutRef.current = null;
            const malformedMsg = "Server returned an unreadable response while checking upload status — please retry.";
            setGcsPhase("error");
            setGcsError(malformedMsg);
            setGcsServerStatus(null);
            toast({
              title: "Upload processing failed",
              description: malformedMsg,
              variant: "destructive",
            });
            return;
          }

          // Track server-reported queued/processing sub-status for UI display.
          if (job.status === "queued" || job.status === "processing") {
            setGcsServerStatus(job.status);
          }

          const knownStatuses = new Set(["queued", "processing", "done", "failed"]);
          if (!knownStatuses.has(job.status)) {
            clearInterval(pollIntervalId);
            gcsPollIntervalRef.current = null;
            clearTimeout(gcsWatchdogTimeoutRef.current ?? undefined);
            gcsWatchdogTimeoutRef.current = null;
            const unknownMsg = `Upload processing returned an unexpected status ("${job.status}") — please retry.`;
            setGcsPhase("error");
            setGcsError(unknownMsg);
            setGcsServerStatus(null);
            toast({
              title: "Upload processing failed",
              description: unknownMsg,
              variant: "destructive",
            });
            return;
          }

          if (job.status === "done" && !job.datasetId) {
            clearInterval(pollIntervalId);
            gcsPollIntervalRef.current = null;
            clearTimeout(gcsWatchdogTimeoutRef.current ?? undefined);
            gcsWatchdogTimeoutRef.current = null;
            const missingIdMsg = "Processing completed but the server did not return a dataset ID — please retry.";
            setGcsPhase("error");
            setGcsError(missingIdMsg);
            setGcsServerStatus(null);
            toast({
              title: "Upload processing failed",
              description: missingIdMsg,
              variant: "destructive",
            });
            return;
          }

          if (job.status === "done" && job.datasetId) {
            clearInterval(pollIntervalId);
            gcsPollIntervalRef.current = null;
            void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
            void qc.invalidateQueries({ queryKey: getGetSubstrateQueryKey(job.datasetId) });
            setGcsPhase("idle");
            setGcsError(null);
            setGcsServerStatus(null);

            const completedDatasetId = job.datasetId;
            const displayName = file.name.replace(/\.[^.]+$/, "");

            const triggerLoad = () => {
              setLoadingId(completedDatasetId);
              setPendingUserDatasetId(completedDatasetId);
              setPendingId(null);
              setUploadOpen(false);
            };

            const skippedNote =
              job.skippedCount && job.skippedCount > 0
                ? ` · ${job.skippedCount} file${job.skippedCount === 1 ? "" : "s"} skipped` +
                  (job.skippedFormats && job.skippedFormats.length > 0
                    ? ` (unsupported formats: ${job.skippedFormats.join(", ")})`
                    : "")
                : "";

            toast({
              title: `Dataset ready: ${displayName}`,
              description: `${buildImportDescription(job.soundingCount, job.substrateCount)}${skippedNote}`,
              action: (
                <ToastAction altText="Load dataset now" onClick={triggerLoad}>
                  Load now
                </ToastAction>
              ),
            });

            if (job.parseWarnings && job.parseWarnings.length > 0) {
              toast({
                title: "Column name advisory",
                description: job.parseWarnings.join(" "),
              });
            }
          } else if (job.status === "failed") {
            clearInterval(pollIntervalId);
            gcsPollIntervalRef.current = null;
            const failMsg = job.error ?? "Processing failed. Please try uploading again.";
            setGcsPhase("error");
            setGcsError(failMsg);
            setGcsServerStatus(null);
            toast({
              title: "Upload processing failed",
              description: failMsg,
              variant: "destructive",
            });
          }
        })
        .catch(() => {
          // Transient network error — keep polling
        });
    }, 10_000);
    gcsPollIntervalRef.current = pollIntervalId;

    // After 15 minutes, stop polling and enter a distinct "processing_timeout"
    // phase rather than "idle" or "error". The upload itself succeeded; only
    // background conversion is still running.  "processing_timeout" signals
    // this clearly in the UI while still allowing a new file to be dropped.
    const watchdogId = setTimeout(() => {
      clearInterval(pollIntervalId);
      gcsPollIntervalRef.current = null;
      gcsWatchdogTimeoutRef.current = null;
      // No-op if the component unmounted while the timeout was pending.
      if (gcsUnmountedRef.current) return;
      setGcsPhase((prev) => {
        if (prev === "processing") {
          setGcsServerStatus(null);
          toast({
            title: "Still processing",
            description:
              "Processing is taking longer than usual. Your file is safe — check back in a few minutes and it should appear in your datasets.",
          });
          return "processing_timeout";
        }
        return prev;
      });
    }, 15 * 60 * 1000);
    gcsWatchdogTimeoutRef.current = watchdogId;
  }, [qc, setUploadOpen, toast]);

  // ─── Chunked upload entry-point (new upload, starts from chunk 0) ─────────
  const chunkedUploadFile = useCallback(async (file: File) => {
    setLastChunkedFile(file);
    setChunkedPhase("uploading");
    setChunkedUploadProgress(0);
    setChunkedJobProgress(0);
    setChunkedError(null);
    setChunkedJobId(null);

    const uploadId = crypto.randomUUID();
    chunkedUploadIdRef.current = uploadId;
    chunkedFailedAtRef.current = null;

    const chunksOk = await doSendChunks(file, uploadId, 0);
    if (!chunksOk) return;
    await doFinalizeChunks(file, uploadId);
  }, [doSendChunks, doFinalizeChunks]);

  // ─── Poll job-status endpoint while chunked processing is in flight ────────
  // Once the server queues the job (finalize returns jobId), we poll
  // GET /api/datasets/upload/jobs/:jobId with exponential back-off on network
  // errors and immediate resume when the health-poll confirms the server is
  // back online (via subscribeToReconnect).
  useEffect(() => {
    if (chunkedPhase !== "processing" || !chunkedJobId) return;

    setChunkedJobProgress(0);
    setChunkedJobEta(null);
    setChunkedServerStatus(null);

    let stopped = false;
    let backoffMs = 1_500;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;

      try {
        const resp = await authorizedFetch(
          `${API_BASE}/api/datasets/upload/jobs/${encodeURIComponent(chunkedJobId)}`,
        );
        backoffMs = 1_500; // reset back-off on any successful network response

        if (!resp.ok) {
          scheduleNext();
          return;
        }

        const job = await resp.json() as {
          status: string; progress: number; error?: string; datasetId?: string;
          skippedCount?: number; skippedFormats?: string[]; soundingCount?: number;
          substrateCount?: number; parseWarnings?: string[]; eta?: number | null;
        };

        if (stopped) return;

        if (typeof job.progress === "number") {
          setChunkedJobProgress(job.progress);
        }
        setChunkedJobEta(typeof job.eta === "number" ? job.eta : null);

        // Track server-reported queued/processing sub-status for UI display.
        if (job.status === "queued" || job.status === "processing") {
          setChunkedServerStatus(job.status);
        }

        if (job.status === "done" && job.datasetId) {
          stopped = true;
          setChunkedPhase("idle");
          setChunkedJobId(null);
          setChunkedJobProgress(0);
          void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });

          const completedDatasetId = job.datasetId;
          const displayName = lastChunkedFile?.name.replace(/\.[^.]+$/, "") ?? "Dataset";
          const triggerLoad = () => {
            setLoadingId(completedDatasetId);
            setPendingUserDatasetId(completedDatasetId);
            setPendingId(null);
            setUploadOpen(false);
          };
          const skippedNote =
            job.skippedCount && job.skippedCount > 0
              ? ` · ${job.skippedCount} file${job.skippedCount === 1 ? "" : "s"} skipped` +
                (job.skippedFormats && job.skippedFormats.length > 0
                  ? ` (unsupported formats: ${job.skippedFormats.join(", ")})`
                  : "")
              : "";

          toast({
            title: `Dataset ready: ${displayName}`,
            description: `${buildImportDescription(job.soundingCount, job.substrateCount)}${skippedNote}`,
            action: (
              <ToastAction altText="Load dataset now" onClick={triggerLoad}>
                Load now
              </ToastAction>
            ),
          });

          if (job.parseWarnings && job.parseWarnings.length > 0) {
            toast({
              title: "Column name advisory",
              description: job.parseWarnings.join(" "),
            });
          }
        } else if (job.status === "error") {
          stopped = true;
          clearUploadSession();
          setChunkedPhase("error");
          setChunkedError(job.error ?? "Processing failed. Please try uploading again.");
        } else {
          scheduleNext();
        }
      } catch {
        // Network error — enter back-off; resume immediately when server is back.
        if (!stopped) {
          backoffMs = Math.min(backoffMs * 2, 15_000);
          scheduleNext();
        }
      }
    };

    const scheduleNext = () => {
      if (stopped) return;
      timerId = setTimeout(() => { void poll(); }, backoffMs);
    };

    void poll();

    const unsubscribeReconnect = subscribeToReconnect(() => {
      if (stopped) return;
      // Server came back — reset back-off and poll immediately.
      backoffMs = 1_500;
      if (timerId !== null) { clearTimeout(timerId); timerId = null; }
      void poll();
    });

    // Stop polling after 10 minutes and show a timeout message.
    const timeoutId = setTimeout(() => {
      if (stopped) return;
      stopped = true;
      if (timerId !== null) clearTimeout(timerId);
      setChunkedPhase((prev) => {
        if (prev === "processing") {
          setChunkedError("Processing timed out. The file may still be processing — check back in a few minutes or try uploading again.");
          return "error";
        }
        return prev;
      });
    }, 10 * 60 * 1_000);

    return () => {
      stopped = true;
      if (timerId !== null) clearTimeout(timerId);
      clearTimeout(timeoutId);
      unsubscribeReconnect();
    };
  }, [chunkedPhase, chunkedJobId, qc, lastChunkedFile, toast, setUploadOpen]);

  // Async resume helper extracted so onDrop can stay synchronous (useCallback
  // type inference doesn't allow async callbacks in strict mode here).
  const doResumeChunkedUpload = useCallback(async (file: File, saved: SavedUploadSession) => {
    pendingResumeRef.current = null;
    setInterruptedSession(null);
    clearUploadSession();

    setLastChunkedFile(file);
    setChunkedPhase("uploading");
    setChunkedError(null);
    setChunkedJobId(null);
    chunkedUploadIdRef.current = saved.uploadId;
    chunkedFailedAtRef.current = null;

    // Ask the server which chunks it already has so we skip them.
    let resumeFrom = 0;
    try {
      const statusResp = await authorizedFetch(
        `${API_BASE}/api/datasets/upload/chunk/status/${encodeURIComponent(saved.uploadId)}`,
      );
      if (statusResp.ok) {
        const { receivedChunks } = await statusResp.json() as { receivedChunks: number[] };
        const receivedSet = new Set(receivedChunks);
        let firstMissing = 0;
        while (firstMissing < saved.totalChunks && receivedSet.has(firstMissing)) firstMissing++;
        resumeFrom = firstMissing;
      }
    } catch { /* fall back to 0 */ }

    // Re-persist the session so it survives any further reloads during transfer.
    saveUploadSession(saved);
    setChunkedUploadProgress(Math.round((resumeFrom / saved.totalChunks) * 100));
    setChunkedJobProgress(0);

    toast({
      title: "Upload resumed",
      description: resumeFrom > 0
        ? `Continuing from chunk ${resumeFrom + 1} of ${saved.totalChunks}`
        : "Restarting upload from the beginning",
    });

    const ok = await doSendChunks(file, saved.uploadId, resumeFrom);
    if (!ok) return;
    await doFinalizeChunks(file, saved.uploadId);
  }, [doSendChunks, doFinalizeChunks, toast]);

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      // Guard: ignore new drops while any upload path is already in progress.
      if (postDatasetsUpload.isPending || chunkedPhase === "uploading" || chunkedPhase === "processing" || gcsPhase === "uploading" || gcsPhase === "processing") return;

      setUploadError(null);
      setSaveError(null);
      setChunkedPhase("idle");
      setChunkedError(null);
      setGcsPhase("idle");
      setGcsError(null);
      if (rejected.length) {
        const code = rejected[0]?.errors[0]?.code;
        if (code === "file-invalid-type") {
          setUploadError("Unsupported file type. Accepted: .csv, .xyz, .txt, .tif, .tiff, .bag, .las, .laz, .nc, .gpx, .nmea, .gz");
        } else {
          setUploadError("Invalid file");
        }
        return;
      }
      const file = accepted[0];
      if (!file) return;
      if (autoRetryTimer.current) {
        clearTimeout(autoRetryTimer.current);
        autoRetryTimer.current = null;
      }
      setSavingToAccount(false);

      // If this file matches a saved interrupted session, resume it.
      const saved = pendingResumeRef.current ?? interruptedSession;
      if (
        saved &&
        file.size > CHUNKED_THRESHOLD &&
        file.size <= GCS_THRESHOLD &&
        file.name === saved.fileName &&
        file.size === saved.fileSize &&
        file.lastModified === saved.lastModified
      ) {
        void doResumeChunkedUpload(file, saved);
        return;
      }

      if (file.size > GCS_THRESHOLD) {
        // Files above 50 MB bypass the API server entirely: upload directly to
        // GCS via a presigned URL, then the bucket monitor processes them.
        void gcsUploadFile(file);
      } else if (file.size > CHUNKED_THRESHOLD) {
        void chunkedUploadFile(file);
      } else {
        uploadFile(file);
      }
    },
    [uploadFile, chunkedUploadFile, gcsUploadFile, interruptedSession, doResumeChunkedUpload, postDatasetsUpload.isPending, chunkedPhase, gcsPhase],
  );

  const handleRetrySave = useCallback(() => {
    if (!lastUploadedFile || postDatasetsUpload.isPending) return;
    uploadFile(lastUploadedFile, { isRetry: true });
  }, [lastUploadedFile, postDatasetsUpload.isPending, uploadFile]);

  // ─── Chunked upload retry — resumes from the failed chunk, same uploadId ──
  // If a chunk transfer failed: resend from that chunk index onwards.
  // If all chunks arrived but finalize failed: skip straight to finalize.
  // Never restarts the whole upload unnecessarily.
  //
  // Before re-entering the upload loop we probe GET /api/healthz with a 5 s
  // timeout. If the server is unreachable we update the error message so the
  // user sees "Server unreachable" instead of experiencing a silent second
  // failure, and we leave chunkedPhase as "error" so the retry button stays
  // visible for when connectivity is restored.
  const handleRetryChunked = useCallback(async () => {
    if (!lastChunkedFile || chunkedPhase === "uploading" || chunkedPhase === "processing") return;
    const uploadId = chunkedUploadIdRef.current;
    if (!uploadId) return;

    // ── Server health probe ────────────────────────────────────────────────────
    let serverReachable = false;
    try {
      const probe = await fetch(`${API_BASE}/api/healthz`, {
        signal: AbortSignal.timeout(5_000),
      });
      serverReachable = probe.ok;
    } catch {
      serverReachable = false;
    }

    if (!serverReachable) {
      setChunkedError("Server unreachable — check your connection and try again");
      // Start the background health poll so the reconnect event fires once the
      // server comes back, allowing the upload to auto-resume without another
      // manual Retry click.
      markServerUnreachable();
      return;
    }

    const totalChunks = Math.ceil(lastChunkedFile.size / CHUNK_SIZE);
    const failedAt = chunkedFailedAtRef.current ?? 0;

    setChunkedPhase("uploading");
    setChunkedError(null);
    // Show progress from where we are — don't reset to 0 if early chunks already landed
    setChunkedUploadProgress(Math.round((Math.min(failedAt, totalChunks) / totalChunks) * 100));

    if (failedAt >= totalChunks) {
      // All chunks were already received; only the finalize call failed. Retry it directly.
      await doFinalizeChunks(lastChunkedFile, uploadId);
    } else {
      // Resume chunk transfer from the failed index, then finalize.
      const chunksOk = await doSendChunks(lastChunkedFile, uploadId, failedAt);
      if (!chunksOk) return;
      await doFinalizeChunks(lastChunkedFile, uploadId);
    }
  }, [lastChunkedFile, chunkedPhase, doSendChunks, doFinalizeChunks]);

  // ─── Auto-resume chunked upload on reconnect ───────────────────────────────
  // When a network error interrupted a chunk upload, doSendChunks sets
  // chunkedPhase to "error" and records the failed chunk index.
  // This effect subscribes to the health-poll reconnect event and:
  //   1. Calls the chunk-status endpoint to see which chunks arrived safely.
  //   2. Compares against chunkedFailedAtRef to find the first missing chunk.
  //   3. Resumes sending from that chunk (and finalises once all are received).
  // The user sees the upload continue automatically without having to click Retry.
  useEffect(() => {
    if (chunkedPhase !== "error") return;

    const uploadId = chunkedUploadIdRef.current;
    const file = lastChunkedFile;
    if (!uploadId || !file) return;

    const unsubscribe = subscribeToReconnect(async () => {
      // Re-read phase at the time of reconnect; it might have changed.
      if (chunkedPhase !== "error") return;

      // Re-probe health before resuming. This is the common path when
      // handleRetryChunked called markServerUnreachable after a failed probe:
      // the health poll confirmed the server is back, but we do a direct
      // /api/healthz check to be sure before re-entering the upload loop.
      try {
        const healthProbe = await fetch(`${API_BASE}/api/healthz`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!healthProbe.ok) {
          setChunkedError("Server unreachable — check your connection and try again");
          return;
        }
      } catch {
        setChunkedError("Server unreachable — check your connection and try again");
        return;
      }

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      // Ask the server which chunk slices it already has on disk.
      let resumeFrom = chunkedFailedAtRef.current ?? 0;
      try {
        const statusResp = await authorizedFetch(
          `${API_BASE}/api/datasets/upload/chunk/status/${encodeURIComponent(uploadId)}`,
        );
        if (statusResp.ok) {
          const { receivedChunks } = await statusResp.json() as { receivedChunks: number[] };
          const receivedSet = new Set(receivedChunks);
          // Find the first gap in the received set.
          let firstMissing = 0;
          while (firstMissing < totalChunks && receivedSet.has(firstMissing)) {
            firstMissing++;
          }
          resumeFrom = firstMissing;
        }
      } catch {
        // Status endpoint unreachable — fall back to the in-memory failed index.
      }

      const resumeChunkDisplay = Math.min(resumeFrom + 1, totalChunks);
      toast({
        title: "Upload resumed",
        description: `Reconnected — resuming from chunk ${resumeChunkDisplay} of ${totalChunks}`,
      });

      setChunkedPhase("uploading");
      setChunkedError(null);
      setChunkedUploadProgress(Math.round((Math.min(resumeFrom, totalChunks) / totalChunks) * 100));

      if (resumeFrom >= totalChunks) {
        await doFinalizeChunks(file, uploadId);
      } else {
        const ok = await doSendChunks(file, uploadId, resumeFrom);
        if (!ok) return;
        await doFinalizeChunks(file, uploadId);
      }
    });

    return unsubscribe;
  }, [chunkedPhase, lastChunkedFile, doSendChunks, doFinalizeChunks, toast]);

  const isAnyUploadBusy = postDatasetsUpload.isPending || chunkedPhase === "uploading" || chunkedPhase === "processing" || gcsPhase === "uploading" || gcsPhase === "processing";

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "text/plain": [".xyz", ".txt", ".nmea"],
      "application/gzip": [".gz"],
      "application/x-gzip": [".gz"],
      "image/tiff": [".tif", ".tiff"],
      "application/octet-stream": [".bag", ".las", ".laz", ".nc", ".gz"],
      "application/x-netcdf": [".nc"],
      "application/gpx+xml": [".gpx"],
      "text/xml": [".gpx"],
    },
    maxFiles: 1,
    // No maxSize — large files (> 10 MB) route to the chunked path automatically.
    // Files ≤ 50 MB use the regular multer path; the server enforces limits there.
    disabled: isAnyUploadBusy,
  });

  // ─── Markers ──────────────────────────────────────────────────────────────
  const markersOpen = !usePanelCollapseStore((s) => s.collapsed.markersAccordion);
  const setMarkersOpen = useCallback(
    (v: boolean) => usePanelCollapseStore.getState().setCollapsed("markersAccordion", !v),
    [],
  );
  const [markerSearch, setMarkerSearch] = useState("");
  const [markerTypeFilter, setMarkerTypeFilter] = useState<string | null>(null);
  const [gpsImportOpen, setGpsImportOpen] = useState(false);
  const [gpsExportOpen, setGpsExportOpen] = useState(false);

  // Reset search + filter whenever the MARKERS accordion is closed.
  useEffect(() => {
    if (!markersOpen) {
      setMarkerSearch("");
      setMarkerTypeFilter(null);
    }
  }, [markersOpen]);

  // ─── Bookmarks ─────────────────────────────────────────────────────────────
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const bookmarkDatasetId = terrain?.datasetId ?? "";
  const bookmarks: CameraBookmark[] = useSettingsStore(
    (s) => (bookmarkDatasetId ? (s.bookmarks[bookmarkDatasetId] ?? EMPTY_BOOKMARKS) : EMPTY_BOOKMARKS),
  );
  const renameBookmark = useSettingsStore((s) => s.renameBookmark);
  const deleteBookmark = useSettingsStore((s) => s.deleteBookmark);
  const reorderBookmarks = useSettingsStore((s) => s.reorderBookmarks);

  // Drag-to-reorder state (refs avoid re-renders during drag)
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleFlyToBookmark = (bk: CameraBookmark) => {
    if (!terrain) return;
    const { x, z } = lonLatToWorldXZ(bk.lon, bk.lat, terrain);
    const depthRange = terrain.maxDepth - terrain.minDepth;
    const t = depthRange > 0 ? (bk.depth - terrain.minDepth) / depthRange : 0;
    const worldY = -Math.max(0, Math.min(1, t)) * MAX_DEPTH_WORLD;
    useUiStore.getState().setPendingDropIn({
      worldX: x,
      worldZ: z,
      worldY,
      heading: bk.heading,
    });
  };

  const handleRenameBookmark = (bk: CameraBookmark) => {
    const name = window.prompt("Rename saved view:", bk.name);
    if (!name || !name.trim()) return;
    renameBookmark(bookmarkDatasetId, bk.id, name.trim());
  };

  const handleDeleteBookmark = (e: React.MouseEvent, bk: CameraBookmark) => {
    e.stopPropagation();
    deleteBookmark(bookmarkDatasetId, bk.id);
  };
  const markerDatasetId = terrain?.datasetId ?? "";
  const { data: markers } = useGetMarkers(
    { datasetId: markerDatasetId },
    { query: { enabled: !!markerDatasetId, queryKey: getGetMarkersQueryKey({ datasetId: markerDatasetId }) } },
  );
  const requestMarkerDelete = useUndoableMarkerDelete();

  const handleDeleteMarker = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const marker = markers?.find((m) => m.id === id);
    if (!marker) return;
    requestMarkerDelete(marker, markerDatasetId);
  };

  const handleTeleportToMarker = (lon: number, lat: number) => {
    if (!terrain) return;
    const { x, z } = lonLatToWorldXZ(lon, lat, terrain);
    useUiStore.getState().setPendingDropIn({ worldX: x, worldZ: z });
  };

  // ─── Action-bar handlers ─────────────────────────────────────────────────
  const handleLoadTogether = useCallback(async () => {
    const state = useTerrainStore.getState();
    const visibleIds = new Set(state.visibleDatasets.map((v) => v.datasetId));

    const presetToAdd = [...presetSelectedIds].filter((id) => !visibleIds.has(id));
    const libraryToAdd = [...librarySelectedIds].filter((id) => !visibleIds.has(id));

    // Library datasets carry grids inline — add them to the selected pool immediately, no preflight.
    const toggleLibrary = () => {
      const st = useTerrainStore.getState();
      const selected = new Set(st.selectedIds);
      for (const id of libraryToAdd) {
        if (!selected.has(id)) st.addSelected(id, "user");
      }
    };

    // Add preset datasets to selected pool and clear selection after preflight passes.
    const togglePresetsAndClear = () => {
      const st = useTerrainStore.getState();
      const selected = new Set(st.selectedIds);
      for (const id of presetToAdd) {
        if (!selected.has(id)) st.addSelected(id, "preset");
      }
      // Drive AppState.datasetId to the first preset so useActiveDatasetSync
      // fetches its terrain into AppState context — the primary TerrainMesh in
      // SceneContents reads from AppState.terrain, not terrainStore directly.
      if (presetToAdd[0]) setDatasetId(presetToAdd[0]);
      setPresetSelectedIds(new Set());
      setLibrarySelectedIds(new Set());
    };

    if (presetToAdd.length === 0) {
      // Only library datasets selected — toggle immediately.
      toggleLibrary();
      // Drive the primary user dataset through the existing pending-load
      // pipeline so AppState.terrain (and setGrids) are updated, which is what
      // SceneContents uses to render the primary TerrainMesh.
      if (libraryToAdd[0]) setPendingUserDatasetId(libraryToAdd[0]);
      setPresetSelectedIds(new Set());
      setLibrarySelectedIds(new Set());
      return;
    }

    const { suppressed, setPending } = useSimulatedDataStore.getState();

    // Toggle library datasets now; they never need a preflight.
    toggleLibrary();

    if (suppressed) {
      togglePresetsAndClear();
      return;
    }

    // Fetch previews for preset datasets in parallel (errors → proceed).
    const results = await Promise.all(
      presetToAdd.map(async (id) => {
        try {
          const preview = await queryClient.fetchQuery({
            queryKey: getGetDatasetsIdPreviewQueryKey(id),
            queryFn: () => getDatasetsIdPreview(id),
            staleTime: 30_000,
          });
          return { id, preview };
        } catch {
          return { id, preview: null };
        }
      }),
    );

    const firstSimulated = results.find(
      (r) =>
        r.preview?.dataSource === "synthetic" || r.preview?.dataSource === "unknown",
    );

    if (!firstSimulated) {
      togglePresetsAndClear();
      return;
    }

    // Show one combined warning dialog for the preset batch.
    setPending({
      datasetId: firstSimulated.id,
      datasetName: firstSimulated.preview?.name ?? firstSimulated.id,
      preview: firstSimulated.preview!,
      onConfirm: () => {
        setPending(null);
        togglePresetsAndClear();
      },
      onCancel: () => {
        setPending(null);
      },
    });
  }, [presetSelectedIds, librarySelectedIds, setDatasetId, setPendingUserDatasetId]);

  const handleActionDelete = useCallback(() => {
    if (presetSelectedIds.size > 0) {
      setPresetDeleteConfirm(true);
      return;
    }
    if (librarySelectedIds.size === 0) return;
    setLibraryBulkDeleteSignal((s) => s + 1);
  }, [librarySelectedIds.size, presetSelectedIds.size]);

  const handleConfirmPresetDelete = useCallback(async () => {
    setPresetDeleteConfirm(false);
    const ids = [...presetSelectedIds];
    for (const id of ids) {
      try {
        await authorizedFetch(`${API_BASE}/api/datasets/presets/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch {
        // best-effort; server already guards against duplicates
      }
    }
    setPresetSelectedIds(new Set());
    void qc.invalidateQueries({ queryKey: getGetDatasetsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDatasetsQueryKey({ waterType }) });
    if (librarySelectedIds.size > 0) {
      setLibraryBulkDeleteSignal((s) => s + 1);
    }
  }, [presetSelectedIds, librarySelectedIds.size, qc, waterType]);

  const handleActionCopy = useCallback(() => {
    toast({ title: "Coming soon", description: "Copy is not yet available." });
  }, [toast]);

  const handleActionMoveToFolder = useCallback(() => {
    if (librarySelectedIds.size !== 1) return;
    const [id] = [...librarySelectedIds];
    if (!id) return;
    const ds = (userDatasets ?? []).find((d) => d.id === id);
    if (!ds) return;
    setLibraryMoveSignal({ id: ds.id, name: ds.name, folderId: ds.folderId ?? null, seq: Date.now() });
  }, [librarySelectedIds, userDatasets]);

  const handleActionPaste = useCallback(() => {
    toast({ title: "Coming soon", description: "Paste is not yet available." });
  }, [toast]);

  const handleActionRename = useCallback(() => {
    if (librarySelectedIds.size !== 1 || presetSelectedIds.size > 0) return;
    const [id] = [...librarySelectedIds];
    if (!id) return;
    const ds = (userDatasets ?? []).find((d) => d.id === id);
    if (!ds) return;
    setLibraryRenameSignal({ id: ds.id, name: ds.name, seq: Date.now() });
  }, [librarySelectedIds, presetSelectedIds.size, userDatasets]);

  // ─── Offline Pack modal ───────────────────────────────────────────────────
  const [offlinePackDataset, setOfflinePackDataset] = useState<{
    id: string;
    name: string;
    bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null;
  } | null>(null);

  // ─── Georeferencing wizard modal ──────────────────────────────────────────
  const [georefDataset, setGeorefDataset] = useState<UserDatasetMeta | null>(null);

  // ─── Render ────────────────────────────────────────────────────────────────
  const anyLoading = datasetsLoading || userDatasetsLoading;

  return (
    <div
      style={embedded ? { width: "100%" } : { ...PANEL, pointerEvents: "auto" }}
      className="dataset-panel select-none"
    >
      {/* Header — hidden when embedded inside a SidebarSection */}
      {!embedded && (
      <div className="w-full flex items-center px-3 py-2 hover:bg-white/5 transition-colors rounded-t">
        {/*
         * HelpIcon is a <button> and must be a sibling of the toggle <button>,
         * not a descendant — nested <button> elements are invalid HTML.
         */}
        <ViewscreenTooltip label={collapsed ? "Expand datasets panel" : "Collapse datasets panel"} side="right">
          <button
            onClick={() => togglePanel("datasets")}
            className="flex-1 flex items-center justify-between"
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontFamily: "inherit", padding: 0, textAlign: "left" }}
          >
            <span className="uppercase tracking-widest" style={{ fontSize: 15, ...CYAN, fontWeight: 700 }}>
              Datasets
            </span>
            <div className="flex items-center gap-2">
              {anyLoading && (
                <span className="animate-spin" style={{ fontSize: 15 }}>◌</span>
              )}
              <span style={{ color: "#cbd5e1", fontSize: 36, lineHeight: 1 }}>{collapsed ? "▸" : "▾"}</span>
            </div>
          </button>
        </ViewscreenTooltip>
        <HelpIcon articleId="datasets-uploads" label="Datasets and uploads" />
      </div>
      )}

      {!collapsed && (
        <div>
          {/* ── Water type toggle ── */}
          <div style={{
            padding: "6px 10px",
            borderTop: "1px solid rgba(0,229,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}>
            <span style={{ fontSize: 15, letterSpacing: "0.12em", color: "#cbd5e1" }}>ENVIRONMENT</span>
            <WaterTypeToggle />
          </div>
          {/* ── MY LIBRARY section (preset datasets + user library) ── */}
          <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
            <button
              type="button"
              onClick={() => togglePanel("myLibrary")}
              aria-expanded={!myLibraryCollapsed}
              className="px-3 py-1 flex items-center gap-2 w-full hover:bg-white/5 transition-colors"
              style={{
                fontSize: 15,
                letterSpacing: "0.12em",
                color: "#cbd5e1",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span>{myLibraryCollapsed ? "▾ MY LIBRARY" : "▲ MY LIBRARY"}</span>
              {anyLoading && (
                <span className="animate-spin" style={{ fontSize: 13.5, color: "#cbd5e1" }}>◌</span>
              )}
            </button>

            {!myLibraryCollapsed && (
              <div>
                {presetLoadError && (
                  <div
                    data-testid="preset-dataset-load-error"
                    style={{
                      margin: "4px 8px",
                      padding: "6px 8px",
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.35)",
                      borderRadius: 4,
                      fontSize: 15,
                      color: "#fca5a5",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                      Failed to load "{presetLoadError.name}"
                    </span>
                    <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                      <button
                        data-testid="btn-retry-preset"
                        onClick={handleRetryPreset}
                        disabled={!!pendingId}
                        style={{
                          fontSize: 15,
                          color: "#00e5ff",
                          background: "transparent",
                          border: "1px solid rgba(0,229,255,0.35)",
                          borderRadius: 3,
                          padding: "1px 6px",
                          cursor: !!pendingId ? "not-allowed" : "pointer",
                          opacity: !!pendingId ? 0.5 : 1,
                        }}
                      >
                        {!!pendingId ? "Loading…" : "Retry"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPresetLoadError(null); }}
                        style={{
                          fontSize: 15, color: "#cbd5e1", background: "transparent",
                          border: "none", cursor: "pointer", padding: "1px 4px",
                        }}
                        aria-label="Dismiss error"
                      >×</button>
                    </div>
                  </div>
                )}

                <VisibleDatasetsHeader onHideAllOthers={handleHideAllOthers} />
                <VisibleDatasetRows
                  allDatasets={[
                    ...(datasets ?? []).map((d) => ({ id: d.id, name: d.name })),
                    ...(userDatasets ?? []).map((d) => ({ id: d.id, name: d.name })),
                  ]}

                />

                {isSignedIn && (
                  <>
                    {userLoadError && (
                      <div
                        data-testid="user-dataset-load-error"
                        style={{
                          margin: "4px 8px 8px",
                          padding: "6px 8px",
                          background: "rgba(239,68,68,0.08)",
                          border: "1px solid rgba(239,68,68,0.35)",
                          borderRadius: 4, fontSize: 15, color: "#fca5a5",
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between", gap: 8,
                        }}
                      >
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                          Failed to load "{userLoadError.name}"
                        </span>
                        <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                          <button
                            data-testid="btn-retry-user-dataset"
                            onClick={handleRetryUserDataset}
                            disabled={!!pendingUserDatasetId}
                            style={{
                              fontSize: 15, color: "#00e5ff", background: "transparent",
                              border: "1px solid rgba(0,229,255,0.35)", borderRadius: 3,
                              padding: "1px 6px",
                              cursor: !!pendingUserDatasetId ? "not-allowed" : "pointer",
                              opacity: !!pendingUserDatasetId ? 0.5 : 1,
                            }}
                          >
                            {!!pendingUserDatasetId ? "Loading…" : "Retry"}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setUserLoadError(null); }}
                            style={{
                              fontSize: 15, color: "#cbd5e1", background: "transparent",
                              border: "none", cursor: "pointer", padding: "1px 4px",
                            }}
                            aria-label="Dismiss error"
                          >×</button>
                        </div>
                      </div>
                    )}
                    <ErrorBoundary label="the dataset library">
                      <DatasetFolderTree
                        datasets={userDatasets ?? []}
                        activeUserDatasetId={pendingUserDatasetId ? null : activeUserDatasetId}
                        loadingId={loadingId}
                        onSelectDataset={handleSelectUserDataset}
                        onDatasetsRemoved={handleDatasetsRemoved}
                        onSelectionChange={setLibrarySelectedIds}
                        bulkDeleteSignal={libraryBulkDeleteSignal}
                        externalMoveSignal={libraryMoveSignal}
                        externalRenameSignal={libraryRenameSignal}
                        onGeoreference={setGeorefDataset}
                      />
                    </ErrorBoundary>
                  </>
                )}

                {/* ── Example Datasets virtual folder (always below user library) ── */}
                <div>
                  <button
                    type="button"
                    data-testid="example-datasets-folder-toggle"
                    onClick={() => setExampleDatasetsFolderExpanded((v) => !v)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 12px 4px 8px",
                      background: "transparent",
                      border: "none",
                      borderTop: "1px solid rgba(0,229,255,0.08)",
                      cursor: "pointer",
                      color: "#7dd3fc",
                      fontSize: 15,
                      letterSpacing: "0.08em",
                      textAlign: "left",
                      fontFamily: "inherit",
                    }}
                  >
                    <span style={{ fontSize: 13.5 }}>{exampleDatasetsFolderExpanded ? "▾" : "▸"}</span>
                    <span style={{ fontSize: 16.5 }}>📁</span>
                    <span style={{ flex: 1 }}>Example Datasets</span>
                    {(datasets ?? []).length > 0 && (
                      <span style={{ fontSize: 13.5, color: "#64748b" }}>{(datasets ?? []).length}</span>
                    )}
                  </button>

                  {exampleDatasetsFolderExpanded && (datasets ?? []).map((ds) => {
                  const active = ds.id === datasetId && !pendingId && !activeUserDatasetId;
                  const loading = ds.id === loadingId;
                  const isChecked = presetSelectedIds.has(ds.id);
                  const isRowDisabled = (!isOnline && !cachedIds.has(ds.id)) || loading;
                  return (
                    <ViewscreenTooltip key={ds.id} label={`Load ${ds.name}`} side="right">
                    <div
                      data-testid={`row-dataset-${ds.id}`}
                      className="w-full flex items-stretch transition-colors hover:bg-white/5"
                      style={{
                        background: active ? "rgba(0,229,255,0.07)" : "transparent",
                        borderLeft: active ? "2px solid #00e5ff" : "2px solid transparent",
                        opacity: !isOnline && !cachedIds.has(ds.id) ? 0.4 : 1,
                        paddingLeft: 8,
                      }}
                    >
                      <span
                        role="checkbox"
                        aria-checked={isChecked}
                        data-testid={`chk-preset-${ds.id}`}
                        onClick={(e) => { e.stopPropagation(); togglePresetSelected(ds.id); }}
                        style={{
                          width: 28, flexShrink: 0, display: "flex",
                          alignItems: "center", justifyContent: "center", cursor: "pointer",
                        }}
                      >
                        <span style={{
                          width: 14, height: 14,
                          border: `1px solid ${isChecked ? "#00e5ff" : "rgba(148,163,184,0.5)"}`,
                          borderRadius: 2,
                          background: isChecked ? "rgba(0,229,255,0.18)" : "transparent",
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontSize: 15, color: "#00e5ff",
                        }}>
                          {isChecked ? "✓" : ""}
                        </span>
                      </span>
                    <div
                      role="button"
                      tabIndex={isRowDisabled ? -1 : 0}
                      aria-disabled={isRowDisabled}
                      data-testid={`btn-dataset-${ds.id}`}
                      onClick={() => { if (!isRowDisabled) handleSelectPreset(ds); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (!isRowDisabled) handleSelectPreset(ds);
                        }
                      }}
                      className="flex-1 text-left px-2 py-2"
                      style={{
                        background: "transparent",
                        cursor: isRowDisabled ? "not-allowed" : "pointer",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          style={{
                            flex: 1, minWidth: 0, fontSize: 16.5,
                            fontWeight: active ? 700 : 400,
                            color: active ? "#00e5ff" : !isOnline && !cachedIds.has(ds.id) ? "#cbd5e1" : "#e2e8f0",
                            textShadow: active ? "0 0 6px rgba(0,229,255,0.4)" : "none",
                            whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word",
                            textDecoration: "underline", textUnderlineOffset: 2,
                          }}
                        >
                          {ds.name}
                        </span>
                        <span style={{ fontSize: 13.5, color: "#cbd5e1", flexShrink: 0 }}>
                          {loading ? (
                            <LoadingDial datasetId={ds.id} label={ds.name} />
                          ) : !isOnline ? (
                            cachedIds.has(ds.id) ? (
                              <ViewscreenTooltip label="Cached — works offline" side="left">
                                <span data-testid={`cache-badge-${ds.id}`} style={{ color: "#4ade80", letterSpacing: "0.1em" }}>✓</span>
                              </ViewscreenTooltip>
                            ) : (
                              <ViewscreenTooltip label="Not cached — needs internet" side="left">
                                <span data-testid={`unavailable-badge-${ds.id}`} style={{ color: "#ef4444", letterSpacing: "0.1em" }}>✗</span>
                              </ViewscreenTooltip>
                            )
                          ) : null}
                        </span>
                      </div>
                      <div style={{ fontSize: 15, color: "#cbd5e1", marginTop: 2, letterSpacing: "0.05em" }}>
                        {formatDepthRange(ds.minDepth, ds.maxDepth, { units })}
                      </div>
                      {active && terrain && terrain.datasetId === ds.id && (
                        <div onClick={(e) => e.stopPropagation()}>
                          <ProvenancePanel terrain={terrain} hasEfh={ds.hasEfh ?? false} />
                          <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(0,229,255,0.08)" }}>
                            <button
                              data-testid={`btn-save-offline-${ds.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOfflinePackDataset({
                                  id: ds.id,
                                  name: ds.name,
                                  bbox: terrain
                                    ? { minLon: terrain.minLon, maxLon: terrain.maxLon, minLat: terrain.minLat, maxLat: terrain.maxLat }
                                    : null,
                                });
                              }}
                              style={{
                                fontSize: 13.5,
                                padding: "3px 8px",
                                background: "rgba(251,191,36,0.08)",
                                border: "1px solid rgba(251,191,36,0.35)",
                                borderRadius: 3,
                                color: "#fbbf24",
                                cursor: "pointer",
                                letterSpacing: "0.1em",
                                textTransform: "uppercase",
                              }}
                            >
                              ⬇ Save Offline
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    </div>
                    </ViewscreenTooltip>
                  );
                })}
                </div>
                {/* ── end Example Datasets folder ── */}

                {(presetSelectedIds.size + librarySelectedIds.size > 0) && (
                  <div
                    data-testid="library-action-bar"
                    style={{
                      margin: "6px 8px 4px",
                      padding: "6px 8px",
                      background: "rgba(0,229,255,0.06)",
                      border: "1px solid rgba(0,229,255,0.2)",
                      borderRadius: 4,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    <span style={{
                      fontSize: 13.5, color: "#7dd3fc", width: "100%",
                      letterSpacing: "0.08em", marginBottom: 2,
                    }}>
                      {presetSelectedIds.size + librarySelectedIds.size} selected
                    </span>
                    <button data-testid="btn-action-load-together" onClick={() => { void handleLoadTogether(); }} style={ACTION_BTN_STYLE}>Load Together</button>
                    <button
                      data-testid="btn-action-delete"
                      onClick={handleActionDelete}
                      disabled={librarySelectedIds.size === 0 && presetSelectedIds.size === 0}
                      style={{ ...ACTION_BTN_STYLE, opacity: (librarySelectedIds.size === 0 && presetSelectedIds.size === 0) ? 0.35 : 1, color: "#fca5a5", borderColor: "rgba(239,68,68,0.4)" }}
                    >Delete</button>
                    <button data-testid="btn-action-copy" onClick={handleActionCopy} style={ACTION_BTN_STYLE}>Copy</button>
                    <button
                      data-testid="btn-action-move-to-folder"
                      onClick={handleActionMoveToFolder}
                      disabled={librarySelectedIds.size !== 1}
                      style={{ ...ACTION_BTN_STYLE, opacity: librarySelectedIds.size !== 1 ? 0.35 : 1 }}
                    >Move To Folder</button>
                    <button data-testid="btn-action-paste" onClick={handleActionPaste} style={ACTION_BTN_STYLE}>Paste</button>
                    <button
                      data-testid="btn-action-rename"
                      onClick={handleActionRename}
                      disabled={librarySelectedIds.size !== 1 || presetSelectedIds.size > 0}
                      style={{ ...ACTION_BTN_STYLE, opacity: (librarySelectedIds.size !== 1 || presetSelectedIds.size > 0) ? 0.35 : 1 }}
                    >Rename</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Markers section ── */}
          {markerDatasetId && (
            <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
              <button
                onClick={() => setMarkersOpen(!markersOpen)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
                style={{ cursor: "pointer" }}
              >
                <span style={{ fontSize: 15, letterSpacing: "0.12em", color: "#cbd5e1" }}>
                  ▼ MARKERS {markers?.length ? `(${markers.length})` : ""}
                </span>
                <span style={{ color: "#cbd5e1", fontSize: 16.5 }}>{markersOpen ? "−" : "+"}</span>
              </button>

              {markersOpen && (() => {
                const markerTypeOptions = waterType === "freshwater" ? FRESHWATER_MARKER_TYPES : SALTWATER_MARKER_TYPES;
                const q = markerSearch.trim().toLowerCase();
                const visibleMarkers = (markers ?? []).filter((m) => {
                  if (markerTypeFilter && m.type !== markerTypeFilter) return false;
                  if (q) {
                    const inLabel = m.label.toLowerCase().includes(q);
                    const inNotes = (m.notes ?? "").toLowerCase().includes(q);
                    if (!inLabel && !inNotes) return false;
                  }
                  return true;
                });
                return (
                <div style={{ paddingBottom: 4 }}>
                  <div style={{ padding: "2px 12px 6px", display: "flex", gap: 6 }}>
                    <ViewscreenTooltip label="Import waypoints/routes from GPX, KML, KMZ, or CSV" side="right">
                      <button
                        onClick={() => setGpsImportOpen(true)}
                        data-testid="open-gps-import"
                        style={{
                          flex: 1,
                          padding: "5px 8px",
                          background: "rgba(0,229,255,0.06)",
                          border: "1px solid rgba(0,229,255,0.2)",
                          borderRadius: 3,
                          color: "#00e5ff",
                          fontSize: 15,
                          letterSpacing: "0.12em",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        ▼ IMPORT GPS…
                      </button>
                    </ViewscreenTooltip>
                    <ViewscreenTooltip label="Export markers and trolling routes as GPX or KML" side="right">
                      <button
                        onClick={() => setGpsExportOpen(true)}
                        data-testid="open-gps-export"
                        style={{
                          flex: 1,
                          padding: "5px 8px",
                          background: "rgba(0,229,255,0.06)",
                          border: "1px solid rgba(0,229,255,0.2)",
                          borderRadius: 3,
                          color: "#00e5ff",
                          fontSize: 15,
                          letterSpacing: "0.12em",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        ▲ EXPORT GPS…
                      </button>
                    </ViewscreenTooltip>
                  </div>

                  {/* ── Search + type filter ── */}
                  {(markers?.length ?? 0) > 0 && (
                    <div style={{ padding: "0 10px 6px" }}>
                      <input
                        type="search"
                        data-testid="marker-search-input"
                        value={markerSearch}
                        onChange={(e) => setMarkerSearch(e.target.value)}
                        placeholder="Search markers…"
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          background: "rgba(0,229,255,0.04)",
                          border: "1px solid rgba(0,229,255,0.15)",
                          borderRadius: 3,
                          color: "#e2e8f0",
                          fontSize: 15,
                          padding: "4px 7px",
                          fontFamily: "inherit",
                          outline: "none",
                          marginBottom: 5,
                        }}
                      />
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {markerTypeOptions.map((t) => {
                          const active = markerTypeFilter === t.value;
                          return (
                            <ViewscreenTooltip key={t.value} label={`Filter by ${t.label}`} side="top">
                              <button
                                type="button"
                                data-testid={`marker-type-filter-${t.value}`}
                                onClick={() => setMarkerTypeFilter(active ? null : t.value)}
                                style={{
                                  fontSize: 16.5,
                                  padding: "2px 5px",
                                  borderRadius: 3,
                                  border: `1px solid ${active ? t.color : "rgba(0,229,255,0.12)"}`,
                                  background: active ? `${t.color}22` : "transparent",
                                  color: active ? t.color : "#94a3b8",
                                  cursor: "pointer",
                                  lineHeight: 1,
                                  fontFamily: "inherit",
                                }}
                                aria-pressed={active}
                                aria-label={t.label}
                              >
                                {t.icon}
                              </button>
                            </ViewscreenTooltip>
                          );
                        })}
                        {markerTypeFilter && (
                          <button
                            type="button"
                            onClick={() => setMarkerTypeFilter(null)}
                            style={{
                              fontSize: 13.5,
                              padding: "2px 5px",
                              borderRadius: 3,
                              border: "1px solid rgba(0,229,255,0.15)",
                              background: "transparent",
                              color: "#cbd5e1",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              letterSpacing: "0.06em",
                            }}
                          >
                            ✕ all
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {!markers?.length && (
                    <div style={{ fontSize: 15, color: "#cbd5e1", padding: "4px 12px 6px" }}>
                      No markers yet — press G or right-click to drop one
                    </div>
                  )}
                  {markers?.length && !visibleMarkers.length ? (
                    <div style={{ fontSize: 15, color: "#94a3b8", padding: "4px 12px 6px" }}>
                      No markers match the current filter
                    </div>
                  ) : null}
                  {visibleMarkers.map((m) => {
                    const color = MARKER_COLOR[m.type] ?? "#e2e8f0";
                    const icon = MARKER_ICON[m.type] ?? "●";
                    return (
                      <div
                        key={m.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleTeleportToMarker(m.lon, m.lat)}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleTeleportToMarker(m.lon, m.lat);
                          }
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors group"
                        style={{
                          cursor: "pointer",
                        }}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span style={{ color, fontSize: 15, flexShrink: 0 }}>{icon}</span>
                          <span
                            style={{
                              flex: 1,
                              fontSize: 15,
                              color: "#cbd5e1",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {m.label}
                          </span>
                          <span style={{ fontSize: 13.5, color: "#64748b", flexShrink: 0 }}>
                            {Math.round(m.depth)}m
                          </span>
                          <ViewscreenTooltip label="Edit this marker" side="left">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                useMarkerEditStore.getState().open(m);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  useMarkerEditStore.getState().open(m);
                                }
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{
                                fontSize: 15,
                                color: "#7dd3fc",
                                cursor: "pointer",
                                lineHeight: 1,
                                padding: "0 2px",
                                flexShrink: 0,
                              }}
                            >
                              ✏
                            </span>
                          </ViewscreenTooltip>
                          <ViewscreenTooltip label="Delete this marker" side="left">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => handleDeleteMarker(e, m.id)}
                              onKeyDown={(e) =>
                                e.key === "Enter" &&
                                handleDeleteMarker(e as unknown as React.MouseEvent, m.id)
                              }
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{
                                fontSize: 16.5,
                                color: "#cbd5e1",
                                cursor: "pointer",
                                lineHeight: 1,
                                padding: "0 2px",
                                flexShrink: 0,
                              }}
                            >
                              ×
                            </span>
                          </ViewscreenTooltip>
                        </div>
                      </div>
                    );
                  })}
                </div>
                );
              })()}
            </div>
          )}

          {/* ── Bookmarks section ── */}
          {bookmarkDatasetId && (
            <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
              <button
                onClick={() => setBookmarksOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
                style={{ cursor: "pointer" }}
              >
                <span style={{ fontSize: 15, letterSpacing: "0.12em", color: "#cbd5e1" }}>
                  📷 SAVED VIEWS {bookmarks.length ? `(${bookmarks.length})` : ""}
                </span>
                <span style={{ color: "#cbd5e1", fontSize: 16.5 }}>{bookmarksOpen ? "−" : "+"}</span>
              </button>

              {bookmarksOpen && (
                <div style={{ paddingBottom: 4 }}>
                  {!bookmarks.length && (
                    <div style={{ fontSize: 15, color: "#cbd5e1", padding: "4px 12px 6px" }}>
                      No saved views yet — right-click terrain and choose &ldquo;Save as saved view…&rdquo;
                    </div>
                  )}
                  {bookmarks.map((bk, idx) => (
                    <div
                      key={bk.id}
                      draggable
                      onDragStart={() => { dragIndexRef.current = idx; }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx); }}
                      onDragLeave={() => { setDragOverIndex(null); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragIndexRef.current;
                        if (from === null || from === idx) { setDragOverIndex(null); return; }
                        const next = [...bookmarks];
                        const [moved] = next.splice(from, 1) as [CameraBookmark];
                        next.splice(idx, 0, moved);
                        reorderBookmarks(bookmarkDatasetId, next);
                        dragIndexRef.current = null;
                        setDragOverIndex(null);
                      }}
                      onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}
                      className="flex items-center gap-1 px-3 py-1 hover:bg-white/5 transition-colors group"
                      style={{
                        borderTop: dragOverIndex === idx ? "1px solid rgba(0,229,255,0.5)" : "1px solid transparent",
                        cursor: "grab",
                      }}
                    >
                      <ViewscreenTooltip label="Drag to reorder" side="right">
                        <span
                          aria-hidden="true"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            fontSize: 16.5,
                            color: "#64748b",
                            flexShrink: 0,
                            lineHeight: 1,
                            userSelect: "none",
                            cursor: "grab",
                          }}
                        >
                          ⠿
                        </span>
                      </ViewscreenTooltip>
                      <span
                        style={{
                          flex: 1,
                          fontSize: 15,
                          color: "#cbd5e1",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {bk.name}
                      </span>
                      <ViewscreenTooltip label="Fly to this saved view" side="left">
                        <button
                          onClick={() => handleFlyToBookmark(bk)}
                          aria-label="Fly to this saved view"
                          style={{
                            fontSize: 13.5,
                            padding: "1px 5px",
                            background: "rgba(0,229,255,0.08)",
                            border: "1px solid rgba(0,229,255,0.25)",
                            borderRadius: 3,
                            color: "#00e5ff",
                            cursor: "pointer",
                            letterSpacing: "0.08em",
                            flexShrink: 0,
                          }}
                        >
                          FLY
                        </button>
                      </ViewscreenTooltip>
                      <ViewscreenTooltip label="Rename saved view" side="left">
                        <button
                          onClick={() => handleRenameBookmark(bk)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            fontSize: 15,
                            color: "#e2e8f0",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            lineHeight: 1,
                            padding: "0 2px",
                            flexShrink: 0,
                          }}
                          aria-label="Rename saved view"
                        >
                          ✎
                        </button>
                      </ViewscreenTooltip>
                      <ViewscreenTooltip label="Delete saved view" side="left">
                        <button
                          onClick={(e) => handleDeleteBookmark(e, bk)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            fontSize: 16.5,
                            color: "#cbd5e1",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            lineHeight: 1,
                            padding: "0 2px",
                            flexShrink: 0,
                          }}
                          aria-label="Delete saved view"
                        >
                          ×
                        </button>
                      </ViewscreenTooltip>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {gpsImportOpen && terrain && (
            <GpsImportDialog terrain={terrain} onClose={() => setGpsImportOpen(false)} />
          )}

          {gpsExportOpen && terrain && (
            <GpsExportDialog terrain={terrain} onClose={() => setGpsExportOpen(false)} />
          )}

          {/* ── Upload accordion ── */}
          <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
            <ViewscreenTooltip label={uploadOpen ? "Hide upload area" : "Upload your own dataset file"} side="right">
            <button
              onClick={() => setUploadOpen(!uploadOpen)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
              style={{ cursor: "pointer" }}
            >
              <span style={{ fontSize: 15, letterSpacing: "0.15em", color: "#cbd5e1" }}>
                ▲ UPLOAD DATASET(S)
              </span>
              <span style={{ color: "#cbd5e1", fontSize: 16.5 }}>{uploadOpen ? "−" : "+"}</span>
            </button>
            </ViewscreenTooltip>

            {uploadOpen && (
              <div className="px-2 pb-2">
                {!isOnline ? (
                  <div
                    data-testid="upload-offline-notice"
                    style={{
                      border: "1px dashed rgba(239,68,68,0.25)",
                      background: "rgba(239,68,68,0.04)",
                      borderRadius: 4,
                      padding: "12px 8px",
                      textAlign: "center",
                      fontSize: 13.5,
                      color: "#f87171",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Upload unavailable offline
                  </div>
                ) : (
                  <>
                    {(postDatasetsUpload.isPending || chunkedPhase === "uploading" || chunkedPhase === "processing" || gcsPhase === "uploading") && (
                      <div
                        style={{
                          height: 3, background: "rgba(0,229,255,0.1)",
                          borderRadius: 2, marginBottom: 6, overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${gcsPhase === "uploading" ? gcsUploadProgress : chunkedPhase === "uploading" ? chunkedUploadProgress : chunkedPhase === "processing" ? chunkedJobProgress : uploadProgress}%`,
                            background: "linear-gradient(90deg, #0d47a1, #00e5ff)",
                            borderRadius: 2, transition: "width 0.3s linear",
                            boxShadow: "0 0 6px rgba(0,229,255,0.6)",
                          }}
                        />
                      </div>
                    )}

                    <div
                      {...getRootProps()}
                      data-testid="dropzone-terrain"
                      className="text-center cursor-pointer transition-colors rounded"
                      style={{
                        border: `1px dashed ${isDragActive ? "#00e5ff" : "rgba(0,229,255,0.2)"}`,
                        background: isDragActive ? "rgba(0,229,255,0.06)" : "rgba(0,0,0,0.2)",
                        padding: "12px 8px",
                        opacity: isAnyUploadBusy ? 0.6 : 1,
                      }}
                    >
                      <input {...getInputProps()} />
                      {postDatasetsUpload.isPending ? (
                        <div>
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 15, marginBottom: 2 }}>
                            ◌ Uploading &amp; parsing...
                          </div>
                          <div style={{ fontSize: 15, color: "#cbd5e1" }}>{Math.round(uploadProgress)}%</div>
                          {formatEta(smallFileEta) && (
                            <div style={{ fontSize: 13.5, color: "#94a3b8", marginTop: 2 }}>
                              {formatEta(smallFileEta)}
                            </div>
                          )}
                        </div>
                      ) : chunkedPhase === "uploading" ? (
                        <div>
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 15, marginBottom: 2 }}>
                            ◌ Uploading in chunks...
                          </div>
                          <div style={{ fontSize: 15, color: "#cbd5e1" }}>{chunkedUploadProgress}%</div>
                        </div>
                      ) : chunkedPhase === "processing" ? (
                        <div>
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 15, marginBottom: 2 }}>
                            {chunkedServerStatus === "queued"
                              ? "⏳ Waiting in line…"
                              : "◌ Processing on server..."}
                          </div>
                          {chunkedServerStatus === "queued" ? (
                            <div style={{ fontSize: 15, color: "#94a3b8" }}>
                              A few other uploads are ahead — you&apos;re next
                            </div>
                          ) : (
                            <>
                              <div style={{ fontSize: 15, color: "#cbd5e1" }}>{Math.round(chunkedJobProgress)}%</div>
                              {formatEta(chunkedJobEta) && (
                                <div style={{ fontSize: 13.5, color: "#94a3b8", marginTop: 2 }}>
                                  {formatEta(chunkedJobEta)}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : gcsPhase === "uploading" ? (
                        <div>
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 15, marginBottom: 2 }}>
                            ◌ Uploading to cloud storage...
                          </div>
                          <div style={{ fontSize: 15, color: "#cbd5e1" }}>{gcsUploadProgress}%</div>
                        </div>
                      ) : gcsPhase === "processing" ? (
                        <div>
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 15, marginBottom: 2 }}>
                            {gcsServerStatus === "queued"
                              ? "⏳ Waiting in line…"
                              : "◌ Processing in background..."}
                          </div>
                          <div style={{ fontSize: 15, color: "#94a3b8" }}>
                            {gcsServerStatus === "queued"
                              ? "A few other uploads are ahead — you're next"
                              : "We\u2019ll notify you when it\u2019s ready"}
                          </div>
                        </div>
                      ) : gcsPhase === "processing_timeout" ? (
                        <div>
                          <div style={{ fontSize: 15, color: "#f59e0b", marginBottom: 4 }}>
                            ⏳ Still processing — taking longer than usual
                          </div>
                          <div style={{ fontSize: 13.5, color: "#94a3b8", marginBottom: 4 }}>
                            Your file was uploaded safely. It will appear in your datasets once conversion finishes. You can drop a new file while you wait.
                          </div>
                          <div style={{ fontSize: 15, color: "#cbd5e1" }}>
                            Drop file here, or click to browse
                          </div>
                        </div>
                      ) : (
                        <>
                          {interruptedSession && chunkedPhase === "idle" && (
                            <div
                              data-testid="interrupted-upload-banner"
                              style={{
                                marginBottom: 8,
                                padding: "6px 8px",
                                border: "1px solid rgba(251,191,36,0.4)",
                                background: "rgba(251,191,36,0.07)",
                                borderRadius: 4,
                                fontSize: 15,
                                color: "#fde68a",
                                textAlign: "left",
                              }}
                            >
                              <div style={{ marginBottom: 4 }}>
                                ⚠ Upload interrupted — <strong>{interruptedSession.fileName}</strong>
                              </div>
                              <div style={{ fontSize: 13.5, color: "#94a3b8", marginBottom: 5 }}>
                                Drop or select the same file to resume from where it left off.
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  clearUploadSession();
                                  setInterruptedSession(null);
                                }}
                                style={{
                                  fontSize: 13.5,
                                  color: "#94a3b8",
                                  background: "transparent",
                                  border: "1px solid rgba(148,163,184,0.3)",
                                  borderRadius: 3,
                                  padding: "1px 6px",
                                  cursor: "pointer",
                                }}
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                          <div style={{ fontSize: 15, color: "#cbd5e1", marginBottom: 3 }}>
                            Drop file here, or click to browse
                          </div>
                          <div style={{ fontSize: 15, color: "#cbd5e1" }}>
                            any size · large files upload in chunks{isSignedIn ? " · auto-saved" : ""}
                          </div>
                          <div style={{ fontSize: 13.5, color: "#94a3b8", marginTop: 4 }}>
                            {SUPPORTED_EXTENSIONS}
                          </div>
                          {activeUploadError && (
                            <div style={{ fontSize: 13.5, color: "#f87171", marginTop: 4 }}>⚠ upload error — click for details</div>
                          )}
                        </>
                      )}
                    </div>

                    {chunkedPhase === "error" && lastChunkedFile && (
                      <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end" }}>
                        <button
                          data-testid="btn-retry-chunked-upload"
                          onClick={() => { void handleRetryChunked(); }}
                          style={{
                            fontSize: 15,
                            color: "#00e5ff",
                            background: "transparent",
                            border: "1px solid rgba(0,229,255,0.35)",
                            borderRadius: 3,
                            padding: "2px 8px",
                            cursor: "pointer",
                          }}
                        >
                          Retry upload
                        </button>
                      </div>
                    )}
                    {savingToAccount && !saveError && (
                      <div
                        data-testid="upload-saving-to-account"
                        style={{
                          marginTop: 6,
                          padding: "6px 8px",
                          border: "1px solid rgba(0,229,255,0.25)",
                          background: "rgba(0,229,255,0.05)",
                          borderRadius: 4,
                          fontSize: 15,
                          color: "#7dd3fc",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span className="animate-pulse">◌</span>
                        <span>Saving to account…</span>
                      </div>
                    )}
                    {saveError && lastUploadedFile && (
                      <div
                        data-testid="upload-save-error"
                        style={{
                          marginTop: 6,
                          padding: "6px 8px",
                          border: "1px solid rgba(248,113,113,0.4)",
                          background: "rgba(248,113,113,0.08)",
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontSize: 15, color: "#fca5a5", flex: 1, lineHeight: 1.4 }}>
                          ⚠ Uploaded, but couldn&apos;t save to your account — {saveError}
                        </div>
                        <button
                          type="button"
                          data-testid="upload-retry-save"
                          onClick={handleRetrySave}
                          disabled={postDatasetsUpload.isPending}
                          style={{
                            fontSize: 15,
                            padding: "3px 8px",
                            border: "1px solid rgba(0,229,255,0.4)",
                            background: "rgba(0,229,255,0.08)",
                            color: "#00e5ff",
                            borderRadius: 3,
                            cursor: postDatasetsUpload.isPending ? "wait" : "pointer",
                            whiteSpace: "nowrap",
                            letterSpacing: "0.08em",
                          }}
                        >
                          {postDatasetsUpload.isPending ? "…" : "Retry save"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {presetDeleteConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preset-delete-dialog-title"
          data-testid="preset-delete-confirm-dialog"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.55)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPresetDeleteConfirm(false);
          }}
        >
          <div
            style={{
              background: "rgba(0,10,20,0.92)",
              border: "1px solid rgba(239,68,68,0.45)",
              borderRadius: 6,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              padding: "20px 24px",
              maxWidth: 340,
              width: "90%",
              backdropFilter: "blur(8px)",
              boxShadow: "0 0 24px rgba(239,68,68,0.12)",
            }}
          >
            <div
              id="preset-delete-dialog-title"
              style={{
                fontSize: 16.5,
                letterSpacing: "0.12em",
                color: "#fca5a5",
                textShadow: "0 0 6px rgba(239,68,68,0.4)",
                marginBottom: 12,
                textTransform: "uppercase",
              }}
            >
              Remove Example Dataset{presetSelectedIds.size !== 1 ? "s" : ""}
            </div>
            <p style={{ fontSize: 16.5, color: "#e2e8f0", lineHeight: 1.5, marginBottom: 16 }}>
              Remove {presetSelectedIds.size === 1 ? "this preset" : `${presetSelectedIds.size} presets`} from the app for all users? This cannot be undone from the UI.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                data-testid="preset-delete-cancel"
                onClick={() => setPresetDeleteConfirm(false)}
                style={{
                  fontSize: 15,
                  padding: "5px 14px",
                  background: "transparent",
                  border: "1px solid rgba(148,163,184,0.4)",
                  borderRadius: 3,
                  color: "#94a3b8",
                  cursor: "pointer",
                  letterSpacing: "0.08em",
                  fontFamily: "inherit",
                }}
              >Cancel</button>
              <button
                data-testid="preset-delete-confirm"
                onClick={() => { void handleConfirmPresetDelete(); }}
                style={{
                  fontSize: 15,
                  padding: "5px 14px",
                  background: "rgba(239,68,68,0.12)",
                  border: "1px solid rgba(239,68,68,0.5)",
                  borderRadius: 3,
                  color: "#fca5a5",
                  cursor: "pointer",
                  letterSpacing: "0.08em",
                  fontFamily: "inherit",
                }}
              >Remove</button>
            </div>
          </div>
        </div>
      )}

      {activeUploadError && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Upload error"
          onClick={dismissUploadError}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            background: "rgba(2,8,18,0.72)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(2,8,18,0.98)",
              border: `1px solid ${accent}44`,
              borderRadius: 8,
              color: "#cbd5e1",
              maxWidth: 480,
              width: "100%",
              padding: "20px 24px",
              boxShadow: `0 0 32px ${accent}22`,
              fontFamily: "'JetBrains Mono','Fira Code',monospace",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#f87171", letterSpacing: "0.1em" }}>
                ⚠ UPLOAD ERROR
              </span>
              <button
                aria-label="Close error dialog"
                onClick={dismissUploadError}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontSize: 24,
                  padding: "0 2px",
                  lineHeight: 1,
                }}
              >✕</button>
            </div>
            <p
              style={{
                fontSize: 16.5,
                color: "#e2e8f0",
                lineHeight: 1.6,
                margin: "0 0 16px 0",
                userSelect: "text",
                wordBreak: "break-word",
              }}
            >
              {activeUploadError}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(activeUploadError).then(() => {
                    setCopiedErrorHint(true);
                    setTimeout(() => setCopiedErrorHint(false), 2000);
                  });
                }}
                style={{
                  fontSize: 15,
                  color: accent,
                  background: "transparent",
                  border: `1px solid ${accent}55`,
                  borderRadius: 3,
                  padding: "3px 10px",
                  cursor: "pointer",
                  letterSpacing: "0.08em",
                  fontFamily: "inherit",
                }}
              >
                {copiedErrorHint ? "COPIED ✓" : "COPY"}
              </button>
              <button
                onClick={dismissUploadError}
                style={{
                  fontSize: 15,
                  color: "#94a3b8",
                  background: "transparent",
                  border: "1px solid rgba(148,163,184,0.3)",
                  borderRadius: 3,
                  padding: "3px 10px",
                  cursor: "pointer",
                  letterSpacing: "0.08em",
                  fontFamily: "inherit",
                }}
              >DISMISS</button>
            </div>
          </div>
        </div>
      )}

      {offlinePackDataset && (
        <OfflinePackModal
          dataset={offlinePackDataset}
          onClose={() => setOfflinePackDataset(null)}
        />
      )}

      {georefDataset && (
        <GeoreferenceModal
          dataset={georefDataset}
          onClose={() => setGeorefDataset(null)}
          onSuccess={() => {
            setGeorefDataset(null);
            void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
          }}
        />
      )}
    </div>
  );
};
