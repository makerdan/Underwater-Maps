/**
 * catalogLiveDownload.smoke.test.ts
 *
 * Confirms that on-demand bundle downloads actually work for newly enabled
 * catalog lakes (Task: catalog fetch-strategy live verification).
 *
 * The strategy derivation in catalogFetchStrategy.ts is covered by offline
 * unit tests, but the mapping to live upstream services (USGS 3DEP, NCEI WCS
 * x3 coverage keys, Great Lakes WCS, GEBCO WCS, NYSDEC ArcGIS, MN DNR ArcGIS)
 * had only been verified with mocks. This file:
 *
 *   1. Always (CI, offline): asserts each representative catalog entry
 *      derives to the expected strategy kind / coverage key, so endpoint-URL
 *      drift in the seed data is caught immediately.
 *
 *   2. Opt-in (NETWORK_TESTS=1): fetches a tiny bundle (N=32) from the live
 *      upstream service for one representative entry per fetcher kind and
 *      asserts non-empty, finite depths.
 *
 * Run the live suite locally with:
 *
 *   NETWORK_TESTS=1 pnpm --filter @workspace/api-server \
 *     exec vitest run src/lib/__tests__/catalogLiveDownload.smoke.test.ts
 *
 * Live endpoints can take 15–60 s per tile; allow several minutes total.
 */

import { describe, it, expect } from "vitest";
import { EXTRA_CATALOG_ENTRIES } from "../catalogSeeder.js";
import { deriveCatalogFetchStrategy } from "../catalogFetchStrategy.js";
import { getFetcher } from "../fetchers/index.js";
import type { Bbox, FetchStrategy } from "../fetchers/types.js";

const NETWORK_TESTS = process.env["NETWORK_TESTS"] === "1";

/** Grid edge for live fetches — small keeps downloads tiny and fast. */
const LIVE_N = 32;
const LIVE_TIMEOUT = 120_000;

interface SmokeCase {
  /** Catalog entry id from EXTRA_CATALOG_ENTRIES. */
  entryId: string;
  label: string;
  expectedKind: FetchStrategy["kind"];
  /** For ncei-wcs strategies: the expected coverage key. */
  expectedCoverageKey?: "bagMosaic" | "demGlobalMosaic" | "southAlaskaCrm";
  /** For arcgis-rest strategies: expected dataSource discriminator. */
  expectedDataSource?: string;
  /**
   * Tiny bbox to fetch, chosen to sit over known water within the entry's
   * coverage. For lake entries this is the lake itself; for wide-coverage
   * sources (GEBCO, NCEI mosaics) it is a hand-picked surveyed spot.
   */
  fetchBbox: Bbox;
}

const SMOKE_CASES: SmokeCase[] = [
  {
    entryId: "fw-lake-champlain",
    label: "USGS 3DEP — Lake Champlain (NY/VT)",
    expectedKind: "usgs-3dep",
    // Main lake broadening near Burlington — deep open water.
    fetchBbox: { minLon: -73.35, minLat: 44.4, maxLon: -73.2, maxLat: 44.55 },
  },
  {
    entryId: "ncei-bag-mosaic-alaska",
    label: "NCEI BAG Mosaic — Clarence Strait near Ketchikan (SE AK)",
    expectedKind: "ncei-wcs",
    expectedCoverageKey: "bagMosaic",
    // Surveyed corridor in the Inside Passage (Tongass Narrows approaches).
    fetchBbox: { minLon: -131.75, minLat: 55.25, maxLon: -131.55, maxLat: 55.4 },
  },
  {
    entryId: "ncei-dem-global-mosaic",
    label: "NCEI DEM Global Mosaic — Juneau / Gastineau Channel (SE AK)",
    expectedKind: "ncei-wcs",
    expectedCoverageKey: "demGlobalMosaic",
    fetchBbox: { minLon: -134.55, minLat: 58.2, maxLon: -134.35, maxLat: 58.35 },
  },
  {
    entryId: "ncei-crm-kodiak-island",
    label: "NCEI Southern Alaska CRM — Chiniak Bay, Kodiak Island",
    expectedKind: "ncei-wcs",
    expectedCoverageKey: "southAlaskaCrm",
    fetchBbox: { minLon: -152.5, minLat: 57.7, maxLon: -152.25, maxLat: 57.85 },
  },
  {
    entryId: "fw-lake-michigan",
    label: "Great Lakes WCS — mid Lake Michigan",
    expectedKind: "great-lakes-wcs",
    fetchBbox: { minLon: -87.3, minLat: 43.5, maxLon: -87.05, maxLat: 43.7 },
  },
  {
    entryId: "gebco-2024-global",
    label: "GEBCO WCS — open Atlantic off Cape Hatteras",
    expectedKind: "gebco-wcs",
    fetchBbox: { minLon: -70.0, minLat: 35.0, maxLon: -69.7, maxLat: 35.3 },
  },
  {
    // The statewide DEC_Lake_Bathymetry service was deleted upstream; the
    // replacement Finger Lakes service covers Seneca Lake but not Lake George
    // (which now falls through to USGS 3DEP).
    entryId: "fw-seneca-lake-ny",
    label: "NYSDEC ArcGIS — Seneca Lake, NY",
    expectedKind: "arcgis-rest",
    expectedDataSource: "nysdec",
    fetchBbox: { minLon: -76.95, minLat: 42.6, maxLon: -76.86, maxLat: 42.75 },
  },
  {
    entryId: "fw-lake-minnetonka-mn",
    label: "MN DNR ArcGIS — Lake Minnetonka, MN",
    expectedKind: "arcgis-rest",
    expectedDataSource: "mn-dnr",
    fetchBbox: { minLon: -93.75, minLat: 44.88, maxLon: -93.35, maxLat: 44.98 },
  },
];

