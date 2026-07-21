/**
 * NCEI WCS fetcher — wraps the existing `buildNceiTerrainForBbox` logic.
 *
 * probe()  — requests a 4×4 GetCoverage tile to verify the WCS endpoint.
 * fetch()  — delegates to `buildNceiTerrainForBbox` for full N×N grid.
 */

import type {
  BathymetryFetcher,
  BathyFetchBundle,
  Bbox,
  FetchStrategy,
  NceiWcsFetchStrategy,
  ProbeResult,
} from "./types.js";
import { buildNceiTerrainForBbox } from "../terrain.js";

const NCEI_ENDPOINTS = {
  bagMosaic: {
    // The old bag_mosaic service was deleted upstream (2025/2026); the
    // multibeam_mosaic successor carries the survey composite.
    url: "https://gis.ngdc.noaa.gov/arcgis/services/multibeam_mosaic/ImageServer/WCSServer",
    coverage: "multibeam_mosaic_combined",
    label: "NCEI Multibeam Mosaic",
    resolution: "1–50 m multibeam survey composite",
    creditUrl: "https://www.ncei.noaa.gov/products/bathymetry",
  },
  demGlobalMosaic: {
    // Moved under the DEM_mosaics/ folder; coverage id is the service name.
    url: "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/DEM_global_mosaic/ImageServer/WCSServer",
    coverage: "DEM_global_mosaic",
    label: "NCEI DEM Global Mosaic",
    resolution: "8–90 m best-available DEM mosaic",
    creditUrl: "https://www.ncei.noaa.gov/products/coastal-elevation-models",
  },
  southAlaskaCrm: {
    // The dedicated CRM 703 service was deleted upstream; DEM_all (global
    // best-available tiled mosaic) still includes the CRM 703 grids.
    url: "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/DEM_all/ImageServer/WCSServer",
    coverage: "DEM_all",
    label: "NCEI Southern Alaska Coastal Relief Model (DEM_all successor)",
    resolution: "~90 m coastal relief model",
    creditUrl:
      "https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ngdc.mgg.dem:703/html",
  },
} as const satisfies Record<
  string,
  { url: string; coverage: string; label: string; resolution: string; creditUrl: string }
>;

async function probeWcsEndpoint(url: string, coverage: string, bbox: Bbox): Promise<boolean> {
  const { minLon, minLat, maxLon, maxLat } = bbox;
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const tiny = 0.01;
  const probeBbox = `${centerLon - tiny},${centerLat - tiny},${centerLon + tiny},${centerLat + tiny}`;
  const params = new URLSearchParams({
    service: "WCS",
    request: "GetCoverage",
    version: "1.0.0",
    coverage,
    bbox: probeBbox,
    crs: "EPSG:4326",
    format: "GeoTIFF",
    width: "4",
    height: "4",
    resx: String(tiny * 2 / 4),
    resy: String(tiny * 2 / 4),
  });
  const r = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return false;
  const ct = r.headers.get("content-type") ?? "";
  return /tiff|octet/i.test(ct);
}

export const nceiWcsFetcher: BathymetryFetcher = {
  async probe(strategy: FetchStrategy, bbox: Bbox): Promise<ProbeResult> {
    if (strategy.kind !== "ncei-wcs") {
      return { available: false, title: "", error: "Wrong strategy kind for nceiWcsFetcher" };
    }
    const s = strategy as NceiWcsFetchStrategy;
    const ep = NCEI_ENDPOINTS[s.coverageKey];
    if (!ep) {
      return { available: false, title: "", error: `Unknown coverage key: ${s.coverageKey}` };
    }
    try {
      const ok = await probeWcsEndpoint(ep.url, ep.coverage, bbox);
      if (!ok) {
        return { available: false, title: ep.label, error: "WCS endpoint unavailable or no coverage for this bbox" };
      }
      return { available: true, title: ep.label, resolution: ep.resolution };
    } catch (err) {
      return { available: false, title: ep.label, error: (err as Error).message };
    }
  },

  async fetch(strategy: FetchStrategy, bbox: Bbox, N: number): Promise<BathyFetchBundle> {
    if (strategy.kind !== "ncei-wcs") throw new Error("Wrong strategy kind");
    const s = strategy as NceiWcsFetchStrategy;
    const ep = NCEI_ENDPOINTS[s.coverageKey];
    if (!ep) throw new Error(`Unknown coverage key: ${s.coverageKey}`);

    const grid = await buildNceiTerrainForBbox(
      {
        datasetId: `ondemand-ncei-${s.coverageKey}-${Date.now()}`,
        name: ep.label,
        waterType: "saltwater",
        bbox,
        coverageKey: s.coverageKey,
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
      dataSource: "ncei",
      label: ep.label,
      creditUrl: ep.creditUrl,
    };
  },
};
