/**
 * Real Southeast Alaska substrate polygons (merged ShoreZone + NOAA ENC).
 *
 * This module bundles two complementary authoritative substrate sources and
 * exposes a single per-dataset lookup that callers (the `/api/substrate/:id`
 * route in particular) use to obtain real polygons for any SE Alaska AOI:
 *
 *   1) Alaska ShoreZone Coastal Habitat Mapping Program (NOAA AKR / ADF&G)
 *      Layer:   AK_SZ_ITZ_Polygons (intertidal-zone polygons)
 *      Service: https://services9.arcgis.com/ayzk2J4kDK5FpHqs/arcgis/rest/services/AK_SZ_ITZ_Polygons/FeatureServer/9
 *      Program: https://alaskafisheries.noaa.gov/shorezone/
 *      Coverage: ~58.4–59.1°N / 137.1–135.8°W (Glacier Bay / Icy Strait).
 *
 *   2) NOAA Electronic Navigational Charts — Coastal.Seabed_Area (S-57 SBDARE)
 *      Service: https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer/144
 *      Info:    https://nauticalcharts.noaa.gov/charts/noaa-enc.html
 *      Coverage: all US navigable waters — used here to fill in the rest of
 *      SE Alaska (Sitka, Juneau, Ketchikan, Thorne Bay / Prince of Wales).
 *
 * Both bundles are generated at build time by `scripts/src/build-shorezone-data.ts`
 * and `scripts/src/build-enc-substrate.ts` respectively and persisted as
 * plain JSON files (loaded synchronously here via `fs.readFileSync`).
 * Storing them as JSON instead of inlined TypeScript prevents `tsc` from
 * having to parse a 10+ MB source file.
 *
 * Each feature's `properties.source` identifies which dataset it came from
 * ("alaska-shorezone" | "noaa-enc-coastal"), so the API response can render
 * per-feature attribution. The `/api/substrate/:id` route reports merged
 * provenance via `metadata.sources`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ShoreZoneSubstrate = "bedrock" | "gravel" | "sand" | "mud";

/** Source-of-record for a substrate polygon. */
export type SubstrateSource = "alaska-shorezone" | "noaa-enc-coastal";

/**
 * Properties common to every bundled substrate feature, regardless of source.
 * Source-specific fields (szMaterial / natsur / etc.) are optional so a
 * single FeatureCollection type can hold polygons from either bundle.
 */
export interface SubstrateFeatureProperties {
  /** Stable per-feature id (ShoreZone PHY_IDENT or "ENC-<oid>"). */
  unitId: string;
  /** CMECS broad substrate class. */
  substrate: ShoreZoneSubstrate;
  /** Human-readable class string (ShoreZone descriptive class or ENC NATSUR). */
  shoreZoneClass: string;
  /** CMECS classification code. */
  cmecsCode: string;
  /** Suggested hex colour for rendering. */
  color: string;
  /** Source-of-record. */
  source: SubstrateSource;

  // ShoreZone-only (present when source === "alaska-shorezone"):
  szMaterial?: string | null;
  szForm?: string | null;
  areaSqM?: number | null;

  // ENC-only (present when source === "noaa-enc-coastal"):
  natsur?: string | null;
  natqua?: string | null;
  encChart?: string | null;
}