function getEntry(entryId: string) {
  const entry = EXTRA_CATALOG_ENTRIES.find((e) => e.id === entryId);
  if (!entry) throw new Error(`Catalog entry '${entryId}' not found in EXTRA_CATALOG_ENTRIES`);
  return entry;
}

function deriveStrategyOrThrow(entryId: string): FetchStrategy {
  const strategy = deriveCatalogFetchStrategy(getEntry(entryId));
  if (!strategy) throw new Error(`No fetch strategy derived for '${entryId}'`);
  return strategy;
}

// ---------------------------------------------------------------------------
// Offline guard — always runs. Catches seed endpoint-URL drift that would
// change which fetcher a catalog entry maps to.
// ---------------------------------------------------------------------------

describe("catalog live-download smoke cases derive to the expected strategy (offline)", () => {
  for (const c of SMOKE_CASES) {
    it(`${c.entryId} → ${c.expectedKind}${c.expectedCoverageKey ? `/${c.expectedCoverageKey}` : ""}`, () => {
      const strategy = deriveStrategyOrThrow(c.entryId);
      expect(strategy.kind, `${c.entryId}: unexpected strategy kind`).toBe(c.expectedKind);
      if (c.expectedCoverageKey) {
        expect(
          strategy.kind === "ncei-wcs" ? strategy.coverageKey : undefined,
          `${c.entryId}: wrong NCEI coverage key`,
        ).toBe(c.expectedCoverageKey);
      }
      if (c.expectedDataSource) {
        expect(
          strategy.kind === "arcgis-rest" ? strategy.dataSource : undefined,
          `${c.entryId}: wrong ArcGIS dataSource`,
        ).toBe(c.expectedDataSource);
      }
      // The fetch bbox must sit inside the entry's advertised coverage.
      const cov = getEntry(c.entryId).coverageBbox;
      expect(c.fetchBbox.minLon).toBeGreaterThanOrEqual(cov.minLon);
      expect(c.fetchBbox.maxLon).toBeLessThanOrEqual(cov.maxLon);
      expect(c.fetchBbox.minLat).toBeGreaterThanOrEqual(cov.minLat);
      expect(c.fetchBbox.maxLat).toBeLessThanOrEqual(cov.maxLat);
    });
  }
});

// ---------------------------------------------------------------------------
// Live download smoke — opt-in via NETWORK_TESTS=1.
// ---------------------------------------------------------------------------

describe.skipIf(!NETWORK_TESTS)(
  "catalog live bundle downloads (NETWORK_TESTS=1)",
  () => {
    for (const c of SMOKE_CASES) {
      it(
        `${c.entryId}: live fetch returns non-empty depths — ${c.label}`,
        async () => {
          const strategy = deriveStrategyOrThrow(c.entryId);
          const fetcher = getFetcher(strategy);
          const bundle = await fetcher.fetch(strategy, c.fetchBbox, LIVE_N);

          expect(bundle.depths.length, `${c.entryId}: depths must be N²`).toBe(
            LIVE_N * LIVE_N,
          );
          const positiveCells = bundle.depths.filter(
            (d) => Number.isFinite(d) && d > 0,
          ).length;
          expect(
            positiveCells,
            `${c.entryId}: expected at least one positive depth cell from the live service`,
          ).toBeGreaterThan(0);
          expect(
            Number.isFinite(bundle.minDepth),
            `${c.entryId}: minDepth must be finite`,
          ).toBe(true);
          expect(
            Number.isFinite(bundle.maxDepth),
            `${c.entryId}: maxDepth must be finite`,
          ).toBe(true);
          expect(
            bundle.maxDepth,
            `${c.entryId}: maxDepth must exceed minDepth`,
          ).toBeGreaterThan(bundle.minDepth);
          expect(bundle.width).toBe(LIVE_N);
          expect(bundle.height).toBe(LIVE_N);
        },
        LIVE_TIMEOUT,
      );
    }
  },
);
