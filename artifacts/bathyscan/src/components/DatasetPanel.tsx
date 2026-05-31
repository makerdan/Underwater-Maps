import React, { useCallback, useEffect, useRef, useState } from "react";
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
  usePostDatasetsUpload,
} from "@workspace/api-client-react";
import type { DatasetMeta, UserDatasetMeta } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { requestDatasetSwitch } from "@/lib/simulatedDataStore";
import { useTerrainStore, VISIBLE_DATASETS_CAP } from "@/lib/terrainStore";
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
import { GpsImportDialog } from "@/components/GpsImportDialog";
import { GpsExportDialog } from "@/components/GpsExportDialog";
import { LoadingDial } from "@/components/LoadingDial";
import { useActiveLoadStore } from "@/lib/activeLoadStore";
import { fetchJsonWithProgress } from "@/lib/fetchWithProgress";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import {
  getGetDatasetsIdTerrainUrl,
  getGetDatasetsIdOverviewUrl,
  getGetUserDatasetsIdTerrainUrl,
  getGetUserDatasetsIdOverviewUrl,
} from "@workspace/api-client-react";
import type { TerrainData } from "@workspace/api-client-react";

// Auto-retry backoff schedule for transient save-to-account failures.
// Module-scope so reading it inside the upload callback doesn't require
// a hook deps entry.
const AUTO_RETRY_DELAYS_MS = [500, 1500];

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
  return ({ signal }: { signal?: AbortSignal }): Promise<TerrainData> =>
    fetchJsonWithProgress<TerrainData>(url, {
      signal,
      onProgress: reportProgress
        ? ({ loaded, total }) => {
            useActiveLoadStore.getState().update(datasetId, loaded, total);
          }
        : undefined,
    });
}

const CHUNKED_THRESHOLD = 10 * 1024 * 1024; // files above 10 MB use chunked path
const CHUNK_SIZE = 5 * 1024 * 1024;          // 5 MB per chunk
const GCS_THRESHOLD = 50 * 1024 * 1024;      // files above 50 MB go straight to GCS

const PANEL: React.CSSProperties = {
  background: "rgba(0,10,20,0.82)",
  border: "1px solid rgba(0,229,255,0.18)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#e2e8f0",
  fontSize: 11,
  minWidth: 220,
  maxWidth: 260,
  backdropFilter: "blur(6px)",
};

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

