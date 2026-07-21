/**
 * catalogFetchStrategy.ts
 *
 * Maps catalog entries (dataset_catalog rows / CatalogSeedEntry objects) to a
 * concrete `FetchStrategy` so POST /api/terrain/bundles can serve on-demand
 * bundle downloads for catalog presets that are not in ALL_PRESET_DATASETS.
 *
 * The strategy is derived from the entry's endpoint URL (and, for bundled
 * surveys, from BUNDLED_TERRAIN coverage) rather than stored in the DB, so
 * existing rows pick up strategies without a schema migration and the
 * derivation stays in lock-step with the fetcher registry.
 *
 * Returns `null` for non-bathymetry entries and for bathymetry entries whose
 * source has no matching fetcher — the guard test in
 * `__tests__/catalog-fetch-strategy.test.ts` asserts that no seeded
 * bathymetry entry ever falls into the latter bucket.
 */

import type { FetchStrategy } from "./fetchers/types.js";
import type { CatalogSeedEntry } from "./catalogSeeder.js";
import {
  ALL_PRESET_DATASETS,
  BUNDLED_TERRAIN,
  NYSDEC_BATHY_FEATURE_SERVICE,
  MN_DNR_BATHY_FEATURE_SERVICE,
} from "./terrain.js";

/** Subset of CatalogSeedEntry fields the derivation needs. */
export type CatalogStrategySource = Pick<
  CatalogSeedEntry,
  "id" | "dataType" | "endpointUrl" | "coverageBbox"
>;

const NYSDEC_STRATEGY: FetchStrategy = {
  kind: "arcgis-rest",
  serviceUrl: NYSDEC_BATHY_FEATURE_SERVICE,
  sourceLabel: "NYSDEC Lake Bathymetry",
  dataSource: "nysdec",
  creditUrl:
    "https://data.gis.ny.gov/datasets/bff954401b5641a2a920482532b7a0ae_0/about",
};

const MN_DNR_STRATEGY: FetchStrategy = {
  kind: "arcgis-rest",
  serviceUrl: MN_DNR_BATHY_FEATURE_SERVICE,
  sourceLabel: "MN DNR Lake Bathymetry",
  dataSource: "mn-dnr",
  creditUrl: "https://www.dnr.state.mn.us/lakefind/index.html",
};

/** Entry ids for the five Great Lakes (see Great Lakes matching note below). */
const GREAT_LAKE_ENTRY_IDS = new Set([
  "fw-lake-superior",
  "fw-lake-michigan",
  "fw-lake-huron",
  "fw-lake-erie",
  "fw-lake-ontario",
]);

/**
 * True when a pre-built static bundle covers the centre of the given bbox
 * (the same matching rule `bundledFetcher.fetch()` uses), or when the entry
 * id is itself a BUNDLED_TERRAIN key.
 */
function isBundledCovered(entry: CatalogStrategySource): boolean {
  if (Object.prototype.hasOwnProperty.call(BUNDLED_TERRAIN, entry.id)) {
    return true;
  }
  const bbox = entry.coverageBbox;
  if (!bbox) return false;
  const cx = (bbox.minLon + bbox.maxLon) / 2;
  const cy = (bbox.minLat + bbox.maxLat) / 2;
  for (const bundle of Object.values(BUNDLED_TERRAIN)) {
    if (!bundle) continue;
    const { minLon, maxLon, minLat, maxLat } = bundle.bbox;
    if (cx >= minLon && cx <= maxLon && cy >= minLat && cy <= maxLat) {
      return true;
    }
  }
  return false;
}

/**
 * Derive the fetch strategy for a catalog entry. Returns null when the entry
 * is not bathymetry or when no fetcher matches its source.
 */
export function deriveCatalogFetchStrategy(
  entry: CatalogStrategySource,
): FetchStrategy | null {
  if (entry.dataType !== "bathymetry") return null;

  // preset-<datasetId> rows mirror ALL_PRESET_DATASETS — reuse the preset's
  // own strategy so the two never diverge.
  if (entry.id.startsWith("preset-")) {
    const datasetId = entry.id.slice("preset-".length);
    const meta = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
    return meta?.fetchStrategy ?? null;
  }

  // Pre-built survey bundles (Lake Tahoe, Crater Lake, Ray Roberts) trump the
  // remote endpoint — they are higher-resolution and require no network I/O.
  if (isBundledCovered(entry)) {
    return { kind: "bundled" };
  }

  const url = (entry.endpointUrl ?? "").toLowerCase();
  if (!url) return null;

  // The five Great Lakes entries share the DEM_global_mosaic WCS URL since
  // the dedicated NOAA_Great_Lakes_mosaics service was deleted upstream, so
  // they must be matched by id BEFORE the generic dem_global_mosaic rule.
  if (GREAT_LAKE_ENTRY_IDS.has(entry.id) || url.includes("great_lakes")) {
    return { kind: "great-lakes-wcs" };
  }
  if (url.includes("3depelevation")) return { kind: "usgs-3dep" };
  // bag_mosaic was deleted upstream; multibeam_mosaic is its successor.
  if (url.includes("bag_mosaic") || url.includes("multibeam_mosaic")) {
    return { kind: "ncei-wcs", coverageKey: "bagMosaic" };
  }
  // DEM_all is the successor to the deleted Southern Alaska CRM service.
  if (
    url.includes("dem_mosaics/dem_all") ||
    url.includes("coastal_relief_model_southern_alaska")
  ) {
    return { kind: "ncei-wcs", coverageKey: "southAlaskaCrm" };
  }
  if (url.includes("dem_global_mosaic")) return { kind: "ncei-wcs", coverageKey: "demGlobalMosaic" };
  if (url.includes("gebco")) return { kind: "gebco-wcs" };
  if (url.includes("data.gis.ny.gov") || url.includes("nysdec")) return NYSDEC_STRATEGY;
  if (
    url.includes("gisdata.mn.gov") ||
    url.includes("gis.mn.gov") ||
    url.includes("dnr.state.mn.us")
  ) {
    return MN_DNR_STRATEGY;
  }
  // USACE Geospatial Hub reservoirs (Kentucky Lake, Lake Barkley, Clarks
  // Hill) — no dedicated USACE fetcher exists; USGS 3DEP covers these CONUS
  // impoundments as topobathy fallback.
  if (url.includes("geospatial-usace")) return { kind: "usgs-3dep" };

  return null;
}