export interface ShoreZoneFeature {
  type: "Feature";
  properties: SubstrateFeatureProperties;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface ShoreZoneFeatureCollection {
  type: "FeatureCollection";
  features: ShoreZoneFeature[];
  metadata: {
    region: string;
    bbox: [number, number, number, number];
    source: SubstrateSource;
    sourceName: string;
    sourceLayer: string;
    sourceService: string;
    creditUrl: string;
    fetchedAt: string;
    featureCount: number;
  };
}

// ---------------------------------------------------------------------------
// Bundle loading (runtime JSON read to avoid 10+ MB TS parse cost)
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadBundle(filename: string, expectedSource: SubstrateSource): ShoreZoneFeatureCollection {
  const path = resolve(__dirname, filename);
  const raw = JSON.parse(readFileSync(path, "utf8")) as ShoreZoneFeatureCollection;
  // Stamp `source` into every feature's properties so downstream code can
  // attribute features individually after merging. (The ShoreZone bundle
  // pre-dates the per-feature source tag; the ENC bundle already includes
  // it. We normalise here so both look the same to consumers.)
  for (const f of raw.features) {
    if (!f.properties.source) f.properties.source = expectedSource;
  }
  return raw;
}

/** The full bundled Alaska ShoreZone regional FeatureCollection. */
export const ALASKA_SHOREZONE: ShoreZoneFeatureCollection = loadBundle(
  "shoreZoneData.alaska.gen.json",
  "alaska-shorezone",
);

/** The full bundled SE Alaska NOAA ENC seabed FeatureCollection. */
export const ENC_SE_ALASKA_SUBSTRATE: ShoreZoneFeatureCollection = loadBundle(
  "encSubstrateData.alaska.gen.json",
  "noaa-enc-coastal",
);

/** Convenience: all bundles in source-priority order (ShoreZone preferred). */
const ALL_BUNDLES: ShoreZoneFeatureCollection[] = [ALASKA_SHOREZONE, ENC_SE_ALASKA_SUBSTRATE];

// ---------------------------------------------------------------------------
// Bbox helpers
// ---------------------------------------------------------------------------

export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function ringBbox(
  ring: number[][],
): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const c of ring) {
    const lon = c[0]!, lat = c[1]!;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function featureBbox(feature: ShoreZoneFeature): {
  minLon: number; minLat: number; maxLon: number; maxLat: number;
} {
  const polygons: number[][][][] =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const poly of polygons) {
    for (const ring of poly) {
      const b = ringBbox(ring);
      if (b.minLon < minLon) minLon = b.minLon;
      if (b.minLat < minLat) minLat = b.minLat;
      if (b.maxLon > maxLon) maxLon = b.maxLon;
      if (b.maxLat > maxLat) maxLat = b.maxLat;
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

function intersectsBbox(features: ShoreZoneFeature[], bbox: Bbox): ShoreZoneFeature[] {
  return features.filter((f) => {
    const b = featureBbox(f);
    return (
      b.maxLon >= bbox.minLon &&
      b.minLon <= bbox.maxLon &&
      b.maxLat >= bbox.minLat &&
      b.minLat <= bbox.maxLat
    );
  });
}

/** Return the subset of ALASKA_SHOREZONE whose bbox overlaps `bbox`. */
export function getShoreZoneIntersectingBbox(bbox: Bbox): ShoreZoneFeature[] {
  return intersectsBbox(ALASKA_SHOREZONE.features, bbox);
}

/** Return the subset of the ENC SE Alaska bundle whose bbox overlaps `bbox`. */
export function getEncSubstrateIntersectingBbox(bbox: Bbox): ShoreZoneFeature[] {
  return intersectsBbox(ENC_SE_ALASKA_SUBSTRATE.features, bbox);
}

// ---------------------------------------------------------------------------
// Distance helpers
// ---------------------------------------------------------------------------

function haversineKm(
  aLat: number, aLon: number, bLat: number, bLon: number,
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestKm(features: ShoreZoneFeature[], bbox: Bbox): number {
  const qLat = (bbox.minLat + bbox.maxLat) / 2;
  const qLon = (bbox.minLon + bbox.maxLon) / 2;
  let best = Infinity;
  for (const f of features) {
    const b = featureBbox(f);
    const fLat = (b.minLat + b.maxLat) / 2;
    const fLon = (b.minLon + b.maxLon) / 2;
    const d = haversineKm(qLat, qLon, fLat, fLon);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Approximate distance in km from a query bbox to the nearest ShoreZone
 * feature (kept for backwards compatibility with existing callers).
 */
export function nearestCoverageKm(bbox: Bbox): number {
  return nearestKm(ALASKA_SHOREZONE.features, bbox);
}

// ---------------------------------------------------------------------------
// Per-dataset coverage lookup (merged ShoreZone + ENC)
// ---------------------------------------------------------------------------

export interface SubstrateDatasetCoverage {
  /** Substrate polygons intersecting the dataset bbox, merged across sources. */
  features: ShoreZoneFeature[];
  /** Human-readable region label for the slice. */
  region: string;
  /** Tight bbox of the returned features, or null when no features returned. */
  coverageBbox: [number, number, number, number] | null;
  /** True when at least one substrate polygon overlaps the dataset bbox. */
  hasCoverage: boolean;
  /** Distance in km to nearest substrate polygon (0 when hasCoverage). */
  nearestCoverageKm: number;
  /** Per-source counts in the returned slice, in priority order. */
  sources: { source: SubstrateSource; featureCount: number }[];
  /**
   * When `hasCoverage` is false, identifies which bundle owns the nearest
   * substrate polygon so callers can attribute the "nearest coverage" hint
   * to the right source. `null` when `hasCoverage` is true.
   */
  nearestSource: SubstrateSource | null;
}

/** Backwards-compatible alias kept so existing imports keep working. */
export type ShoreZoneDatasetCoverage = SubstrateDatasetCoverage;

/**
 * Per-dataset region labels. Maps preset dataset ids to a human-readable
 * label for the returned substrate slice; falls back to "{datasetId}
 * (NOAA ENC + Alaska ShoreZone)" / "no published substrate coverage"
 * for unknown ids.
 */
const DATASET_REGION_LABELS: Record<string, string> = {
  "glacier-bay":       "Glacier Bay (Alaska ShoreZone + NOAA ENC)",
  "icy-strait":        "Icy Strait / Cross Sound (Alaska ShoreZone + NOAA ENC)",
  "thorne-bay":        "Thorne Bay / Clarence Strait (NOAA ENC seabed)",
  "sitka-sound":       "Sitka Sound (NOAA ENC seabed)",
  "juneau-approaches": "Juneau approaches — Stephens Passage / Lynn Canal (NOAA ENC seabed)",
  "ketchikan":         "Ketchikan / Revillagigedo Channel (NOAA ENC seabed)",
};

function tightBbox(features: ShoreZoneFeature[]): [number, number, number, number] | null {
  if (features.length === 0) return null;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const f of features) {
    const b = featureBbox(f);
    if (b.minLon < minLon) minLon = b.minLon;
    if (b.minLat < minLat) minLat = b.minLat;
    if (b.maxLon > maxLon) maxLon = b.maxLon;
    if (b.maxLat > maxLat) maxLat = b.maxLat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Canonical entry point: return the merged substrate slice for a dataset
 * given its AOI bbox and id. Combines ShoreZone (preferred where available)
 * and NOAA ENC seabed polygons so every SE Alaska preset receives real
 * substrate coverage.
 *
 * Each returned feature's `properties.source` identifies which bundle it
 * came from. If no source has intersecting polygons, the response is an
 * honest empty FeatureCollection with `nearestCoverageKm` measured against
 * the nearest substrate polygon across *all* bundles.
 */
export function getSubstrateForDataset(
  datasetId: string,
  bbox: Bbox,
): SubstrateDatasetCoverage {
  const perSource: { source: SubstrateSource; features: ShoreZoneFeature[] }[] = [
    { source: "alaska-shorezone",  features: intersectsBbox(ALASKA_SHOREZONE.features, bbox) },
    { source: "noaa-enc-coastal",  features: intersectsBbox(ENC_SE_ALASKA_SUBSTRATE.features, bbox) },
  ];
  const merged: ShoreZoneFeature[] = perSource.flatMap((s) => s.features);
  const hasCoverage = merged.length > 0;
  const region =
    DATASET_REGION_LABELS[datasetId] ??
    (hasCoverage
      ? `${datasetId} (NOAA ENC + Alaska ShoreZone)`
      : `${datasetId} (no published substrate coverage)`);

  let nearest = 0;
  let nearestSource: SubstrateSource | null = null;
  if (!hasCoverage) {
    const perBundle = ALL_BUNDLES.map((b) => ({
      source: b.metadata.source,
      km: nearestKm(b.features, bbox),
    }));
    const best = perBundle.reduce((a, c) => (c.km < a.km ? c : a));
    nearest = best.km;
    nearestSource = best.source;
  }

  return {
    features: merged,
    region,
    coverageBbox: tightBbox(merged),
    hasCoverage,
    nearestCoverageKm: nearest,
    sources: perSource.map((s) => ({ source: s.source, featureCount: s.features.length })),
    nearestSource,
  };
}

/**
 * Backwards-compatible alias: previous task introduced
 * `getShoreZoneForDataset()` which now delegates to the merged
 * `getSubstrateForDataset()`. Kept so existing callers keep compiling.
 */
export function getShoreZoneForDataset(
  datasetId: string,
  bbox: Bbox,
): SubstrateDatasetCoverage {
  return getSubstrateForDataset(datasetId, bbox);
}
