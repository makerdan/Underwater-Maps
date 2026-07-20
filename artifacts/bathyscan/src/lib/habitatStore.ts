/**
 * habitatStore.ts — Zustand store for habitat suitability scoring.
 *
 * Holds the active species, computed score array, and extracted hotspots.
 * Scoring results are memoised per-species so switching back is instant.
 * Call compute() whenever the terrain or zone map changes.
 *
 * `scores` uses `RemoteData<Float32Array>` — a PoC migration from the former
 * `scores: Float32Array | null` nullable field.  The discriminated union makes
 * every async state explicit and unrepresentable-invalid:
 *
 *   - `idle`    — no species selected, or species set but grid not yet available
 *   - `loading` — (reserved for a future async compute path)
 *   - `done`    — scores available at `scores.data`
 *   - `error`   — compute failed (should not happen in practice, but is modelled)
 *
 * Consumers narrow with `if (scores.status === 'done') { use scores.data }`.
 */
import { create } from "zustand";
import type { TerrainData } from "@workspace/api-client-react";
import { RemoteData } from "@workspace/shared-types";
import type { RemoteData as RemoteDataT } from "@workspace/shared-types";
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
  /** Score array for the active species. Use `.status === 'done'` to access `.data`. */
  scores: RemoteDataT<Float32Array>;
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
  scores: RemoteData.idle(),
  hotspots: [],
  scoreCache: new Map(),

  setSpecies: (id, grid, zoneMap) => {
    if (id === null) {
      set({ activeSpecies: null, scores: RemoteData.idle(), hotspots: [] });
      return;
    }

    const cache = get().scoreCache;
    const cached = cache.get(id);

    if (cached) {
      set({ activeSpecies: id, scores: RemoteData.done(cached.scores), hotspots: cached.hotspots });
      return;
    }

    set({ activeSpecies: id, scores: RemoteData.idle(), hotspots: [] });
    if (grid) {
      get().compute(grid, zoneMap ?? null);
    }
  },

  compute: (grid, zoneMap) => {
    const { activeSpecies, scoreCache } = get();
    if (!activeSpecies) return;

    const config: SpeciesConfig | undefined = SPECIES_CONFIGS[activeSpecies];
    if (!config) return;

    const cached = scoreCache.get(activeSpecies);
    if (cached) {
      set({ scores: RemoteData.done(cached.scores), hotspots: cached.hotspots });
      return;
    }

    try {
      const scores = computeHabitatScore(grid, zoneMap, config);
      const hotspots = extractHotspots(scores, grid, zoneMap);

      const newCache = new Map(scoreCache);
      newCache.set(activeSpecies, { scores, hotspots });
      set({ scores: RemoteData.done(scores), hotspots, scoreCache: newCache });
    } catch (err) {
      set({ scores: RemoteData.error(err instanceof Error ? err : new Error(String(err))) });
    }
  },

  clear: () =>
    set({ activeSpecies: null, scores: RemoteData.idle(), hotspots: [], scoreCache: new Map() }),
}));
