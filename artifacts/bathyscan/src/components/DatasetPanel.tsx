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
  useDeleteUserDatasetsId,
  useGetMarkers,
  useDeleteMarkersId,
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
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { lonLatToWorldXZ } from "@/lib/terrain";
import { MARKER_COLOR, MARKER_ICON } from "@/lib/markerConstants";
import { useClassificationStore } from "@/lib/classificationStore";
import { useOfflineStore } from "@/lib/offlineStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { ProvenancePanel } from "@/components/ProvenancePanel";
import { DatasetFolderTree } from "@/components/DatasetFolderTree";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";
import { WaterTypeToggle } from "@/components/WaterTypeToggle";
import { HelpIcon } from "@/components/help/HelpButton";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const PANEL: React.CSSProperties = {
  background: "rgba(0,10,20,0.82)",
  border: "1px solid rgba(0,229,255,0.18)",
  borderRadius: 6,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  color: "#94a3b8",
  fontSize: 11,
  minWidth: 220,
  maxWidth: 260,
  backdropFilter: "blur(6px)",
};

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

export const DatasetPanel: React.FC = () => {
  const { datasetId, setDatasetId, setTerrain, terrain, mode } = useAppState();
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);

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

  const collapsed = usePanelCollapseStore((s) => s.collapsed.datasets);
  const togglePanel = usePanelCollapseStore((s) => s.toggle);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // ─── Preset dataset pending fetch ─────────────────────────────────────────
  const [pendingId, setPendingId] = useState<string | null>(null);

  // ─── User dataset pending + active tracking ────────────────────────────────
  const [pendingUserDatasetId, setPendingUserDatasetId] = useState<string | null>(null);
  const [activeUserDatasetId, setActiveUserDatasetId] = useState<string | null>(null);
  const [userLoadError, setUserLoadError] = useState<{ id: string; name: string } | null>(null);
  const [presetLoadError, setPresetLoadError] = useState<{ id: string; name: string } | null>(null);

  // ─── Upload progress (simulated) ──────────────────────────────────────────
  const [uploadProgress, setUploadProgress] = useState(0);

  const waterType = useSettingsStore((s) => s.waterType);

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
      },
    },
  );

  const { data: pendingOverview, isError: overviewFetchError } = useGetDatasetsIdOverview(
    pendingId ?? "",
    {
      query: {
        enabled: !!pendingId,
        queryKey: getGetDatasetsIdOverviewQueryKey(pendingId ?? ""),
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
      },
    },
  );

  const { data: userPendingOverview, isError: userOverviewError } = useGetUserDatasetsIdOverview(
    pendingUserDatasetId ?? "",
    {
      query: {
        enabled: !!pendingUserDatasetId,
        queryKey: getGetUserDatasetsIdOverviewQueryKey(pendingUserDatasetId ?? ""),
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
    }
  }, [pendingUserDatasetId, userTerrainError, userOverviewError, userDatasets]);

  useEffect(() => {
    if (!pendingUserDatasetId || !userPendingTerrain || !userPendingOverview) return;
    if (
      userPendingTerrain.datasetId !== pendingUserDatasetId ||
      userPendingOverview.datasetId !== pendingUserDatasetId
    )
      return;

    setTerrain(userPendingTerrain);
    setDatasetId(null);
    setActiveUserDatasetId(pendingUserDatasetId);
    useTerrainStore.getState().setGrids({
      activeGrid: userPendingTerrain,
      overviewGrid: userPendingOverview,
    });
    useClassificationStore.getState().clearZoneMap();
    void useClassificationStore.getState().classify(userPendingTerrain);
    setLoadingId(null);
    setPendingUserDatasetId(null);
  }, [userPendingTerrain, userPendingOverview, pendingUserDatasetId, setTerrain, setDatasetId]);

  // ─── Overview for the active dataset (initial / background) ───────────────
  const activeId = pendingId ? "" : (datasetId ?? "");
  const { data: activeOverviewData } = useGetDatasetsIdOverview(activeId, {
    query: {
      enabled: !!activeId,
      queryKey: getGetDatasetsIdOverviewQueryKey(activeId),
    },
  });

  const activeOverviewWrittenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeOverviewData || !terrain || activeOverviewWrittenRef.current === activeId) return;
    activeOverviewWrittenRef.current = activeId;
    useTerrainStore.getState().setGrids({ activeGrid: terrain, overviewGrid: activeOverviewData });
  }, [activeOverviewData, terrain, activeId]);

  // ─── Dataset click handlers ────────────────────────────────────────────────
  const handleSelectPreset = (ds: DatasetMeta) => {
    if (ds.id === datasetId && !pendingId) return;
    setPresetLoadError(null);
    setUserLoadError(null);
    setLoadingId(ds.id);
    setPendingId(ds.id);
    setPendingUserDatasetId(null);
  };

  const handleSelectUserDataset = (ds: UserDatasetMeta) => {
    if (ds.id === activeUserDatasetId && !pendingUserDatasetId) return;
    setUserLoadError(null);
    setPresetLoadError(null);
    setLoadingId(ds.id);
    setPendingUserDatasetId(ds.id);
    setPendingId(null);
  };

  const handleRetryUserDataset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userLoadError) return;
    const id = userLoadError.id;
    void qc.invalidateQueries({ queryKey: getGetUserDatasetsIdTerrainQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetUserDatasetsIdOverviewQueryKey(id) });
    setUserLoadError(null);
    setLoadingId(id);
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
    setPendingId(id);
    setPendingUserDatasetId(null);
  };

  // ─── Delete user dataset (mutation surface kept for compatibility) ────────
  const deleteMutation = useDeleteUserDatasetsId();

  // When a delete completes in the tree, clear active selection if needed.
  useEffect(() => {
    if (
      deleteMutation.isSuccess &&
      typeof deleteMutation.variables?.id === "string" &&
      activeUserDatasetId === deleteMutation.variables.id
    ) {
      setActiveUserDatasetId(null);
    }
  }, [deleteMutation.isSuccess, deleteMutation.variables, activeUserDatasetId]);

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
    (file: File, { isRetry }: { isRetry?: boolean } = {}) => {
      postDatasetsUpload.mutate(
        { data: { file, resolution: 256 } },
        {
          onSuccess: (data) => {
            if (!isRetry) {
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
              // MY UPLOADS cache so it appears immediately, without
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
              if (!isRetry) setUploadOpen(false);
            } else if (data.saveError) {
              setSaveError(data.saveError);
              setLastUploadedFile(file);
              if (!isRetry) setActiveUserDatasetId(null);
            } else {
              if (!isRetry) setActiveUserDatasetId(null);
              setSaveError(null);
              setLastUploadedFile(null);
              if (!isRetry) setUploadOpen(false);
            }
          },
          onError: (err) => {
            if (isRetry) {
              setSaveError(err instanceof Error ? err.message : "Retry failed");
            } else {
              setUploadError(err instanceof Error ? err.message : "Parse failed");
            }
          },
        },
      );
    },
    [postDatasetsUpload, setDatasetId, setTerrain, qc],
  );

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      setUploadError(null);
      setSaveError(null);
      if (rejected.length) {
        const code = rejected[0]?.errors[0]?.code;
        if (code === "file-too-large") {
          setUploadError("File exceeds 50 MB limit");
        } else if (code === "file-invalid-type") {
          setUploadError("Only .xyz or .csv files accepted");
        } else {
          setUploadError("Invalid file");
        }
        return;
      }
      const file = accepted[0];
      if (!file) return;
      uploadFile(file);
    },
    [uploadFile],
  );

  const handleRetrySave = useCallback(() => {
    if (!lastUploadedFile || postDatasetsUpload.isPending) return;
    uploadFile(lastUploadedFile, { isRetry: true });
  }, [lastUploadedFile, postDatasetsUpload.isPending, uploadFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"], "text/plain": [".xyz"] },
    maxFiles: 1,
    maxSize: MAX_UPLOAD_BYTES,
    disabled: postDatasetsUpload.isPending,
  });

  // ─── Markers ──────────────────────────────────────────────────────────────
  const [markersOpen, setMarkersOpen] = useState(false);
  const markerDatasetId = terrain?.datasetId ?? "";
  const { data: markers } = useGetMarkers(
    { datasetId: markerDatasetId },
    { query: { enabled: !!markerDatasetId, queryKey: getGetMarkersQueryKey({ datasetId: markerDatasetId }) } },
  );
  const deleteMarkerMutation = useDeleteMarkersId();

  const handleDeleteMarker = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteMarkerMutation.mutate(
      { id },
      {
        onSuccess: () => {
          void qc.invalidateQueries({
            queryKey: getGetMarkersQueryKey({ datasetId: markerDatasetId }),
          });
        },
      },
    );
  };

  const handleTeleportToMarker = (lon: number, lat: number) => {
    if (!terrain) return;
    if (mode !== "fly") return;
    const { x, z } = lonLatToWorldXZ(lon, lat, terrain);
    useUiStore.getState().setPendingDropIn({ worldX: x, worldZ: z });
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  const anyLoading = datasetsLoading || userDatasetsLoading;

  return (
    <div style={{ ...PANEL, pointerEvents: "auto" }} className="dataset-panel select-none">
      {/* Header */}
      <ViewscreenTooltip label={collapsed ? "Expand datasets panel" : "Collapse datasets panel"} side="right">
        <button
          onClick={() => togglePanel("datasets")}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors rounded-t"
          style={{ cursor: "pointer" }}
        >
          <span className="uppercase tracking-widest" style={{ fontSize: 10, ...CYAN, fontWeight: 700 }}>
            ▼ Datasets
          </span>
          <div className="flex items-center gap-2">
            {anyLoading && (
              <span className="animate-spin" style={{ fontSize: 10 }}>◌</span>
            )}
            <HelpIcon articleId="datasets-uploads" label="Datasets and uploads" />
            <span style={{ color: "#cbd5e1", fontSize: 12 }}>{collapsed ? "▸" : "▾"}</span>
          </div>
        </button>
      </ViewscreenTooltip>

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
                    style={{
                      fontSize: 10,
                      color: "#00e5ff",
                      background: "transparent",
                      border: "1px solid rgba(0,229,255,0.35)",
                      borderRadius: 3,
                      padding: "1px 6px",
                      cursor: "pointer",
                    }}
                  >
                    Retry
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
            {(datasets ?? []).map((ds) => {
              const active = ds.id === datasetId && !pendingId && !activeUserDatasetId;
              const loading = ds.id === loadingId;
              return (
                <ViewscreenTooltip key={ds.id} label={`Load ${ds.name}`} side="right">
                <button
                  data-testid={`btn-dataset-${ds.id}`}
                  onClick={() => (isOnline || cachedIds.has(ds.id)) && handleSelectPreset(ds)}
                  disabled={!isOnline && !cachedIds.has(ds.id)}
                  className="w-full text-left px-3 py-2 transition-colors hover:bg-white/5"
                  style={{
                    background: active ? "rgba(0,229,255,0.07)" : "transparent",
                    borderLeft: active ? "2px solid #00e5ff" : "2px solid transparent",
                    cursor: !isOnline && !cachedIds.has(ds.id) ? "not-allowed" : "pointer",
                    opacity: !isOnline && !cachedIds.has(ds.id) ? 0.4 : 1,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: active ? 700 : 400,
                        color: active ? "#00e5ff" : !isOnline && !cachedIds.has(ds.id) ? "#64748b" : "#e2e8f0",
                        textShadow: active ? "0 0 6px rgba(0,229,255,0.4)" : "none",
                      }}
                    >
                      {ds.name}
                    </span>
                    <span style={{ fontSize: 9, color: "#cbd5e1" }}>
                      {loading ? (
                        <span className="animate-pulse" style={{ color: "#00e5ff" }}>◌</span>
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
                      ) : ds.waterType === "saltwater" ? "≋" : "~"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 2, letterSpacing: "0.05em" }}>
                    {ds.minDepth}m – {ds.maxDepth}m
                  </div>
                  <div
                    style={{
                      fontSize: 9, color: "#334155", marginTop: 1,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    {ds.description}
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
                <span>▲ MY UPLOADS</span>
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
                      style={{
                        fontSize: 10,
                        color: "#00e5ff",
                        background: "transparent",
                        border: "1px solid rgba(0,229,255,0.35)",
                        borderRadius: 3,
                        padding: "1px 6px",
                        cursor: "pointer",
                      }}
                    >
                      Retry
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
                />
              </ErrorBoundary>
            </div>
          )}

          {/* ── Markers section ── */}
          {markerDatasetId && (
            <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
              <button
                onClick={() => setMarkersOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
                style={{ cursor: "pointer" }}
              >
                <span style={{ fontSize: 10, letterSpacing: "0.12em", color: "#cbd5e1" }}>
                  ▼ MARKERS {markers?.length ? `(${markers.length})` : ""}
                </span>
                <span style={{ color: "#cbd5e1", fontSize: 11 }}>{markersOpen ? "−" : "+"}</span>
              </button>

              {markersOpen && (
                <div style={{ paddingBottom: 4 }}>
                  {!markers?.length && (
                    <div style={{ fontSize: 10, color: "#cbd5e1", padding: "4px 12px 6px" }}>
                      No markers yet — press G or right-click to drop one
                    </div>
                  )}
                  {(markers ?? []).map((m) => {
                    const color = MARKER_COLOR[m.type] ?? "#e2e8f0";
                    const icon = MARKER_ICON[m.type] ?? "●";
                    const deleting =
                      deleteMarkerMutation.isPending &&
                      (deleteMarkerMutation.variables as { id: string } | undefined)?.id === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => handleTeleportToMarker(m.lon, m.lat)}
                        className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors group"
                        style={{
                          opacity: deleting ? 0.4 : 1,
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
                          <span style={{ fontSize: 9, color: "#334155", flexShrink: 0 }}>
                            {Math.round(m.depth)}m
                          </span>
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
              )}
            </div>
          )}

          {/* ── Upload accordion ── */}
          <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
            <ViewscreenTooltip label={uploadOpen ? "Hide upload area" : "Upload your own terrain file"} side="right">
            <button
              onClick={() => setUploadOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
              style={{ cursor: "pointer" }}
            >
              <span style={{ fontSize: 10, letterSpacing: "0.15em", color: "#cbd5e1" }}>
                ▲ UPLOAD CUSTOM TERRAIN
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
                    {postDatasetsUpload.isPending && (
                      <div
                        style={{
                          height: 3, background: "rgba(0,229,255,0.1)",
                          borderRadius: 2, marginBottom: 6, overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%", width: `${uploadProgress}%`,
                            background: "linear-gradient(90deg, #0d47a1, #00e5ff)",
                            borderRadius: 2, transition: "width 0.1s linear",
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
                        opacity: postDatasetsUpload.isPending ? 0.6 : 1,
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
                      ) : (
                        <>
                          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>
                            Drop .xyz or .csv here
                          </div>
                          <div style={{ fontSize: 10, color: "#cbd5e1" }}>
                            up to 50 MB{isSignedIn ? " · auto-saved to account" : ""}
                          </div>
                          {uploadError && (
                            <div style={{ fontSize: 9, color: "#f87171", marginTop: 4 }}>⚠ {uploadError}</div>
                          )}
                        </>
                      )}
                    </div>
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
