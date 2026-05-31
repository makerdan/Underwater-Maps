/**
 * parser-zero-depth-projected-crs.test.ts
 *
 * Tests for two data-correctness fixes in uploadParsers:
 *   1. Zero-depth filtering — depth === 0 is a valid intertidal/shallow measurement
 *      and must not be discarded.
 *   2. Projected coordinate detection — files exported with UTM / State Plane
 *      coordinates should produce a clear, actionable error rather than the
 *      generic "no valid depth points" message.
 */

import { describe, it, expect } from "vitest";
import {
  parseGpxTerrain,
  parseLasLaz,
  parseNetCdf,
  parseGeoTiff,
  looksLikeProjectedCoords,
  PROJECTED_COORD_ERROR,
} from "../lib/uploadParsers.js";

// ---------------------------------------------------------------------------
// Helpers — synthetic binary format builders
// ---------------------------------------------------------------------------

/**
 * Build a minimal LAS 1.2 file in EPSG:4326 (geographic WGS84) coordinates.
 * Uses OFFSET_X=-200 and SCALE_XY=0.000001 which is safe for longitudes
 * in the range [-180, 180] and latitudes in [-90, 90].
 */
function buildMinimalLas(
  points: Array<{ lon: number; lat: number; depthMetres: number }>,
): Buffer {
  const HEADER_SIZE = 227;
  const RECORD_SIZE = 20;
  const SCALE_XY = 0.000001;
  const SCALE_Z = 0.001;
  const OFFSET_X = -200.0;
  const OFFSET_Y = -100.0;
  const OFFSET_Z = 0.0;

  const N = points.length;
  const buf = Buffer.alloc(HEADER_SIZE + N * RECORD_SIZE, 0);
  buf.write("LASF", 0, "ascii");
  buf.writeUInt8(1, 24);
  buf.writeUInt8(2, 25);
  buf.writeUInt16LE(HEADER_SIZE, 94);
  buf.writeUInt32LE(HEADER_SIZE, 96);
  buf.writeUInt8(0, 104);
  buf.writeUInt16LE(RECORD_SIZE, 105);
  buf.writeUInt32LE(N, 107);
  buf.writeDoubleLE(SCALE_XY, 131);
  buf.writeDoubleLE(SCALE_XY, 139);
  buf.writeDoubleLE(SCALE_Z, 147);
  buf.writeDoubleLE(OFFSET_X, 155);
  buf.writeDoubleLE(OFFSET_Y, 163);
  buf.writeDoubleLE(OFFSET_Z, 171);

  for (let i = 0; i < N; i++) {
    const base = HEADER_SIZE + i * RECORD_SIZE;
    const { lon, lat, depthMetres } = points[i]!;
    buf.writeInt32LE(Math.round((lon - OFFSET_X) / SCALE_XY), base);
    buf.writeInt32LE(Math.round((lat - OFFSET_Y) / SCALE_XY), base + 4);
    buf.writeInt32LE(Math.round(-depthMetres / SCALE_Z), base + 8);
  }
  return buf;
}

/**
 * Build a minimal LAS 1.2 file with UTM-range coordinates.
 *
 * UTM eastings are ~530 000 m, northings ~6 100 000 m.  To stay within the
 * Int32 encoded-value range the offset must be set near the centroid of the
 * point cloud and the scale must be ≥ 1 mm/step.
 *
 * Here we use:
 *   OFFSET_X = 530_000, SCALE_X = 1.0  → encoded_x = (easting – 530_000) / 1.0
 *   OFFSET_Y = 6_100_000, SCALE_Y = 1.0
 * All encoded values are small integers (0–900), safely within Int32 range.
 */
function buildUtmLas(
  points: Array<{ easting: number; northing: number; depthMetres: number }>,
): Buffer {
  const HEADER_SIZE = 227;
  const RECORD_SIZE = 20;
  const SCALE_XY = 1.0;      // 1 m precision
  const SCALE_Z = 0.001;
  const OFFSET_X = 530_000;
  const OFFSET_Y = 6_100_000;
  const OFFSET_Z = 0.0;

  const N = points.length;
  const buf = Buffer.alloc(HEADER_SIZE + N * RECORD_SIZE, 0);
  buf.write("LASF", 0, "ascii");
  buf.writeUInt8(1, 24);
  buf.writeUInt8(2, 25);
  buf.writeUInt16LE(HEADER_SIZE, 94);
  buf.writeUInt32LE(HEADER_SIZE, 96);
  buf.writeUInt8(0, 104);
  buf.writeUInt16LE(RECORD_SIZE, 105);
  buf.writeUInt32LE(N, 107);
  buf.writeDoubleLE(SCALE_XY, 131);
  buf.writeDoubleLE(SCALE_XY, 139);
  buf.writeDoubleLE(SCALE_Z, 147);
  buf.writeDoubleLE(OFFSET_X, 155);
  buf.writeDoubleLE(OFFSET_Y, 163);
  buf.writeDoubleLE(OFFSET_Z, 171);

  for (let i = 0; i < N; i++) {
    const base = HEADER_SIZE + i * RECORD_SIZE;
    const { easting, northing, depthMetres } = points[i]!;
    buf.writeInt32LE(Math.round((easting - OFFSET_X) / SCALE_XY), base);
    buf.writeInt32LE(Math.round((northing - OFFSET_Y) / SCALE_XY), base + 4);
    buf.writeInt32LE(Math.round(-depthMetres / SCALE_Z), base + 8);
  }
  return buf;
}


