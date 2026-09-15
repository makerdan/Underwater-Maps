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
import { buildUsgs3depTerrainForBbox, fetchWcsGeoTiffGrid } from "../terrain.js";

export const USGS_3DEP_URL =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";

const CONUS = { minLon: -130, maxLon: -60, minLat: 24, maxLat: 50 };
const USGS_PROBE_RESOLUTION = 4;
const USGS_PROBE_TIMEOUT_MS = 30_000;

function centerInConus(bbox: Bbox): boolean {
  const cx = (bbox.minLon + bbox.maxLon) / 2;
  const cy = (bbox.minLat + bbox.maxLat) / 2;
  return cx >= CONUS.minLon && cx <= CONUS.maxLon && cy >= CONUS.minLat && cy <= CONUS.maxLat;
}

export const usgs3depFetcher: BathymetryFetcher = {
  async probe(_strategy: FetchStrategy, bbox: Bbox): Promise<ProbeResult> {
    try {
      return await probeUsgs3depCoverage(bbox);
    } catch (err) {
      return {
        available: false,
        title: "USGS 3DEP",
        error: err instanceof Error ? err.message : String(err),
      };
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

/**
 * Probe the same ImageServer raster used by the full 3DEP fetcher.
 *
 * A successful HTTP response is not enough: ImageServer can return an
 * otherwise valid GeoTIFF whose cells are all no-data for the requested bbox.
 * The connector uses this function directly so the federated search request's
 * AbortSignal cancels the raster download and decode as well.
 */
export async function probeUsgs3depCoverage(
  bbox: Bbox,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  if (!centerInConus(bbox)) {
    return { available: false, title: "USGS 3DEP", error: "bbox outside continental US" };
  }
  try {
    const params = new URLSearchParams({
      bbox: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
      bboxSR: "4326",
      imageSR: "4326",
      size: `${USGS_PROBE_RESOLUTION},${USGS_PROBE_RESOLUTION}`,
      format: "tiff",
      pixelType: "F32",
      noData: "-9999",
      f: "image",
    });
    const grid = await fetchWcsGeoTiffGrid(
      `${USGS_3DEP_URL}/exportImage?${params}`,
      USGS_PROBE_TIMEOUT_MS,
      "USGS 3DEP coverage probe",
      signal,
    );
    const hasUsableElevation = grid.values.some(
      (value) => value !== grid.nodata && Number.isFinite(value),
    );
    if (!hasUsableElevation) {
      return {
        available: false,
        title: "USGS 3DEP",
        error: "no usable elevation data for bbox",
      };
    }
    return {
      available: true,
      title: "USGS 3DEP Best-Available DEM",
      resolution: "1–10 m (lidar) / 1/3 arc-second seamless",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (signal?.aborted || /timed out|aborted|cancelled/i.test(message)) {
      throw new Error(`USGS 3DEP coverage probe timed out or was cancelled: ${message}`, {
        cause: err,
      });
    }
    if (/empty|invalid|no readable raster|not a valid/i.test(message)) {
      return {
        available: false,
        title: "USGS 3DEP",
        error: `no usable elevation data for bbox: ${message}`,
      };
    }
    throw new Error(`USGS 3DEP coverage probe failed: ${message}`, { cause: err });
  }
}
