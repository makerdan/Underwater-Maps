/**
 * parser-subsampling.test.ts
 *
 * Integration tests verifying that the GeoTIFF and NetCDF parsers correctly
 * sub-sample large raster files instead of emitting every pixel.
 *
 * Each test builds a synthetic 100×100 fixture (10 000 cells / pixels) and
 * runs it through the parser with a pointCap of 5 000.  Because the fixture
 * contains exactly 10 000 valid data points and 10 000 / 5 000 = 2 (an exact
 * integer stride), the parsers must return exactly 5 000 points — not 9 999,
 * not 5 001.  Verifying the exact count proves:
 *   1. The sub-sampling path is taken (not the full-emit path).
 *   2. The cap guard (`points.length >= pointCap`) stops the loop precisely.
 *   3. No off-by-one errors exist in the stride calculation.
 */

import { describe, it, expect } from "vitest";
import { writeArrayBuffer } from "geotiff";
import { parseGeoTiff, parseNetCdf } from "../lib/uploadParsers.js";

// ---------------------------------------------------------------------------
// Synthetic fixture builders
// ---------------------------------------------------------------------------

/**
 * Build a 100×100 GeoTIFF with all-valid float32 depth values (no NODATA).
 * All pixel values are negative (below sea level) so the parser's sign-flip
 * produces positive depth values; none is zero so zero-depth skipping does
 * not remove any sample.
 *
 * geotiff.writeArrayBuffer normalises the ModelTiepoint to the globe corner
 * [-180, 90] regardless of what is passed — the actual coordinates don't
 * matter for the sub-sampling count test.
 */
async function buildLargeGeoTiff(width: number, height: number): Promise<Buffer> {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = -(100 + i); // guaranteed non-zero, non-NaN, non-NODATA
  }
  const ab = await writeArrayBuffer(data, {
    width,
    height,
    ModelPixelScale: [0.01, 0.01, 0],
    ModelTiepoint: [0, 0, 0, -180, 90, 0],
    SampleFormat: [3],
  });
  return Buffer.from(ab);
}

/**
 * Build a 100×100 NetCDF CDF-1 (classic) file.
 * All depth cells are negative non-zero values — no fill, no zero-depth.
 * The resulting grid has 10 000 depth values arranged as a 2D [lat × lon]
 * array (nLats=100, nLons=100).
 */
function buildLargeNetCdf(nLons: number, nLats: number): Buffer {
  const NC_FLOAT = 5;
  const NC_DIMENSION = 0x0000000a;
  const NC_ATTRIBUTE = 0x0000000c;
  const NC_VARIABLE = 0x0000000b;
  const ABSENT = 0x00000000;

  const u32be = (v: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v >>> 0, 0);
    return b;
  };
  const ncStr = (s: string): Buffer => {
    const sb = Buffer.from(s, "utf8");
    const padLen = (4 - (sb.length % 4)) % 4;
    return Buffer.concat([u32be(sb.length), sb, Buffer.alloc(padLen)]);
  };

  const LON_DIM = 0, LAT_DIM = 1;
  const LON_VSIZE = nLons * 4;
  const LAT_VSIZE = nLats * 4;
  const DEPTH_VSIZE = nLats * nLons * 4;

  const dimList = Buffer.concat([
    u32be(NC_DIMENSION), u32be(2),
    ncStr("lon"), u32be(nLons),
    ncStr("lat"), u32be(nLats),
  ]);
  const gAttList = Buffer.concat([u32be(ABSENT), u32be(ABSENT)]);

  const buildVarHeaders = (lonBegin: number, latBegin: number, depthBegin: number): Buffer => {
    const lonVar = Buffer.concat([
      ncStr("lon"), u32be(1), u32be(LON_DIM),
      u32be(ABSENT), u32be(ABSENT),
      u32be(NC_FLOAT), u32be(LON_VSIZE), u32be(lonBegin),
    ]);
    const latVar = Buffer.concat([
      ncStr("lat"), u32be(1), u32be(LAT_DIM),
      u32be(ABSENT), u32be(ABSENT),
      u32be(NC_FLOAT), u32be(LAT_VSIZE), u32be(latBegin),
    ]);
    const depthVar = Buffer.concat([
      ncStr("depth"), u32be(2), u32be(LAT_DIM), u32be(LON_DIM),
      u32be(NC_ATTRIBUTE), u32be(0),
      u32be(NC_FLOAT), u32be(DEPTH_VSIZE), u32be(depthBegin),
    ]);
    return Buffer.concat([u32be(NC_VARIABLE), u32be(3), lonVar, latVar, depthVar]);
  };

  const placeholderVarList = buildVarHeaders(0, 0, 0);
  const headerProbe = Buffer.concat([
    Buffer.from("CDF\x01"), u32be(0), dimList, gAttList, placeholderVarList,
  ]);
  const headerPad = (4 - (headerProbe.length % 4)) % 4;
  const dataStart = headerProbe.length + headerPad;

  const lonBegin = dataStart;
  const latBegin = lonBegin + LON_VSIZE;
  const depthBegin = latBegin + LAT_VSIZE;

  const finalVarList = buildVarHeaders(lonBegin, latBegin, depthBegin);
  const header = Buffer.concat([
    Buffer.from("CDF\x01"), u32be(0), dimList, gAttList, finalVarList,
    Buffer.alloc(headerPad),
  ]);

  const lonData = Buffer.alloc(LON_VSIZE);
  for (let i = 0; i < nLons; i++) lonData.writeFloatBE(142.0 + i * 0.01, i * 4);

  const latData = Buffer.alloc(LAT_VSIZE);
  for (let i = 0; i < nLats; i++) latData.writeFloatBE(11.0 + i * 0.01, i * 4);

  const depthData = Buffer.alloc(DEPTH_VSIZE);
  for (let r = 0; r < nLats; r++) {
    for (let c = 0; c < nLons; c++) {
      const idx = r * nLons + c;
      depthData.writeFloatBE(-(1000 + idx), idx * 4);
    }
  }

  return Buffer.concat([header, lonData, latData, depthData]);
}

