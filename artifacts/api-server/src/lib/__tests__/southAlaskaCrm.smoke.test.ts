/**
 * southAlaskaCrm.smoke.test.ts
 *
 * Smoke-tests for the four Southern Alaska AOIs wired to the NCEI Southern
 * Alaska Coastal Relief Model (DEM ID 703):
 *   - kodiak-island        (Kodiak / Chiniak Bay)
 *   - kachemak-bay         (Homer / Cook Inlet)
 *   - resurrection-bay     (Seward / Kenai Fjords)
 *   - prince-william-sound (Valdez / western PWS)
 *
 * Two complementary suites:
 *
 *   1. Unit suite (always runs in CI) — stubs `globalThis.fetch` to return a
 *      realistic AAIGRID response, then drives the full
 *      resolveBathymetrySource → fetchNceiGrid → SourceFetchResult path.
 *      Asserts that:
 *        • ncei-crm-s-alaska is selected as the winning source for every AOI
 *        • the returned depths array has N*N non-zero cells
 *        • minDepth / maxDepth are finite, positive, and ordered
 *        • the depth range is > 5 m (passes fetchNceiGrid's near-flat guard)
 *
 *   2. Live WCS suite (opt-in, NOT run in CI) — hits the real NCEI Southern
 *      Alaska CRM endpoint for all four AOIs at N=32, asserts a valid depth
 *      range and non-zero cell count from the live grid.
 *
 *      To run the live suite locally:
 *
 *        VITEST_RUN_INTEGRATION=1 pnpm --filter @workspace/api-server \
 *          exec vitest run src/lib/__tests__/southAlaskaCrm.smoke.test.ts
 *
 *      The real NCEI endpoint can take 15–30 s per tile; allow ~2 min total.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DATASET_SOURCE_PRIORITY,
  PRESET_DATASETS,
  resolveBathymetrySource,
  type DatasetMeta,
} from "../terrain.js";

/**
 * Metadata for the four Southern Alaska AOIs that were former presets.
 * Kept here so the resolver smoke-tests can still exercise the CRM source
 * against real bboxes after these entries were removed from PRESET_DATASETS.
 */
