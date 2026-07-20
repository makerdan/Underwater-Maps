/**
 * Bundled fetcher — serves datasets from pre-built static JSON bundle files.
 *
 * probe()  — checks that the bundle is registered in BUNDLED_TERRAIN (no I/O
 *             beyond what module init already did).
 * fetch()  — resamples the bundled grid to the requested resolution.
 */

import type {
  BathymetryFetcher,
  BathyFetchBundle,
  Bbox,
  FetchStrategy,
  ProbeResult,
} from "./types.js";
import { BUNDLED_TERRAIN, resampleBundled } from "../terrain.js";

export const bundledFetcher: BathymetryFetcher = {
  async probe(_strategy: FetchStrategy, bbox: Bbox): Promise<ProbeResult> {
    const cx = (bbox.minLon + bbox.maxLon) / 2;
    const cy = (bbox.minLat + bbox.maxLat) / 2;

    for (const [, bundle] of Object.entries(BUNDLED_TERRAIN)) {
      if (!bundle) continue;
      const { minLon, maxLon, minLat, maxLat } = bundle.bbox;
      if (cx >= minLon && cx <= maxLon && cy >= minLat && cy <= maxLat) {
        return {
          available: true,
          title: bundle.bathymetry.label,
          resolution: "pre-built survey bundle",
          vintage: bundle.bathymetry.fetchedAt
            ? bundle.bathymetry.fetchedAt.slice(0, 10)
            : undefined,
        };
      }
    }
    return {
      available: false,
      title: "Bundled survey",
      error: `No bundled terrain registered for this bbox`,
    };
  },

  async fetch(strategy: FetchStrategy, bbox: Bbox, N: number): Promise<BathyFetchBundle> {
    if (strategy.kind !== "bundled") throw new Error("Wrong strategy kind");

    const cx = (bbox.minLon + bbox.maxLon) / 2;
    const cy = (bbox.minLat + bbox.maxLat) / 2;

    let matchedId: string | null = null;
    for (const [id, bundle] of Object.entries(BUNDLED_TERRAIN)) {
      if (!bundle) continue;
      const { minLon, maxLon, minLat, maxLat } = bundle.bbox;
      if (cx >= minLon && cx <= maxLon && cy >= minLat && cy <= maxLat) {
        matchedId = id;
        break;
      }
    }

    if (!matchedId) throw new Error("No bundled terrain found for this bbox");
    const bundle = BUNDLED_TERRAIN[matchedId];
    if (!bundle) throw new Error(`Bundled terrain '${matchedId}' is null (load failed)`);

    const rs = resampleBundled(bundle, N);

    return {
      depths: rs.depths,
      topography: rs.topography,
      hasTopography: rs.hasTopography,
      minDepth: rs.minDepth,
      maxDepth: rs.maxDepth,
      width: N,
      height: N,
      bbox: bundle.bbox,
      dataSource: bundle.bathymetry.source,
      label: bundle.bathymetry.label,
      creditUrl: bundle.bathymetry.creditUrl,
    };
  },
};
