/**
 * usgs3depCoverage.ts — federated "coverage" connector for USGS 3DEP.
 *
 * 3DEP is not a searchable catalog — it is a single CONUS-wide topobathy
 * ImageServer (exportImage REST). This connector therefore answers the
 * question "does 3DEP cover the area I'm looking at?":
 *
 *  - viewport bbox centred inside CONUS  → one importable synthetic result
 *  - no bbox but an elevation-flavoured query ("dem", "lidar", "3dep",
 *    "elevation", "topobathy") → one CONUS-wide importable result
 *  - otherwise → no results (status still "ok" — checked, nothing relevant)
 *
 * The endpoint URL is the shared USGS_3DEP_URL constant, which
 * deriveCatalogFetchStrategy maps to the `usgs-3dep` fetcher.
 */

import { USGS_3DEP_URL } from "../../fetchers/usgs3dep.js";
import { deriveImportability } from "../importable.js";
import type { FederatedBbox, FederatedConnector, FederatedResultItem } from "../types.js";

/** Same CONUS envelope the usgs-3dep fetcher uses for its coverage guard. */
const CONUS: FederatedBbox = { minLon: -130, minLat: 24, maxLon: -60, maxLat: 50 };

const ELEVATION_QUERY_RE = /\b(3dep|dem|lidar|elevation|topobathy|topo-?bathy)\b/i;

function centerInConus(bbox: FederatedBbox): boolean {
  const cx = (bbox.minLon + bbox.maxLon) / 2;
  const cy = (bbox.minLat + bbox.maxLat) / 2;
  return cx >= CONUS.minLon && cx <= CONUS.maxLon && cy >= CONUS.minLat && cy <= CONUS.maxLat;
}

function makeResult(coverageBbox: FederatedBbox, areaLabel: string): FederatedResultItem {
  const { importable, importKind } = deriveImportability({
    id: "usgs-3dep-coverage",
    endpointUrl: USGS_3DEP_URL,
    coverageBbox,
  });
  return {
    id: "usgs-3dep:coverage",
    sourceId: "usgs-3dep",
    sourceLabel: "USGS 3DEP",
    name: `USGS 3DEP Topobathy DEM (${areaLabel})`,
    description:
      "Seamless 1/3 arc-second (~10 m) elevation with topobathymetric coverage for many CONUS lakes and coastal areas, served from the USGS 3DEPElevation ImageServer.",
    url: "https://www.usgs.gov/3d-elevation-program",
    endpointUrl: USGS_3DEP_URL,
    coverageBbox,
    resolutionMMin: 10,
    resolutionMMax: 30,
    importable,
    importKind,
  };
}

export const usgs3depCoverageConnector: FederatedConnector = {
  id: "usgs-3dep",
  label: "USGS 3DEP",

  async search(q: string, bbox: FederatedBbox | null): Promise<FederatedResultItem[]> {
    if (bbox) {
      return centerInConus(bbox) ? [makeResult(bbox, "this area")] : [];
    }
    if (ELEVATION_QUERY_RE.test(q)) {
      return [makeResult(CONUS, "contiguous US")];
    }
    return [];
  },
};
