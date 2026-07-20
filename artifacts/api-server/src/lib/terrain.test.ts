/**
 * Unit tests for terrain.ts — WCS fetcher routing via resolveBathymetrySource.
 *
 * These tests mock global.fetch so no real upstream network calls are made.
 * They verify that the correct WCS coverage (3DEP / Great Lakes / GEBCO) is
 * selected for each dataset category, and that error fallthrough works.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveBathymetrySource,
  getDatasetSourcePriority,
  DATASET_SOURCE_PRIORITY,
  type DatasetMeta,
} from "./terrain.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ESRI ASCII Grid response string.
 * ncols/nrows default to 4; values is a flat row-major array.
 */
function makeAsciiGrid(values: number[], ncols = 4, nrows = 4): string {
  const header = [
    `ncols ${ncols}`,
    `nrows ${nrows}`,
    `xllcorner -73.0`,
    `yllcorner 43.0`,
    `cellsize 0.05`,
    `NODATA_value -9999`,
  ].join("\n");
  const rows: string[] = [];
  for (let r = 0; r < nrows; r++) {
    rows.push(values.slice(r * ncols, (r + 1) * ncols).join(" "));
  }
  return header + "\n" + rows.join("\n");
}

/** A valid 3DEP response: mix of high land values (rim) and lower lake values. */
const VALID_3DEP_GRID = makeAsciiGrid([
  100, 100, 100, 100,
  100,  60,  50, 100,
  100,  55,  45, 100,
  100, 100, 100, 100,
]);

/**
 * A valid Great Lakes DEM response: negative values = below datum (lake floor).
 * minDepth = 80, maxDepth = 200, range = 120 m.
 */
const VALID_GREAT_LAKES_GRID = makeAsciiGrid([
    0,    0,    0,    0,
    0, -100, -200,    0,
    0, -150,  -80,    0,
    0,    0,    0,    0,
]);

/** A valid GEBCO ocean response: negative values = below sea level. */
const VALID_GEBCO_GRID = makeAsciiGrid([
   -50, -100, -200, -400,
  -300, -500, -800, -600,
  -700, -900, -100, -800,
  -400, -300, -200, -100,
]);

function makeOkResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/** Make a DatasetMeta from a minimal set of fields. */
function makeMeta(
  id: string,
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  overrides: Partial<DatasetMeta> = {},
): DatasetMeta {
  return {
    id,
    name: id,
    description: "",
    waterType: "freshwater",
    minDepth: 0,
    maxDepth: 100,
    centerLon: (bbox.minLon + bbox.maxLon) / 2,
    centerLat: (bbox.minLat + bbox.maxLat) / 2,
    bbox,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// URL pattern constants — mirror what the fetchers build
// ---------------------------------------------------------------------------
const URL_3DEP = "elevation.nationalmap.gov";
const URL_GREAT_LAKES = "NOAA_Great_Lakes_mosaics";
const URL_GEBCO = "gebco.net";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveBathymetrySource — WCS fetcher routing", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch") as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // (a) Lake George, NY bbox → usgs-3dep, NOT gebco
  // -------------------------------------------------------------------------
  it("(a) Lake George NY bbox routes to usgs-3dep, not GEBCO", async () => {
    const meta = makeMeta("fw-lake-george-ny", {
      minLon: -73.7,
      minLat: 43.4,
      maxLon: -73.4,
      maxLat: 43.8,
    });

    fetchSpy.mockImplementation(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes(URL_3DEP)) return makeOkResponse(VALID_3DEP_GRID);
      // If GEBCO is accidentally called, return an error to ensure the test catches it
      return new Response("unexpected call to non-3DEP URL", { status: 500 });
    });

    const resolved = await resolveBathymetrySource(meta, 32);
    expect(resolved).not.toBeNull();
    expect(resolved!.source.id).toBe("usgs-3dep");
    // Confirm the 3DEP URL was called
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes(URL_3DEP))).toBe(true);
    // Confirm GEBCO was NOT called (3DEP succeeded first)
    expect(calledUrls.some((u) => u.includes(URL_GEBCO))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (b) Lake Superior bbox → noaa-great-lakes-dem, coverage = superior_lld
  // -------------------------------------------------------------------------
  it("(b) Lake Superior bbox routes to noaa-great-lakes-dem with coverage superior_lld", async () => {
    const meta = makeMeta("fw-lake-superior", {
      minLon: -92.2,
      minLat: 46.3,
      maxLon: -84.3,
      maxLat: 49.0,
    });

    fetchSpy.mockImplementation(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes(URL_GREAT_LAKES)) return makeOkResponse(VALID_GREAT_LAKES_GRID);
      return new Response("unexpected", { status: 500 });
    });

    const resolved = await resolveBathymetrySource(meta, 32);
    expect(resolved).not.toBeNull();
    expect(resolved!.source.id).toBe("noaa-great-lakes-dem");
    // Confirm that the URL contained the correct coverage identifier
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    const greatLakesUrl = calledUrls.find((u) => u.includes(URL_GREAT_LAKES));
    expect(greatLakesUrl).toBeDefined();
    expect(greatLakesUrl).toContain("superior_lld");
  });

  // -------------------------------------------------------------------------
  // (c) Lake Erie bbox → noaa-great-lakes-dem, coverage = erie_lld
  // -------------------------------------------------------------------------
  it("(c) Lake Erie bbox routes to noaa-great-lakes-dem with coverage erie_lld", async () => {
    const meta = makeMeta("fw-lake-erie", {
      minLon: -83.5,
      minLat: 41.4,
      maxLon: -78.8,
      maxLat: 43.0,
    });

    fetchSpy.mockImplementation(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes(URL_GREAT_LAKES)) return makeOkResponse(VALID_GREAT_LAKES_GRID);
      return new Response("unexpected", { status: 500 });
    });

    const resolved = await resolveBathymetrySource(meta, 32);
    expect(resolved).not.toBeNull();
    expect(resolved!.source.id).toBe("noaa-great-lakes-dem");
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    const greatLakesUrl = calledUrls.find((u) => u.includes(URL_GREAT_LAKES));
    expect(greatLakesUrl).toBeDefined();
    expect(greatLakesUrl).toContain("erie_lld");
  });

  // -------------------------------------------------------------------------
  // (d) Open North Atlantic bbox → falls through to GEBCO (regression)
  //
  // North Atlantic center (~-30°, 45°) is outside both Great Lakes bounds and
  // CONUS bounds, so both noaa-great-lakes-dem and usgs-3dep fast-fail without
  // a network call; GEBCO is the only source that reaches the wire.
  // -------------------------------------------------------------------------
  it("(d) North Atlantic bbox resolves via GEBCO (regression — saltwater fallback)", async () => {
    // Use a dataset id not in DATASET_SOURCE_PRIORITY so we hit DEFAULT_SOURCE_PRIORITY
    // (noaa-great-lakes-dem → usgs-3dep → gebco). Both fw fetchers fast-fail for
    // non-CONUS/non-Great-Lakes bboxes without making a network request.
    const meta = makeMeta(
      "ocean-north-atlantic-test",
      {
        minLon: -35,
        minLat: 40,
        maxLon: -25,
        maxLat: 50,
      },
      { waterType: "saltwater" },
    );

    fetchSpy.mockImplementation(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes(URL_GEBCO)) return makeOkResponse(VALID_GEBCO_GRID);
      return new Response("unexpected", { status: 500 });
    });

    const resolved = await resolveBathymetrySource(meta, 32);
    expect(resolved).not.toBeNull();
    expect(resolved!.source.id).toBe("gebco");
    // Confirm GEBCO URL was called
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes(URL_GEBCO))).toBe(true);
    // 3DEP and Great Lakes should NOT have been called (fast-failed without fetch)
    expect(calledUrls.some((u) => u.includes(URL_3DEP))).toBe(false);
    expect(calledUrls.some((u) => u.includes(URL_GREAT_LAKES))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (e) 3DEP network error → chain continues to GEBCO, does not throw
  // -------------------------------------------------------------------------
  it("(e) 3DEP network error → chain continues to GEBCO and does not throw", async () => {
    const meta = makeMeta("fw-lake-george-ny", {
      minLon: -73.7,
      minLat: 43.4,
      maxLon: -73.4,
      maxLat: 43.8,
    });

    fetchSpy.mockImplementation(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes(URL_3DEP)) {
        throw new Error("simulated 3DEP network failure");
      }
      if (urlStr.includes(URL_GEBCO)) return makeOkResponse(VALID_GEBCO_GRID);
      return new Response("unexpected", { status: 500 });
    });

    const resolved = await resolveBathymetrySource(meta, 32);
    expect(resolved).not.toBeNull();
    expect(resolved!.source.id).toBe("gebco");
    // Both 3DEP (threw) and GEBCO (succeeded) should have been attempted
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes(URL_3DEP))).toBe(true);
    expect(calledUrls.some((u) => u.includes(URL_GEBCO))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Source priority list sanity checks (no network calls needed)
  // -------------------------------------------------------------------------
  it("DATASET_SOURCE_PRIORITY: Great Lakes entries use noaa-great-lakes-dem first", () => {
    const greatLakeIds = [
      "fw-lake-superior",
      "fw-lake-michigan",
      "fw-lake-huron",
      "fw-lake-erie",
      "fw-lake-ontario",
    ];
    for (const id of greatLakeIds) {
      const priority = getDatasetSourcePriority(id);
      expect(
        priority[0],
        `${id} should have noaa-great-lakes-dem first`,
      ).toBe("noaa-great-lakes-dem");
    }
  });

  it("DATASET_SOURCE_PRIORITY: Lake Champlain uses usgs-3dep first (no NYSDEC survey)", () => {
    const priority = getDatasetSourcePriority("fw-lake-champlain");
    expect(priority[0], "fw-lake-champlain should have usgs-3dep first").toBe("usgs-3dep");
  });

  it("DATASET_SOURCE_PRIORITY: NYSDEC-surveyed NY lakes lead with nysdec-bathy", () => {
    const nysdecIds = [
      "fw-lake-george-ny",
      "fw-seneca-lake-ny",
      "fw-cayuga-lake-ny",
    ];
    for (const id of nysdecIds) {
      const priority = getDatasetSourcePriority(id);
      expect(priority[0], `${id} should have nysdec-bathy first`).toBe("nysdec-bathy");
    }
  });

  it("DATASET_SOURCE_PRIORITY: Western freshwater reservoirs use usgs-3dep first (except surveyed lakes)", () => {
    const westernIds = [
      "fw-lake-mead",
      "fw-lake-powell",
      "fw-flathead-lake-mt",
    ];
    for (const id of westernIds) {
      const priority = getDatasetSourcePriority(id);
      expect(priority[0], `${id} should have usgs-3dep first`).toBe("usgs-3dep");
    }
  });

  it("DATASET_SOURCE_PRIORITY: USGS ScienceBase-surveyed western lakes lead with bundled-survey", () => {
    const surveyedIds = [
      "fw-crater-lake-or",
      "fw-lake-tahoe",
    ];
    for (const id of surveyedIds) {
      const priority = getDatasetSourcePriority(id);
      expect(priority[0], `${id} should have bundled-survey first`).toBe("bundled-survey");
    }
  });

  it("DATASET_SOURCE_PRIORITY: all freshwater dataset entries include gebco as final fallback", () => {
    const freshwaterPrefix = "fw-";
    const freshwaterDatasets = Object.entries(DATASET_SOURCE_PRIORITY).filter(
      ([id]) => id.startsWith(freshwaterPrefix) || id === "lake-ray-roberts",
    );
    expect(freshwaterDatasets.length).toBeGreaterThan(10);
    for (const [id, sources] of freshwaterDatasets) {
      expect(sources, `${id} should include gebco as fallback`).toContain("gebco");
    }
  });

  it("DATASET_SOURCE_PRIORITY: Thorne Bay uses ncei-bag-mosaic first (SE Alaska regression)", () => {
    const priority = getDatasetSourcePriority("thorne-bay");
    expect(priority[0]).toBe("ncei-bag-mosaic");
  });

  // -------------------------------------------------------------------------
  // MN DNR routing regression guard
  // -------------------------------------------------------------------------

  it("DATASET_SOURCE_PRIORITY: MN DNR surveyed lakes list mn-dnr-bathy first (not usgs-3dep or gebco)", () => {
    const mnDnrSurveyedIds = [
      "fw-lake-minnetonka-mn",
      "fw-mille-lacs-lake-mn",
    ];
    for (const id of mnDnrSurveyedIds) {
      const priority = getDatasetSourcePriority(id);
      expect(
        priority[0],
        `${id} must route to mn-dnr-bathy first — a regression here silently falls through to ${priority[1] ?? "gebco"} at coarse resolution`,
      ).toBe("mn-dnr-bathy");
      expect(
        priority[0],
        `${id} must NOT route to usgs-3dep or gebco first`,
      ).not.toMatch(/^(usgs-3dep|gebco)$/);
    }
  });

  it("DATASET_SOURCE_PRIORITY: all five MN lakes have explicit entries (not falling through to DEFAULT_SOURCE_PRIORITY)", () => {
    const mnLakeIds = [
      "fw-lake-minnetonka-mn",
      "fw-mille-lacs-lake-mn",
      "fw-leech-lake-mn",
      "fw-red-lake-mn",
      "fw-lake-of-the-woods",
    ];
    for (const id of mnLakeIds) {
      expect(
        Object.prototype.hasOwnProperty.call(DATASET_SOURCE_PRIORITY, id),
        `${id} must have an explicit DATASET_SOURCE_PRIORITY entry`,
      ).toBe(true);
    }
  });

  it("DATASET_SOURCE_PRIORITY: all five MN lakes include gebco as final fallback", () => {
    const mnLakeIds = [
      "fw-lake-minnetonka-mn",
      "fw-mille-lacs-lake-mn",
      "fw-leech-lake-mn",
      "fw-red-lake-mn",
      "fw-lake-of-the-woods",
    ];
    for (const id of mnLakeIds) {
      const priority = getDatasetSourcePriority(id);
      expect(
        priority[priority.length - 1],
        `${id} must have gebco as the final fallback`,
      ).toBe("gebco");
    }
  });
});
