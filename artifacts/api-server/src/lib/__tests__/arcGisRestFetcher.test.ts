/**
 * arcGisRestFetcher.test.ts
 *
 * Unit tests for the ArcGIS REST probe HTTP boundary in `arcGisRestFetcher`.
 *
 * Scenarios:
 *  1. Valid response with features → probe returns available:true.
 *  2. ArcGIS error body → probe returns available:false with the error message.
 *  3. Empty features array → probe returns available:false ("No features").
 *  4. Shape mismatch (features is a string) → available:false + structured log.
 *  5. Invalid JSON body → available:false + structured log.
 *  6. Non-OK HTTP status → available:false.
 *  7. Network/transport failure → available:false.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock terrain.js so its side-effectful module init doesn't run in tests
// ---------------------------------------------------------------------------
vi.mock("../terrain.js", async () => {
  const { createTerrainMock } = await import(
    "../../__tests__/helpers/terrainMock.js"
  );
  return createTerrainMock();
});

import { arcGisRestFetcher } from "../fetchers/arcGisRest.js";
import type { FetchStrategy } from "../fetchers/types.js";

// ---------------------------------------------------------------------------
// Strategy fixture
// ---------------------------------------------------------------------------
const strategy: FetchStrategy = {
  kind: "arcgis-rest",
  serviceUrl: "https://services.arcgis.com/fake/FeatureServer/0",
  sourceLabel: "Test ArcGIS Source",
  dataSource: "arcgis-test",
  creditUrl: "https://example.com",
} as unknown as FetchStrategy;

const bbox = { minLon: -74.1, maxLon: -73.9, minLat: 40.6, maxLat: 40.8 };

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------
function makeJsonOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response);
}

function makeJsonBadParse(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as unknown as Response);
}

function makeHttpError(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response);
}

function makeNetworkError(msg = "ECONNREFUSED"): typeof fetch {
  return vi.fn().mockRejectedValue(new TypeError(msg));
}

// ---------------------------------------------------------------------------
// console.error spy
// ---------------------------------------------------------------------------
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("arcGisRestFetcher.probe — ArcGIS JSON shape validation", () => {
  it("returns available:true when features are present", async () => {
    vi.stubGlobal(
      "fetch",
      makeJsonOk({ features: [{ attributes: { depth: 5 } }] }),
    );

    const result = await arcGisRestFetcher.probe(strategy, bbox);

    expect(result.available).toBe(true);
    expect(result.title).toBe("Test ArcGIS Source");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns available:false with the ArcGIS error message", async () => {
    vi.stubGlobal(
      "fetch",
      makeJsonOk({ error: { message: "Token Required", code: 499 } }),
    );

    const result = await arcGisRestFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/Token Required/);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns available:false when features array is empty", async () => {
    vi.stubGlobal("fetch", makeJsonOk({ features: [] }));

    const result = await arcGisRestFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/No features/i);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns available:false and logs shape mismatch when features is not an array", async () => {
    // Upstream returns `features` as a string instead of an array
    vi.stubGlobal("fetch", makeJsonOk({ features: "broken" }));

    const result = await arcGisRestFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/shape/i);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("shape mismatch"),
      expect.anything(),
    );
    expect(consoleSpy.mock.calls[0]![0]).toContain(
      "services.arcgis.com/fake/FeatureServer/0",
    );
  });

  it("returns available:false and logs when upstream returns invalid JSON", async () => {
    vi.stubGlobal("fetch", makeJsonBadParse());

    const result = await arcGisRestFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/invalid JSON/i);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid JSON"),
    );
  });

  it("returns available:false on non-OK HTTP status", async () => {
    vi.stubGlobal("fetch", makeHttpError(503));

    const result = await arcGisRestFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/HTTP 503/);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns available:false on network/transport failure", async () => {
    vi.stubGlobal("fetch", makeNetworkError("Failed to connect"));

    const result = await arcGisRestFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/Failed to connect/);
  });

  it("returns available:false for the wrong strategy kind", async () => {
    const wrongStrategy = { kind: "gebco-wcs" } as unknown as FetchStrategy;
    const result = await arcGisRestFetcher.probe(wrongStrategy, bbox);
    expect(result.available).toBe(false);
    expect(result.error).toMatch(/Wrong strategy kind/i);
  });
});
