/**
 * efhFetcher.ts — NOAA Alaska EFH species GeoJSON fetcher
 *
 * Fetches real NOAA Alaska Essential Fish Habitat (EFH) species polygon data
 * from the confirmed NOAA Fisheries ArcGIS FeatureServer hosted at:
 *   https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/GulfOfAlaska/FeatureServer
 *
 * This service (NOAA org: C8EMgrsFcRFL6LrL, owner: ammon.bailey_noaa) backs
 * the official Alaska Essential Fish Habitat Mapper web application:
 *   https://noaa.maps.arcgis.com/apps/webappviewer/index.html?id=66d51e1a1c34468bb766f6ec1b6f58d9
 *
 * The GulfOfAlaska service organises data as one FeatureLayer per
 * species + life-stage + season combination (153 layers total). Species
 * metadata (scientific name, FMP, depth range) is NOT stored in the feature
 * properties — it is encoded in the layer name and mapped through the
 * GOA_LAYER_SPECS table below.
 *
 * The fetcher queries the subset of layers relevant to the three BathyScan
 * EFH catalog entries (Pacific cod, Pacific halibut, rockfish complex) in
 * parallel, page-folds where the server's maxRecordCount (1000) is hit, and
 * expands any MultiPolygon geometry so the full official EFH footprint is
 * preserved. Results are cached in memory + on disk using the same
 * cache-version pattern as the GEBCO/NCEI terrain fetchers.
 *
 * Credit: NOAA Fisheries / National Marine Fisheries Service (NMFS)
 *   https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles
 */

import { promises as fsPromises } from "fs";
import path from "path";
import type { EfhFeature, EfhFeatureCollection } from "./efhData.js";

// ---------------------------------------------------------------------------
// Cache versioning — bump whenever the normalization logic, layer selection,
// or schema changes in a way that makes previously cached entries stale.
//
//   1 — initial correct implementation using confirmed NOAA ArcGIS
//       FeatureServer (C8EMgrsFcRFL6LrL / GulfOfAlaska). Queries specific
//       layer IDs for pcod, halibut, and rockfish; injects species metadata
//       from the GOA_LAYER_SPECS table; expands MultiPolygon per-part.
//   2 — added walleye pollock (layers 135–141), sablefish (112–117), and
//       arrowtooth flounder (14–19) to GOA_LAYER_SPECS.
// ---------------------------------------------------------------------------
export const EFH_CACHE_VERSION = 2;

const CACHE_DIR = "/tmp/efh-cache";
const CACHE_KEY = "alaska-efh-species";
const NOAA_EFH_CREDIT_URL =
  "https://www.fisheries.noaa.gov/resource/data/alaska-essential-fish-habitat-efh-species-shapefiles";

/**
 * Base URL of the confirmed NOAA GulfOfAlaska EFH FeatureServer.
 *
 * Hosted by NOAA Fisheries Alaska Region (ArcGIS org C8EMgrsFcRFL6LrL,
 * owner ammon.bailey_noaa). Backing service for the official Alaska EFH
 * Mapper (ArcGIS item 66d51e1a1c34468bb766f6ec1b6f58d9).
 */
const GOA_BASE_URL =
  "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/GulfOfAlaska/FeatureServer";

const FETCH_TIMEOUT_MS = 25_000;
const PAGE_SIZE = 1000; // matches server maxRecordCount

// ---------------------------------------------------------------------------
// Layer specification table
//
// The GulfOfAlaska FeatureServer stores one FeatureLayer per
// species + life-stage + season. Feature properties only contain OBJECTID,
// Id, EFH_NAME, and Link — species identity is encoded purely in the layer
// name. This table maps each layer ID we care about to the full EfhFeature
// property set so the resulting features are semantically rich.
//
// Layer IDs verified by querying
//   GET /GulfOfAlaska/FeatureServer/layers?f=json
// on 2026-05-26. Only layers relevant to the three BathyScan catalog entries
// (pcod, halibut, rockfish complex) are included.
// ---------------------------------------------------------------------------

interface LayerSpec {
  layerId: number;
  species: string;        // scientific name (lowercase_underscore)
  commonName: string;
  fmp: string;
  depthRangeM: [number, number];
  color: string;
  lifeStage?: string;
  season?: string;
}