// ─── Visible-datasets summary header (Task #350) ─────────────────────────────
const VisibleDatasetsHeader: React.FC = () => {
  const count = useTerrainStore((s) => s.visibleDatasets.length);
  const hideAllOthers = useTerrainStore((s) => s.hideAllOthers);
  if (count <= 1) return null;
  const atCap = count >= VISIBLE_DATASETS_CAP;
  return (
    <div
      data-testid="visible-datasets-header"
      style={{
        padding: "4px 12px 6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 9,
        letterSpacing: "0.1em",
        color: "#7dd3fc",
        background: "rgba(0,229,255,0.04)",
        borderBottom: "1px solid rgba(0,229,255,0.08)",
      }}
    >
      <span data-testid="visible-datasets-count">
        VISIBLE DATASETS ({count}){atCap ? " · CAP" : ""}
      </span>
      <button
        data-testid="btn-hide-all-others"
        onClick={hideAllOthers}
        style={{
          fontSize: 9,
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

// ─── Per-row eye toggle (preset rows) ────────────────────────────────────────
const PresetVisibilityToggle: React.FC<{
  datasetId: string;
  disabled: boolean;
}> = ({ datasetId, disabled }) => {
  const visible = useTerrainStore(
    (s) => s.visibleDatasets.some((v) => v.datasetId === datasetId),
  );
  const isPrimary = useTerrainStore((s) => s.primaryDatasetId === datasetId);
  const toggleVisible = useTerrainStore((s) => s.toggleVisible);
  return (
    <ViewscreenTooltip
      label={
        visible
          ? isPrimary
            ? "Primary dataset — hide to demote"
            : "Hide from scene"
          : "Show in scene alongside primary"
      }
      side="right"
    >
      <button
        type="button"
        data-testid={`btn-visibility-${datasetId}`}
        aria-pressed={visible}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          toggleVisible({ datasetId, source: "preset" });
        }}
        style={{
          width: 24,
          flexShrink: 0,
          background: "transparent",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          color: visible ? (isPrimary ? "#00e5ff" : "#7dd3fc") : "#94a3b8",
          fontSize: 12,
          lineHeight: 1,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visible ? (isPrimary ? "◉" : "◎") : "○"}
      </button>
    </ViewscreenTooltip>
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
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const { toast } = useToast();

  // Track which dataset IDs are available in the service-worker cache
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (isOnline || !("caches" in window)) return;
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
      setCachedIds(ids);
    })();
  }, [isOnline]);

  const storeCollapsed = usePanelCollapseStore((s) => s.collapsed.datasets);
  const collapsed = embedded ? false : storeCollapsed;
  const togglePanel = usePanelCollapseStore((s) => s.toggle);
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

  // Chunked upload session refs — stable across renders, used by retry logic
  const chunkedUploadIdRef = useRef<string | null>(null);
  // Index of the chunk that failed (null = not failed yet, >= totalChunks = finalize failed)
  const chunkedFailedAtRef = useRef<number | null>(null);

  // ─── Preset dataset pending fetch ─────────────────────────────────────────
  const [pendingId, setPendingId] = useState<string | null>(null);

  // ─── User dataset pending + active tracking ────────────────────────────────
  const [pendingUserDatasetId, setPendingUserDatasetId] = useState<string | null>(null);
  const [activeUserDatasetId, setActiveUserDatasetId] = useState<string | null>(null);
  const [userLoadError, setUserLoadError] = useState<{ id: string; name: string } | null>(null);
  const [presetLoadError, setPresetLoadError] = useState<{ id: string; name: string } | null>(null);

  // ─── Upload progress (simulated, small-file path) ─────────────────────────
  const [uploadProgress, setUploadProgress] = useState(0);

  // ─── Chunked-upload state (large-file path > CHUNKED_THRESHOLD) ───────────
  type ChunkedPhase = "idle" | "uploading" | "processing" | "error";
  const [chunkedPhase, setChunkedPhase] = useState<ChunkedPhase>("idle");
  const [chunkedUploadProgress, setChunkedUploadProgress] = useState(0);
  const [chunkedJobId, setChunkedJobId] = useState<string | null>(null);
  const [chunkedJobProgress, setChunkedJobProgress] = useState(0);
  const [chunkedError, setChunkedError] = useState<string | null>(null);
  const [lastChunkedFile, setLastChunkedFile] = useState<File | null>(null);

  // ─── GCS upload state (oversized files > GCS_THRESHOLD via presigned URL) ──
  type GcsPhase = "idle" | "uploading" | "processing" | "error";
  const [gcsPhase, setGcsPhase] = useState<GcsPhase>("idle");
  const [gcsUploadProgress, setGcsUploadProgress] = useState(0);
  const [gcsError, setGcsError] = useState<string | null>(null);

  const waterType = useSettingsStore((s) => s.waterType);
  const units = useSettingsStore((s) => s.units);

  // ─── Fetch dataset lists ───────────────────────────────────────────────────
  const { data: datasets, isLoading: datasetsLoading } = useGetDatasets(
    { waterType },
    { query: { queryKey: getGetDatasetsQueryKey({ waterType }) } },
  );
  const { data: userDatasets, isLoading: userDatasetsLoading } = useGetUserDatasets({
    query: { enabled: !!isSignedIn, queryKey: getGetUserDatasetsQueryKey() },
  });

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

  // ─── Chunked-upload job polling ───────────────────────────────────────────
  useEffect(() => {
    if (!chunkedJobId) return;
    const poll = async () => {
      try {
        const resp = await fetch(`/api/datasets/upload/jobs/${chunkedJobId}`, {
          credentials: "include",
        });
        if (!resp.ok) return;
        const data = await resp.json() as {
          status: string;
          progress: number;
          error?: string;
          datasetId?: string;
        };
        if (data.status === "done" && data.datasetId) {
          setChunkedJobId(null);
          setChunkedPhase("idle");
          setLastChunkedFile(null);
          setChunkedError(null);
          void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
          setActiveUserDatasetId(data.datasetId);
          setLoadingId(data.datasetId);
          setPendingUserDatasetId(data.datasetId);
          setPendingId(null);
          setUploadOpen(false);
        } else if (data.status === "error") {
          setChunkedJobId(null);
          setChunkedPhase("error");
          setChunkedError(data.error ?? "Server-side processing failed.");
        }
      } catch {
        // transient network error; will retry on next interval tick
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 2000);
    return () => clearInterval(timer);
  }, [chunkedJobId, qc, setUploadOpen]);

  // ─── Upload ────────────────────────────────────────────────────────────────
  const postDatasetsUpload = usePostDatasetsUpload();

  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (postDatasetsUpload.isPending) {
      setUploadProgress(0);
      progressTimer.current = setInterval(() => {
        setUploadProgress((p) => Math.min(88, p + 1.2));
      }, 60);
    } else {
      if (progressTimer.current) {
        clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
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
      postDatasetsUpload.mutate(
        { data: { file, resolution: 256 } },
        {
          onSuccess: (data) => {
            const isFirstTry = !isRetry && autoAttempt === 0;
            if (isFirstTry) {
              setDatasetId(null);
              setTerrain(data.terrain);
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

      const resp = await fetch("/api/datasets/upload/chunk", {
        method: "POST",
        body: fd,
        credentials: "include",
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({})) as { details?: string; error?: string };
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
    const finalResp = await fetch("/api/datasets/upload/chunk/finalize", {
      method: "POST",
      body: JSON.stringify({ uploadId, fileName: file.name, totalChunks, resolution: 256 }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });

    if (!finalResp.ok) {
      const errBody = await finalResp.json().catch(() => ({})) as { details?: string; error?: string };
      // Use totalChunks as sentinel: all chunks are present, only finalize failed
      chunkedFailedAtRef.current = totalChunks;
      setChunkedPhase("error");
      setChunkedError(errBody.details ?? errBody.error ?? "Failed to start server processing");
      return false;
    }

    const { jobId } = await finalResp.json() as { jobId: string };
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

    // Step 1: get presigned URL
    let uploadUrl: string;
    let objectKey: string;
    try {
      const resp = await fetch("/api/datasets/upload/request-gcs-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fileName: file.name }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { details?: string; error?: string };
        throw new Error(err.details ?? err.error ?? "Failed to get upload URL");
      }
      const data = await resp.json() as { uploadUrl: string; objectKey: string };
      uploadUrl = data.uploadUrl;
      objectKey = data.objectKey;
    } catch (err) {
      setGcsPhase("error");
      setGcsError(err instanceof Error ? err.message : "Failed to request upload URL");
      return;
    }

    // Step 2: PUT directly to GCS with XHR for real progress
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setGcsUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`GCS upload failed with status ${xhr.status}`));
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
        xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
        xhr.send(file);
      });
    } catch (err) {
      setGcsPhase("error");
      setGcsError(err instanceof Error ? err.message : "Upload to cloud storage failed");
      return;
    }

    // Step 3: switch to background-processing state
    setGcsPhase("processing");
    setGcsUploadProgress(100);

    // Step 4: poll the job-status endpoint every 10 s using the specific
    // objectKey so we resolve exactly the right dataset, even if another
    // upload finishes concurrently.
    const pollIntervalId = setInterval(() => {
      void fetch(`/api/datasets/upload/gcs-job-status?objectKey=${encodeURIComponent(objectKey)}`, {
        credentials: "include",
      })
        .then((r) => r.json() as Promise<{ status: string; datasetId?: string; error?: string }>)
        .then((job) => {
          if (job.status === "done" && job.datasetId) {
            clearInterval(pollIntervalId);
            void qc.invalidateQueries({ queryKey: getGetUserDatasetsQueryKey() });
            setGcsPhase("idle");
            setGcsError(null);

            const completedDatasetId = job.datasetId;
            const displayName = file.name.replace(/\.[^.]+$/, "");

            const triggerLoad = () => {
              setLoadingId(completedDatasetId);
              setPendingUserDatasetId(completedDatasetId);
              setPendingId(null);
              setUploadOpen(false);
            };

            toast({
              title: `Dataset ready: ${displayName}`,
              description: "Your file has finished processing.",
              action: (
                <ToastAction altText="Load dataset now" onClick={triggerLoad}>
                  Load now
                </ToastAction>
              ),
            });
          } else if (job.status === "failed") {
            clearInterval(pollIntervalId);
            const failMsg = job.error ?? "Processing failed. Please try uploading again.";
            setGcsPhase("error");
            setGcsError(failMsg);
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

    // Stop polling after 15 minutes and surface a timeout error so the panel
    // isn't stuck in `processing` indefinitely (blocking further uploads).
    setTimeout(() => {
      clearInterval(pollIntervalId);
      setGcsPhase((prev) => {
        if (prev === "processing") {
          const timeoutMsg = "Background processing timed out. The file may still be processing — check back in a few minutes or try uploading again.";
          setGcsError(timeoutMsg);
          toast({
            title: "Upload processing timed out",
            description: timeoutMsg,
            variant: "destructive",
          });
          return "error";
        }
        return prev;
      });
    }, 15 * 60 * 1000);
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
  // GET /api/datasets/upload/jobs/:jobId every 1.5 s to get real progress,
  // surface the server's error message on failure, and auto-load the dataset
  // when processing completes.
  useEffect(() => {
    if (chunkedPhase !== "processing" || !chunkedJobId) return;

    setChunkedJobProgress(0);

    let stopped = false;
    const pollIntervalId = setInterval(() => {
      void fetch(`/api/datasets/upload/jobs/${encodeURIComponent(chunkedJobId)}`, {
        credentials: "include",
      })
        .then((r) => r.json() as Promise<{ status: string; progress: number; error?: string; datasetId?: string }>)
        .then((job) => {
          if (stopped) return;
          if (typeof job.progress === "number") {
            setChunkedJobProgress(job.progress);
          }
          if (job.status === "done" && job.datasetId) {
            stopped = true;
            clearInterval(pollIntervalId);
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

            toast({
              title: `Dataset ready: ${displayName}`,
              description: "Your file has finished processing.",
              action: (
                <ToastAction altText="Load dataset now" onClick={triggerLoad}>
                  Load now
                </ToastAction>
              ),
            });
          } else if (job.status === "error") {
            stopped = true;
            clearInterval(pollIntervalId);
            setChunkedPhase("error");
            setChunkedError(job.error ?? "Processing failed. Please try uploading again.");
          }
        })
        .catch(() => {
          // Transient network error — keep polling
        });
    }, 1_500);

    // Stop polling after 10 minutes and show a timeout message
    const timeoutId = setTimeout(() => {
      if (stopped) return;
      stopped = true;
      clearInterval(pollIntervalId);
      setChunkedPhase((prev) => {
        if (prev === "processing") {
          setChunkedError("Processing timed out. The file may still be processing — check back in a few minutes or try uploading again.");
          return "error";
        }
        return prev;
      });
    }, 10 * 60 * 1000);

    return () => {
      stopped = true;
      clearInterval(pollIntervalId);
      clearTimeout(timeoutId);
    };
  }, [chunkedPhase, chunkedJobId, qc, lastChunkedFile, toast, setUploadOpen]);

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
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
    [uploadFile, chunkedUploadFile, gcsUploadFile],
  );

  const handleRetrySave = useCallback(() => {
    if (!lastUploadedFile || postDatasetsUpload.isPending) return;
    uploadFile(lastUploadedFile, { isRetry: true });
  }, [lastUploadedFile, postDatasetsUpload.isPending, uploadFile]);

  // ─── Chunked upload retry — resumes from the failed chunk, same uploadId ──
  // If a chunk transfer failed: resend from that chunk index onwards.
  // If all chunks arrived but finalize failed: skip straight to finalize.
  // Never restarts the whole upload unnecessarily.
  const handleRetryChunked = useCallback(async () => {
    if (!lastChunkedFile || chunkedPhase === "uploading" || chunkedPhase === "processing") return;
    const uploadId = chunkedUploadIdRef.current;
    if (!uploadId) return;

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

  const isAnyUploadBusy = postDatasetsUpload.isPending || chunkedPhase === "uploading" || chunkedPhase === "processing" || gcsPhase === "uploading" || gcsPhase === "processing";

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "text/plain": [".xyz", ".txt", ".nmea"],
      "application/gzip": [".gz"],
      "application/x-gzip": [".gz"],
      "image/tiff": [".tif", ".tiff"],
      "application/octet-stream": [".bag", ".las", ".laz", ".nc"],
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
    const name = window.prompt("Rename bookmark:", bk.name);
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

  // ─── Render ────────────────────────────────────────────────────────────────
  const anyLoading = datasetsLoading || userDatasetsLoading;

  return (
    <div
      style={embedded ? { width: "100%" } : { ...PANEL, pointerEvents: "auto" }}
      className="dataset-panel select-none"
    >
      {/* Header — hidden when embedded inside a SidebarSection */}
      {!embedded && (
      <ViewscreenTooltip label={collapsed ? "Expand datasets panel" : "Collapse datasets panel"} side="right">
        <button
          onClick={() => togglePanel("datasets")}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors rounded-t"
          style={{ cursor: "pointer" }}
        >
          <span className="uppercase tracking-widest" style={{ fontSize: 10, ...CYAN, fontWeight: 700 }}>
            Datasets
          </span>
          <div className="flex items-center gap-2">
            {anyLoading && (
              <span className="animate-spin" style={{ fontSize: 10 }}>◌</span>
            )}
            <HelpIcon articleId="datasets-uploads" label="Datasets and uploads" />
            <span style={{ color: "#cbd5e1", fontSize: 24, lineHeight: 1 }}>{collapsed ? "▸" : "▾"}</span>
          </div>
        </button>
      </ViewscreenTooltip>
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
            <span style={{ fontSize: 10, letterSpacing: "0.12em", color: "#cbd5e1" }}>ENVIRONMENT</span>
            <WaterTypeToggle />
          </div>
          {/* ── Built-in dataset list ── */}
          <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
            {presetLoadError && (
              <div
                data-testid="preset-dataset-load-error"
                style={{
                  margin: "4px 8px",
                  padding: "6px 8px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.35)",
                  borderRadius: 4,
                  fontSize: 10,
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
                      fontSize: 10,
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
                    onClick={(e) => {
                      e.stopPropagation();
                      setPresetLoadError(null);
                    }}
                    style={{
                      fontSize: 10,
                      color: "#cbd5e1",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "1px 4px",
                    }}
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
            <VisibleDatasetsHeader />
            {(datasets ?? []).map((ds) => {
              const active = ds.id === datasetId && !pendingId && !activeUserDatasetId;
              const loading = ds.id === loadingId;
              return (
                <ViewscreenTooltip key={ds.id} label={`Load ${ds.name}`} side="right">
                <div
                  data-testid={`row-dataset-${ds.id}`}
                  className="w-full flex items-stretch transition-colors hover:bg-white/5"
                  style={{
                    background: active ? "rgba(0,229,255,0.07)" : "transparent",
                    borderLeft: active ? "2px solid #00e5ff" : "2px solid transparent",
                    opacity: !isOnline && !cachedIds.has(ds.id) ? 0.4 : 1,
                  }}
                >
                  <PresetVisibilityToggle
                    datasetId={ds.id}
                    disabled={!isOnline && !cachedIds.has(ds.id)}
                  />
                <button
                  data-testid={`btn-dataset-${ds.id}`}
                  onClick={() => (isOnline || cachedIds.has(ds.id)) && handleSelectPreset(ds)}
                  disabled={(!isOnline && !cachedIds.has(ds.id)) || loadingId === ds.id}
                  className="flex-1 text-left px-2 py-2"
                  style={{
                    background: "transparent",
                    cursor: (!isOnline && !cachedIds.has(ds.id)) || loadingId === ds.id ? "not-allowed" : "pointer",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11,
                        fontWeight: active ? 700 : 400,
                        color: active ? "#00e5ff" : !isOnline && !cachedIds.has(ds.id) ? "#cbd5e1" : "#e2e8f0",
                        textShadow: active ? "0 0 6px rgba(0,229,255,0.4)" : "none",
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                        textDecoration: "underline",
                        textUnderlineOffset: 2,
                      }}
                    >
                      {ds.name}
                    </span>
                    <span style={{ fontSize: 9, color: "#cbd5e1", flexShrink: 0 }}>
                      {loading ? (
                        <LoadingDial datasetId={ds.id} label={ds.name} />
                      ) : !isOnline ? (
                        cachedIds.has(ds.id) ? (
                          <ViewscreenTooltip label="Cached — works offline" side="left">
                            <span
                              data-testid={`cache-badge-${ds.id}`}
                              style={{ color: "#4ade80", letterSpacing: "0.1em" }}
                            >
                              ✓
                            </span>
                          </ViewscreenTooltip>
                        ) : (
                          <ViewscreenTooltip label="Not cached — needs internet" side="left">
                            <span
                              data-testid={`unavailable-badge-${ds.id}`}
                              style={{ color: "#ef4444", letterSpacing: "0.1em" }}
                            >
                              ✗
                            </span>
                          </ViewscreenTooltip>
                        )
                      ) : null}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 2, letterSpacing: "0.05em" }}>
                    {formatDepthRange(ds.minDepth, ds.maxDepth, { units })}
                  </div>
                  {active && terrain && terrain.datasetId === ds.id && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <ProvenancePanel
                        terrain={terrain}
                        hasEfh={ds.hasEfh ?? false}
                      />
                    </div>
                  )}
                </button>
                </div>
                </ViewscreenTooltip>
              );
            })}
          </div>

          {/* ── My Library (folders + uploads), signed-in only ── */}
          {isSignedIn && (
            <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
              <div
                className="px-3 py-1 flex items-center gap-2"
                style={{ fontSize: 10, letterSpacing: "0.12em", color: "#cbd5e1" }}
              >
                <span>▲ MY LIBRARY</span>
                {userDatasetsLoading && (
                  <span className="animate-spin" style={{ fontSize: 9, color: "#cbd5e1" }}>◌</span>
                )}
              </div>

              {userLoadError && (
                <div
                  data-testid="user-dataset-load-error"
                  style={{
                    margin: "4px 8px 8px",
                    padding: "6px 8px",
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.35)",
                    borderRadius: 4,
                    fontSize: 10,
                    color: "#fca5a5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
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
                        fontSize: 10,
                        color: "#00e5ff",
                        background: "transparent",
                        border: "1px solid rgba(0,229,255,0.35)",
                        borderRadius: 3,
                        padding: "1px 6px",
                        cursor: !!pendingUserDatasetId ? "not-allowed" : "pointer",
                        opacity: !!pendingUserDatasetId ? 0.5 : 1,
                      }}
                    >
                      {!!pendingUserDatasetId ? "Loading…" : "Retry"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setUserLoadError(null);
                      }}
                      style={{
                        fontSize: 10,
                        color: "#cbd5e1",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: "1px 4px",
                      }}
                      aria-label="Dismiss error"
                    >
                      ×
                    </button>
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
                />
              </ErrorBoundary>
            </div>
          )}

          {/* ── Markers section ── */}
          {markerDatasetId && (
            <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
              <button
                onClick={() => setMarkersOpen(!markersOpen)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
                style={{ cursor: "pointer" }}
              >
                <span style={{ fontSize: 10, letterSpacing: "0.12em", color: "#cbd5e1" }}>
                  ▼ MARKERS {markers?.length ? `(${markers.length})` : ""}
                </span>
                <span style={{ color: "#cbd5e1", fontSize: 11 }}>{markersOpen ? "−" : "+"}</span>
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
                          fontSize: 10,
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
                          fontSize: 10,
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
                          fontSize: 10,
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
                                  fontSize: 11,
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
                              fontSize: 9,
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
                    <div style={{ fontSize: 10, color: "#cbd5e1", padding: "4px 12px 6px" }}>
                      No markers yet — press G or right-click to drop one
                    </div>
                  )}
                  {markers?.length && !visibleMarkers.length ? (
                    <div style={{ fontSize: 10, color: "#94a3b8", padding: "4px 12px 6px" }}>
                      No markers match the current filter
                    </div>
                  ) : null}
                  {visibleMarkers.map((m) => {
                    const color = MARKER_COLOR[m.type] ?? "#e2e8f0";
                    const icon = MARKER_ICON[m.type] ?? "●";
                    return (
                      <button
                        key={m.id}
                        onClick={() => handleTeleportToMarker(m.lon, m.lat)}
                        className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors group"
                        style={{
                          cursor: "pointer",
                        }}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span style={{ color, fontSize: 10, flexShrink: 0 }}>{icon}</span>
                          <span
                            style={{
                              flex: 1,
                              fontSize: 10,
                              color: "#cbd5e1",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {m.label}
                          </span>
                          <span style={{ fontSize: 9, color: "#64748b", flexShrink: 0 }}>
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
                                fontSize: 10,
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
                                fontSize: 11,
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
                      </button>
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
                <span style={{ fontSize: 10, letterSpacing: "0.12em", color: "#cbd5e1" }}>
                  🔖 BOOKMARKS {bookmarks.length ? `(${bookmarks.length})` : ""}
                </span>
                <span style={{ color: "#cbd5e1", fontSize: 11 }}>{bookmarksOpen ? "−" : "+"}</span>
              </button>

              {bookmarksOpen && (
                <div style={{ paddingBottom: 4 }}>
                  {!bookmarks.length && (
                    <div style={{ fontSize: 10, color: "#cbd5e1", padding: "4px 12px 6px" }}>
                      No bookmarks yet — right-click terrain and choose &ldquo;Save view as bookmark…&rdquo;
                    </div>
                  )}
                  {bookmarks.map((bk) => (
                    <div
                      key={bk.id}
                      className="flex items-center gap-1 px-3 py-1 hover:bg-white/5 transition-colors group"
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: 10,
                          color: "#cbd5e1",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {bk.name}
                      </span>
                      <ViewscreenTooltip label="Fly to this bookmark" side="left">
                        <button
                          onClick={() => handleFlyToBookmark(bk)}
                          style={{
                            fontSize: 9,
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
                      <ViewscreenTooltip label="Rename bookmark" side="left">
                        <button
                          onClick={() => handleRenameBookmark(bk)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            fontSize: 10,
                            color: "#e2e8f0",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            lineHeight: 1,
                            padding: "0 2px",
                            flexShrink: 0,
                          }}
                          aria-label="Rename bookmark"
                        >
                          ✎
                        </button>
                      </ViewscreenTooltip>
                      <ViewscreenTooltip label="Delete bookmark" side="left">
                        <button
                          onClick={(e) => handleDeleteBookmark(e, bk)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            fontSize: 11,
                            color: "#cbd5e1",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            lineHeight: 1,
                            padding: "0 2px",
                            flexShrink: 0,
                          }}
                          aria-label="Delete bookmark"
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
              <span style={{ fontSize: 10, letterSpacing: "0.15em", color: "#cbd5e1" }}>
                ▲ UPLOAD DATASET(S)
              </span>
              <span style={{ color: "#cbd5e1", fontSize: 11 }}>{uploadOpen ? "−" : "+"}</span>
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
                      fontSize: 9,
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
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 10, marginBottom: 2 }}>
                            ◌ Uploading &amp; parsing...
                          </div>
                          <div style={{ fontSize: 10, color: "#cbd5e1" }}>{Math.round(uploadProgress)}%</div>
                        </div>
                      ) : chunkedPhase === "uploading" ? (
                        <div>
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 10, marginBottom: 2 }}>
                            ◌ Uploading in chunks...
                          </div>
                          <div style={{ fontSize: 10, color: "#cbd5e1" }}>{chunkedUploadProgress}%</div>
                        </div>
                      ) : chunkedPhase === "processing" ? (
                        <div>
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 10, marginBottom: 2 }}>
                            ◌ Processing on server...
                          </div>
                          <div style={{ fontSize: 10, color: "#cbd5e1" }}>{Math.round(chunkedJobProgress)}%</div>
                        </div>
                      ) : gcsPhase === "uploading" ? (
                        <div>
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 10, marginBottom: 2 }}>
                            ◌ Uploading to cloud storage...
                          </div>
                          <div style={{ fontSize: 10, color: "#cbd5e1" }}>{gcsUploadProgress}%</div>
                        </div>
                      ) : gcsPhase === "processing" ? (
                        <div>
                          <div className="animate-pulse" style={{ ...CYAN, fontSize: 10, marginBottom: 2 }}>
                            ◌ Processing in background...
                          </div>
                          <div style={{ fontSize: 10, color: "#94a3b8" }}>
                            We&apos;ll notify you when it&apos;s ready
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 3 }}>
                            Drop file here, or click to browse
                          </div>
                          <div style={{ fontSize: 10, color: "#cbd5e1" }}>
                            any size · large files upload in chunks{isSignedIn ? " · auto-saved" : ""}
                          </div>
                          {gcsPhase === "error" && gcsError && (
                            <div style={{ fontSize: 9, color: "#f87171", marginTop: 4 }}>⚠ {gcsError}</div>
                          )}
                          {chunkedPhase === "error" && chunkedError && (
                            <div style={{ fontSize: 9, color: "#f87171", marginTop: 4 }}>⚠ {chunkedError}</div>
                          )}
                          {uploadError && (
                            <div style={{ fontSize: 9, color: "#f87171", marginTop: 4 }}>⚠ {uploadError}</div>
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
                            fontSize: 10,
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
                          fontSize: 10,
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
                        <div style={{ fontSize: 10, color: "#fca5a5", flex: 1, lineHeight: 1.4 }}>
                          ⚠ Uploaded, but couldn&apos;t save to your account — {saveError}
                        </div>
                        <button
                          type="button"
                          data-testid="upload-retry-save"
                          onClick={handleRetrySave}
                          disabled={postDatasetsUpload.isPending}
                          style={{
                            fontSize: 10,
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
    </div>
  );
};
