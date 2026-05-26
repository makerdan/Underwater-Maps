/**
 * Substrate grid sampling for the AI zone classifier.
 *
 * For a given preset dataset, samples the bundled ShoreZone + NOAA ENC
 * substrate polygons onto the 32×32 classification grid the AI / heuristic
 * classifier operates on. Returns a per-cell label grid (or null where no
 * substrate polygon covers the cell), a coverage mask, a compact fingerprint
 * used as part of the zone-cache key, and an aggregate summary the prompt
 * can show the model.
 *
 * Cells that fall outside any substrate polygon are reported as `null`
 * (unknown) rather than fabricated — the classifier can then fall back to
 * pure geological reasoning for those cells.
 *
 * For unknown datasets (no preset bbox, e.g. user uploads) the function
 * returns a no-coverage result. Heuristic / AI behaviour for those datasets
 * is identical to today.
 */
import type { Bbox, ShoreZoneFeature, ShoreZoneSubstrate } from "./shoreZoneData.js";
import { getSubstrateForDataset } from "./shoreZoneData.js";
import { ALL_PRESET_DATASETS } from "./terrain.js";

export const SUBSTRATE_GRID_W = 32;
export const SUBSTRATE_GRID_H = 32;
const N = SUBSTRATE_GRID_W * SUBSTRATE_GRID_H;

export interface SubstrateGridSample {
  /** Per-cell dominant substrate class, or null when no polygon covers the cell. */
  labels: (ShoreZoneSubstrate | null)[];
  /** Per-cell coverage flag aligned with `labels`. */
  mask: boolean[];
  /** Number of cells with a known substrate label. */
  coveredCount: number;
  /** Coverage as a 0..1 fraction. */
  coverageFraction: number;
  /** Aggregate counts per substrate class for the prompt summary. */
  counts: Record<ShoreZoneSubstrate, number>;
  /**
   * 8-char hex fingerprint of the label+mask grid. "00000000" when no
   * substrate coverage at all — used as part of the zone-cache key so a
   * change in substrate coverage invalidates stale classifications.
   */
  fingerprint: string;
  /** True when at least one cell has a known substrate label. */
  hasCoverage: boolean;
}

const EMPTY_COUNTS: Record<ShoreZoneSubstrate, number> = {
  bedrock: 0,
  gravel: 0,
  sand: 0,
  mud: 0,
};

function emptySample(): SubstrateGridSample {
  return {
    labels: new Array(N).fill(null),
    mask: new Array(N).fill(false),
    coveredCount: 0,
    coverageFraction: 0,
    counts: { ...EMPTY_COUNTS },
    fingerprint: "00000000",
    hasCoverage: false,
  };
}

interface FeatureBox {
  feature: ShoreZoneFeature;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function ringBbox(ring: number[][]): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const c of ring) {
    const lon = c[0] as number, lat = c[1] as number;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function computeFeatureBbox(f: ShoreZoneFeature): FeatureBox {
  const polys: number[][][][] =
    f.geometry.type === "Polygon"
      ? [f.geometry.coordinates]
      : f.geometry.coordinates;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      const b = ringBbox(ring);
      if (b.minLon < minLon) minLon = b.minLon;
      if (b.minLat < minLat) minLat = b.minLat;
      if (b.maxLon > maxLon) maxLon = b.maxLon;
      if (b.maxLat > maxLat) maxLat = b.maxLat;
    }
  }
  return { feature: f, minLon, minLat, maxLon, maxLat };
}

