/**
 * habitatStore.ts — Zustand store for habitat suitability scoring.
 *
 * Holds the active species, computed score array, and extracted hotspots.
 * Scoring results are memoised per-species so switching back is instant.
 * Call compute() whenever the terrain or zone map changes.
 */
import { create } from "zustand";
import type { TerrainData } from "@workspace/api-client-react";
import {
  computeHabitatScore,
  extractHotspots,
  SPECIES_CONFIGS,
} from "./habitat";
import type { SpeciesId, HotspotCandidate, SpeciesConfig } from "./habitat";

interface CacheEntry {
  scores: Float32Array;
  hotspots: HotspotCandidate[];
}

interface HabitatState {
  activeSpecies: SpeciesId | null;
  scores: Float32Array | null;
  hotspots: HotspotCandidate[];
  /** Per-species memo cache — cleared when terrain changes. */
  scoreCache: Map<SpeciesId, CacheEntry>;

  /** Select a species (computes if grid is available; loads from cache if hit). */
  setSpecies: (id: SpeciesId | null, grid?: TerrainData, zoneMap?: Uint8Array | null) => void;
  /** Run scoring for the active species. */
  compute: (grid: TerrainData, zoneMap: Uint8Array | null) => void;
  /** Clear all state + cache (call when a new terrain loads). */
  clear: () => void;
}

export const useHabitatStore = create<HabitatState>((set, get) => ({
  activeSpecies: null,
  scores: null,
  hotspots: [],
  scoreCache: new Map(),

  setSpecies: (id, grid, zoneMap) => {
    if (id === null) {
      set({ activeSpecies: null, scores: null, hotspots: [] });
      return;
    }

    const cache = get().scoreCache;
    const cached = cache.get(id);

    if (cached) {
      set({ activeSpecies: id, scores: cached.scores, hotspots: cached.hotspots });
      return;
    }

    // No cache hit — set the id first, then compute if grid is available
    set({ activeSpecies: id, scores: null, hotspots: [] });
    if (grid) {
      get().compute(grid, zoneMap ?? null);
    }
  },

  compute: (grid, zoneMap) => {
    const { activeSpecies, scoreCache } = get();
    if (!activeSpecies) return;

    const config: SpeciesConfig | undefined = SPECIES_CONFIGS[activeSpecies];
    if (!config) return;

    // Cache hit — serve instantly
    const cached = scoreCache.get(activeSpecies);
    if (cached) {
      set({ scores: cached.scores, hotspots: cached.hotspots });
      return;
    }

    // Compute
    const scores = computeHabitatScore(grid, zoneMap, config);
    const hotspots = extractHotspots(scores, grid, zoneMap);

    const newCache = new Map(scoreCache);
    newCache.set(activeSpecies, { scores, hotspots });
    set({ scores, hotspots, scoreCache: newCache });
  },

  clear: () =>
    set({ activeSpecies: null, scores: null, hotspots: [], scoreCache: new Map() }),
}));
