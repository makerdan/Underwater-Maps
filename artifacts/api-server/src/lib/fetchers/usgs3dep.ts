/**
 * USGS 3DEP fetcher — wraps the existing `buildUsgs3depTerrainForBbox` logic.
 *
 * probe()  — sends a tiny 4×4 exportImage request to check service availability.
 * fetch()  — delegates to `buildUsgs3depTerrainForBbox` for full N×N grid.
 */

import type {
  BathymetryFetcher,
  BathyFetchBundle,
  Bbox,
  FetchStrategy,
  ProbeResult,
} from "./types.js";
import { buildUsgs3depTerrainForBbox } from "../terrain.js";

export const USGS_3DEP_URL =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";

const CONUS = { minLon: -130, maxLon: -60, minLat: 24, maxLat: 50 };

function centerInConus(bbox: Bbox): boolean {
  const cx = (bbox.minLon + bbox.maxLon) / 2;
  const cy = (bbox.minLat + bbox.maxLat) / 2;
  return cx >= CONUS.minLon && cx <= CONUS.maxLon && cy >= CONUS.minLat && cy <= CONUS.maxLat;
}

export const usgs3depFetcher: BathymetryFetcher = {
  async probe(_strategy: FetchStrategy, bbox: Bbox): Promise<ProbeResult> {
    if (!centerInConus(bbox)) {
      return { available: false, title: "USGS 3DEP", error: "bbox outside continental US" };
    }
    try {
      const params = new URLSearchParams({
        bbox: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
        bboxSR: "4326",
        imageSR: "4326",
        size: "4,4",
        format: "tiff",
        pixelType: "F32",
        noData: "-9999",
        f: "image",
      });
      const r = await fetch(`${USGS_3DEP_URL}/exportImage?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) {
        return { available: false, title: "USGS 3DEP", error: `HTTP ${r.status}` };
      }
      const ct = r.headers.get("content-type") ?? "";
      if (!/tiff/i.test(ct)) {
        return { available: false, title: "USGS 3DEP", error: `Unexpected content-type: ${ct}` };
      }
      return {
        available: true,
        title: "USGS 3DEP Best-Available DEM",
        resolution: "1–10 m (lidar) / 1/3 arc-second seamless",
      };
    } catch (err) {
      return { available: false, title: "USGS 3DEP", error: (err as Error).message };
    }
  },

  async fetch(strategy: FetchStrategy, bbox: Bbox, N: number): Promise<BathyFetchBundle> {
    if (strategy.kind !== "usgs-3dep") throw new Error("Wrong strategy kind");
    const grid = await buildUsgs3depTerrainForBbox(
      {
        datasetId: `ondemand-${Date.now()}`,
        name: "On-demand USGS 3DEP",
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
      dataSource: "usgs-3dep",
      label: "USGS 3DEP Best-Available DEM",
      creditUrl: "https://www.usgs.gov/3d-elevation-program",
    };
  },
};
