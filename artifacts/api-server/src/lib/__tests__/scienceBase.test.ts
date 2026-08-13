/**
 * scienceBase.test.ts
 *
 * Unit tests for the ScienceBase HTTP boundary in `fetchSbItem` (called
 * indirectly via `scienceBaseFetcher.probe`).
 *
 * Scenarios:
 *  1. Valid SbItem response → probe returns available:true with correct title.
 *  2. Shape mismatch (files is a string) → probe returns available:false (null
 *     from fetchSbItem), structured error is logged.
 *  3. Completely empty object → passes schema (all fields optional), treated
 *     as "no TIFF attached".
 *  4. Non-OK HTTP status → probe returns available:false, status logged.
 *  5. Transport failure (fetch throws) → probe returns available:false, cause
 *     logged.
 *  6. Invalid JSON → probe returns available:false, parse error logged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scienceBaseFetcher } from "../fetchers/scienceBase.js";
import type { FetchStrategy } from "../fetchers/types.js";

// ---------------------------------------------------------------------------
// Strategy fixture
// ---------------------------------------------------------------------------
const strategy: FetchStrategy = {
  kind: "sciencebase",
  itemId: "item-abc-123",
  poolElevationM: 0,
  maxDepthM: 100,
} as unknown as FetchStrategy;

const bbox = { minLon: -90, maxLon: -89, minLat: 40, maxLat: 41 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response);
}

function makeFetchStatus(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response);
}

function makeFetchBadJson(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as unknown as Response);
}

function makeFetchNetworkError(msg = "Failed to connect"): typeof fetch {
  return vi.fn().mockRejectedValue(new TypeError(msg));
}

// ---------------------------------------------------------------------------
// Spy on console.error to verify structured logging
// ---------------------------------------------------------------------------
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scienceBaseFetcher.probe — SbItem shape validation", () => {
  it("returns available:true for a well-formed ScienceBase item with a TIFF", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchOk({
        title: "Lake Survey 2024",
        files: [
          { name: "survey.tif", downloadUri: "https://sb.gov/files/survey.tif" },
        ],
        dates: [{ label: "Publication", dateString: "2024-03-01" }],
      }),
    );

    const result = await scienceBaseFetcher.probe(strategy, bbox);

    expect(result.available).toBe(true);
    expect(result.title).toBe("Lake Survey 2024");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns available:false and logs shape mismatch when files is not an array", async () => {
    // files should be SbFile[] but upstream returns a string — shape mismatch
    vi.stubGlobal(
      "fetch",
      makeFetchOk({
        title: "Bad Item",
        files: "not-an-array",
      }),
    );

    const result = await scienceBaseFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    // fetchSbItem returns null → probe reports item unreachable
    expect(result.error).toMatch(/unreachable/i);
    // Structured shape-mismatch log
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("shape mismatch"),
      expect.anything(),
    );
  });

  it("returns available:false (no TIFF) when ScienceBase returns an empty object", async () => {
    // All fields are optional — empty object is a valid SbItem with no files
    vi.stubGlobal("fetch", makeFetchOk({}));

    const result = await scienceBaseFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/no GeoTIFF/i);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns available:false and logs HTTP status when sidecar returns non-OK", async () => {
    vi.stubGlobal("fetch", makeFetchStatus(404));

    const result = await scienceBaseFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/unreachable/i);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("non-OK HTTP status 404"),
    );
  });

  it("returns available:false and logs transport failure when fetch throws", async () => {
    vi.stubGlobal("fetch", makeFetchNetworkError("ECONNREFUSED"));

    const result = await scienceBaseFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/unreachable/i);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("transport failure"),
      expect.anything(),
    );
  });

  it("returns available:false and logs JSON parse error on invalid JSON", async () => {
    vi.stubGlobal("fetch", makeFetchBadJson());

    const result = await scienceBaseFetcher.probe(strategy, bbox);

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/unreachable/i);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid JSON"),
      expect.anything(),
    );
  });
});
