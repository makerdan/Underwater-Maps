/**
 * habitat.ts — Client-side habitat suitability scoring for seafloor species.
 *
 * Uses terrain geometry alone (no live oceanographic data):
 *   - Depth suitability (trapezoid function per species)
 *   - Substrate suitability (AI zone map, with depth-heuristic fallback)
 *   - Slope suitability (gentle vs steep preference)
 *   - Structural complexity (local depth variance)
 *   - Edge proximity (zone boundary ecotones)
 *
 * All functions are pure — suitable for useMemo and unit testing.
 */
import type { TerrainData } from "@workspace/api-client-react";
import { SALTWATER_ZONES, FRESHWATER_ZONES } from "./zoneMap";

// ---------------------------------------------------------------------------
// Species configuration types
// ---------------------------------------------------------------------------

export type SaltwaterSpeciesId =
  | "dungeness_crab"
  | "demersal_fish"
  | "rockfish"
  | "halibut"
  | "salmon_resting";

export type FreshwaterSpeciesId =
  | "lake_trout"
  | "walleye"
  | "largemouth_bass"
  | "channel_catfish"
  | "northern_pike"
  | "yellow_perch";

export type SpeciesId = SaltwaterSpeciesId | FreshwaterSpeciesId;

export interface SpeciesConfig {
  label: string;
  waterType: "saltwater" | "freshwater";
  depthOptimal: [number, number];
  depthTolerance: [number, number];
  substratePreferences: Partial<Record<string, number>>;
  slopePreference: "gentle" | "steep" | "any";
  complexityWeight: number;
  edgeWeight: number;
  weights: {
    depth: number;
    substrate: number;
    slope: number;
    complexity: number;
    edge: number;
  };
}

// ---------------------------------------------------------------------------
// Species configs
// ---------------------------------------------------------------------------

