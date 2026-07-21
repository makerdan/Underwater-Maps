/**
 * GEBCO WCS fetcher — wraps `buildGebcoTerrainForBbox`.
 *
 * probe()  — sends a 4×4 GetCoverage tile to the GEBCO WCS to verify it's up.
 * fetch()  — delegates to `buildGebcoTerrainForBbox` for full N×N grid.
 */

import type {
  BathymetryFetcher,
  BathyFetchBundle,
  Bbox,
  FetchStrategy,
  ProbeResult,
} from "./types.js";
import { buildGebcoTerrainForBbox } from "../terrain.js";

/**
 * GEBCO's own WCS no longer serves GetCoverage (MapServer config errors on
 * every coverage/format — verified 2026-07). The probe and fetch both go
 * through NCEI's DEM_global_mosaic, which bundles the GEBCO grid as its
 * global base layer — same endpoint `buildGebcoTerrainForBbox` uses.
 */
const GEBCO_WCS =
  "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/DEM_global_mosaic/ImageServer/WCSServer";

export const gebcoFetcher: BathymetryFetcher = {
  async probe(_strategy: FetchStrategy, bbox: Bbox): Promise<ProbeResult> {
    try {
      const cx = (bbox.minLon + bbox.maxLon) / 2;
      const cy = (bbox.minLat + bbox.maxLat) / 2;
      const tiny = 0.5;
      const params = new URLSearchParams({
        service: "WCS",
        request: "GetCoverage",
        version: "1.0.0",
        coverage: "DEM_global_mosaic",
        bbox: `${cx - tiny},${cy - tiny},${cx + tiny},${cy + tiny}`,
        crs: "EPSG:4326",
        format: "GeoTIFF",
        width: "4",
        height: "4",
      });
      const r = await fetch(`${GEBCO_WCS}?${params}`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) return { available: false, title: "GEBCO 2024", error: `WCS HTTP ${r.status}` };
      const ct = r.headers.get("content-type") ?? "";
      if (!/tiff|octet/i.test(ct)) {
        return { available: false, title: "GEBCO 2024", error: "WCS returned non-TIFF response" };
      }
      return {
        available: true,
        title: "GEBCO 2024 Global Bathymetric Grid",
        resolution: "~400 m global grid",
        vintage: "2024",
      };
    } catch (err) {
      return { available: false, title: "GEBCO 2024", error: (err as Error).message };
    }
  },

  async fetch(strategy: FetchStrategy, bbox: Bbox, N: number): Promise<BathyFetchBundle> {
    if (strategy.kind !== "gebco-wcs") throw new Error("Wrong strategy kind");
    const grid = await buildGebcoTerrainForBbox(
      {
        datasetId: `ondemand-gebco-${Date.now()}`,
        name: "GEBCO 2024 Global Bathymetric Grid",
        waterType: "saltwater",
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
      dataSource: "gebco",
      label: "GEBCO 2024 Global Bathymetric Grid",
      creditUrl:
        "https://www.gebco.net/data_and_products/gridded_bathymetry_data/",
    };
  },
};
