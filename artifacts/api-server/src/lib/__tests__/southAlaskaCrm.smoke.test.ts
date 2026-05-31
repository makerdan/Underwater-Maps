/**
 * southAlaskaCrm.smoke.test.ts
 *
 * Smoke-tests for the four Southern Alaska AOIs wired to the NCEI Southern
 * Alaska Coastal Relief Model (DEM ID 703):
 *   - kodiak-island   (Kodiak / Chiniak Bay)
 *   - kachemak-bay    (Homer / Cook Inlet)
 *   - resurrection-bay (Seward / Kenai Fjords)
 *   - prince-william-sound (Valdez / western PWS)
 *
 * Two complementary suites:
 *
 *   1. Unit suite (always runs) — stubs `globalThis.fetch` to return a
 *      realistic AAIGRID response, then drives the full
 *      resolveBathymetrySource → fetchNceiGrid → SourceFetchResult path.
 *      Asserts that:
 *        • ncei-crm-s-alaska is selected as the winning source for every AOI
 *        • the returned depths array has N*N non-zero cells
 *        • minDepth / maxDepth are finite, positive, and ordered
 *        • the depth range is > 5 m (passes fetchNceiGrid's near-flat guard)
 *
 *   2. Live WCS suite (opt-in, set TEST_LIVE_WCS=true) — hits the real NCEI
 *      Southern Alaska CRM endpoint for two AOIs (kodiak-island and
 *      resurrection-bay), asserts a valid depth range and non-zero cell count
 *      from the live grid.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DATASET_SOURCE_PRIORITY,
  PRESET_DATASETS,
  resolveBathymetrySource,
  type DatasetMeta,
} from "../terrain.js";

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

/** Pull the DatasetMeta from PRESET_DATASETS by id (throws if not found). */
function getPreset(id: string): DatasetMeta {
  const meta = PRESET_DATASETS.find((d) => d.id === id);
  if (!meta) throw new Error(`PRESET_DATASETS has no entry for '${id}'`);
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

  it("every Southern Alaska AOI is present in PRESET_DATASETS", () => {
    for (const aoi of S_ALASKA_AOIS) {
      expect(
        PRESET_DATASETS.some((d) => d.id === aoi),
        `PRESET_DATASETS is missing an entry for '${aoi}'`,
      ).toBe(true);
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
// Live WCS smoke suite — opt-in via TEST_LIVE_WCS=true
// ---------------------------------------------------------------------------

const LIVE = process.env["TEST_LIVE_WCS"] === "true";

describe.skipIf(!LIVE)(
  "Southern Alaska CRM — live WCS smoke tests (TEST_LIVE_WCS=true)",
  () => {
    // Generous timeout: the real NCEI endpoint can take 15–30 s per tile.
    const LIVE_TIMEOUT = 60_000;
    const LIVE_N = 16;

    it(
      "kodiak-island: live CRM grid has valid depth range and non-zero cell count",
      async () => {
        const meta = getPreset("kodiak-island");
        const res = await resolveBathymetrySource(meta, LIVE_N);

        expect(res, "kodiak-island: live resolver returned null").not.toBeNull();
        expect(res!.source.id).toBe("ncei-crm-s-alaska");

        const { depths, minDepth, maxDepth } = res!.result;

        expect(depths.length).toBe(LIVE_N * LIVE_N);
        expect(depths.filter((d) => d > 0).length).toBeGreaterThan(0);
        expect(Number.isFinite(minDepth)).toBe(true);
        expect(Number.isFinite(maxDepth)).toBe(true);
        expect(maxDepth - minDepth).toBeGreaterThan(5);
        // Kodiak has shelf depths to ~360 m — a live grid should exceed 10 m
        expect(maxDepth).toBeGreaterThan(10);
      },
      LIVE_TIMEOUT,
    );

    it(
      "resurrection-bay: live CRM grid has valid depth range and non-zero cell count",
      async () => {
        const meta = getPreset("resurrection-bay");
        const res = await resolveBathymetrySource(meta, LIVE_N);

        expect(res, "resurrection-bay: live resolver returned null").not.toBeNull();
        expect(res!.source.id).toBe("ncei-crm-s-alaska");

        const { depths, minDepth, maxDepth } = res!.result;

        expect(depths.length).toBe(LIVE_N * LIVE_N);
        expect(depths.filter((d) => d > 0).length).toBeGreaterThan(0);
        expect(Number.isFinite(minDepth)).toBe(true);
        expect(Number.isFinite(maxDepth)).toBe(true);
        expect(maxDepth - minDepth).toBeGreaterThan(5);
        // Resurrection Bay is a deep glacial fjord reaching ~275 m
        expect(maxDepth).toBeGreaterThan(10);
      },
      LIVE_TIMEOUT,
    );
  },
);