export const SPECIES_CONFIGS: Record<SpeciesId, SpeciesConfig> = {
  // ── Saltwater ──────────────────────────────────────────────────────────────
  dungeness_crab: {
    label: "Dungeness Crab",
    waterType: "saltwater",
    depthOptimal: [10, 120],
    depthTolerance: [5, 180],
    substratePreferences: {
      sandy_shelf: 1.0,
      coarse_sediment: 0.7,
      silt_plain: 0.4,
      basalt_rock: 0.1,
      volcanic_vent_field: 0.1,
      trench_wall: 0.1,
      seamount_flank: 0.4,
      coral_reef_potential: 0.6,
      aquatic_vegetation: 0.8,
      sandy_lake_bed: 1.0,
      rocky_shoreline: 0.2,
      silt_deep: 0.3,
      gravel_bed: 0.7,
      bedrock_shelf: 0.2,
      submerged_wood: 0.5,
      clay_flat: 0.3,
    },
    slopePreference: "gentle",
    complexityWeight: 0.2,
    edgeWeight: 0.3,
    weights: { depth: 0.35, substrate: 0.30, slope: 0.15, complexity: 0.10, edge: 0.10 },
  },

  demersal_fish: {
    label: "Demersal Fish (General)",
    waterType: "saltwater",
    depthOptimal: [30, 300],
    depthTolerance: [10, 600],
    substratePreferences: {
      sandy_shelf: 0.7,
      coarse_sediment: 0.6,
      silt_plain: 0.8,
      basalt_rock: 0.5,
      volcanic_vent_field: 0.3,
      trench_wall: 0.4,
      seamount_flank: 0.7,
      coral_reef_potential: 0.9,
      aquatic_vegetation: 0.6,
      sandy_lake_bed: 0.7,
      rocky_shoreline: 0.5,
      silt_deep: 0.8,
      gravel_bed: 0.6,
      bedrock_shelf: 0.5,
      submerged_wood: 0.7,
      clay_flat: 0.7,
    },
    slopePreference: "any",
    complexityWeight: 0.3,
    edgeWeight: 0.4,
    weights: { depth: 0.30, substrate: 0.25, slope: 0.10, complexity: 0.20, edge: 0.15 },
  },

  rockfish: {
    label: "Rockfish",
    waterType: "saltwater",
    depthOptimal: [50, 400],
    depthTolerance: [20, 800],
    substratePreferences: {
      sandy_shelf: 0.2,
      coarse_sediment: 0.5,
      silt_plain: 0.3,
      basalt_rock: 1.0,
      volcanic_vent_field: 0.7,
      trench_wall: 0.8,
      seamount_flank: 0.9,
      coral_reef_potential: 0.8,
      aquatic_vegetation: 0.3,
      sandy_lake_bed: 0.2,
      rocky_shoreline: 1.0,
      silt_deep: 0.2,
      gravel_bed: 0.6,
      bedrock_shelf: 0.9,
      submerged_wood: 0.5,
      clay_flat: 0.2,
    },
    slopePreference: "steep",
    complexityWeight: 0.4,
    edgeWeight: 0.3,
    weights: { depth: 0.25, substrate: 0.30, slope: 0.20, complexity: 0.15, edge: 0.10 },
  },

  halibut: {
    label: "Halibut",
    waterType: "saltwater",
    depthOptimal: [20, 200],
    depthTolerance: [5, 400],
    substratePreferences: {
      sandy_shelf: 0.8,
      coarse_sediment: 0.5,
      silt_plain: 1.0,
      basalt_rock: 0.2,
      volcanic_vent_field: 0.1,
      trench_wall: 0.2,
      seamount_flank: 0.4,
      coral_reef_potential: 0.5,
      aquatic_vegetation: 0.5,
      sandy_lake_bed: 0.8,
      rocky_shoreline: 0.2,
      silt_deep: 1.0,
      gravel_bed: 0.5,
      bedrock_shelf: 0.2,
      submerged_wood: 0.4,
      clay_flat: 0.9,
    },
    slopePreference: "gentle",
    complexityWeight: 0.15,
    edgeWeight: 0.35,
    weights: { depth: 0.35, substrate: 0.30, slope: 0.20, complexity: 0.05, edge: 0.10 },
  },

  salmon_resting: {
    label: "Salmon (Resting)",
    waterType: "saltwater",
    depthOptimal: [5, 50],
    depthTolerance: [0, 100],
    substratePreferences: {
      sandy_shelf: 0.9,
      coarse_sediment: 0.6,
      silt_plain: 0.5,
      basalt_rock: 0.3,
      volcanic_vent_field: 0.1,
      trench_wall: 0.2,
      seamount_flank: 0.4,
      coral_reef_potential: 0.7,
      aquatic_vegetation: 1.0,
      sandy_lake_bed: 0.9,
      rocky_shoreline: 0.7,
      silt_deep: 0.4,
      gravel_bed: 0.8,
      bedrock_shelf: 0.6,
      submerged_wood: 0.8,
      clay_flat: 0.3,
    },
    slopePreference: "gentle",
    complexityWeight: 0.25,
    edgeWeight: 0.35,
    weights: { depth: 0.35, substrate: 0.25, slope: 0.15, complexity: 0.10, edge: 0.15 },
  },

  // ── Freshwater ────────────────────────────────────────────────────────────
  lake_trout: {
    label: "Lake Trout",
    waterType: "freshwater",
    depthOptimal: [30, 100],
    depthTolerance: [10, 200],
    substratePreferences: {
      aquatic_vegetation: 0.3,
      sandy_lake_bed: 0.5,
      rocky_shoreline: 0.9,
      silt_deep: 0.4,
      gravel_bed: 0.8,
      bedrock_shelf: 1.0,
      submerged_wood: 0.6,
      clay_flat: 0.2,
    },
    slopePreference: "steep",
    complexityWeight: 0.4,
    edgeWeight: 0.3,
    weights: { depth: 0.30, substrate: 0.30, slope: 0.18, complexity: 0.12, edge: 0.10 },
  },

  walleye: {
    label: "Walleye",
    waterType: "freshwater",
    depthOptimal: [5, 40],
    depthTolerance: [2, 80],
    substratePreferences: {
      aquatic_vegetation: 0.5,
      sandy_lake_bed: 0.8,
      rocky_shoreline: 0.7,
      silt_deep: 0.5,
      gravel_bed: 0.9,
      bedrock_shelf: 0.6,
      submerged_wood: 0.7,
      clay_flat: 0.4,
    },
    slopePreference: "gentle",
    complexityWeight: 0.25,
    edgeWeight: 0.45,
    weights: { depth: 0.30, substrate: 0.28, slope: 0.12, complexity: 0.12, edge: 0.18 },
  },

  largemouth_bass: {
    label: "Largemouth Bass",
    waterType: "freshwater",
    depthOptimal: [1, 8],
    depthTolerance: [0, 18],
    substratePreferences: {
      aquatic_vegetation: 1.0,
      sandy_lake_bed: 0.5,
      rocky_shoreline: 0.6,
      silt_deep: 0.3,
      gravel_bed: 0.6,
      bedrock_shelf: 0.4,
      submerged_wood: 1.0,
      clay_flat: 0.3,
    },
    slopePreference: "gentle",
    complexityWeight: 0.35,
    edgeWeight: 0.4,
    weights: { depth: 0.30, substrate: 0.30, slope: 0.10, complexity: 0.15, edge: 0.15 },
  },

  channel_catfish: {
    label: "Channel Catfish",
    waterType: "freshwater",
    depthOptimal: [3, 25],
    depthTolerance: [1, 50],
    substratePreferences: {
      aquatic_vegetation: 0.4,
      sandy_lake_bed: 0.7,
      rocky_shoreline: 0.4,
      silt_deep: 1.0,
      gravel_bed: 0.6,
      bedrock_shelf: 0.3,
      submerged_wood: 0.8,
      clay_flat: 1.0,
    },
    slopePreference: "gentle",
    complexityWeight: 0.2,
    edgeWeight: 0.3,
    weights: { depth: 0.30, substrate: 0.35, slope: 0.10, complexity: 0.10, edge: 0.15 },
  },

  northern_pike: {
    label: "Northern Pike",
    waterType: "freshwater",
    depthOptimal: [1, 6],
    depthTolerance: [0, 15],
    substratePreferences: {
      aquatic_vegetation: 1.0,
      sandy_lake_bed: 0.4,
      rocky_shoreline: 0.5,
      silt_deep: 0.2,
      gravel_bed: 0.5,
      bedrock_shelf: 0.3,
      submerged_wood: 0.9,
      clay_flat: 0.2,
    },
    slopePreference: "gentle",
    complexityWeight: 0.3,
    edgeWeight: 0.4,
    weights: { depth: 0.30, substrate: 0.30, slope: 0.10, complexity: 0.15, edge: 0.15 },
  },

  yellow_perch: {
    label: "Yellow Perch",
    waterType: "freshwater",
    depthOptimal: [3, 20],
    depthTolerance: [1, 40],
    substratePreferences: {
      aquatic_vegetation: 0.7,
      sandy_lake_bed: 0.9,
      rocky_shoreline: 0.6,
      silt_deep: 0.5,
      gravel_bed: 0.8,
      bedrock_shelf: 0.5,
      submerged_wood: 0.7,
      clay_flat: 0.5,
    },
    slopePreference: "any",
    complexityWeight: 0.25,
    edgeWeight: 0.4,
    weights: { depth: 0.28, substrate: 0.28, slope: 0.12, complexity: 0.14, edge: 0.18 },
  },
};

