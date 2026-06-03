/**
 * useSubstrateErrorToast — fires a branded one-shot toast when substrate
 * coverage is unavailable for a given dataset.
 *
 * Two distinct conditions trigger the toast:
 *   - `isEmpty`: the server returned a 200 with an empty FeatureCollection,
 *     meaning the dataset's AOI genuinely has no bundled substrate polygons.
 *     This is the expected signal for uploaded datasets outside any covered
 *     region after the backend bbox-lookup fix.
 *   - `isError`: an HTTP error (e.g. 404 or network failure) occurred while
 *     fetching substrate data.
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
  isEmpty,
  datasetId,
  enabled,
}: {
  isError: boolean;
  /** True when the server returned a 200 with zero substrate features. */
  isEmpty: boolean;
  datasetId: string;
  enabled: boolean;
}): void {
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      firedRef.current = null;
      return;
    }
    if (!datasetId) return;
    const shouldFire = isEmpty || isError;
    if (!shouldFire) return;
    if (firedRef.current === datasetId) return;
    if (firedForDatasetIds.has(datasetId)) {
      firedRef.current = datasetId;
      return;
    }

    firedForDatasetIds.add(datasetId);
    firedRef.current = datasetId;

    if (isEmpty) {
      toast({
        title: "No substrate map available",
        description:
          "No bundled substrate polygons (ShoreZone or NOAA ENC) intersect " +
          "this dataset's area. The overlay will show no polygons. Coverage is " +
          "available for built-in survey regions in SE Alaska and select CONUS coasts.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "No substrate map available",
        description:
          "Substrate coverage is only bundled for built-in survey regions. " +
          "Uploaded datasets do not have substrate data — the overlay will show no polygons.",
        variant: "destructive",
      });
    }
  }, [isError, isEmpty, datasetId, enabled]);

  useEffect(() => {
    const id = datasetId;
    return () => {
      firedForDatasetIds.delete(id);
    };
  }, [datasetId]);
}