const ROCKFISH_FMP = "Gulf of Alaska Groundfish FMP";

const GOA_LAYER_SPECS: LayerSpec[] = [
  // -------------------------------------------------------------------------
  // Pacific Halibut (hippoglossus_stenolepis) — layers 56–57
  // -------------------------------------------------------------------------
  { layerId: 56, species: "hippoglossus_stenolepis", commonName: "Pacific Halibut",
    fmp: "Pacific Halibut (IPHC)", depthRangeM: [20, 500], color: "#f59e0b",
    lifeStage: "Adults", season: "Summer" },
  { layerId: 57, species: "hippoglossus_stenolepis", commonName: "Pacific Halibut",
    fmp: "Pacific Halibut (IPHC)", depthRangeM: [0, 200], color: "#f59e0b",
    lifeStage: "Juveniles", season: "Summer" },

  // -------------------------------------------------------------------------
  // Pacific Cod (gadus_macrocephalus) — layers 79–84
  // -------------------------------------------------------------------------
  { layerId: 79, species: "gadus_macrocephalus", commonName: "Pacific Cod",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [10, 400], color: "#6366f1",
    lifeStage: "Adults", season: "Fall" },
  { layerId: 80, species: "gadus_macrocephalus", commonName: "Pacific Cod",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [10, 400], color: "#6366f1",
    lifeStage: "Adults", season: "Spring (spawning)" },
  { layerId: 81, species: "gadus_macrocephalus", commonName: "Pacific Cod",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [10, 400], color: "#6366f1",
    lifeStage: "Adults", season: "Summer" },
  { layerId: 82, species: "gadus_macrocephalus", commonName: "Pacific Cod",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [10, 400], color: "#6366f1",
    lifeStage: "Adults", season: "Winter" },
  { layerId: 83, species: "gadus_macrocephalus", commonName: "Pacific Cod",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 150], color: "#6366f1",
    lifeStage: "Juveniles", season: "Summer" },
  { layerId: 84, species: "gadus_macrocephalus", commonName: "Pacific Cod",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 50], color: "#6366f1",
    lifeStage: "Larvae", season: "Summer" },

  // -------------------------------------------------------------------------
  // Rockfish complex — SE Alaska key species
  // -------------------------------------------------------------------------
  // Black rockfish (sebastes_melanops) — layer 30
  { layerId: 30, species: "sebastes_melanops", commonName: "Black Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [0, 100], color: "#1f2937",
    lifeStage: "Adults", season: "Summer" },
  // Dusky rockfish (sebastes_variabilis) — layers 41–45
  { layerId: 41, species: "sebastes_variabilis", commonName: "Dusky Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [50, 400], color: "#7c3aed",
    lifeStage: "Adults", season: "Fall" },
  { layerId: 42, species: "sebastes_variabilis", commonName: "Dusky Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [50, 400], color: "#7c3aed",
    lifeStage: "Adults", season: "Spring" },
  { layerId: 43, species: "sebastes_variabilis", commonName: "Dusky Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [50, 400], color: "#7c3aed",
    lifeStage: "Adults", season: "Summer" },
  { layerId: 44, species: "sebastes_variabilis", commonName: "Dusky Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [50, 400], color: "#7c3aed",
    lifeStage: "Adults", season: "Winter" },
  { layerId: 45, species: "sebastes_variabilis", commonName: "Dusky Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [0, 150], color: "#7c3aed",
    lifeStage: "Juveniles", season: "Summer" },
  // Pacific Ocean Perch (sebastes_alutus) — layers 85–90
  { layerId: 85, species: "sebastes_alutus", commonName: "Pacific Ocean Perch",
    fmp: ROCKFISH_FMP, depthRangeM: [100, 500], color: "#dc2626",
    lifeStage: "Adults", season: "Fall" },
  { layerId: 86, species: "sebastes_alutus", commonName: "Pacific Ocean Perch",
    fmp: ROCKFISH_FMP, depthRangeM: [100, 500], color: "#dc2626",
    lifeStage: "Adults", season: "Spring" },
  { layerId: 87, species: "sebastes_alutus", commonName: "Pacific Ocean Perch",
    fmp: ROCKFISH_FMP, depthRangeM: [100, 500], color: "#dc2626",
    lifeStage: "Adults", season: "Summer" },
  { layerId: 88, species: "sebastes_alutus", commonName: "Pacific Ocean Perch",
    fmp: ROCKFISH_FMP, depthRangeM: [100, 500], color: "#dc2626",
    lifeStage: "Adults", season: "Winter" },
  { layerId: 89, species: "sebastes_alutus", commonName: "Pacific Ocean Perch",
    fmp: ROCKFISH_FMP, depthRangeM: [0, 200], color: "#dc2626",
    lifeStage: "Juveniles", season: "Summer" },
  { layerId: 90, species: "sebastes_alutus", commonName: "Pacific Ocean Perch",
    fmp: ROCKFISH_FMP, depthRangeM: [0, 100], color: "#dc2626",
    lifeStage: "Larvae", season: "Summer" },
  // Quillback rockfish (sebastes_maliger) — layer 92
  { layerId: 92, species: "sebastes_maliger", commonName: "Quillback Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [40, 270], color: "#facc15",
    lifeStage: "Adults", season: "Summer" },
  // Rougheye rockfish (sebastes_aleutianus) — layers 107–111
  { layerId: 107, species: "sebastes_aleutianus", commonName: "Rougheye Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [100, 900], color: "#92400e",
    lifeStage: "Adults", season: "Fall" },
  { layerId: 108, species: "sebastes_aleutianus", commonName: "Rougheye Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [100, 900], color: "#92400e",
    lifeStage: "Adults", season: "Spring" },
  { layerId: 109, species: "sebastes_aleutianus", commonName: "Rougheye Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [100, 900], color: "#92400e",
    lifeStage: "Adults", season: "Summer" },
  { layerId: 110, species: "sebastes_aleutianus", commonName: "Rougheye Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [100, 900], color: "#92400e",
    lifeStage: "Adults", season: "Winter" },
  { layerId: 111, species: "sebastes_aleutianus", commonName: "Rougheye Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [0, 300], color: "#92400e",
    lifeStage: "Juveniles", season: "Summer" },
  // Yelloweye rockfish (sebastes_ruberrimus) — layers 147–150
  { layerId: 147, species: "sebastes_ruberrimus", commonName: "Yelloweye Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [80, 350], color: "#ef4444",
    lifeStage: "Adults", season: "Fall" },
  { layerId: 148, species: "sebastes_ruberrimus", commonName: "Yelloweye Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [80, 350], color: "#ef4444",
    lifeStage: "Adults", season: "Spring" },
  { layerId: 149, species: "sebastes_ruberrimus", commonName: "Yelloweye Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [80, 350], color: "#ef4444",
    lifeStage: "Adults", season: "Summer" },
  { layerId: 150, species: "sebastes_ruberrimus", commonName: "Yelloweye Rockfish",
    fmp: ROCKFISH_FMP, depthRangeM: [0, 150], color: "#ef4444",
    lifeStage: "Juveniles", season: "Summer" },

  // -------------------------------------------------------------------------
  // Arrowtooth Flounder (atheresthes_stomias) — layers 14–19
  // -------------------------------------------------------------------------
  { layerId: 14, species: "atheresthes_stomias", commonName: "Arrowtooth Flounder",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 900], color: "#16a34a",
    lifeStage: "Adults", season: "Fall" },
  { layerId: 15, species: "atheresthes_stomias", commonName: "Arrowtooth Flounder",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 900], color: "#16a34a",
    lifeStage: "Adults", season: "Spring" },
  { layerId: 16, species: "atheresthes_stomias", commonName: "Arrowtooth Flounder",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 900], color: "#16a34a",
    lifeStage: "Adults", season: "Summer" },
  { layerId: 17, species: "atheresthes_stomias", commonName: "Arrowtooth Flounder",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 900], color: "#16a34a",
    lifeStage: "Adults", season: "Winter" },
  { layerId: 18, species: "atheresthes_stomias", commonName: "Arrowtooth Flounder",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 300], color: "#16a34a",
    lifeStage: "Juveniles", season: "Summer" },
  { layerId: 19, species: "atheresthes_stomias", commonName: "Arrowtooth Flounder",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 150], color: "#16a34a",
    lifeStage: "Larvae", season: "Summer" },

  // -------------------------------------------------------------------------
  // Sablefish (anoplopoma_fimbria) — layers 112–117
  // -------------------------------------------------------------------------
  { layerId: 112, species: "anoplopoma_fimbria", commonName: "Sablefish",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [200, 2000], color: "#0e7490",
    lifeStage: "Adults", season: "Fall" },
  { layerId: 113, species: "anoplopoma_fimbria", commonName: "Sablefish",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [200, 2000], color: "#0e7490",
    lifeStage: "Adults", season: "Spring" },
  { layerId: 114, species: "anoplopoma_fimbria", commonName: "Sablefish",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [200, 2000], color: "#0e7490",
    lifeStage: "Adults", season: "Summer" },
  { layerId: 115, species: "anoplopoma_fimbria", commonName: "Sablefish",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [200, 2000], color: "#0e7490",
    lifeStage: "Adults", season: "Winter" },
  { layerId: 116, species: "anoplopoma_fimbria", commonName: "Sablefish",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 400], color: "#0e7490",
    lifeStage: "Juveniles", season: "Summer" },
  { layerId: 117, species: "anoplopoma_fimbria", commonName: "Sablefish",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 200], color: "#0e7490",
    lifeStage: "Larvae", season: "Summer" },

  // -------------------------------------------------------------------------
  // Walleye Pollock (gadus_chalcogrammus) — layers 135–141
  // -------------------------------------------------------------------------
  { layerId: 135, species: "gadus_chalcogrammus", commonName: "Walleye Pollock",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 500], color: "#7c3aed",
    lifeStage: "Adults", season: "Fall" },
  { layerId: 136, species: "gadus_chalcogrammus", commonName: "Walleye Pollock",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 500], color: "#7c3aed",
    lifeStage: "Adults", season: "Spring" },
  { layerId: 137, species: "gadus_chalcogrammus", commonName: "Walleye Pollock",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 500], color: "#7c3aed",
    lifeStage: "Adults", season: "Summer" },
  { layerId: 138, species: "gadus_chalcogrammus", commonName: "Walleye Pollock",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 500], color: "#7c3aed",
    lifeStage: "Adults", season: "Winter" },
  { layerId: 139, species: "gadus_chalcogrammus", commonName: "Walleye Pollock",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 200], color: "#7c3aed",
    lifeStage: "Eggs", season: "Summer" },
  { layerId: 140, species: "gadus_chalcogrammus", commonName: "Walleye Pollock",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 200], color: "#7c3aed",
    lifeStage: "Juveniles", season: "Summer" },
  { layerId: 141, species: "gadus_chalcogrammus", commonName: "Walleye Pollock",
    fmp: "Gulf of Alaska Groundfish FMP", depthRangeM: [0, 100], color: "#7c3aed",
    lifeStage: "Larvae", season: "Summer" },
];