// ---------------------------------------------------------------------------
// looksLikeProjectedCoords — unit tests for the detection helper
// ---------------------------------------------------------------------------

describe("looksLikeProjectedCoords()", () => {
  it("returns false for an empty sample", () => {
    expect(looksLikeProjectedCoords([])).toBe(false);
  });

  it("returns false when all samples are valid WGS84 coords", () => {
    const sample = [
      { x: -132.5, y: 55.2 },
      { x: -132.6, y: 55.3 },
      { x: 142.0, y: 11.0 },
    ];
    expect(looksLikeProjectedCoords(sample)).toBe(false);
  });

  it("returns true for typical UTM zone-10 easting/northing values", () => {
    // Zone 10N, around SE Alaska coast — easting ~530 000, northing ~6 100 000
    const sample = Array.from({ length: 10 }, (_, i) => ({
      x: 530_000 + i * 100,
      y: 6_100_000 + i * 100,
    }));
    expect(looksLikeProjectedCoords(sample)).toBe(true);
  });

  it("returns true when only easting is in projected range (northing looks like latitude)", () => {
    const sample = Array.from({ length: 10 }, (_, i) => ({
      x: 530_000 + i * 10, // easting > 1000 → out of [-180,180]
      y: 45.0 + i * 0.001, // northing in valid-latitude range but x fails
    }));
    expect(looksLikeProjectedCoords(sample)).toBe(true);
  });

  it("returns false when fewer than 90% of samples fail isValidCoord", () => {
    // 5 valid WGS84, 4 UTM → 4/9 ≈ 44% invalid — below 90% threshold
    const sample = [
      { x: -132.5, y: 55.2 },
      { x: -132.6, y: 55.3 },
      { x: -132.7, y: 55.4 },
      { x: -132.8, y: 55.5 },
      { x: -132.9, y: 55.6 },
      { x: 530_000, y: 6_100_000 },
      { x: 530_100, y: 6_100_100 },
      { x: 530_200, y: 6_100_200 },
      { x: 530_300, y: 6_100_300 },
    ];
    expect(looksLikeProjectedCoords(sample)).toBe(false);
  });

  it("returns false when all failures have small absolute values (not projected scale)", () => {
    // Values like lat=91, lon=181 fail isValidCoord but are not UTM-scale
    const sample = Array.from({ length: 10 }, () => ({
      x: 185, // just outside WGS84 but < 1000 — does not look like UTM
      y: 91,
    }));
    expect(looksLikeProjectedCoords(sample)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Zero-depth in GPX parser
// ---------------------------------------------------------------------------

describe("parseGpxTerrain — zero-depth points are included", () => {
  it("includes a <trkpt> with <ele>0</ele> as depth=0", () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="55.200000" lon="-132.500000"><ele>0</ele></trkpt>
    <trkpt lat="55.201000" lon="-132.501000"><ele>-10.0</ele></trkpt>
  </trkseg></trk>
</gpx>`;
    const pts = parseGpxTerrain(gpx);
    expect(pts.length).toBe(2);
    const zeroPt = pts.find((p) => p.depth === 0);
    expect(zeroPt).toBeDefined();
    expect(zeroPt!.lat).toBeCloseTo(55.2, 3);
  });

  it("includes a <trkpt> with <extensions><depth>0</depth></extensions> as depth=0", () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="55.200000" lon="-132.500000">
      <extensions><depth>0</depth></extensions>
    </trkpt>
    <trkpt lat="55.201000" lon="-132.501000"><ele>-5.0</ele></trkpt>
  </trkseg></trk>
</gpx>`;
    const pts = parseGpxTerrain(gpx);
    expect(pts.length).toBe(2);
    const zeroPt = pts.find((p) => p.depth === 0);
    expect(zeroPt).toBeDefined();
  });

  it("includes a <wpt> with <ele>0</ele> as depth=0", () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1">
  <wpt lat="55.200000" lon="-132.500000"><ele>0</ele></wpt>
  <wpt lat="55.201000" lon="-132.501000"><ele>-20.0</ele></wpt>
</gpx>`;
    const pts = parseGpxTerrain(gpx);
    expect(pts.length).toBe(2);
    const zeroPt = pts.find((p) => p.depth === 0);
    expect(zeroPt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Zero-depth in LAS parser
// ---------------------------------------------------------------------------

describe("parseLasLaz — zero-depth points are included", () => {
  it("includes a LAS point with Z=0 (waterline / intertidal survey)", async () => {
    const buf = buildMinimalLas([
      { lon: -132.5, lat: 55.2, depthMetres: 0 },
      { lon: -132.501, lat: 55.201, depthMetres: 5.5 },
      { lon: -132.502, lat: 55.202, depthMetres: 12.0 },
    ]);
    const pts = await parseLasLaz(buf, "test.las");
    expect(pts.length).toBe(3);
    const zeroPt = pts.find((p) => p.depth === 0);
    expect(zeroPt).toBeDefined();
    expect(zeroPt!.lon).toBeCloseTo(-132.5, 2);
  });
});

// ---------------------------------------------------------------------------
// Projected coordinate detection — LAS
// ---------------------------------------------------------------------------

describe("parseLasLaz — UTM coordinates trigger projected-CRS error", () => {
  it("throws the projected-CRS error when all points have UTM-range coordinates", async () => {
    // Simulate a file with X = UTM easting, Y = UTM northing.
    // buildUtmLas uses OFFSET = (530_000, 6_100_000) with SCALE = 1.0 so
    // encoded int32 values are small even though actual values are huge.
    const utmPoints = Array.from({ length: 10 }, (_, i) => ({
      easting:  530_000 + i * 10,
      northing: 6_100_000 + i * 10,
      depthMetres: 50 + i,
    }));
    const buf = buildUtmLas(utmPoints);
    await expect(parseLasLaz(buf, "utm_survey.las")).rejects.toThrow(
      PROJECTED_COORD_ERROR,
    );
  });
});

// ---------------------------------------------------------------------------
// Projected coordinate detection — NetCDF
// ---------------------------------------------------------------------------

describe("parseNetCdf — UTM coordinates trigger projected-CRS error", () => {
  /**
   * Build a minimal CDF-1 NetCDF with lon/lat arrays in UTM-scale range.
   * Re-uses the same hand-coded CDF-1 format as generate.mjs.
   */
  function buildUtmNetCdf(): Buffer {
    const NC_FLOAT = 5;
    const NC_DIMENSION = 0x0000000a;
    const NC_ATTRIBUTE = 0x0000000c;
    const NC_VARIABLE = 0x0000000b;
    const ABSENT = 0x00000000;

    const u32be = (v: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(v >>> 0, 0);
      return b;
    };
    const f32be = (v: number) => {
      const b = Buffer.alloc(4);
      b.writeFloatBE(v, 0);
      return b;
    };
    const ncStr = (s: string) => {
      const sb = Buffer.from(s, "utf8");
      const padLen = (4 - (sb.length % 4)) % 4;
      return Buffer.concat([u32be(sb.length), sb, Buffer.alloc(padLen)]);
    };
    const singleFloatAttr = (name: string, value: number) =>
      Buffer.concat([
        u32be(NC_ATTRIBUTE), u32be(1),
        ncStr(name),
        u32be(NC_FLOAT), u32be(1),
        f32be(value),
      ]);

    const LON_DIM = 0, LAT_DIM = 1;
    const LON_SIZE = 5, LAT_SIZE = 5;
    const LON_VSIZE = LON_SIZE * 4;
    const LAT_VSIZE = LAT_SIZE * 4;
    const DEPTH_VSIZE = LAT_SIZE * LON_SIZE * 4;
    const FILL_VALUE = -32767;

    const dimList = Buffer.concat([
      u32be(NC_DIMENSION), u32be(2),
      ncStr("lon"), u32be(LON_SIZE),
      ncStr("lat"), u32be(LAT_SIZE),
    ]);
    const gAttList = Buffer.concat([u32be(ABSENT), u32be(ABSENT)]);

    const lonVarFn = (begin: number) => Buffer.concat([
      ncStr("lon"),
      u32be(1), u32be(LON_DIM),
      u32be(ABSENT), u32be(ABSENT),
      u32be(NC_FLOAT), u32be(LON_VSIZE),
      u32be(begin),
    ]);
    const latVarFn = (begin: number) => Buffer.concat([
      ncStr("lat"),
      u32be(1), u32be(LAT_DIM),
      u32be(ABSENT), u32be(ABSENT),
      u32be(NC_FLOAT), u32be(LAT_VSIZE),
      u32be(begin),
    ]);
    const depthVarFn = (begin: number) => Buffer.concat([
      ncStr("depth"),
      u32be(2), u32be(LAT_DIM), u32be(LON_DIM),
      singleFloatAttr("_FillValue", FILL_VALUE),
      u32be(NC_FLOAT), u32be(DEPTH_VSIZE),
      u32be(begin),
    ]);

    const varListFn = (lonBegin: number, latBegin: number, depthBegin: number) =>
      Buffer.concat([
        u32be(NC_VARIABLE), u32be(3),
        lonVarFn(lonBegin), latVarFn(latBegin), depthVarFn(depthBegin),
      ]);

    const placeholderHeader = Buffer.concat([
      Buffer.from("CDF\x01"),
      u32be(0),
      dimList, gAttList,
      varListFn(0, 0, 0),
    ]);
    const headerPad = (4 - (placeholderHeader.length % 4)) % 4;
    const dataStart = placeholderHeader.length + headerPad;
    const lonBegin = dataStart;
    const latBegin = lonBegin + LON_VSIZE;
    const depthBegin = latBegin + LAT_VSIZE;

    const finalHeader = Buffer.concat([
      Buffer.from("CDF\x01"),
      u32be(0),
      dimList, gAttList,
      varListFn(lonBegin, latBegin, depthBegin),
      Buffer.alloc(headerPad),
    ]);

    // UTM easting ~530 000, northing ~6 100 000
    const lonData = Buffer.alloc(LON_VSIZE);
    for (let i = 0; i < LON_SIZE; i++) lonData.writeFloatBE(530_000 + i * 100, i * 4);

    const latData = Buffer.alloc(LAT_VSIZE);
    for (let i = 0; i < LAT_SIZE; i++) latData.writeFloatBE(6_100_000 + i * 100, i * 4);

    const depthData = Buffer.alloc(DEPTH_VSIZE);
    for (let idx = 0; idx < LAT_SIZE * LON_SIZE; idx++) {
      depthData.writeFloatBE(-(50 + idx * 5), idx * 4);
    }

    return Buffer.concat([finalHeader, lonData, latData, depthData]);
  }

  it("throws the projected-CRS error when lon/lat arrays contain UTM-scale values", () => {
    const ncBuf = buildUtmNetCdf();
    expect(() => parseNetCdf(ncBuf)).toThrow(PROJECTED_COORD_ERROR);
  });
});

// ---------------------------------------------------------------------------
// Projected coordinate detection — GeoTIFF
// ---------------------------------------------------------------------------

describe("parseGeoTiff — UTM coordinates trigger projected-CRS error", () => {
  it("throws the projected-CRS error when ModelTransformation places the raster in UTM range", async () => {
    // Use ModelTransformation (tag 34264) rather than ModelTiepoint.
    // geotiff.writeArrayBuffer overrides ModelTiepoint with a globe-corner
    // default but does NOT touch ModelTransformation, so the affine matrix we
    // pass is preserved in the output file.
    //
    // The parser reads ModelTransformation first; if present, it uses:
    //   lon0 = transform[3]  (tx = 530 000 — UTM easting)
    //   lat0 = transform[7]  (ty = 6 100 000 — UTM northing)
    //   dLon = transform[0]  (sx = 1.0)
    //   dLat = transform[5]  (sy = -1.0)
    //
    // Every derived lon/lat value will be ~530 000 / 6 100 000, all of which
    // fail isValidCoord and trigger the projected-CRS detection heuristic.
    const { writeArrayBuffer } = await import("geotiff");

    const WIDTH = 4;
    const HEIGHT = 4;
    const data = new Float32Array(WIDTH * HEIGHT).fill(-20.0);

    // 4×4 affine matrix (row-major): [sx, 0, 0, tx, 0, sy, 0, ty, 0, 0, 1, 0, 0, 0, 0, 1]
    const ModelTransformation = [
      1.0, 0, 0, 530_000,
      0, -1.0, 0, 6_100_000,
      0, 0, 0, 0,
      0, 0, 0, 1,
    ];

    const ab = await writeArrayBuffer(data, {
      width: WIDTH,
      height: HEIGHT,
      ModelTransformation,
      GDAL_NODATA: "-9999",
      SampleFormat: [3],
    });
    const buf = Buffer.from(ab);

    await expect(parseGeoTiff(buf)).rejects.toThrow(PROJECTED_COORD_ERROR);
  });
});
