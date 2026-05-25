import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import type { FileRejection } from "react-dropzone";
import {
  useGetDatasets,
  useGetDatasetsIdOverview,
  useGetDatasetsIdTerrain,
  getGetDatasetsIdTerrainQueryKey,
  getGetDatasetsIdOverviewQueryKey,
  usePostDatasetsUpload,
} from "@workspace/api-client-react";
import type { DatasetMeta } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useTerrainStore } from "@/lib/terrainStore";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

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
  const { datasetId, setDatasetId, setTerrain, terrain } = useAppState();
  const [collapsed, setCollapsed] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // ID currently being fetched (triggers parallel queries)
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Simulated upload progress (0-100)
  const [uploadProgress, setUploadProgress] = useState(0);

  const { data: datasets, isLoading: datasetsLoading } = useGetDatasets();

  // ─── Parallel fetch for pending dataset ────────────────────────────────────
  const {
    data: pendingTerrain,
    isError: terrainFetchError,
  } = useGetDatasetsIdTerrain(pendingId ?? "", undefined, {
    query: {
      enabled: !!pendingId,
      queryKey: getGetDatasetsIdTerrainQueryKey(pendingId ?? ""),
    },
  });

  const {
    data: pendingOverview,
    isError: overviewFetchError,
  } = useGetDatasetsIdOverview(pendingId ?? "", {
    query: {
      enabled: !!pendingId,
      queryKey: getGetDatasetsIdOverviewQueryKey(pendingId ?? ""),
    },
  });

  // Clear spinner/pending on fetch error so UI doesn't get stuck
  useEffect(() => {
    if (!pendingId) return;
    if (terrainFetchError || overviewFetchError) {
      setLoadingId(null);
      setPendingId(null);
    }
  }, [pendingId, terrainFetchError, overviewFetchError]);

  // When BOTH terrain and overview for the pending ID arrive, commit atomically
  useEffect(() => {
    if (!pendingId || !pendingTerrain || !pendingOverview) return;
    if (
      pendingTerrain.datasetId !== pendingId ||
      pendingOverview.datasetId !== pendingId
    )
      return;

    // Commit to context and global store
    setDatasetId(pendingId);
    setTerrain(pendingTerrain);
    useTerrainStore.getState().setGrids({
      activeGrid: pendingTerrain,
      overviewGrid: pendingOverview,
    });
    setLoadingId(null);
    setPendingId(null);
  }, [pendingTerrain, pendingOverview, pendingId, setDatasetId, setTerrain]);

  // ─── Overview for the currently active dataset (initial / post-upload) ─────
  const activeId = pendingId ? "" : (datasetId ?? "");
  const { data: activeOverviewData } = useGetDatasetsIdOverview(activeId, {
    query: {
      enabled: !!activeId,
      queryKey: getGetDatasetsIdOverviewQueryKey(activeId),
    },
  });

  const activeOverviewWrittenRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !activeOverviewData ||
      !terrain ||
      activeOverviewWrittenRef.current === activeId
    )
      return;
    activeOverviewWrittenRef.current = activeId;
    useTerrainStore.getState().setGrids({
      activeGrid: terrain,
      overviewGrid: activeOverviewData,
    });
  }, [activeOverviewData, terrain, activeId]);

  const handleSelect = (ds: DatasetMeta) => {
    if (ds.id === datasetId && !pendingId) return;
    setLoadingId(ds.id);
    setPendingId(ds.id); // triggers parallel terrain + overview fetch
  };

  // ─── Upload ────────────────────────────────────────────────────────────────
  const postDatasetsUpload = usePostDatasetsUpload();

  // Simulated progress bar
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

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      setUploadError(null);
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

      postDatasetsUpload.mutate(
        { data: { file, resolution: 256 } },
        {
          onSuccess: (data) => {
            setDatasetId(null);
            setTerrain(data.terrain);
            useTerrainStore.getState().setGrids({
              activeGrid: data.terrain,
              overviewGrid: data.overview,
            });
            setUploadOpen(false);
          },
          onError: (err) => {
            setUploadError(err instanceof Error ? err.message : "Parse failed");
          },
        },
      );
    },
    [postDatasetsUpload, setDatasetId, setTerrain],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"], "text/plain": [".xyz"] },
    maxFiles: 1,
    maxSize: MAX_UPLOAD_BYTES,
    disabled: postDatasetsUpload.isPending,
  });

  return (
    <div style={{ ...PANEL, pointerEvents: "auto" }} className="select-none">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors rounded-t"
        style={{ cursor: "pointer" }}
      >
        <span
          className="uppercase tracking-widest"
          style={{ fontSize: 10, ...CYAN, fontWeight: 700 }}
        >
          ▼ Datasets
        </span>
        <div className="flex items-center gap-2">
          {datasetsLoading && (
            <span className="animate-spin" style={{ fontSize: 10 }}>
              ◌
            </span>
          )}
          <span style={{ color: "#475569", fontSize: 12 }}>
            {collapsed ? "▸" : "▾"}
          </span>
        </div>
      </button>

      {!collapsed && (
        <div>
          {/* Dataset list */}
          <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
            {(datasets ?? []).map((ds) => {
              const active = ds.id === datasetId && !pendingId;
              const loading = ds.id === loadingId;
              return (
                <button
                  key={ds.id}
                  data-testid={`btn-dataset-${ds.id}`}
                  onClick={() => handleSelect(ds)}
                  className="w-full text-left px-3 py-2 transition-colors hover:bg-white/5"
                  style={{
                    background: active ? "rgba(0,229,255,0.07)" : "transparent",
                    borderLeft: active
                      ? "2px solid #00e5ff"
                      : "2px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: active ? 700 : 400,
                        color: active ? "#00e5ff" : "#cbd5e1",
                        textShadow: active
                          ? "0 0 6px rgba(0,229,255,0.4)"
                          : "none",
                      }}
                    >
                      {ds.name}
                    </span>
                    <span style={{ fontSize: 9, color: "#334155" }}>
                      {loading ? (
                        <span
                          className="animate-pulse"
                          style={{ color: "#00e5ff" }}
                        >
                          ◌
                        </span>
                      ) : ds.waterType === "saltwater" ? (
                        "≋"
                      ) : (
                        "~"
                      )}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "#475569",
                      marginTop: 1,
                      letterSpacing: "0.05em",
                    }}
                  >
                    {ds.minDepth}m – {ds.maxDepth}m
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "#334155",
                      marginTop: 1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {ds.description}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Upload accordion */}
          <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
            <button
              onClick={() => setUploadOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
              style={{ cursor: "pointer" }}
            >
              <span
                style={{ fontSize: 9, letterSpacing: "0.15em", color: "#475569" }}
              >
                ▲ UPLOAD CUSTOM TERRAIN
              </span>
              <span style={{ color: "#475569", fontSize: 10 }}>
                {uploadOpen ? "−" : "+"}
              </span>
            </button>

            {uploadOpen && (
              <div className="px-2 pb-2">
                {/* Progress bar (shown during upload) */}
                {postDatasetsUpload.isPending && (
                  <div
                    style={{
                      height: 3,
                      background: "rgba(0,229,255,0.1)",
                      borderRadius: 2,
                      marginBottom: 6,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${uploadProgress}%`,
                        background: "linear-gradient(90deg, #0d47a1, #00e5ff)",
                        borderRadius: 2,
                        transition: "width 0.1s linear",
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
                    background: isDragActive
                      ? "rgba(0,229,255,0.06)"
                      : "rgba(0,0,0,0.2)",
                    padding: "12px 8px",
                    opacity: postDatasetsUpload.isPending ? 0.6 : 1,
                  }}
                >
                  <input {...getInputProps()} />
                  {postDatasetsUpload.isPending ? (
                    <div>
                      <div
                        className="animate-pulse"
                        style={{ ...CYAN, fontSize: 10, marginBottom: 2 }}
                      >
                        ◌ Uploading &amp; parsing...
                      </div>
                      <div style={{ fontSize: 9, color: "#334155" }}>
                        {Math.round(uploadProgress)}%
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}
                      >
                        Drop .xyz or .csv here
                      </div>
                      <div style={{ fontSize: 9, color: "#334155" }}>
                        up to 50 MB
                      </div>
                      {uploadError && (
                        <div
                          style={{ fontSize: 9, color: "#f87171", marginTop: 4 }}
                        >
                          ⚠ {uploadError}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