export const SPECIES_IDS = Object.keys(SPECIES_CONFIGS) as SpeciesId[];

export const SALTWATER_SPECIES_IDS: SaltwaterSpeciesId[] = [
  "dungeness_crab",
  "demersal_fish",
  "rockfish",
  "halibut",
  "salmon_resting",
];

export const FRESHWATER_SPECIES_IDS: FreshwaterSpeciesId[] = [
  "lake_trout",
  "walleye",
  "largemouth_bass",
  "channel_catfish",
  "northern_pike",
  "yellow_perch",
];

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

/**
 * Trapezoid depth suitability:
 * - 1.0 inside optimal range
 * - Linear taper between tolerance and optimal edges
 * - 0.0 outside tolerance range
 */
export function depthSuitability(depth: number, config: SpeciesConfig): number {
  const [optMin, optMax] = config.depthOptimal;
  const [tolMin, tolMax] = config.depthTolerance;
  if (depth < tolMin || depth > tolMax) return 0;
  if (depth >= optMin && depth <= optMax) return 1;
  if (depth < optMin) {
    return (depth - tolMin) / Math.max(1, optMin - tolMin);
  }
  return 1 - (depth - optMax) / Math.max(1, tolMax - optMax);
}

/**
 * Substrate suitability from zone index.
 * Uses substratePreferences map; returns 0.5 if no preference is specified.
 */
