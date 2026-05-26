import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent } from "@/components/ui/card";
import { usePostDatasetsUpload } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { useAuth } from "@/lib/clerkCompat";
import { Spinner } from "@/components/ui/spinner";

/**
 * FileUpload — Drop-zone for XYZ/CSV bathymetry uploads.
 *
 * Uploads are auth-gated server-side: every successful upload is persisted
 * into the user's dataset library. When the user isn't signed in we surface
 * a clear "sign in to upload" prompt instead of letting them attempt an
 * upload that would be rejected with a 401.
 */
export const FileUpload = () => {
  const { setTerrain, setDatasetId, setPendingExternalUserDatasetId } = useAppState();
  const { isSignedIn } = useAuth();
  const postDatasetsUpload = usePostDatasetsUpload();
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!isSignedIn) {
        setError("Sign in to upload your own datasets.");
        return;
      }
      const file = acceptedFiles[0];
      if (!file) return;

      setError(null);
      postDatasetsUpload.mutate(
        { data: { file, resolution: 256 } },
        {
          onSuccess: (data) => {
            setDatasetId(null);
            setTerrain(data.terrain);
            // Hand off to DatasetPanel so the newly-saved row is loaded
            // through the unified /user/datasets read path (which also
            // hydrates the overview map and "My Uploads" list).
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
              setError(details ?? "File is too large to upload.");
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
      "text/plain": [".xyz", ".txt"],
    },
    maxFiles: 1,
    disabled: !isSignedIn,
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
            </div>
          ) : !isSignedIn ? (
            <>
              <p className="text-xs font-semibold mb-1">UPLOAD CUSTOM TERRAIN</p>
              <p className="text-[10px] text-muted-foreground">
                Sign in to upload XYZ or CSV files to your account
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold mb-1">UPLOAD CUSTOM TERRAIN</p>
              <p className="text-[10px] text-muted-foreground">
                Drop XYZ or CSV file here — auto-saved to your account
              </p>
              {error && <p className="text-[10px] text-destructive mt-2">{error}</p>}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
