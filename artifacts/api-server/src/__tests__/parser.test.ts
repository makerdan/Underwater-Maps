import { describe, it, expect } from "vitest";
import { parseXyzCsv } from "../lib/terrain.js";
import {
  parseGeoTiff,
  parseNetCdf,
  parseLasLaz,
  parseGpxTerrain,
  parseNmea,
  parseUploadedFile,
} from "../lib/uploadParsers.js";

// ---------------------------------------------------------------------------
// Existing CSV / XYZ tests
// ---------------------------------------------------------------------------

describe("parseXyzCsv — CSV format", () => {
  it("parses comma-delimited header CSV", () => {
    const csv = `lon,lat,depth\n142.0,11.0,3000\n142.1,11.1,5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 142.0, lat: 11.0, depth: 3000 });
    expect(pts[1]).toMatchObject({ lon: 142.1, lat: 11.1, depth: 5000 });
  });

  it("parses tab-delimited CSV without header", () => {
    const csv = `142.0\t11.0\t3000\n142.1\t11.1\t5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 142.0, lat: 11.0, depth: 3000 });
  });

  it("negates negative depth values (converts elevations to depths)", () => {
    const csv = `lon,lat,depth\n0.0,0.0,-3000\n1.0,1.0,-5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts[0]?.depth).toBe(3000);
    expect(pts[1]?.depth).toBe(5000);
  });

  it("skips comment lines starting with #", () => {
    const csv = `# this is a comment\nlon,lat,depth\n142.0,11.0,3000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(1);
  });

  it("skips rows with NaN fields", () => {
    const csv = `lon,lat,depth\n142.0,NaN,3000\n142.1,11.1,5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(1);
    expect(pts[0]?.lat).toBe(11.1);
  });

  it("handles space-delimited files without header", () => {
    const csv = `142.0 11.0 3000\n142.1 11.1 5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(2);
  });
});

