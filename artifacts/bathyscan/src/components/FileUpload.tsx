import React, { useCallback, useEffect, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Card, CardContent } from "@/components/ui/card";
import { usePostDatasetsUpload } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useAuth } from "@/lib/clerkCompat";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

/**
 * FileUpload — Drop-zone for bathymetric file uploads.
 *
 * Supports: CSV, XYZ, TXT (text grids), GeoTIFF, BAG, LAS, LAZ, NetCDF,
 * GPX (depth tracks), and NMEA depth-sounder logs.
 *
 * Uploads are auth-gated server-side: every successful upload is persisted
 * into the user's dataset library. When the user isn't signed in we surface
 * a clear "sign in to upload" prompt instead of letting them attempt an
 * upload that would be rejected with a 401.
 */

export const SUPPORTED_EXTENSIONS =
  ".csv, .xyz, .txt, .tif, .tiff, .bag, .las, .laz, .nc, .gpx, .xml, .nmea, .gz, .pdf";

/**
 * MIME-type → extension map passed to react-dropzone.
 *
 * `.pdf` is included because the API server accepts vector and raster contour
 * PDFs via the pdfContour / pdfContourRaster pipelines (see datasets.ts
 * ACCEPTED_EXTENSIONS_SET). The `application/pdf` MIME type is required for
 * the browser drop-zone to recognise PDF files; without it the drop-zone
 * silently rejects them even though the server would accept them.
 *
 * Exported so the unit-test agreement check (F-008 regression guard) can
 * compare this list against SUPPORTED_EXTENSIONS without re-parsing the JSX.
 */
export const ACCEPT_MAP: Record<string, string[]> = {
  "text/csv": [".csv"],
  "text/plain": [".xyz", ".txt", ".nmea"],
  "application/gzip": [".gz"],
  "application/x-gzip": [".gz"],
  "image/tiff": [".tif", ".tiff"],
  "application/octet-stream": [".bag", ".las", ".laz", ".nc", ".gz"],
  "application/x-netcdf": [".nc"],
  "application/gpx+xml": [".gpx", ".xml"],
  "application/xml": [".xml"],
  "text/xml": [".gpx", ".xml"],
  // PDF contour maps (vector or raster) — processed by pdfContour pipeline
  "application/pdf": [".pdf"],
};

const GZ_WARNING_THRESHOLD_MB = 30;
const UPLOAD_LIMIT_MB = 50;
const NEAR_LIMIT_THRESHOLD_MB = UPLOAD_LIMIT_MB * 0.8; // 40 MB — within 20% of limit