/** Ray-casting point-in-polygon for a single ring. */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as number[];
    const b = ring[j] as number[];
    const xi = a[0] as number, yi = a[1] as number;
    const xj = b[0] as number, yj = b[1] as number;
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True when (lon,lat) is inside any outer ring (and not inside a hole). */
function pointInFeature(lon: number, lat: number, f: ShoreZoneFeature): boolean {
  const polys: number[][][][] =
    f.geometry.type === "Polygon"
      ? [f.geometry.coordinates]
      : f.geometry.coordinates;
  for (const rings of polys) {
    const outer = rings[0];
    if (!outer) continue;
    if (!pointInRing(lon, lat, outer)) continue;
    let inHole = false;
    for (let h = 1; h < rings.length; h++) {
      if (pointInRing(lon, lat, rings[h] as number[][])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const CLASS_CHAR: Record<ShoreZoneSubstrate, string> = {
  bedrock: "B",
  gravel: "G",
  sand: "S",
  mud: "M",
};

function bboxForDataset(datasetId: string): Bbox | null {
  const meta = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
  if (!meta) return null;
  return meta.bbox;
}

/**
 * Sample bundled substrate polygons onto the 32×32 classification grid for a
 * given dataset id. For datasets without a known preset bbox, or whose AOI
 * has no substrate coverage, returns an empty sample (fingerprint
 * "00000000", no coverage) so callers can short-circuit cleanly.
 *
 * Cell (row, col) covers a rectangular lat/lon sub-cell of the dataset bbox
 * with row 0 at the north (maxLat) edge and col 0 at the west (minLon) edge,
 * matching the depth-grid orientation produced by `buildTerrainGrid`.
 */
export function sampleSubstrateGrid(datasetId: string): SubstrateGridSample {
  const bbox = bboxForDataset(datasetId);
  if (!bbox) return emptySample();

  const slice = getSubstrateForDataset(datasetId, bbox);
  if (!slice.hasCoverage || slice.features.length === 0) return emptySample();

  // Pre-compute feature bboxes once; reuse for every cell.
  const boxed: FeatureBox[] = slice.features.map(computeFeatureBbox);

  const labels: (ShoreZoneSubstrate | null)[] = new Array(N).fill(null);
  const mask: boolean[] = new Array(N).fill(false);
  const counts: Record<ShoreZoneSubstrate, number> = { ...EMPTY_COUNTS };
  let coveredCount = 0;

  const lonRange = bbox.maxLon - bbox.minLon;
  const latRange = bbox.maxLat - bbox.minLat;

  for (let row = 0; row < SUBSTRATE_GRID_H; row++) {
    const lat = bbox.maxLat - ((row + 0.5) / SUBSTRATE_GRID_H) * latRange;
    for (let col = 0; col < SUBSTRATE_GRID_W; col++) {
      const lon = bbox.minLon + ((col + 0.5) / SUBSTRATE_GRID_W) * lonRange;
      const idx = row * SUBSTRATE_GRID_W + col;
      for (const fb of boxed) {
        if (lon < fb.minLon || lon > fb.maxLon || lat < fb.minLat || lat > fb.maxLat) continue;
        if (!pointInFeature(lon, lat, fb.feature)) continue;
        const sub = fb.feature.properties.substrate;
        labels[idx] = sub;
        mask[idx] = true;
        counts[sub]++;
        coveredCount++;
        break;
      }
    }
  }

  if (coveredCount === 0) return emptySample();

  // Fingerprint: per-cell char ('.' uncovered, B/G/S/M covered).
  let fpStr = "";
  for (let i = 0; i < N; i++) {
    fpStr += labels[i] ? CLASS_CHAR[labels[i] as ShoreZoneSubstrate] : ".";
  }
  return {
    labels,
    mask,
    coveredCount,
    coverageFraction: coveredCount / N,
    counts,
    fingerprint: fnv1a32(fpStr),
    hasCoverage: true,
  };
}

// ---------------------------------------------------------------------------
// Substrate → zone-label mappings
// ---------------------------------------------------------------------------

/**
 * Map a CMECS broad substrate class to the closest matching saltwater zone
 * label. Used to ground both the AI prompt and the heuristic fallback for
 * cells with known substrate coverage.
 */
export const SUBSTRATE_TO_SALTWATER_ZONE: Record<ShoreZoneSubstrate, string> = {
  bedrock: "basalt_rock",
  gravel: "coarse_sediment",
  sand: "sandy_shelf",
  mud: "silt_plain",
};

/**
 * Map a CMECS broad substrate class to the closest matching freshwater zone
 * label.
 */
export const SUBSTRATE_TO_FRESHWATER_ZONE: Record<ShoreZoneSubstrate, string> = {
  bedrock: "bedrock_shelf",
  gravel: "gravel_bed",
  sand: "sandy_lake_bed",
  mud: "clay_flat",
};

export function substrateToZone(
  substrate: ShoreZoneSubstrate,
  waterType: "saltwater" | "freshwater",
): string {
  return waterType === "freshwater"
    ? SUBSTRATE_TO_FRESHWATER_ZONE[substrate]
    : SUBSTRATE_TO_SALTWATER_ZONE[substrate];
}

/**
 * Memoised fingerprint helper for callers (e.g. GET /datasets/:id/zones)
 * that only need the cache-key fingerprint, not the full grid.
 */
const fpMemo = new Map<string, string>();
export function substrateFingerprintForDataset(datasetId: string): string {
  const hit = fpMemo.get(datasetId);
  if (hit !== undefined) return hit;
  const fp = sampleSubstrateGrid(datasetId).fingerprint;
  fpMemo.set(datasetId, fp);
  return fp;
}

/** Test-only: clear the per-dataset fingerprint memo. */
export function _clearSubstrateFingerprintMemo(): void {
  fpMemo.clear();
}
