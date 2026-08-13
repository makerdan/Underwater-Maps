/**
 * catalogSeeder.applySampleBbox.test.ts
 *
 * Unit tests for `applySampleBboxFromStatic`.
 *
 * Verifies:
 *   • Valid DB rows are passed through as CatalogSeedEntry values.
 *   • Rows with null or missing required fields (e.g. coverageBbox) are
 *     skipped rather than cast and inserted into the catalog.
 *   • A skipped row triggers a logger.warn call.
 *   • sampleBbox from the staticEntries map is merged onto valid matching rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the logger so we can assert on warn calls without any console noise.
// vi.hoisted() is required because vi.mock() factories are hoisted to the top
// of the file and run before any module-level let/const declarations.
// ---------------------------------------------------------------------------
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock("../logger.js", () => ({
  logger: { warn: mockWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Prevent catalogSeeder from opening a real DB connection at import time.
vi.mock("@workspace/db", () => ({
  db: {},
  datasetCatalogTable: {},
  disabledPresetsTable: {},
}));

// terrain.js is imported at module scope but only its exported constants are
// used; provide minimal stubs so the import resolves without side-effects.
vi.mock("../terrain.js", () => ({
  ALL_PRESET_DATASETS: [],
  NCEI_DATASET_COVERAGES: {},
}));

import { applySampleBboxFromStatic } from "../catalogSeeder.js";
import type { CatalogSeedEntry } from "../catalogSeeder.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_ROW: { id: string; [key: string]: unknown } = {
  id: "ncei-alaska",
  name: "NCEI Alaska Bathymetry",
  sourceAgency: "NOAA NCEI",
  dataType: "bathymetry",
  resolutionMMin: 8,
  resolutionMMax: 32,
  coverageBbox: { minLon: -170, minLat: 54, maxLon: -130, maxLat: 72 },
  endpointUrl: null,
  accessNotes: null,
  description: null,
  keywords: null,
  lastUpdated: null,
  waterType: "saltwater",
};

const NULL_BBOX_ROW: { id: string; [key: string]: unknown } = {
  id: "bad-entry",
  name: "Bad Entry",
  sourceAgency: "Unknown",
  dataType: "bathymetry",
  resolutionMMin: null,
  resolutionMMax: null,
  coverageBbox: null, // <-- invalid: null bbox
  endpointUrl: null,
  accessNotes: null,
  description: null,
  keywords: null,
  lastUpdated: null,
  waterType: "saltwater",
};

const MISSING_BBOX_ROW: { id: string; [key: string]: unknown } = {
  id: "no-bbox-entry",
  name: "No Bbox Entry",
  sourceAgency: "Unknown",
  dataType: "bathymetry",
  // coverageBbox intentionally absent
  resolutionMMin: null,
  resolutionMMax: null,
  endpointUrl: null,
  accessNotes: null,
  description: null,
  keywords: null,
  lastUpdated: null,
  waterType: "freshwater",
};

const INVALID_DATATYPE_ROW: { id: string; [key: string]: unknown } = {
  id: "bad-datatype",
  name: "Bad DataType Entry",
  sourceAgency: "Unknown",
  dataType: "unknown-type", // <-- invalid enum value
  resolutionMMin: null,
  resolutionMMax: null,
  coverageBbox: { minLon: -100, minLat: 40, maxLon: -90, maxLat: 50 },
  endpointUrl: null,
  accessNotes: null,
  description: null,
  keywords: null,
  lastUpdated: null,
  waterType: "freshwater",
};

const STATIC_ENTRY: CatalogSeedEntry = {
  id: "ncei-alaska",
  name: "NCEI Alaska Bathymetry",
  sourceAgency: "NOAA NCEI",
  dataType: "bathymetry",
  resolutionMMin: 8,
  resolutionMMax: 32,
  coverageBbox: { minLon: -170, minLat: 54, maxLon: -130, maxLat: 72 },
  sampleBbox: { minLon: -140, minLat: 58, maxLon: -138, maxLat: 60 },
  endpointUrl: null,
  accessNotes: null,
  description: null,
  keywords: null,
  lastUpdated: null,
  waterType: "saltwater",
};

beforeEach(() => {
  mockWarn.mockClear();
});

// ---------------------------------------------------------------------------
// Happy-path: valid rows pass through
// ---------------------------------------------------------------------------
describe("applySampleBboxFromStatic — valid rows", () => {
  it("returns a valid row as a CatalogSeedEntry", () => {
    const result = applySampleBboxFromStatic([VALID_ROW], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("ncei-alaska");
    expect(result[0]?.coverageBbox).toEqual({ minLon: -170, minLat: 54, maxLon: -130, maxLat: 72 });
  });

  it("merges sampleBbox from the staticEntries map onto a matching valid row", () => {
    const result = applySampleBboxFromStatic([VALID_ROW], [STATIC_ENTRY]);
    expect(result).toHaveLength(1);
    expect(result[0]?.sampleBbox).toEqual({ minLon: -140, minLat: 58, maxLon: -138, maxLat: 60 });
  });

  it("does not merge sampleBbox when the row id has no matching static entry", () => {
    const result = applySampleBboxFromStatic([VALID_ROW], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.sampleBbox).toBeUndefined();
  });

  it("returns an empty array when given no rows", () => {
    expect(applySampleBboxFromStatic([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invalid rows: null / missing bbox
// ---------------------------------------------------------------------------
describe("applySampleBboxFromStatic — null or missing coverageBbox", () => {
  it("skips a row whose coverageBbox is null", () => {
    const result = applySampleBboxFromStatic([NULL_BBOX_ROW], []);
    expect(result).toHaveLength(0);
  });

  it("logs a warning when a null-bbox row is skipped", () => {
    applySampleBboxFromStatic([NULL_BBOX_ROW], []);
    expect(mockWarn).toHaveBeenCalledOnce();
    const [logObj, msg] = mockWarn.mock.calls[0] as [{ id: string; issues: string }, string];
    expect(logObj.id).toBe("bad-entry");
    expect(logObj.issues).toMatch(/coverageBbox/);
    expect(msg).toMatch(/skipping invalid DB row/);
  });

  it("skips a row that is missing coverageBbox entirely", () => {
    const result = applySampleBboxFromStatic([MISSING_BBOX_ROW], []);
    expect(result).toHaveLength(0);
  });

  it("logs a warning when a missing-bbox row is skipped", () => {
    applySampleBboxFromStatic([MISSING_BBOX_ROW], []);
    expect(mockWarn).toHaveBeenCalledOnce();
    const [logObj] = mockWarn.mock.calls[0] as [{ id: string; issues: string }];
    expect(logObj.id).toBe("no-bbox-entry");
    expect(logObj.issues).toMatch(/coverageBbox/);
  });
});

// ---------------------------------------------------------------------------
// Invalid rows: bad dataType enum
// ---------------------------------------------------------------------------
describe("applySampleBboxFromStatic — invalid dataType", () => {
  it("skips a row with an unrecognised dataType", () => {
    const result = applySampleBboxFromStatic([INVALID_DATATYPE_ROW], []);
    expect(result).toHaveLength(0);
  });

  it("logs a warning with the id and issue details when dataType is invalid", () => {
    applySampleBboxFromStatic([INVALID_DATATYPE_ROW], []);
    expect(mockWarn).toHaveBeenCalledOnce();
    const [logObj] = mockWarn.mock.calls[0] as [{ id: string; issues: string }];
    expect(logObj.id).toBe("bad-datatype");
    expect(logObj.issues).toMatch(/dataType/);
  });
});

// ---------------------------------------------------------------------------
// Mixed rows: valid and invalid together
// ---------------------------------------------------------------------------
describe("applySampleBboxFromStatic — mixed valid and invalid rows", () => {
  it("returns only the valid rows when a mix is supplied", () => {
    const result = applySampleBboxFromStatic(
      [VALID_ROW, NULL_BBOX_ROW, MISSING_BBOX_ROW],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("ncei-alaska");
  });

  it("emits one warning per invalid row", () => {
    applySampleBboxFromStatic([VALID_ROW, NULL_BBOX_ROW, MISSING_BBOX_ROW], []);
    expect(mockWarn).toHaveBeenCalledTimes(2);
  });
});
