/**
 * useSubstrateErrorToast — fires a branded one-shot toast when the substrate
 * query errors for a given dataset.
 *
 * A module-level Set deduplicates across both SubstrateLayer (3D) and
 * OverviewMap (2D), which are often mounted simultaneously. Each component
 * calls this hook; only the first call for a given datasetId fires the toast.
 *
 * The per-datasetId entry is removed when the dataset changes (component
 * remounts with a new datasetId) so a fresh dataset can fire the toast again.
 */
import { useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";

/** Tracks which datasetIds have already triggered the substrate error toast. */
const firedForDatasetIds = new Set<string>();

export function useSubstrateErrorToast({
  isError,
  datasetId,
  enabled,
}: {
  isError: boolean;
  datasetId: string;
  enabled: boolean;
}): void {
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      firedRef.current = null;
      return;
    }
    if (!isError || !datasetId) return;
    if (firedRef.current === datasetId) return;
    if (firedForDatasetIds.has(datasetId)) {
      firedRef.current = datasetId;
      return;
    }

    firedForDatasetIds.add(datasetId);
    firedRef.current = datasetId;

    toast({
      title: "No substrate map available",
      description:
        "Substrate coverage is only bundled for built-in survey regions. " +
        "Uploaded datasets do not have substrate data — the overlay will show no polygons.",
      variant: "destructive",
    });
  }, [isError, datasetId, enabled]);

  useEffect(() => {
    const id = datasetId;
    return () => {
      firedForDatasetIds.delete(id);
    };
  }, [datasetId]);
}