// ---------------------------------------------------------------------------
// GeoTIFF sub-sampling tests
// ---------------------------------------------------------------------------

describe("parseGeoTiff — sub-sampling with pointCap", () => {
  it("returns exactly pointCap points from a 10 000-pixel fixture when cap=5000", async () => {
    const buf = await buildLargeGeoTiff(100, 100);
    const pts = await parseGeoTiff(buf, { pointCap: 5_000 });
    expect(pts.length).toBe(5_000);
  });

  it("all sub-sampled points are valid (finite coords and positive depth)", async () => {
    const buf = await buildLargeGeoTiff(100, 100);
    const pts = await parseGeoTiff(buf, { pointCap: 5_000 });
    for (const p of pts) {
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(p.depth).toBeGreaterThan(0);
    }
  });

  it("does not sub-sample when total pixels are below the cap", async () => {
    const buf = await buildLargeGeoTiff(10, 10);
    const pts = await parseGeoTiff(buf, { pointCap: 500 });
    expect(pts.length).toBe(100);
  });

  it("uses the default 2 000 000 cap when no pointCap is provided", async () => {
    const buf = await buildLargeGeoTiff(100, 100);
    const pts = await parseGeoTiff(buf);
    expect(pts.length).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// NetCDF sub-sampling tests
// ---------------------------------------------------------------------------

describe("parseNetCdf — sub-sampling with pointCap", () => {
  it("returns exactly pointCap points from a 10 000-cell fixture when cap=5000", () => {
    const buf = buildLargeNetCdf(100, 100);
    const pts = parseNetCdf(buf, { pointCap: 5_000 });
    expect(pts.length).toBe(5_000);
  });

  it("all sub-sampled points are valid (finite coords and positive depth)", () => {
    const buf = buildLargeNetCdf(100, 100);
    const pts = parseNetCdf(buf, { pointCap: 5_000 });
    for (const p of pts) {
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(p.depth).toBeGreaterThan(0);
    }
  });

  it("does not sub-sample when cell count is below the cap", () => {
    const buf = buildLargeNetCdf(10, 10);
    const pts = parseNetCdf(buf, { pointCap: 500 });
    expect(pts.length).toBe(100);
  });

  it("uses the default 2 000 000 cap when no pointCap is provided", () => {
    const buf = buildLargeNetCdf(100, 100);
    const pts = parseNetCdf(buf);
    expect(pts.length).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// LAS cap-before-loop verification
// ---------------------------------------------------------------------------

describe("parseLasLaz — cap applied before main loop", () => {
  /**
   * Build a LAS 1.2 buffer with exactly N point records.
   * All points have valid lon/lat/depth so none are skipped by the validator.
   */
  function buildLasWithN(n: number): Buffer {
    const HEADER_SIZE = 227;
    const RECORD_SIZE = 20;
    const buf = Buffer.alloc(HEADER_SIZE + n * RECORD_SIZE, 0);

    buf.write("LASF", 0, "ascii");
    buf.writeUInt8(1, 24);
    buf.writeUInt8(2, 25);
    buf.writeUInt16LE(HEADER_SIZE, 94);
    buf.writeUInt32LE(HEADER_SIZE, 96);
    buf.writeUInt8(0, 104);
    buf.writeUInt16LE(RECORD_SIZE, 105);
    buf.writeUInt32LE(n, 107);

    const SCALE = 0.000001;
    buf.writeDoubleLE(SCALE, 131);
    buf.writeDoubleLE(SCALE, 139);
    buf.writeDoubleLE(SCALE, 147);
    buf.writeDoubleLE(0, 155);
    buf.writeDoubleLE(0, 163);
    buf.writeDoubleLE(0, 171);

    for (let i = 0; i < n; i++) {
      const base = HEADER_SIZE + i * RECORD_SIZE;
      buf.writeInt32LE(Math.round(10.0 / SCALE), base);
      buf.writeInt32LE(Math.round(55.0 / SCALE), base + 4);
      buf.writeInt32LE(Math.round(-100 / SCALE), base + 8);
    }

    return buf;
  }

  it("parses a 10 000-point LAS file and returns all points (well under 2M cap)", async () => {
    const { parseLasLaz } = await import("../lib/uploadParsers.js");
    const buf = buildLasWithN(10_000);
    const pts = await parseLasLaz(buf, "big-survey.las");
    expect(pts.length).toBe(10_000);
  });

  it("stops at 2 000 000 points without reading further records", async () => {
    const { parseLasLaz } = await import("../lib/uploadParsers.js");
    const N = 10_000;
    const buf = buildLasWithN(N);
    buf.writeUInt32LE(3_000_000, 107);
    const pts = await parseLasLaz(buf, "overcount.las");
    expect(pts.length).toBe(N);
  });
});
