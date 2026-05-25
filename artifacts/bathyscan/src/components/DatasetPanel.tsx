import React, { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  useGetDatasets,
  useGetDatasetsIdOverview,
  getGetDatasetsIdOverviewQueryKey,
  usePostDatasetsUpload,
} from "@workspace/api-client-react";
import type { DatasetMeta } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useTerrainStore } from "@/lib/terrainStore";

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
  const { datasetId, setDatasetId, setTerrain } = useAppState();
  const [collapsed, setCollapsed] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: datasets, isLoading: datasetsLoading } = useGetDatasets();

  // Fetch overview for the active dataset and sync to terrainStore
  const overviewId = datasetId ?? "";
  const { data: overviewData } = useGetDatasetsIdOverview(overviewId, {
    query: {
      enabled: !!datasetId,
      queryKey: getGetDatasetsIdOverviewQueryKey(overviewId),
    },
  });

  useEffect(() => {
    if (overviewData) {
      useTerrainStore.getState().setGrids({ overviewGrid: overviewData });
    }
  }, [overviewData]);

  // Track loading state when changing datasets
  useEffect(() => {
    if (loadingId && loadingId === datasetId) {
      setLoadingId(null);
    }
  }, [datasetId, loadingId]);

  const handleSelect = (ds: DatasetMeta) => {
    if (ds.id === datasetId) return;
    setLoadingId(ds.id);
    setDatasetId(ds.id);
  };

  const postDatasetsUpload = usePostDatasetsUpload();

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      setUploadError(null);
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
    accept: { "text/csv": [".csv"], "text/plain": [".xyz", ".txt"] },
    maxFiles: 1,
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
          <span style={{ color: "#475569", fontSize: 12 }}>{collapsed ? "▸" : "▾"}</span>
        </div>
      </button>

      {!collapsed && (
        <div>
          {/* Dataset list */}
          <div style={{ borderTop: "1px solid rgba(0,229,255,0.08)" }}>
            {(datasets ?? []).map((ds) => {
              const active = ds.id === datasetId;
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
                        textShadow: active ? "0 0 6px rgba(0,229,255,0.4)" : "none",
                      }}
                    >
                      {ds.name}
                    </span>
                    <span style={{ fontSize: 9, color: "#334155" }}>
                      {loading ? (
                        <span className="animate-pulse" style={{ color: "#00e5ff" }}>
                          ◌
                        </span>
                      ) : (
                        ds.waterType === "saltwater" ? "≋" : "~"
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
              <span style={{ fontSize: 9, letterSpacing: "0.15em", color: "#475569" }}>
                ▲ UPLOAD CUSTOM TERRAIN
              </span>
              <span style={{ color: "#475569", fontSize: 10 }}>{uploadOpen ? "−" : "+"}</span>
            </button>

            {uploadOpen && (
              <div className="px-2 pb-2">
                <div
                  {...getRootProps()}
                  data-testid="dropzone-terrain"
                  className="text-center cursor-pointer transition-colors rounded"
                  style={{
                    border: `1px dashed ${isDragActive ? "#00e5ff" : "rgba(0,229,255,0.2)"}`,
                    background: isDragActive ? "rgba(0,229,255,0.06)" : "rgba(0,0,0,0.2)",
                    padding: "12px 8px",
                  }}
                >
                  <input {...getInputProps()} />
                  {postDatasetsUpload.isPending ? (
                    <div>
                      <div
                        className="animate-pulse"
                        style={{ ...CYAN, fontSize: 10, marginBottom: 4 }}
                      >
                        ◌ Parsing grid...
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>
                        Drop .xyz or .csv here
                      </div>
                      <div style={{ fontSize: 9, color: "#334155" }}>up to 50 MB</div>
                      {uploadError && (
                        <div style={{ fontSize: 9, color: "#f87171", marginTop: 4 }}>
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
