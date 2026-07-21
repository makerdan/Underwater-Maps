/**
 * NOAA Great Lakes WCS fetcher — wraps `buildGreatLakesTerrainForBbox`.
 *
 * probe()  — matches the bbox center to a lake coverage and does a tiny WCS
 *             GetCoverage call to confirm the endpoint is serving.
 * fetch()  — delegates to `buildGreatLakesTerrainForBbox`.
 */

import type {
  BathymetryFetcher,
  BathyFetchBundle,
  Bbox,
  FetchStrategy,
  ProbeResult,
} from "./types.js";
import { buildGreatLakesTerrainForBbox } from "../terrain.js";

// The dedicated NOAA_Great_Lakes_mosaics service (per-lake *_lld coverages)
// was deleted upstream; DEM_global_mosaic carries the same lake bathymetry.
// Per-lake entries below are kept for bbox matching and labelling only.
const GREAT_LAKES_WCS =
  "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/DEM_global_mosaic/ImageServer/WCSServer";

const GREAT_LAKES_COVERAGE_ID = "DEM_global_mosaic";

interface LakeCoverage {
  coverage: string;
  label: string;
  bounds: { minLon: number; maxLon: number; minLat: number; maxLat: number };
}

const LAKE_COVERAGES: LakeCoverage[] = [
  { coverage: "superior_lld", label: "NOAA Great Lakes DEM — Lake Superior", bounds: { minLon: -92.2, maxLon: -84.3, minLat: 46.3, maxLat: 49.0 } },
  { coverage: "michigan_lld", label: "NOAA Great Lakes DEM — Lake Michigan", bounds: { minLon: -88.1, maxLon: -84.7, minLat: 41.6, maxLat: 46.1 } },
  { coverage: "huron_lld",    label: "NOAA Great Lakes DEM — Lake Huron",    bounds: { minLon: -84.6, maxLon: -79.6, minLat: 43.0, maxLat: 46.6 } },
  { coverage: "erie_lld",     label: "NOAA Great Lakes DEM — Lake Erie",     bounds: { minLon: -83.5, maxLon: -78.8, minLat: 41.4, maxLat: 43.0 } },
  { coverage: "ontario_lld",  label: "NOAA Great Lakes DEM — Lake Ontario",  bounds: { minLon: -79.9, maxLon: -75.9, minLat: 43.1, maxLat: 44.3 } },
];

function matchLake(bbox: Bbox): LakeCoverage | null {
  const cx = (bbox.minLon + bbox.maxLon) / 2;
  const cy = (bbox.minLat + bbox.maxLat) / 2;
  return LAKE_COVERAGES.find(
    (l) => cx >= l.bounds.minLon && cx <= l.bounds.maxLon && cy >= l.bounds.minLat && cy <= l.bounds.maxLat,
  ) ?? null;
}

export const greatLakesFetcher: BathymetryFetcher = {
  async probe(_strategy: FetchStrategy, bbox: Bbox): Promise<ProbeResult> {
    const lake = matchLake(bbox);
    if (!lake) {
      return { available: false, title: "NOAA Great Lakes DEM", error: "bbox center outside Great Lakes" };
    }
    try {
      const { minLon, minLat, maxLon, maxLat } = bbox;
      const cx = (minLon + maxLon) / 2;
      const cy = (minLat + maxLat) / 2;
      const tiny = 0.01;
      const params = new URLSearchParams({
        service: "WCS",
        request: "GetCoverage",
        version: "1.0.0",
        coverage: GREAT_LAKES_COVERAGE_ID,
        bbox: `${cx - tiny},${cy - tiny},${cx + tiny},${cy + tiny}`,
        crs: "EPSG:4326",
        format: "GeoTIFF",
        width: "4",
        height: "4",
        resx: String(tiny * 2 / 4),
        resy: String(tiny * 2 / 4),
      });
      const r = await fetch(`${GREAT_LAKES_WCS}?${params}`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) return { available: false, title: lake.label, error: `WCS HTTP ${r.status}` };
      const ct = r.headers.get("content-type") ?? "";
      if (!/tiff|octet/i.test(ct)) return { available: false, title: lake.label, error: "WCS returned non-TIFF" };
      return { available: true, title: lake.label, resolution: "3–10 m integrated hydrographic survey" };
    } catch (err) {
      return { available: false, title: lake.label ?? "Great Lakes DEM", error: (err as Error).message };
    }
  },

  async fetch(strategy: FetchStrategy, bbox: Bbox, N: number): Promise<BathyFetchBundle> {
    if (strategy.kind !== "great-lakes-wcs") throw new Error("Wrong strategy kind");
    const grid = await buildGreatLakesTerrainForBbox(
      {
        datasetId: `ondemand-great-lakes-${Date.now()}`,
        name: "NOAA Great Lakes DEM",
        waterType: "freshwater",
        bbox,
      },
      N,
      { smoothing: true },
    );

    return {
      depths: grid.depths,
      topography: grid.topography ?? new Array(N * N).fill(0),
      hasTopography: grid.hasTopography ?? false,
      minDepth: grid.minDepth,
      maxDepth: grid.maxDepth,
      width: N,
      height: N,
      bbox,
      dataSource: "noaa-great-lakes",
      label: "NOAA Great Lakes DEM",
      creditUrl: "https://www.ncei.noaa.gov/products/great-lakes-bathymetry",
    };
  },
};
