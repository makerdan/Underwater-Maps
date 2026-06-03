/**
 * useSubstrateCoverageToast — fires a one-shot discovery nudge when the
 * substrate query returns real features for a user-uploaded dataset.
 *
 * Uploaded datasets previously showed nothing in the substrate overlay;
 * now that the backend can return real coverage for them, users need a
 * heads-up so they know to look at the overlay.
 *
 * Deduplication mirrors useSubstrateErrorToast:
 *   - A module-level Set prevents both SubstrateLayer (3D) and OverviewMap
 *     (2D) from firing the same toast simultaneously (only the first wins).
 *   - The per-datasetId entry is removed on unmount so a fresh load of the
 *     same dataset can fire again if the component remounts.
 *
 * The toast does NOT fire when:
 *   - `hasFeatures` is false (dataset is outside coverage, no polygons)
 *   - `isUserDataset` is false (built-in preset datasets; they always had
 *     coverage, so the nudge would be noise)
 *   - `enabled` is false (overlay is toggled off)
 */
import { useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";

/** Tracks which datasetIds have already triggered the coverage discovery toast. */
const firedForDatasetIds = new Set<string>();

export function useSubstrateCoverageToast({
  hasFeatures,
  isUserDataset,
  datasetId,
  enabled,
}: {
  /** True when the server returned ≥1 substrate feature for this dataset. */
  hasFeatures: boolean;
  /** True when the dataset was uploaded by the user (source === "user"). */
  isUserDataset: boolean;
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
    if (!hasFeatures || !isUserDataset) return;
    if (firedRef.current === datasetId) return;
    if (firedForDatasetIds.has(datasetId)) {
      firedRef.current = datasetId;
      return;
    }

    firedForDatasetIds.add(datasetId);
    firedRef.current = datasetId;

    toast({
      title: "Substrate coverage available",
      description:
        "This dataset's area overlaps bundled substrate polygons. " +
        "Toggle the Substrate overlay to explore habitat classifications.",
    });
  }, [hasFeatures, isUserDataset, datasetId, enabled]);

  useEffect(() => {
    const id = datasetId;
    return () => {
      firedForDatasetIds.delete(id);
    };
  }, [datasetId]);
}
