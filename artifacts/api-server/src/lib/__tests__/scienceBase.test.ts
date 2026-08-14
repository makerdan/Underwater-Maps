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

/**
 * A valid ScienceBase catalog-item response that has one GeoTIFF attached.
 */
const VALID_SB_ITEM = {
  title: "Lake Survey 2024",
  files: [{ name: "survey.tif", downloadUri: "https://sb.gov/files/survey.tif" }],
};

/**
 * Build a fetch mock that returns `catalogItem` for the first call (SbItem
 * JSON) and `tiffResponse` for the second call (GeoTIFF download).
 */
function makeTwoStepFetch(
  catalogItem: unknown,
  tiffResponse: { ok: boolean; status?: number; arrayBuffer?: ArrayBuffer },
): typeof fetch {
  return vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => catalogItem,
    } as unknown as Response)
    .mockResolvedValueOnce({
      ok: tiffResponse.ok,
      status: tiffResponse.status ?? 200,
      arrayBuffer: async () => tiffResponse.arrayBuffer ?? new ArrayBuffer(0),
    } as unknown as Response);
}

/**
 * Build a minimal 1×1 F32 GeoTIFF ArrayBuffer in little-endian TIFF format.
 *
 * The geo metadata encodes a WGS84 geographic CRS (ModelType=2) positioned
 * at the origin supplied.  Because bilinearSample requires at least a 2×2
 * neighbourhood (c1 = c0+1 must be < width), a 1×1 raster always returns NaN
 * for every sample → extractDepthGrid returns null → "does not cover" branch.
 */