export const FileUpload = () => {
  const { setTerrain, setDatasetId, setPendingExternalUserDatasetId } = useAppState();
  const { isSignedIn } = useAuth();
  const postDatasetsUpload = usePostDatasetsUpload();
  const [error, setError] = useState<string | null>(null);
  const [gzWarning, setGzWarning] = useState<string | null>(null);
  const [nearLimitWarning, setNearLimitWarning] = useState<string | null>(null);
  const [uploadStalled, setUploadStalled] = useState(false);

  useEffect(() => {
    if (!postDatasetsUpload.isPending) {
      setUploadStalled(false);
      return;
    }
    const timer = window.setTimeout(() => setUploadStalled(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [postDatasetsUpload.isPending]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!isSignedIn) {
        setError("Sign in to upload your own datasets.");
        return;
      }
      const file = acceptedFiles[0];
      if (!file) return;

      setError(null);

      const isGz = file.name.toLowerCase().endsWith(".gz");
      const sizeMb = file.size / (1024 * 1024);
      if (isGz && sizeMb > GZ_WARNING_THRESHOLD_MB) {
        setGzWarning(
          "This file may be large when decompressed. If upload fails, try a smaller area.",
        );
      } else {
        setGzWarning(null);
      }

      if (sizeMb > NEAR_LIMIT_THRESHOLD_MB) {
        setNearLimitWarning(
          `This file is ${sizeMb.toFixed(1)} MB — close to the ${UPLOAD_LIMIT_MB} MB upload limit. Upload may fail for very large files.`,
        );
      } else {
        setNearLimitWarning(null);
      }
      postDatasetsUpload.mutate(
        { data: { file, resolution: 256 } },
        {
          onSuccess: (data) => {
            setDatasetId(null);
            setTerrain(data.terrain);
            // Hand off to DatasetPanel so the newly-saved row is loaded
            // through the unified /user/datasets read path (which also
            // hydrates the overview map and "My Library" list).
            if (data.savedDatasetId) {
              setPendingExternalUserDatasetId(data.savedDatasetId);
            }
          },
          onError: (err: unknown) => {
            const e = err as { status?: number; data?: { detail?: string; details?: string; error?: string }; response?: { status?: number }; message?: string };
            const status = e?.response?.status ?? e?.status;
            const detail = e?.data?.detail ?? e?.data?.details;
            if (status === 401) {
              setError("Session expired — please sign in again to upload.");
            } else if (status === 413) {
              setError(
                detail ??
                  "File is too large to upload. The maximum file size is 50 MB.",
              );
            } else if (detail) {
              setError(detail);
            } else {
              setError(e?.message ?? "Failed to parse terrain");
            }
          },
        },
      );
    },
    [isSignedIn, postDatasetsUpload, setTerrain, setDatasetId, setPendingExternalUserDatasetId],
  );

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const code = rejections[0]?.errors[0]?.code;
    if (code === "too-many-files") {
      setError("Drop one file at a time");
    } else if (code === "file-invalid-type") {
      setError(`Unsupported file type — supported formats: ${SUPPORTED_EXTENSIONS}`);
    } else {
      setError("File rejected — check the file type and try again");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    onDragEnter: () => setError(null),
    accept: ACCEPT_MAP,
    maxFiles: 1,
    disabled: !isSignedIn || postDatasetsUpload.isPending,
  });

  return (
    <Card className="bg-background/80 backdrop-blur-md border-border text-foreground pointer-events-auto overflow-hidden">
      <CardContent className="p-0">
        <div
          {...getRootProps()}
          data-testid="dropzone-terrain"
          aria-disabled={!isSignedIn}
          className={`p-6 text-center border-2 border-dashed transition-colors ${
            !isSignedIn
              ? "border-border/50 opacity-60 cursor-not-allowed"
              : isDragActive
                ? "border-primary bg-primary/10 cursor-pointer"
                : "border-border hover:bg-muted/50 cursor-pointer"
          }`}
        >
          <input {...getInputProps()} />
          {postDatasetsUpload.isPending ? (
            <div className="flex flex-col items-center gap-2">
              <Spinner className="w-5 h-5 text-primary" />
              <p className="text-[18px] text-muted-foreground">
                {uploadStalled ? "Upload appears stalled" : "Parsing grid..."}
              </p>
              {uploadStalled && (
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    className="min-h-11 rounded border border-border px-3 text-[15px] text-foreground"
                    onClick={() => {
                      postDatasetsUpload.reset();
                      setError("Upload cancelled. Choose the file again to retry.");
                    }}
                  >
                    Cancel and retry
                  </button>
                </div>
              )}
              {nearLimitWarning && <ErrorMessage message={`⚠ ${nearLimitWarning}`} className="text-[15px] text-amber-500" />}
              {gzWarning && <ErrorMessage message={`⚠ ${gzWarning}`} className="text-[15px] text-amber-400" />}
            </div>
          ) : !isSignedIn ? (
            <>
              <p className="text-[18px] font-semibold mb-1">UPLOAD DATASET(S)</p>
              <p className="text-[15px] text-muted-foreground">
                Sign in to upload bathymetric files to your account
              </p>
            </>
          ) : (
            <>
              <p className="text-[18px] font-semibold mb-1">UPLOAD DATASET(S)</p>
              <p className="text-[15px] text-muted-foreground">
                Drop file here — auto-saved to your account
              </p>
              <p style={{ fontSize: "calc(13.5px * var(--bs-font-scale, 1))", color: "#94a3b8", marginTop: 4 }}>
                {SUPPORTED_EXTENSIONS}
              </p>
              {nearLimitWarning && <ErrorMessage message={`⚠ ${nearLimitWarning}`} className="mt-2 text-[15px] text-amber-500" />}
              {gzWarning && <ErrorMessage message={`⚠ ${gzWarning}`} className="mt-2 text-[15px] text-amber-400" />}
              {error && <ErrorMessage message={error} className="mt-2 text-[15px] text-destructive" />}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
