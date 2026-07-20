/**
 * Fetcher router — maps a `FetchStrategy` to the correct fetcher instance.
 *
 * Used by the job worker (POST /api/terrain/bundles) and the probe endpoint.
 */

import type { BathymetryFetcher, FetchStrategy } from "./types.js";
import { scienceBaseFetcher } from "./scienceBase.js";
import { usgs3depFetcher } from "./usgs3dep.js";
import { nceiWcsFetcher } from "./nceiWcs.js";
import { arcGisRestFetcher } from "./arcGisRest.js";
import { greatLakesFetcher } from "./greatLakes.js";
import { gebcoFetcher } from "./gebco.js";
import { bundledFetcher } from "./bundled.js";

const FETCHERS: Record<FetchStrategy["kind"], BathymetryFetcher> = {
  sciencebase: scienceBaseFetcher,
  "usgs-3dep": usgs3depFetcher,
  "ncei-wcs": nceiWcsFetcher,
  "arcgis-rest": arcGisRestFetcher,
  "great-lakes-wcs": greatLakesFetcher,
  "gebco-wcs": gebcoFetcher,
  bundled: bundledFetcher,
};

/**
 * Returns the fetcher for the given strategy kind.
 * Throws if the kind is unrecognised (should never happen in practice since
 * the FetchStrategy union is exhaustive).
 */
export function getFetcher(strategy: FetchStrategy): BathymetryFetcher {
  const fetcher = FETCHERS[strategy.kind];
  if (!fetcher) throw new Error(`No fetcher registered for strategy kind: ${strategy.kind}`);
  return fetcher;
}

export type { BathymetryFetcher, BathyFetchBundle, FetchStrategy, ProbeResult, Bbox } from "./types.js";
