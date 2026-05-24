import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent } from "@/components/ui/card";
import { usePostDatasetsUpload } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { Spinner } from "@/components/ui/spinner";

export const FileUpload = () => {
  const { setTerrain, setDatasetId } = useAppState();
  const postDatasetsUpload = usePostDatasetsUpload();
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setError(null);
    postDatasetsUpload.mutate(
      { data: { file, resolution: 256 } },
      {
        onSuccess: (data) => {
          setDatasetId(null);
          setTerrain(data.terrain);
        },
        onError: (err) => {
          setError(err.message || "Failed to parse terrain");
        },
      }
    );
  }, [postDatasetsUpload, setTerrain, setDatasetId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "text/plain": [".xyz", ".txt"],
    },
    maxFiles: 1,
  });

  return (
    <Card className="bg-background/80 backdrop-blur-md border-border text-foreground pointer-events-auto overflow-hidden">
      <CardContent className="p-0">
        <div
          {...getRootProps()}
          data-testid="dropzone-terrain"
          className={`p-6 text-center cursor-pointer border-2 border-dashed transition-colors ${
            isDragActive ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"
          }`}
        >
          <input {...getInputProps()} />
          {postDatasetsUpload.isPending ? (
            <div className="flex flex-col items-center gap-2">
              <Spinner className="w-5 h-5 text-primary" />
              <p className="text-xs text-muted-foreground">Parsing grid...</p>
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold mb-1">UPLOAD CUSTOM TERRAIN</p>
              <p className="text-[10px] text-muted-foreground">Drop XYZ or CSV file here</p>
              {error && <p className="text-[10px] text-destructive mt-2">{error}</p>}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