export function substrateSuitability(
  zoneIndex: number,
  config: SpeciesConfig,
  zones: readonly string[],
): number {
  const label = zones[zoneIndex];
  if (label === undefined) return 0.5;
  return config.substratePreferences[label] ?? 0.5;
}

/**
 * Slope suitability.
 * gentle: 1.0 at 0°, tapers to 0 at 15°+
 * steep:  0.0 at 0°, rises to 1.0 at 30°+
 * any:    always 1.0
 */
export function slopeSuitability(slopeDeg: number, config: SpeciesConfig): number {
  if (config.slopePreference === "gentle") {
    return Math.max(0, 1 - slopeDeg / 15);
  }
  if (config.slopePreference === "steep") {
    return Math.min(1, slopeDeg / 30);
  }
  return 1;
}

/**
 * Structural complexity: std-dev of depth in a 5×5 neighbourhood.
 * Returns [0,1] normalised by 100 m std-dev as a reasonable maximum.
 */
export function structuralComplexity(
  grid: TerrainData,
  col: number,
  row: number,
): number {
  const N = grid.resolution;
  const radius = 2;
  const samples: number[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const r = Math.max(0, Math.min(N - 1, row + dr));
      const c = Math.max(0, Math.min(N - 1, col + dc));
      samples.push(grid.depths[r * N + c] ?? 0);
    }
  }
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.min(1, Math.sqrt(variance) / 100);
}

/**
 * Edge proximity: fraction of the 8 neighbours that belong to a different zone.
 * Returns [0,1]; high values indicate zone boundary ecotones.
 */
export function edgeProximity(
  zoneMap: Uint8Array,
  N: number,
  col: number,
  row: number,
): number {
  const centre = zoneMap[row * N + col] ?? 0;
  let different = 0;
  let total = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= N || c < 0 || c >= N) continue;
      total++;
      if ((zoneMap[r * N + c] ?? 0) !== centre) different++;
    }
  }
  return total > 0 ? different / total : 0;
}

// ---------------------------------------------------------------------------
// Slope precomputation (matches computeSlopeAttribute in terrain.ts)
// ---------------------------------------------------------------------------

function precomputeSlopes(grid: TerrainData): Float32Array {
  const N = grid.resolution;
  const { depths, minDepth, maxDepth } = grid;
  const depthRange = (maxDepth - minDepth) || 1;
  const worldStep = 100 / Math.max(1, N - 1);
  const MAX_DEPTH_WORLD = 50;
  const slopes = new Float32Array(N * N);

  const tOf = (r: number, c: number): number => {
    const d = depths[Math.max(0, Math.min(N - 1, r)) * N + Math.max(0, Math.min(N - 1, c))] ?? 0;
    return (d - minDepth) / depthRange;
  };

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const r0 = Math.max(0, row - 1);
      const r1 = Math.min(N - 1, row + 1);
      const c0 = Math.max(0, col - 1);
      const c1 = Math.min(N - 1, col + 1);
      const dH = (col === 0 || col === N - 1 ? 1 : 2) * worldStep;
      const dV = (row === 0 || row === N - 1 ? 1 : 2) * worldStep;
      const dtX = (tOf(row, c1) - tOf(row, c0)) * MAX_DEPTH_WORLD;
      const dtZ = (tOf(r1, col) - tOf(r0, col)) * MAX_DEPTH_WORLD;
      const slopeX = Math.abs(dtX / dH);
      const slopeZ = Math.abs(dtZ / dV);
      slopes[row * N + col] =
        (Math.atan(Math.sqrt(slopeX * slopeX + slopeZ * slopeZ)) * 180) / Math.PI;
    }
  }
  return slopes;
}