function buildMinimalF32GeoTiff(originLon = 0, originLat = -60): ArrayBuffer {
  // Layout:
  //   0: TIFF header (8 bytes)
  //   8: IFD (2 + 12*12 + 4 = 150 bytes, ends at 158)
  // 158: ModelPixelScale tag data – 3 float64s (24 bytes, ends at 182)
  // 182: ModelTiepoint tag data  – 6 float64s (48 bytes, ends at 230)
  // 230: GeoKeyDirectory tag data – 8 uint16s (16 bytes, ends at 246)
  // 246: 2 bytes padding so pixel data is 4-byte-aligned (Float32Array requirement)
  // 248: pixel data               – 1 float32  (4 bytes, total 252)
  const TOTAL = 252;
  const buf = new ArrayBuffer(TOTAL);
  const dv = new DataView(buf);

  // ---- TIFF header (little-endian) ----
  dv.setUint8(0, 0x49); // 'I'
  dv.setUint8(1, 0x49); // 'I'
  dv.setUint16(2, 42, true); // magic
  dv.setUint32(4, 8, true); // IFD offset

  // ---- IFD ----
  const IFD_OFF = 8;
  const NUM_ENTRIES = 12;
  dv.setUint16(IFD_OFF, NUM_ENTRIES, true);

  const PIXEL_SCALE_OFF = 158;
  const TIEPOINT_OFF = 182;
  const GEOKEY_OFF = 230;
  const PIXEL_DATA_OFF = 248; // must be 4-byte-aligned for Float32Array

  // Helper: write one IFD entry (tag, type, count, value-or-offset)
  let entryIdx = 0;
  function writeEntry(tag: number, type: number, count: number, valueOrOffset: number): void {
    const off = IFD_OFF + 2 + entryIdx * 12;
    dv.setUint16(off, tag, true);
    dv.setUint16(off + 2, type, true);
    dv.setUint32(off + 4, count, true);
    // For SHORT values that fit in 4 bytes, store inline (left-justified in LE)
    if (type === 3 && count === 1) {
      dv.setUint16(off + 8, valueOrOffset, true);
      dv.setUint16(off + 10, 0, true);
    } else {
      dv.setUint32(off + 8, valueOrOffset, true);
    }
    entryIdx++;
  }

  // Entries must be in ascending tag order
  writeEntry(256, 3, 1, 1);           // ImageWidth  = 1
  writeEntry(257, 3, 1, 1);           // ImageLength = 1
  writeEntry(258, 3, 1, 32);          // BitsPerSample = 32
  writeEntry(273, 4, 1, PIXEL_DATA_OFF); // StripOffsets
  writeEntry(277, 3, 1, 1);           // SamplesPerPixel = 1
  writeEntry(278, 3, 1, 1);           // RowsPerStrip = 1
  writeEntry(279, 4, 1, 4);           // StripByteCounts = 4
  writeEntry(284, 3, 1, 1);           // PlanarConfiguration = 1 (chunky)
  writeEntry(339, 3, 1, 3);           // SampleFormat = 3 (float)
  writeEntry(33550, 12, 3, PIXEL_SCALE_OFF); // ModelPixelScaleTag
  writeEntry(33922, 12, 6, TIEPOINT_OFF);    // ModelTiepointTag
  writeEntry(34735, 3, 8, GEOKEY_OFF);       // GeoKeyDirectoryTag

  // Next IFD offset = 0
  dv.setUint32(IFD_OFF + 2 + NUM_ENTRIES * 12, 0, true);

  // ---- ModelPixelScale: [scaleX, scaleY, scaleZ] ----
  dv.setFloat64(PIXEL_SCALE_OFF + 0, 0.001, true);
  dv.setFloat64(PIXEL_SCALE_OFF + 8, 0.001, true);
  dv.setFloat64(PIXEL_SCALE_OFF + 16, 0, true);

  // ---- ModelTiepoint: [I, J, K, X, Y, Z] ----
  dv.setFloat64(TIEPOINT_OFF + 0, 0, true);  // I (pixel col)
  dv.setFloat64(TIEPOINT_OFF + 8, 0, true);  // J (pixel row)
  dv.setFloat64(TIEPOINT_OFF + 16, 0, true); // K
  dv.setFloat64(TIEPOINT_OFF + 24, originLon, true); // X (geo lon of top-left)
  dv.setFloat64(TIEPOINT_OFF + 32, originLat, true); // Y (geo lat of top-left)
  dv.setFloat64(TIEPOINT_OFF + 40, 0, true); // Z

  // ---- GeoKeyDirectory: KeyDirectoryVersion=1, KeyRevision=1,
  //      MinorRevision=0, NumberOfKeys=1, Key: 1024 (ModelType)=2 (Geographic) ----
  dv.setUint16(GEOKEY_OFF + 0, 1, true);    // KeyDirectoryVersion
  dv.setUint16(GEOKEY_OFF + 2, 1, true);    // KeyRevision
  dv.setUint16(GEOKEY_OFF + 4, 0, true);    // MinorRevision
  dv.setUint16(GEOKEY_OFF + 6, 1, true);    // NumberOfKeys
  dv.setUint16(GEOKEY_OFF + 8, 1024, true); // KeyId: GTModelTypeGeoKey
  dv.setUint16(GEOKEY_OFF + 10, 0, true);   // TIFFTagLocation = 0 (value in offset field)
  dv.setUint16(GEOKEY_OFF + 12, 1, true);   // Count
  dv.setUint16(GEOKEY_OFF + 14, 2, true);   // Value: ModelTypeGeographic

  // ---- Pixel data: one float32 depth value (e.g. 5.0 m) ----
  dv.setFloat32(PIXEL_DATA_OFF, 5.0, true);

  return buf;
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

// ---------------------------------------------------------------------------
// fetch() — GeoTIFF download guard tests
// ---------------------------------------------------------------------------

describe("scienceBaseFetcher.fetch — GeoTIFF download validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a descriptive error including the item ID on non-OK download HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      makeTwoStepFetch(VALID_SB_ITEM, { ok: false, status: 403 }),
    );

    await expect(scienceBaseFetcher.fetch(strategy, bbox, 4)).rejects.toThrow(
      /item-abc-123.*download HTTP 403/i,
    );
  });

  it("throws a descriptive error including the item ID when the download buffer is too short to be a valid TIFF", async () => {
    // A 4-byte buffer cannot contain a full TIFF header; readTiffWithGeo will
    // throw a DataView bounds error which must be caught and re-wrapped.
    vi.stubGlobal(
      "fetch",
      makeTwoStepFetch(VALID_SB_ITEM, { ok: true, arrayBuffer: new ArrayBuffer(4) }),
    );

    await expect(scienceBaseFetcher.fetch(strategy, bbox, 4)).rejects.toThrow(
      /item-abc-123.*failed to parse GeoTIFF/i,
    );
  });

  it("throws a descriptive error including the item ID when the GeoTIFF does not cover the requested bbox", async () => {
    // buildMinimalF32GeoTiff() returns a 1×1 raster. bilinearSample always
    // returns NaN for a 1×1 grid (needs 2×2 neighbourhood), so
    // extractDepthGrid reports zero valid pixels → null → "does not cover".
    vi.stubGlobal(
      "fetch",
      makeTwoStepFetch(VALID_SB_ITEM, {
        ok: true,
        arrayBuffer: buildMinimalF32GeoTiff(),
      }),
    );

    await expect(scienceBaseFetcher.fetch(strategy, bbox, 4)).rejects.toThrow(
      /item-abc-123.*does not cover/i,
    );
  });
});

// ---------------------------------------------------------------------------
// probe() — SbItem shape validation
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
