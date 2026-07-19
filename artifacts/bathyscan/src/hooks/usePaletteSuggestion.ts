/**
 * usePaletteSuggestion — watches the active terrain grid and drives the
 * adaptive-palette suggestion pipeline.
 *
 * On every dataset load (activeGrid changes to a non-null value):
 *   1. Compute the depth profile from the mesh vertex data.
 *   2. Run the suggestion engine → { theme, bandBoundaries }.
 *   3a. If the user has NEVER manually chosen a palette (colormapUserSet ===
 *       false), auto-apply silently and do NOT show a banner.
 *   3b. If the user HAS a custom palette active, make the suggestion
 *       available for the PaletteSuggestionBanner (unless this dataset's
 *       suggestion was already dismissed this session).
 *
 * Session-only state (suggestion + per-dataset dismiss set) lives in a
 * lightweight Zustand store without persistence so it always resets on
 * page reload.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { useTerrainStore } from "@/lib/terrainStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { usePaletteStore } from "@/lib/paletteStore";
import { computeDepthProfile, suggestColormap, type ColormapSuggestion } from "@/lib/depthProfile";

// ─── Session-only suggestion store ───────────────────────────────────────────

interface PaletteSuggestionState {
  /** Current pending suggestion (null when no dataset loaded or auto-applied). */
  suggestion: ColormapSuggestion | null;
  /** The datasetId that produced the pending suggestion. */
  suggestionDatasetId: string | null;
  /**
   * Set of datasetIds whose suggestions the user has dismissed this session.
   * Keyed by datasetId so dismissal persists across dataset switches and
   * component remounts, but resets on page reload.
   */
  dismissedDatasetIds: Set<string>;

  setSuggestion: (s: ColormapSuggestion | null, datasetId: string | null) => void;
  dismiss: () => void;
  clear: () => void;
  /** Returns true if the given datasetId has been dismissed this session. */
  isDismissed: (datasetId: string | null) => boolean;
}

export const usePaletteSuggestionStore = create<PaletteSuggestionState>((set, get) => ({
  suggestion: null,
  suggestionDatasetId: null,
  dismissedDatasetIds: new Set(),

  setSuggestion: (suggestion, suggestionDatasetId) => {
    set({ suggestion, suggestionDatasetId });
  },

  dismiss: () => {
    const { suggestionDatasetId, dismissedDatasetIds } = get();
    if (suggestionDatasetId) {
      const next = new Set(dismissedDatasetIds);
      next.add(suggestionDatasetId);
      set({ dismissedDatasetIds: next });
    }
  },

  clear: () => set({ suggestion: null, suggestionDatasetId: null }),

  isDismissed: (datasetId) => {
    if (!datasetId) return false;
    return get().dismissedDatasetIds.has(datasetId);
  },
}));

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mount this once at the app root (alongside useServerSettingsSync) so the
 * suggestion pipeline runs continuously while the app is open.
 */
export function usePaletteSuggestion(): void {
  const activeGrid = useTerrainStore((s) => s.activeGrid);
  const primaryDatasetId = useTerrainStore((s) => s.primaryDatasetId);

  useEffect(() => {
    if (!activeGrid?.depths || activeGrid.depths.length === 0) return;

    const profile = computeDepthProfile(activeGrid.depths.filter((d): d is number => d !== null));
    if (!profile) return;

    const suggestion = suggestColormap(profile, activeGrid.waterType ?? undefined);
    const { colormapUserSet, setColormapTheme } = useSettingsStore.getState();
    const { setBandBoundaries } = usePaletteStore.getState();

    if (!colormapUserSet) {
      setColormapTheme(suggestion.theme);
      setBandBoundaries(suggestion.bandBoundaries);
      usePaletteSuggestionStore.getState().clear();
    } else {
      usePaletteSuggestionStore.getState().setSuggestion(suggestion, primaryDatasetId);
    }
  }, [activeGrid, primaryDatasetId]);
}