/** Fallback substrate score when no zoneMap is available (uses normalised depth). */
function depthZoneHeuristic(t: number, config: SpeciesConfig): number {
  const shallow = config.substratePreferences["sandy_shelf"] ?? config.substratePreferences["sandy_lake_bed"] ?? 0.5;
  const deep = config.substratePreferences["silt_plain"] ?? config.substratePreferences["silt_deep"] ?? 0.5;
  return Math.max(0, Math.min(1, shallow * (1 - t) + deep * t));
}

// ---------------------------------------------------------------------------
// Main scoring pass
// ---------------------------------------------------------------------------

/**
 * Compute per-cell habitat suitability scores.
 * Returns a Float32Array of length N×N with values in [0,1].
 * Suitable for uploading to a THREE.DataTexture.
 */
export function computeHabitatScore(
  grid: TerrainData,
  zoneMap: Uint8Array | null,
  config: SpeciesConfig,
): Float32Array {
  const N = grid.resolution;
  const { minDepth, maxDepth } = grid;
  const depthRange = (maxDepth - minDepth) || 1;
  const scores = new Float32Array(N * N);

  const waterType = grid.waterType as "saltwater" | "freshwater";
  const zones = waterType === "freshwater" ? FRESHWATER_ZONES : SALTWATER_ZONES;
  const hasZoneMap = !!zoneMap && zoneMap.length === N * N;
  const slopeDeg = precomputeSlopes(grid);
  const w = config.weights;

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const idx = row * N + col;
      const depth = grid.depths[idx] ?? minDepth;

      const dScore = depthSuitability(depth, config);

      let sScore: number;
      if (hasZoneMap) {
        sScore = substrateSuitability(zoneMap![idx] ?? 0, config, zones);
      } else {
        const t = (depth - minDepth) / depthRange;
        sScore = depthZoneHeuristic(t, config);
      }

      const slScore = slopeSuitability(slopeDeg[idx] ?? 0, config);

      const cScore = structuralComplexity(grid, col, row);

      const eScore = hasZoneMap
        ? edgeProximity(zoneMap!, N, col, row)
        : 0;

      scores[idx] = Math.min(
        1,
        Math.max(
          0,
          w.depth * dScore +
          w.substrate * sScore +
          w.slope * slScore +
          w.complexity * cScore +
          w.edge * eScore,
        ),
      );
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Hotspot extraction
// ---------------------------------------------------------------------------

export interface HotspotCandidate {
  row: number;
  col: number;
  score: number;
  depth: number;
  zoneLabel: string;
  lon: number;
  lat: number;
}

/**
 * Extract up to 10 hotspot candidates from habitat scores descending.
 * Each candidate must have score > minScore and be at least minSpacing
 * grid cells from any previously selected candidate.
 */
export function extractHotspots(
  scores: Float32Array,
  grid: TerrainData,
  zoneMap: Uint8Array | null,
  minScore: number = 0.75,
  minSpacing: number = 5,
): HotspotCandidate[] {
  const N = grid.resolution;
  const waterType = grid.waterType as "saltwater" | "freshwater";
  const zones = waterType === "freshwater" ? FRESHWATER_ZONES : SALTWATER_ZONES;
  const lonRange = grid.maxLon - grid.minLon;
  const latRange = grid.maxLat - grid.minLat;

  // Sort indices descending by score
  const indices = Array.from({ length: N * N }, (_, i) => i);
  indices.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

  const candidates: HotspotCandidate[] = [];

  for (const idx of indices) {
    const score = scores[idx] ?? 0;
    if (score <= minScore) break;

    const row = Math.floor(idx / N);
    const col = idx % N;

    const tooClose = candidates.some((c) => {
      const dr = c.row - row;
      const dc = c.col - col;
      return Math.sqrt(dr * dr + dc * dc) < minSpacing;
    });
    if (tooClose) continue;

    const depth = grid.depths[idx] ?? 0;
    const zoneIdx = zoneMap ? (zoneMap[idx] ?? 0) : 0;
    const zoneLabel = zones[zoneIdx] ?? "unknown";
    const lon = grid.minLon + (N > 1 ? (col / (N - 1)) : 0) * lonRange;
    const lat = grid.minLat + (N > 1 ? (row / (N - 1)) : 0) * latRange;

    candidates.push({ row, col, score, depth, zoneLabel, lon, lat });
    if (candidates.length >= 10) break;
  }

  return candidates;
}