// ---------------------------------------------------------------------------
// Per-layer GeoJSON fetcher (with pagination)
// ---------------------------------------------------------------------------

interface RawFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: unknown;
  } | null;
  properties: Record<string, unknown>;
}

/**
 * Fetch all features from a single GOA FeatureLayer as GeoJSON, handling
 * pagination where the result set exceeds `maxRecordCount` (1000).
 *
 * Returns an empty array (and logs a warning) rather than throwing, so a
 * single failing layer does not abort the entire fetch.
 */
async function fetchLayerFeatures(
  baseUrl: string,
  layerId: number,
): Promise<RawFeature[]> {
  const all: RawFeature[] = [];
  let offset = 0;

  for (;;) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "EFH_NAME,Link",
      returnGeometry: "true",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: "geojson",
    });
    const url = `${baseUrl}/${layerId}/query?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      console.warn(
        `[efh-fetcher] Layer ${layerId}: HTTP ${resp.status} at offset ${offset}; skipping layer.`,
      );
      return all;
    }

    const json = (await resp.json()) as {
      type?: string;
      features?: RawFeature[];
      error?: { code: number; message: string };
    };

    if (json.error) {
      console.warn(
        `[efh-fetcher] Layer ${layerId}: ArcGIS error ${json.error.code}: ${json.error.message}; skipping.`,
      );
      return all;
    }

    const page = json.features ?? [];
    all.push(...page);

    if (page.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  return all;
}

// ---------------------------------------------------------------------------
// MultiPolygon expansion
// ---------------------------------------------------------------------------

/**
 * Convert a raw GeoJSON feature + its LayerSpec into zero or more EfhFeature
 * records. MultiPolygon geometries are expanded to one EfhFeature per polygon
 * part so the full official EFH footprint is preserved.
 */
export function expandFeature(raw: RawFeature, spec: LayerSpec): EfhFeature[] {
  const geom = raw.geometry;
  if (!geom || !geom.coordinates) return [];

  const efhName = raw.properties["EFH_NAME"]
    ? String(raw.properties["EFH_NAME"])
    : `${spec.commonName} EFH`;
  const habitatDescription =
    `Essential Fish Habitat for ${spec.commonName} in Alaskan waters under the ` +
    `Magnuson-Stevens Act. ${efhName}.`;

  const sharedProps: EfhFeature["properties"] = {
    species: spec.species,
    commonName: spec.commonName,
    fmp: spec.fmp,
    depthRangeM: spec.depthRangeM,
    habitatDescription,
    ...(spec.lifeStage ? { lifeStage: spec.lifeStage } : {}),
    ...(spec.season ? { season: spec.season } : {}),
    source: "NOAA Fisheries / NMFS Alaska Region EFH (GulfOfAlaska FeatureServer)",
    creditUrl: NOAA_EFH_CREDIT_URL,
    color: spec.color,
  };

  if (geom.type === "Polygon") {
    const coordinates = geom.coordinates as number[][][];
    return [{ type: "Feature", properties: sharedProps, geometry: { type: "Polygon", coordinates } }];
  }

  if (geom.type === "MultiPolygon") {
    // Expand to one EfhFeature per polygon part so no coverage is lost.
    const parts = geom.coordinates as number[][][][];
    const out: EfhFeature[] = [];
    for (const rings of parts) {
      if (!rings || rings.length === 0) continue;
      out.push({
        type: "Feature",
        properties: sharedProps,
        geometry: { type: "Polygon", coordinates: rings },
      });
    }
    return out;
  }

  return [];
}

// ---------------------------------------------------------------------------
// On-disk cache helpers
// ---------------------------------------------------------------------------

interface DiskCache {
  version: number;
  fetchedAt: string;
  features: EfhFeature[];
}

async function readDiskCache(): Promise<EfhFeature[] | null> {
  try {
    const file = path.join(CACHE_DIR, `${CACHE_KEY}.json`);
    const raw = await fsPromises.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as DiskCache;
    if ((parsed.version ?? 0) < EFH_CACHE_VERSION) {
      console.info(
        `[efh-fetcher] Discarding stale EFH cache (v${parsed.version} < v${EFH_CACHE_VERSION})`,
      );
      fsPromises.unlink(file).catch(() => {});
      return null;
    }
    console.info(
      `[efh-fetcher] Loaded ${parsed.features.length} EFH features from disk cache (${parsed.fetchedAt})`,
    );
    return parsed.features;
  } catch {
    return null;
  }
}

async function writeDiskCache(features: EfhFeature[]): Promise<void> {
  try {
    await fsPromises.mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${CACHE_KEY}.json`);
    const payload: DiskCache = {
      version: EFH_CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      features,
    };
    await fsPromises.writeFile(file, JSON.stringify(payload), "utf8");
    console.info(`[efh-fetcher] Cached ${features.length} EFH features to disk.`);
  } catch (err) {
    console.warn(`[efh-fetcher] Failed to write EFH disk cache: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let memoryCache: EfhFeature[] | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the NOAA Alaska EFH species polygon data for the BathyScan catalog
 * entries (Pacific Halibut, Pacific Cod, rockfish complex) from the confirmed
 * NOAA GulfOfAlaska ArcGIS FeatureServer.
 *
 * Each layer in `GOA_LAYER_SPECS` is queried in parallel; MultiPolygon
 * features are expanded to one EfhFeature per polygon part. The full result
 * is cached in memory and on disk (versioned) to avoid repeated upstream
 * requests.
 *
 * Returns `null` if all layer fetches fail (or the server is unreachable),
 * allowing callers to fall back to the bundled hand-simplified polygons.
 */
export async function fetchNoaaAlaskaEfh(): Promise<EfhFeature[] | null> {
  // 1. Memory cache
  if (memoryCache !== null) return memoryCache;

  // 2. Disk cache
  const cached = await readDiskCache();
  if (cached !== null) {
    memoryCache = cached;
    return cached;
  }

  // 3. Live fetch — query all GOA_LAYER_SPECS layers in parallel
  console.info(
    `[efh-fetcher] Fetching ${GOA_LAYER_SPECS.length} EFH layers from NOAA GulfOfAlaska FeatureServer…`,
  );

  try {
    const results = await Promise.all(
      GOA_LAYER_SPECS.map(async (spec) => {
        // Per-layer catch: transport-level errors (AbortError, DNS, reset) must
        // not propagate out of the map callback and reject the whole Promise.all.
        // Returning an empty result for the failing layer preserves partial live
        // data from all other layers, matching the stated "single failing layer
        // does not abort the entire fetch" contract.
        let rawFeatures: RawFeature[];
        try {
          rawFeatures = await fetchLayerFeatures(GOA_BASE_URL, spec.layerId);
        } catch (err) {
          console.warn(
            `[efh-fetcher] Layer ${spec.layerId} (${spec.commonName}): transport error — ` +
            `${(err as Error).message}; skipping layer.`,
          );
          rawFeatures = [];
        }
        const expanded: EfhFeature[] = [];
        let polyCount = 0;
        for (const raw of rawFeatures) {
          const parts = expandFeature(raw, spec);
          expanded.push(...parts);
          polyCount += parts.length;
        }
        return { spec, rawCount: rawFeatures.length, polyCount, features: expanded };
      }),
    );

    const allFeatures: EfhFeature[] = [];
    let totalRaw = 0;
    let totalPolygons = 0;
    for (const r of results) {
      allFeatures.push(...r.features);
      totalRaw += r.rawCount;
      totalPolygons += r.polyCount;
    }

    if (allFeatures.length === 0) {
      console.warn(
        `[efh-fetcher] All ${GOA_LAYER_SPECS.length} GOA layers returned 0 usable features; will use bundled data.`,
      );
      return null;
    }

    console.info(
      `[efh-fetcher] Fetched ${totalPolygons} polygon parts from ${totalRaw} raw features ` +
      `across ${GOA_LAYER_SPECS.length} NOAA EFH layers.`,
    );

    memoryCache = allFeatures;
    void writeDiskCache(allFeatures);
    return allFeatures;
  } catch (err) {
    console.warn(
      `[efh-fetcher] NOAA EFH fetch failed: ${(err as Error).message}; will use bundled data.`,
    );
    return null;
  }
}

/**
 * Build a merged `EfhFeatureCollection` for a given bbox and species matcher
 * from a set of live (or cached) NOAA EFH features.
 *
 * Clips to the entry bbox using a simple axis-aligned polygon bbox overlap
 * test, matching the approach used in the bundled-data path.
 */
export function buildCollectionFromLiveFeatures(
  liveFeatures: EfhFeature[],
  entryBbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  matchSpecies: (f: EfhFeature) => boolean,
  entryName: string,
  creditUrl: string,
  lastUpdated: string,
): EfhFeatureCollection {
  const { minLon, minLat, maxLon, maxLat } = entryBbox;
  const features = liveFeatures.filter((f) => {
    if (!matchSpecies(f)) return false;
    const coords = f.geometry.coordinates;
    let fMinLon = Infinity, fMinLat = Infinity, fMaxLon = -Infinity, fMaxLat = -Infinity;
    for (const ring of coords) {
      for (const pt of ring) {
        const lon = pt[0];
        const lat = pt[1];
        if (lon === undefined || lat === undefined) continue;
        if (lon < fMinLon) fMinLon = lon;
        if (lon > fMaxLon) fMaxLon = lon;
        if (lat < fMinLat) fMinLat = lat;
        if (lat > fMaxLat) fMaxLat = lat;
      }
    }
    return !(fMaxLon < minLon || fMinLon > maxLon || fMaxLat < minLat || fMinLat > maxLat);
  });
  return {
    type: "FeatureCollection",
    features,
    metadata: {
      region: entryName,
      bbox: [minLon, minLat, maxLon, maxLat],
      creditUrl,
      lastUpdated,
    },
  };
}