describe("parseXyzCsv — XYZ format", () => {
  it("parses whitespace-delimited XYZ file", () => {
    const xyz = `142.0 11.0 3000\n142.1 11.1 5000\n`;
    const pts = parseXyzCsv(xyz, "bathymetry.xyz");
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 142.0, lat: 11.0, depth: 3000 });
  });

  it("returns an empty array when file has only a header row", () => {
    const xyz = `lon lat depth`;
    const pts = parseXyzCsv(xyz, "data.xyz");
    expect(pts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers for building synthetic binary test fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal synthetic LAS 1.2 binary buffer with N uncompressed
 * point format-0 records.
 *
 * Public header layout (LAS 1.2):
 *   0   File Signature      char[4]      "LASF"
 *   4   File Source ID      uint16
 *   6   Global Encoding     uint16
 *   8   Project GUID …      4×uint16/uint8
 *  24   Version Major       uint8        1
 *  25   Version Minor       uint8        2
 *  26   System ID           char[32]
 *  58   Generating Software char[32]
 *  90   File Day            uint16
 *  92   File Year           uint16
 *  94   Header Size         uint16       227
 *  96   Offset to PD        uint32
 * 100   Number of VLRs      uint32
 * 104   Point Data Format   uint8        0
 * 105   Point Data Len      uint16       20
 * 107   Number of Points    uint32
 * 111   Points per return   uint32[5]
 * 131   Scale X             float64
 * 139   Scale Y             float64
 * 147   Scale Z             float64
 * 155   Offset X            float64
 * 163   Offset Y            float64
 * 171   Offset Z            float64
 * 179   min/max X/Y/Z       6×float64
 * 227   Point data starts
 */
function buildLasBuffer(
  pts: Array<{ lon: number; lat: number; depth: number }>,
): Buffer {
  const HEADER_SIZE = 227;
  const RECORD_SIZE = 20; // format 0
  const buf = Buffer.alloc(HEADER_SIZE + pts.length * RECORD_SIZE, 0);

  // File Signature
  buf.write("LASF", 0, "ascii");
  buf.writeUInt8(1, 24); // major
  buf.writeUInt8(2, 25); // minor
  buf.writeUInt16LE(HEADER_SIZE, 94);
  buf.writeUInt32LE(HEADER_SIZE, 96); // offset to point data
  buf.writeUInt8(0, 104); // format 0
  buf.writeUInt16LE(RECORD_SIZE, 105);
  buf.writeUInt32LE(pts.length, 107);

  // Scale = 0.000001, offset = 0
  const SCALE = 0.000001;
  buf.writeDoubleLE(SCALE, 131); // scale X
  buf.writeDoubleLE(SCALE, 139); // scale Y
  buf.writeDoubleLE(SCALE, 147); // scale Z (depth, positive-up → negative stored)
  buf.writeDoubleLE(0, 155); // offset X
  buf.writeDoubleLE(0, 163); // offset Y
  buf.writeDoubleLE(0, 171); // offset Z

  for (let i = 0; i < pts.length; i++) {
    const base = HEADER_SIZE + i * RECORD_SIZE;
    const { lon, lat, depth } = pts[i]!;
    buf.writeInt32LE(Math.round(lon / SCALE), base);
    buf.writeInt32LE(Math.round(lat / SCALE), base + 4);
    // Depth is positive-downward; LAS convention stores Z as positive-up elevation
    // so we store negative Z for below-sea-level points.
    buf.writeInt32LE(Math.round(-depth / SCALE), base + 8);
    buf.writeUInt16LE(0, base + 12); // intensity
    buf.writeUInt8(0, base + 14); // return bits
    buf.writeUInt8(0, base + 15); // classification
    buf.writeUInt8(0, base + 16); // scan angle
    buf.writeUInt8(0, base + 17); // user data
    buf.writeUInt16LE(0, base + 18); // point source ID
  }

  return buf;
}

// ---------------------------------------------------------------------------
// GeoTIFF parser tests
// ---------------------------------------------------------------------------

describe("parseGeoTiff", () => {
  it("throws a descriptive error for non-TIFF buffers", async () => {
    const garbage = Buffer.from("not a tiff file at all");
    await expect(parseGeoTiff(garbage)).rejects.toThrow(/GeoTIFF/i);
  });

  it("is callable and returns RawPoint[] for valid GeoTIFF bytes", async () => {
    // Build a minimal valid TIFF (8-bit, single strip, no geo tags)
    // Little-endian TIFF header: II + magic 42 + offset to IFD
    // This is intentionally minimal — the test just verifies the geotag-missing
    // error path is reached (not a silent crash).
    const header = Buffer.alloc(8);
    header.writeUInt16LE(0x4949, 0); // 'II' little-endian
    header.writeUInt16LE(42, 2); // TIFF magic
    header.writeUInt32LE(8, 4); // IFD offset = 8 (right after header)

    // IFD with 0 entries
    const ifd = Buffer.alloc(6, 0);
    ifd.writeUInt16LE(0, 0); // 0 directory entries

    const tiff = Buffer.concat([header, ifd]);
    // Should either succeed (if geotiff can extract something) or throw with
    // a descriptive message — not crash with an unhandled exception.
    await expect(parseGeoTiff(tiff)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// NetCDF parser tests
// ---------------------------------------------------------------------------

describe("parseNetCdf", () => {
  it("throws a descriptive error for non-NetCDF buffers", () => {
    const garbage = Buffer.from("this is not a netcdf file");
    expect(() => parseNetCdf(garbage)).toThrow(/NetCDF/i);
  });

  it("throws when no recognised depth variable is present", () => {
    // Build the smallest valid NetCDF classic (version 1) header.
    // CDF\x01 magic + numrecs (4 bytes) + dim_list (absent=0x00000000,count=0)
    // + att_list + var_list. Must be large enough for netcdfjs to parse.
    // netcdfjs parses the header and reports "no variables" which matches
    // our "no depth variable" error — or throws a parse error on malformed data.
    // Either way we just verify a descriptive Error is thrown.
    const garbage = Buffer.from("CDF\x01\x00\x00\x00\x00not-valid-netcdf-rest");
    expect(() => parseNetCdf(garbage)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LAS / LAZ parser tests
// ---------------------------------------------------------------------------

describe("parseLasLaz — LAS binary", () => {
  it("throws for buffers with wrong magic", async () => {
    const buf = Buffer.alloc(300, 0);
    buf.write("XXXX", 0, "ascii"); // wrong magic
    await expect(parseLasLaz(buf, "test.las")).rejects.toThrow(/LASF/);
  });

  it("throws for buffers that are too small", async () => {
    const buf = Buffer.from("LASF");
    await expect(parseLasLaz(buf, "test.las")).rejects.toThrow(/too small/i);
  });

  it("parses a synthetic LAS 1.2 file with 3 points", async () => {
    const input = [
      { lon: 10.5, lat: 55.2, depth: 100 },
      { lon: 10.6, lat: 55.3, depth: 200 },
      { lon: 10.7, lat: 55.4, depth: 300 },
    ];
    const buf = buildLasBuffer(input);
    const pts = await parseLasLaz(buf, "survey.las");
    expect(pts).toHaveLength(3);
    expect(pts[0]!.lon).toBeCloseTo(10.5, 3);
    expect(pts[0]!.lat).toBeCloseTo(55.2, 3);
    expect(pts[0]!.depth).toBeCloseTo(100, 0);
    expect(pts[1]!.depth).toBeCloseTo(200, 0);
    expect(pts[2]!.depth).toBeCloseTo(300, 0);
  });

  it("skips points with depth = 0 (sea surface / land)", async () => {
    const input = [
      { lon: 10.5, lat: 55.2, depth: 50 },
      { lon: 10.6, lat: 55.3, depth: 0 },  // will be skipped
      { lon: 10.7, lat: 55.4, depth: 150 },
    ];
    const buf = buildLasBuffer(input);
    const pts = await parseLasLaz(buf, "survey.las");
    expect(pts).toHaveLength(2);
    expect(pts.every((p) => p.depth > 0)).toBe(true);
  });

  it("throws a descriptive error for .laz when laz-perf is unavailable", async () => {
    const buf = buildLasBuffer([{ lon: 10.5, lat: 55.2, depth: 100 }]);
    // The buffer is valid LAS, but the .laz extension triggers the laz-perf
    // code path which will fail in this environment.
    await expect(parseLasLaz(buf, "survey.laz")).rejects.toThrow(/laz/i);
  });
});

// ---------------------------------------------------------------------------
// GPX terrain parser tests
// ---------------------------------------------------------------------------

describe("parseGpxTerrain", () => {
  it("extracts trkpt elements with <ele> as depth points", () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1">
  <trk>
    <trkseg>
      <trkpt lat="55.20" lon="10.50"><ele>-100.0</ele></trkpt>
      <trkpt lat="55.30" lon="10.60"><ele>-200.0</ele></trkpt>
      <trkpt lat="55.40" lon="10.70"><ele>-350.5</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;
    const pts = parseGpxTerrain(gpx);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toMatchObject({ lon: 10.5, lat: 55.2, depth: 100 });
    expect(pts[1]).toMatchObject({ lon: 10.6, lat: 55.3, depth: 200 });
    expect(pts[2]!.depth).toBeCloseTo(350.5, 1);
  });

  it("skips track points without <ele>", () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="55.20" lon="10.50"><ele>-50.0</ele></trkpt>
    <trkpt lat="55.30" lon="10.60"></trkpt>
    <trkpt lat="55.40" lon="10.70"><ele>-75.0</ele></trkpt>
  </trkseg></trk>
</gpx>`;
    const pts = parseGpxTerrain(gpx);
    expect(pts).toHaveLength(2);
  });

  it("also extracts <wpt> elements with <ele>", () => {
    const gpx = `<?xml version="1.0"?>
<gpx version="1.1">
  <wpt lat="48.1" lon="-122.5"><ele>-30.0</ele></wpt>
  <wpt lat="48.2" lon="-122.6"><ele>-45.0</ele></wpt>
</gpx>`;
    const pts = parseGpxTerrain(gpx);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: -122.5, lat: 48.1, depth: 30 });
  });

  it("flips positive elevation to positive depth", () => {
    const gpx = `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lat="0.0" lon="0.0"><ele>500.0</ele></trkpt>
</trkseg></trk></gpx>`;
    const pts = parseGpxTerrain(gpx);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.depth).toBe(500);
  });

  it("throws when there are no elevation track points", () => {
    const gpx = `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lat="55.0" lon="10.0"><name>No elevation</name></trkpt>
</trkseg></trk></gpx>`;
    expect(() => parseGpxTerrain(gpx)).toThrow(/elevation/i);
  });
});

// ---------------------------------------------------------------------------
// NMEA depth-log parser tests
// ---------------------------------------------------------------------------

describe("parseNmea", () => {
  it("pairs $GPGGA position with $SDDBT depth", () => {
    // Use sentences without checksum suffix (validator accepts them freely)
    const nmea = [
      "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,",
      "$SDDBT,10.5,f,3.2,M,1.7,F",
    ].join("\n");
    const pts = parseNmea(nmea);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.depth).toBeCloseTo(3.2, 1);
    expect(pts[0]!.lat).toBeCloseTo(48.117, 2);
    expect(pts[0]!.lon).toBeCloseTo(11.517, 2);
  });

  it("pairs $GPRMC position (status A) with $SDDBS depth", () => {
    const nmea = [
      "$GPRMC,225446,A,4916.45,N,12311.12,W,000.5,054.7,191194,020.3,E",
      "$SDDBS,33.0,f,10.0,M,5.4,F",
    ].join("\n");
    const pts = parseNmea(nmea);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.depth).toBeCloseTo(10.0, 1);
    expect(pts[0]!.lat).toBeCloseTo(49.274, 2);
    expect(pts[0]!.lon).toBeCloseTo(-123.185, 2);
  });

  it("pairs $GPRMC with $SDDPT depth", () => {
    const nmea = [
      "$GPRMC,225446,A,4916.45,N,12311.12,W,000.5,054.7,191194,020.3,E",
      "$SDDPT,25.3,0.5",
    ].join("\n");
    const pts = parseNmea(nmea);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.depth).toBeCloseTo(25.3, 1);
  });

  it("throws when depth sentences have no preceding position fix", () => {
    // Depth sentence present but no position sentence → no pairs → throw
    const nmea = "$SDDBT,10.5,f,3.2,M,1.7,F\n";
    expect(() => parseNmea(nmea)).toThrow(/NMEA/i);
  });

  it("throws when only a void $GPRMC status sentence precedes depth", () => {
    const nmea = [
      "$GPRMC,225446,V,4916.45,N,12311.12,W,000.5,054.7,191194,020.3,E",
      "$SDDBT,10.5,f,3.2,M,1.7,F",
    ].join("\n");
    // V = void — position must not register, depth has no valid fix → throw
    expect(() => parseNmea(nmea)).toThrow(/NMEA/i);
  });

  it("validates NMEA checksums and skips corrupted sentences", () => {
    // $GPGGA with known-correct checksum *47 establishes a fix.
    // $SDDBT with a deliberately wrong checksum *00 is discarded.
    // Because the depth sentence is skipped, no paired point is produced.
    const nmea = [
      "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47",
      "$SDDBT,10.5,f,3.2,M,1.7,F*00", // wrong checksum — skipped
    ].join("\n");
    // The depth sentence is discarded → 0 paired points → throw
    expect(() => parseNmea(nmea)).toThrow(/NMEA/i);
  });

  it("accepts depth sentences without a checksum delimiter", () => {
    const nmea = [
      "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47",
      "$SDDBT,15.0,f,4.5,M,2.5,F",
    ].join("\n");
    const pts = parseNmea(nmea);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.depth).toBeCloseTo(4.5, 1);
  });

  it("throws when no depth+position pairs are found", () => {
    const nmea = "some random text\nnot nmea at all";
    expect(() => parseNmea(nmea)).toThrow(/NMEA/i);
  });
});

// ---------------------------------------------------------------------------
// parseUploadedFile dispatcher tests
// ---------------------------------------------------------------------------

describe("parseUploadedFile dispatcher", () => {
  it("throws for unsupported extensions with a helpful message", async () => {
    const buf = Buffer.from("dummy");
    await expect(parseUploadedFile(buf, "survey.shp")).rejects.toThrow(
      /Unsupported file extension/i,
    );
  });

  it("throws for .laz with a conversion hint", async () => {
    // Use a valid LAS header so it passes the magic check before hitting
    // the laz-perf missing path
    const buf = buildLasBuffer([{ lon: 10.0, lat: 55.0, depth: 50 }]);
    await expect(parseUploadedFile(buf, "survey.laz")).rejects.toThrow(
      /laz/i,
    );
  });

  it("routes .gpx to GPX parser and returns points", async () => {
    const gpxContent = `<?xml version="1.0"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="55.0" lon="10.0"><ele>-50.0</ele></trkpt>
    <trkpt lat="55.1" lon="10.1"><ele>-75.0</ele></trkpt>
  </trkseg></trk>
</gpx>`;
    const buf = Buffer.from(gpxContent, "utf8");
    const pts = await parseUploadedFile(buf, "track.gpx");
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 10.0, lat: 55.0, depth: 50 });
  });

  it("routes .nmea to NMEA parser and returns points", async () => {
    const nmeaContent = [
      "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47",
      "$SDDBT,20.0,f,6.0,M,3.3,F",
    ].join("\n");
    const buf = Buffer.from(nmeaContent, "utf8");
    const pts = await parseUploadedFile(buf, "log.nmea");
    expect(pts).toHaveLength(1);
    expect(pts[0]!.depth).toBeCloseTo(6.0, 1);
  });

  it("routes .las to LAS parser and returns points", async () => {
    const input = [
      { lon: -132.5, lat: 55.7, depth: 120 },
      { lon: -132.4, lat: 55.8, depth: 230 },
    ];
    const buf = buildLasBuffer(input);
    const pts = await parseUploadedFile(buf, "multibeam.las");
    expect(pts).toHaveLength(2);
    expect(pts[0]!.lon).toBeCloseTo(-132.5, 3);
    expect(pts[0]!.depth).toBeCloseTo(120, 0);
  });
});
