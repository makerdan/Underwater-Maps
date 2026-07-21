import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import type { FileRejection } from "react-dropzone";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/clerkCompat";
import {
  usePostDatasetsUpload,
  getGetUserDatasetsQueryKey,
} from "@workspace/api-client-react";
import type { UserDatasetMeta } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useTerrainStore } from "@/lib/terrainStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useOfflineStore } from "@/lib/offlineStore";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function formatEta(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  if (seconds < 5) return "Almost done…";
  if (seconds < 60) return `~${seconds} sec remaining`;
  const mins = Math.round(seconds / 60);
  return `~${mins} min remaining`;
}
const AUTO_RETRY_DELAYS_MS = [500, 1500];

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

const CYAN: React.CSSProperties = {
  color: "#00e5ff",
  textShadow: "0 0 6px rgba(0,229,255,0.5)",
};

export const CustomTerrainUpload: React.FC = () => {
  const { setTerrain, setDatasetId } = useAppState();
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [savingToAccount, setSavingToAccount] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [smallFileEta, setSmallFileEta] = useState<number | null>(null);
  const uploadStartedAt = useRef<number | null>(null);
  const uploadFileSizeBytesRef = useRef<number>(0);

  const autoRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (autoRetryTimer.current) clearTimeout(autoRetryTimer.current);
  }, []);

  const postDatasetsUpload = usePostDatasetsUpload();

  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (postDatasetsUpload.isPending) {
      setUploadProgress(0);
      setSmallFileEta(null);
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
              useTerrainStore.getState().setGrids({
                activeGrid: data.terrain,
                overviewGrid: data.overview,
              });
              useClassificationStore.getState().clearZoneMap();
              void useClassificationStore.getState().classify(data.terrain);
            }
            if (data.savedDatasetId) {
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
            } else if (data.saveError) {
              if (autoAttempt < AUTO_RETRY_DELAYS_MS.length) {
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
              }
            } else {
              setSaveError(null);
              setLastUploadedFile(null);
              setSavingToAccount(false);
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
    maxSize: MAX_UPLOAD_BYTES,
    disabled: postDatasetsUpload.isPending,
  });

  return (
    <div style={{ padding: "12px 16px", fontFamily: FONT }}>
      {!isOnline ? (
        <div
          data-testid="upload-offline-notice"
          style={{
            border: "1px dashed rgba(239,68,68,0.25)",
            background: "rgba(239,68,68,0.04)",
            borderRadius: 4,
            padding: "12px 8px",
            textAlign: "center",
            fontSize: "calc(15px * var(--bs-font-scale, 1))",
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
              border: `1px dashed ${isDragActive ? "#00e5ff" : "rgba(0,229,255,0.25)"}`,
              background: isDragActive ? "rgba(0,229,255,0.06)" : "rgba(0,0,0,0.2)",
              padding: "18px 12px",
              opacity: postDatasetsUpload.isPending ? 0.6 : 1,
            }}
          >
            <input {...getInputProps()} />
            {postDatasetsUpload.isPending ? (
              <div>
                <div className="animate-pulse" style={{ ...CYAN, fontSize: "calc(16.5px * var(--bs-font-scale, 1))", marginBottom: 4 }}>
                  ◌ Uploading &amp; parsing...
                </div>
                <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#cbd5e1" }}>{Math.round(uploadProgress)}%</div>
                {formatEta(smallFileEta) && (
                  <div style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", marginTop: 2 }}>
                    {formatEta(smallFileEta)}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div style={{ fontSize: "calc(16.5px * var(--bs-font-scale, 1))", color: "#cbd5e1", marginBottom: 3, fontWeight: 600 }}>
                  Drop file here, or click to browse
                </div>
                <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#cbd5e1" }}>
                  up to 50 MB{isSignedIn ? " · auto-saved to your account" : ""}
                </div>
                {uploadError && (
                  <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#f87171", marginTop: 6 }}>⚠ {uploadError}</div>
                )}
              </>
            )}
          </div>
          {savingToAccount && !saveError && (
            <div
              data-testid="upload-saving-to-account"
              style={{
                marginTop: 8,
                padding: "6px 8px",
                border: "1px solid rgba(0,229,255,0.25)",
                background: "rgba(0,229,255,0.05)",
                borderRadius: 4,
                fontSize: "calc(15px * var(--bs-font-scale, 1))",
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
                marginTop: 8,
                padding: "6px 8px",
                border: "1px solid rgba(248,113,113,0.4)",
                background: "rgba(248,113,113,0.08)",
                borderRadius: 4,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <div style={{ fontSize: "calc(15px * var(--bs-font-scale, 1))", color: "#fca5a5", flex: 1, lineHeight: 1.4 }}>
                ⚠ Uploaded, but couldn&apos;t save to your account — {saveError}
              </div>
              <button
                type="button"
                data-testid="upload-retry-save"
                onClick={handleRetrySave}
                disabled={postDatasetsUpload.isPending}
                style={{
                  fontSize: "calc(15px * var(--bs-font-scale, 1))",
                  padding: "3px 8px",
                  border: "1px solid rgba(0,229,255,0.4)",
                  background: "rgba(0,229,255,0.08)",
                  color: "#00e5ff",
                  borderRadius: 3,
                  cursor: postDatasetsUpload.isPending ? "wait" : "pointer",
                  whiteSpace: "nowrap",
                  letterSpacing: "0.08em",
                  fontFamily: FONT,
                }}
              >
                {postDatasetsUpload.isPending ? "…" : "Retry save"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
