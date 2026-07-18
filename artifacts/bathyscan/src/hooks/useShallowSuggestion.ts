/**
 * useShallowSuggestion — watches the active terrain grid and surfaces a
 * one-shot, per-dataset suggestion when a shallow dataset (depth range under
 * ~20 ft / 6 m) loads: increase vertical exaggeration and switch to fine
 * contours. The suggestion is a dismissible banner (ShallowDatasetBanner);
 * settings are NEVER changed automatically.
 *
 * Session-only state (pending suggestion + per-dataset dismiss set) lives in
 * a lightweight Zustand store without persistence so it resets on reload —
 * the same pattern as usePaletteSuggestion.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { useTerrainStore } from "@/lib/terrainStore";
import { isShallowDataset } from "@/lib/shallowDataset";

interface ShallowSuggestionState {
  /** datasetId of the pending suggestion, or null when none. */
  suggestionDatasetId: string | null;
  /**
   * datasetIds whose shallow suggestion has already been shown and resolved
   * (dismissed or applied) this session. Ensures the banner appears at most
   * once per dataset.
   */
  dismissedDatasetIds: Set<string>;

  setSuggestion: (datasetId: string | null) => void;
  dismiss: () => void;
  clear: () => void;
  isDismissed: (datasetId: string | null) => boolean;
}

export const useShallowSuggestionStore = create<ShallowSuggestionState>(
  (set, get) => ({
    suggestionDatasetId: null,
    dismissedDatasetIds: new Set(),

    setSuggestion: (suggestionDatasetId) => set({ suggestionDatasetId }),

    dismiss: () => {
      const { suggestionDatasetId, dismissedDatasetIds } = get();
      if (suggestionDatasetId) {
        const next = new Set(dismissedDatasetIds);
        next.add(suggestionDatasetId);
        set({ dismissedDatasetIds: next, suggestionDatasetId: null });
      } else {
        set({ suggestionDatasetId: null });
      }
    },

    clear: () => set({ suggestionDatasetId: null }),

    isDismissed: (datasetId) => {
      if (!datasetId) return false;
      return get().dismissedDatasetIds.has(datasetId);
    },
  }),
);

/**
 * Mount once (ShallowDatasetBanner calls it) so the detection pipeline runs
 * whenever the active grid changes.
 */
export function useShallowSuggestion(): void {
  const activeGrid = useTerrainStore((s) => s.activeGrid);
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);

  useEffect(() => {
    const store = useShallowSuggestionStore.getState();
    if (!activeGrid) {
      store.clear();
      return;
    }
    const datasetId =
      primaryDatasetId ?? (activeGrid.datasetId as string | undefined) ?? null;
    if (!datasetId) return;

    if (!isShallowDataset(activeGrid.minDepth, activeGrid.maxDepth)) {
      store.clear();
      return;
    }
    if (store.isDismissed(datasetId)) return;
    if (store.suggestionDatasetId !== datasetId) {
      store.setSuggestion(datasetId);
    }
  }, [activeGrid, primaryDatasetId]);
}