const FORMER_S_ALASKA_META: Record<string, DatasetMeta> = {
  "kodiak-island": {
    id: "kodiak-island",
    name: "Kodiak Island — Gulf of Alaska",
    description: "Kodiak Island and Chiniak Bay",
    waterType: "saltwater",
    minDepth: 5,
    maxDepth: 360,
    centerLon: -152.5,
    centerLat: 57.8,
    bbox: { minLon: -153.5, minLat: 57.0, maxLon: -151.5, maxLat: 58.6 },
    hasTopography: true,
  },
  "kachemak-bay": {
    id: "kachemak-bay",
    name: "Kachemak Bay — Homer / Cook Inlet",
    description: "Homer Spit, Kachemak Bay, and lower Cook Inlet approaches",
    waterType: "saltwater",
    minDepth: 2,
    maxDepth: 200,
    centerLon: -151.5,
    centerLat: 59.6,
    bbox: { minLon: -152.5, minLat: 59.0, maxLon: -150.5, maxLat: 60.2 },
    hasTopography: true,
  },
  "resurrection-bay": {
    id: "resurrection-bay",
    name: "Resurrection Bay — Seward / Kenai Fjords",
    description: "Seward, Resurrection Bay, and Kenai Fjords approaches",
    waterType: "saltwater",
    minDepth: 5,
    maxDepth: 280,
    centerLon: -149.5,
    centerLat: 60.0,
    bbox: { minLon: -150.5, minLat: 59.4, maxLon: -148.5, maxLat: 60.6 },
    hasTopography: true,
  },
  "prince-william-sound": {
    id: "prince-william-sound",
    name: "Prince William Sound — Valdez / Western Approaches",
    description: "Valdez Arm, Port Valdez, and western Prince William Sound approaches",
    waterType: "saltwater",
    minDepth: 10,
    maxDepth: 760,
    centerLon: -147.5,
    centerLat: 60.8,
    bbox: { minLon: -148.5, minLat: 60.2, maxLon: -146.5, maxLat: 61.4 },
    hasTopography: true,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ESRI ASCII Grid (AAIGRID) string whose elevation values
 * span the requested range so that fetchNceiGrid's near-flat guard
 * (maxDepth - minDepth < 5) is satisfied.
 *
 * The grid is N×N cells. Odd cells get `shallowElev` (shallow ocean),
 * even cells get `deepElev` (deep ocean). Both are negative (below sea
 * level), matching the NCEI sign convention (negative = water, positive = land).
 * A corner cell is set to a positive value (land) so hasTopography fires.
 */
function makeAsciiGrid(
  n: number,
  shallowElev = -20,
  deepElev = -150,
): string {
  const header = [
    `ncols ${n}`,
    `nrows ${n}`,
    `xllcorner -153.5`,
    `yllcorner 57.0`,
    `cellsize 0.01`,
    `NODATA_value -9999`,
  ].join("\n");

  const rows: string[] = [];
  for (let r = 0; r < n; r++) {
    const cells: number[] = [];
    for (let c = 0; c < n; c++) {
      if (r === 0 && c === 0) {
        cells.push(5); // land cell → topography
      } else {
        cells.push((r * n + c) % 2 === 0 ? shallowElev : deepElev);
      }
    }
    rows.push(cells.join(" "));
  }
  return header + "\n" + rows.join("\n");
}

/**
 * Build a truly flat AAIGRID where every cell has the same ocean elevation
 * (`uniformElev`, negative). This produces minDepth === maxDepth, which
 * triggers fetchNceiGrid's near-flat guard (range < 5 m → throws).
 */
function makeFlatAsciiGrid(n: number, uniformElev = -10): string {
  const header = [
    `ncols ${n}`,
    `nrows ${n}`,
    `xllcorner -150.5`,
    `yllcorner 59.4`,
    `cellsize 0.01`,
    `NODATA_value -9999`,
  ].join("\n");

  const row = Array(n).fill(uniformElev).join(" ");
  const rows = Array(n).fill(row);
  return header + "\n" + rows.join("\n");
}

/**
 * Resolve a DatasetMeta by id. Checks PRESET_DATASETS first; falls back to
 * FORMER_S_ALASKA_META for the four Southern Alaska AOIs that were removed
 * from PRESET_DATASETS (they are still valid resolver targets via
 * DATASET_SOURCE_PRIORITY).
 */
function getPreset(id: string): DatasetMeta {
  const meta = PRESET_DATASETS.find((d) => d.id === id) ?? FORMER_S_ALASKA_META[id];
  if (!meta) throw new Error(`no DatasetMeta found for '${id}'`);
  return meta;
}

// ---------------------------------------------------------------------------
// Unit suite — stubbed fetch
// ---------------------------------------------------------------------------

const S_ALASKA_AOIS = [
  "kodiak-island",
  "kachemak-bay",
  "resurrection-bay",
  "prince-william-sound",
] as const;

const GRID_SIZE = 8; // small enough to be fast, large enough for the guard
const STUB_GRID = makeAsciiGrid(GRID_SIZE);

describe("Southern Alaska CRM — unit tests (stubbed WCS fetch)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every Southern Alaska AOI has ncei-crm-s-alaska as its top-ranked source", () => {
    for (const aoi of S_ALASKA_AOIS) {
      const ranked = DATASET_SOURCE_PRIORITY[aoi];
      expect(
        ranked,
        `DATASET_SOURCE_PRIORITY["${aoi}"] is not defined`,
      ).toBeDefined();
      expect(
        ranked![0],
        `${aoi}: first ranked source must be ncei-crm-s-alaska`,
      ).toBe("ncei-crm-s-alaska");
    }
  });

  it("every Southern Alaska AOI has an entry in DATASET_SOURCE_PRIORITY", () => {
    for (const aoi of S_ALASKA_AOIS) {
      expect(
        DATASET_SOURCE_PRIORITY[aoi],
        `DATASET_SOURCE_PRIORITY is missing an entry for '${aoi}'`,
      ).toBeDefined();
    }
  });

  for (const aoi of S_ALASKA_AOIS) {
    it(`resolveBathymetrySource selects ncei-crm-s-alaska for ${aoi}`, async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input) => {
          const url = typeof input === "string" ? input : (input as URL).toString();
          if (url.includes("NOAA_Coastal_Relief_Model_Southern_Alaska")) {
            return new Response(STUB_GRID, { status: 200 });
          }
          throw new Error(`Unexpected fetch call to: ${url}`);
        });

      const meta = getPreset(aoi);
      const res = await resolveBathymetrySource(meta, GRID_SIZE);

      expect(res, `${aoi}: resolver returned null — CRM stub fetch may have failed`).not.toBeNull();
      expect(res!.source.id).toBe("ncei-crm-s-alaska");

      const { depths, minDepth, maxDepth } = res!.result;

      expect(depths.length, `${aoi}: depths.length must equal N²`).toBe(
        GRID_SIZE * GRID_SIZE,
      );

      const nonZeroCells = depths.filter((d) => d > 0).length;
      expect(
        nonZeroCells,
        `${aoi}: expected at least one non-zero depth cell`,
      ).toBeGreaterThan(0);

      expect(Number.isFinite(minDepth), `${aoi}: minDepth must be finite`).toBe(true);
      expect(Number.isFinite(maxDepth), `${aoi}: maxDepth must be finite`).toBe(true);
      expect(minDepth, `${aoi}: minDepth must be ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(maxDepth, `${aoi}: maxDepth must be > minDepth`).toBeGreaterThan(minDepth);
      expect(
        maxDepth - minDepth,
        `${aoi}: depth range must be > 5 m (near-flat guard)`,
      ).toBeGreaterThan(5);

      fetchSpy.mockRestore();
    });
  }

  it("fetchNceiGrid throws and resolver falls through when CRM returns XML error", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as URL).toString();
        if (url.includes("NOAA_Coastal_Relief_Model_Southern_Alaska")) {
          return new Response(
            '<?xml version="1.0"?><ServiceExceptionReport><ServiceException>No data available</ServiceException></ServiceExceptionReport>',
            { status: 200 },
          );
        }
        // BAG Mosaic, DEM Global Mosaic, and GEBCO all fail too
        throw new Error(`Stubbed out: ${url}`);
      });

    const meta = getPreset("kodiak-island");
    const res = await resolveBathymetrySource(meta, GRID_SIZE);

    // All sources should fail → resolver returns null → caller would fall to synthetic
    expect(res).toBeNull();

    fetchSpy.mockRestore();
  });

  it("fetchNceiGrid throws and resolver falls through when CRM returns near-flat grid", async () => {
    // All cells at the same ocean elevation → minDepth === maxDepth → range = 0 < 5 → throws
    const flatGrid = makeFlatAsciiGrid(GRID_SIZE);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as URL).toString();
        if (url.includes("NOAA_Coastal_Relief_Model_Southern_Alaska")) {
          return new Response(flatGrid, { status: 200 });
        }
        throw new Error(`Stubbed out: ${url}`);
      });

    const meta = getPreset("resurrection-bay");
    const res = await resolveBathymetrySource(meta, GRID_SIZE);

    // Near-flat → fetchNceiGrid throws → falls through remaining sources → null
    expect(res).toBeNull();

    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Live WCS smoke suite — opt-in via VITEST_RUN_INTEGRATION=1
//
// Run locally with:
//   VITEST_RUN_INTEGRATION=1 pnpm --filter @workspace/api-server \
//     exec vitest run src/lib/__tests__/southAlaskaCrm.smoke.test.ts
//
// These tests are intentionally excluded from CI (skipped unless the env var
// is set) because they hit the live NCEI WCS endpoint which can be slow
// (15–30 s per tile) and is subject to external availability.
// ---------------------------------------------------------------------------

const LIVE = process.env["VITEST_RUN_INTEGRATION"] === "1";

const LIVE_AOIS: Array<{
  id: string;
  label: string;
  minExpectedMaxDepth: number;
}> = [
  {
    id: "kodiak-island",
    label: "Kodiak Island (Chiniak Bay shelf)",
    minExpectedMaxDepth: 10,
  },
  {
    id: "kachemak-bay",
    label: "Kachemak Bay (Homer / Cook Inlet)",
    minExpectedMaxDepth: 10,
  },
  {
    id: "resurrection-bay",
    label: "Resurrection Bay (Seward / glacial fjord ~275 m)",
    minExpectedMaxDepth: 10,
  },
  {
    id: "prince-william-sound",
    label: "Prince William Sound (Valdez / western PWS)",
    minExpectedMaxDepth: 10,
  },
];

describe.skipIf(!LIVE)(
  "Southern Alaska CRM — live WCS smoke tests (VITEST_RUN_INTEGRATION=1)",
  () => {
    // Generous timeout: the real NCEI endpoint can take 15–30 s per tile.
    const LIVE_TIMEOUT = 90_000;
    const LIVE_N = 32;

    for (const { id, label, minExpectedMaxDepth } of LIVE_AOIS) {
      it(
        `${id}: live CRM returns ncei-crm-s-alaska with valid depth range at N=${LIVE_N} — ${label}`,
        async () => {
          const meta = getPreset(id);
          const res = await resolveBathymetrySource(meta, LIVE_N);

          expect(
            res,
            `${id}: live resolver returned null — endpoint may be unreachable or returned an error`,
          ).not.toBeNull();

          expect(
            res!.source.id,
            `${id}: expected ncei-crm-s-alaska but got '${res?.source.id}' — CRM may have fallen through to a fallback source`,
          ).toBe("ncei-crm-s-alaska");

          const { depths, minDepth, maxDepth } = res!.result;

          expect(depths.length, `${id}: depths.length must equal N²`).toBe(
            LIVE_N * LIVE_N,
          );

          const nonZeroCells = depths.filter((d) => d > 0).length;
          expect(
            nonZeroCells,
            `${id}: at least one non-zero depth cell expected`,
          ).toBeGreaterThan(0);

          expect(
            Number.isFinite(minDepth),
            `${id}: minDepth must be finite`,
          ).toBe(true);
          expect(
            Number.isFinite(maxDepth),
            `${id}: maxDepth must be finite`,
          ).toBe(true);
          expect(maxDepth - minDepth, `${id}: depth range must be > 5 m`).toBeGreaterThan(5);
          expect(
            maxDepth,
            `${id}: maxDepth must exceed ${minExpectedMaxDepth} m for a real survey grid`,
          ).toBeGreaterThan(minExpectedMaxDepth);
        },
        LIVE_TIMEOUT,
      );
    }
  },
);
