import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent } from "@/components/ui/card";
import { usePostDatasetsUpload } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useAuth } from "@/lib/clerkCompat";
import { Spinner } from "@/components/ui/spinner";

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

const SUPPORTED_EXTENSIONS =
  ".csv, .xyz, .txt, .tif, .tiff, .bag, .las, .laz, .nc, .gpx, .nmea";

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
            if (data.saveError) {
              setError(`Saved with warning: ${data.saveError}`);
            }
          },
          onError: (err: unknown) => {
            const e = err as { response?: { status?: number; data?: { error?: string; details?: string } }; message?: string };
            const status = e?.response?.status;
            const details = e?.response?.data?.details;
            if (status === 401) {
              setError("Session expired — please sign in again to upload.");
            } else if (status === 413) {
              setError(
                details ??
                  "File is too large to upload. The maximum file size is 50 MB.",
              );
            } else if (details) {
              setError(details);
            } else {
              setError(e?.message ?? "Failed to parse terrain");
            }
          },
        },
      );
    },
    [isSignedIn, postDatasetsUpload, setTerrain, setDatasetId, setPendingExternalUserDatasetId],
  );

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
              <p className="text-xs text-muted-foreground">Parsing grid...</p>
              {nearLimitWarning && (
                <p className="text-[10px] text-amber-500 select-text">
                  ⚠ {nearLimitWarning}
                </p>
              )}
              {gzWarning && (
                <p className="text-[10px] text-amber-400 select-text">
                  ⚠ {gzWarning}
                </p>
              )}
            </div>
          ) : !isSignedIn ? (
            <>
              <p className="text-xs font-semibold mb-1">UPLOAD CUSTOM TERRAIN</p>
              <p className="text-[10px] text-muted-foreground">
                Sign in to upload bathymetric files to your account
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold mb-1">UPLOAD CUSTOM TERRAIN</p>
              <p className="text-[10px] text-muted-foreground">
                Drop file here — auto-saved to your account
              </p>
              <p className="text-[9px] text-muted-foreground/70 mt-1">
                {SUPPORTED_EXTENSIONS}
              </p>
              {nearLimitWarning && (
                <p className="text-[10px] text-amber-500 mt-2 select-text">
                  ⚠ {nearLimitWarning}
                </p>
              )}
              {gzWarning && (
                <p className="text-[10px] text-amber-400 mt-2 select-text">
                  ⚠ {gzWarning}
                </p>
              )}
              {error && <p className="text-[10px] text-destructive mt-2 select-text">{error}</p>}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
