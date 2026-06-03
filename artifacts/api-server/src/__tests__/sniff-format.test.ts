/**
 * sniff-format.test.ts
 *
 * Unit tests for the sniffFormat helper and the magic-byte fallback path in
 * parseUploadedFile.
 *
 * Focus: files whose .gz base name carries NO inner extension, e.g.
 *   "alaska - tolstoi bay & surrounding area - bathymetric data - h09092"
 * After .gz is stripped the "extension" is the whole filename, which matches
 * no known format.  parseUploadedFile must fall back to sniffFormat and route
 * to the correct parser rather than throwing "Unsupported file extension".
 *
 * Test strategy
 * -------------
 * - sniffFormat is tested directly with magic-byte prefixes for each binary
 *   format and with representative text payloads.
 * - parseUploadedFile is tested end-to-end with real fixture files read from
 *   disk (same fixtures used by the parser tests), but passed under a
 *   no-extension filename to exercise the sniff fallback path.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import * as zlib from "zlib";
import { sniffFormat, parseUploadedFile } from "../lib/uploadParsers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function fixture(name: string): Buffer {
  return readFileSync(resolve(__dirname, "fixtures", name));
}

// ---------------------------------------------------------------------------
// sniffFormat — magic-byte detection
// ---------------------------------------------------------------------------

describe("sniffFormat — magic-byte detection", () => {
  it("identifies little-endian GeoTIFF (II*\\0)", () => {
    const buf = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffFormat(buf)).toBe("tif");
  });

  it("identifies big-endian GeoTIFF (MM\\0*)", () => {
    const buf = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffFormat(buf)).toBe("tif");
  });

  it("identifies LAS via LASF file-signature (no LASzip VLR)", () => {
    // Build a minimal 227-byte LAS header with 0 VLRs so containsLazVlr returns false.
    const buf = Buffer.alloc(300, 0);
    buf.write("LASF", 0, "ascii");         // magic
    buf.writeUInt16LE(227, 94);            // header size (minimum public header)
    buf.writeUInt32LE(0, 100);             // number of VLRs = 0
    expect(sniffFormat(buf)).toBe("las");
  });

  it("identifies LAZ via LASF file-signature + LASzip VLR", () => {
    // Build a minimal LAS buffer with one VLR whose User ID = "laszip encoded"
    const HEADER_SIZE = 227;
    const VLR_HEADER = 54;
    const buf = Buffer.alloc(HEADER_SIZE + VLR_HEADER + 8, 0);
    buf.write("LASF", 0, "ascii");
    buf.writeUInt16LE(HEADER_SIZE, 94);
    buf.writeUInt32LE(1, 100);             // 1 VLR
    // VLR at offset HEADER_SIZE:
    const vlrOff = HEADER_SIZE;
    buf.write("laszip encoded", vlrOff + 2, "ascii"); // user ID
    buf.writeUInt16LE(8, vlrOff + 20);    // record length = 8
    expect(sniffFormat(buf)).toBe("laz");
  });

  it("identifies HDF5 / BAG via 8-byte superblock signature", () => {
    const buf = Buffer.from([
      0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(sniffFormat(buf)).toBe("bag");
  });

  it("identifies NetCDF classic via CDF\\x01 signature", () => {
    const buf = Buffer.from([0x43, 0x44, 0x46, 0x01, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffFormat(buf)).toBe("nc");
  });

  it("identifies GPX via <?xml … <gpx in first 512 bytes", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1">\n</gpx>`;
    expect(sniffFormat(Buffer.from(xml, "utf8"))).toBe("gpx");
  });

  it("does NOT misidentify plain XML without <gpx as GPX", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml>\n</kml>`;
    expect(sniffFormat(Buffer.from(xml, "utf8"))).not.toBe("gpx");
  });

  it("identifies NMEA when first non-blank line starts with $", () => {
    const nmea = `$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,0.0,M,0.0,M,,`;
    expect(sniffFormat(Buffer.from(nmea, "utf8"))).toBe("nmea");
  });

  it("identifies CSV/TXT numeric text as 'csv'", () => {
    const csv = `lon,lat,depth\n142.0,11.0,1000\n142.1,11.1,1050\n`;
    expect(sniffFormat(Buffer.from(csv, "utf8"))).toBe("csv");
  });

  it("identifies headerless numeric CSV as 'csv'", () => {
    const csv = `142.0 11.0 1000\n142.1 11.1 1050\n`;
    expect(sniffFormat(Buffer.from(csv, "utf8"))).toBe("csv");
  });

  it("returns null for unrecognisable binary content", () => {
    const random = Buffer.alloc(64, 0xde);
    expect(sniffFormat(random)).toBeNull();
  });

  it("returns null for a buffer shorter than 4 bytes", () => {
    expect(sniffFormat(Buffer.from([0x00, 0x01]))).toBeNull();
  });

  it("identifies a real GeoTIFF fixture via magic bytes", () => {
    expect(sniffFormat(fixture("survey.tif"))).toBe("tif");
  });

  it("identifies a real LAS fixture via magic bytes (no LASzip VLR → 'las')", () => {
    expect(sniffFormat(fixture("survey_1_2.las"))).toBe("las");
  });

  it("identifies a real LAZ fixture via magic bytes (LASzip VLR present → 'laz')", () => {
    expect(sniffFormat(fixture("survey.laz"))).toBe("laz");
  });

  it("identifies a real HDF5/BAG fixture via magic bytes", () => {
    expect(sniffFormat(fixture("survey.bag"))).toBe("bag");
  });

  it("identifies a real NetCDF fixture via magic bytes", () => {
    expect(sniffFormat(fixture("survey.nc"))).toBe("nc");
  });

  it("identifies a real GPX fixture via magic bytes", () => {
    expect(sniffFormat(fixture("survey.gpx"))).toBe("gpx");
  });

  it("identifies a real NMEA fixture via magic bytes", () => {
    expect(sniffFormat(fixture("survey.nmea"))).toBe("nmea");
  });
});

// ---------------------------------------------------------------------------
// parseUploadedFile — magic-byte fallback path (no inner extension)
// ---------------------------------------------------------------------------

describe("parseUploadedFile — no-extension .gz base name uses magic-byte fallback", () => {
  // Simulate what happens when a .gz file is decompressed: the caller strips
  // ".gz" and passes the bare basename.  If that basename has no dots (or only
  // dots in the middle of a survey name), the extension-based switch hits the
  // default case and must fall back to sniffFormat.
  const NO_EXT_NAME = "alaska - tolstoi bay - bathymetric data - h09092";

  it(
    "parses a GeoTIFF buffer when filename has no extension",
    async () => {
      const points = await parseUploadedFile(fixture("survey.tif"), NO_EXT_NAME);
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty("lon");
      expect(points[0]).toHaveProperty("lat");
      expect(points[0]).toHaveProperty("depth");
    },
    15_000,
  );

  it(
    "parses a LAS buffer when filename has no extension",
    async () => {
      const points = await parseUploadedFile(fixture("survey_1_2.las"), NO_EXT_NAME);
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty("lon");
    },
    15_000,
  );

  it(
    "parses a LAZ buffer when filename has no extension",
    async () => {
      const points = await parseUploadedFile(fixture("survey.laz"), NO_EXT_NAME);
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty("lon");
    },
    15_000,
  );

  it(
    "parses a BAG/HDF5 buffer when filename has no extension",
    async () => {
      const points = await parseUploadedFile(fixture("survey.bag"), NO_EXT_NAME);
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty("lon");
    },
    15_000,
  );

  it(
    "parses a NetCDF buffer when filename has no extension",
    async () => {
      const points = await parseUploadedFile(fixture("survey.nc"), NO_EXT_NAME);
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty("lon");
    },
    15_000,
  );

  it(
    "parses a GPX buffer when filename has no extension",
    async () => {
      const points = await parseUploadedFile(fixture("survey.gpx"), NO_EXT_NAME);
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty("lon");
    },
    15_000,
  );

  it(
    "parses an NMEA buffer when filename has no extension",
    async () => {
      const points = await parseUploadedFile(fixture("survey.nmea"), NO_EXT_NAME);
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty("lon");
    },
    15_000,
  );

  it(
    "parses a CSV/XYZ buffer when filename has no extension",
    async () => {
      const csvContent = [
        "lon,lat,depth",
        ...Array.from({ length: 15 }, (_, i) =>
          `${(142.0 + i * 0.01).toFixed(4)},${(11.0 + i * 0.01).toFixed(4)},${1000 + i * 50}`),
      ].join("\n");
      const points = await parseUploadedFile(Buffer.from(csvContent, "utf8"), NO_EXT_NAME);
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]).toHaveProperty("lon");
    },
    10_000,
  );

  it(
    "throws a clear error message when content is unrecognisable",
    async () => {
      const garbage = Buffer.alloc(64, 0xde);
      await expect(
        parseUploadedFile(garbage, NO_EXT_NAME),
      ).rejects.toThrow(
        "Could not detect the file format. Ensure the .gz contains a supported type",
      );
    },
    5_000,
  );
});

// ---------------------------------------------------------------------------
// End-to-end: gzip-compress a no-extension file, decompress, then parse
// ---------------------------------------------------------------------------

describe("end-to-end: .gz file with no inner extension → sniff → parse", () => {
  it(
    "decompresses and parses a gzip-wrapped GeoTIFF with no inner extension",
    async () => {
      const gz = zlib.gzipSync(fixture("survey.tif"));
      const decompressed = zlib.gunzipSync(gz);
      const baseFileName = "h09092"; // no dots at all
      const points = await parseUploadedFile(decompressed, baseFileName);
      expect(points.length).toBeGreaterThan(0);
    },
    15_000,
  );

  it(
    "decompresses and parses a gzip-wrapped LAS file with no inner extension",
    async () => {
      const gz = zlib.gzipSync(fixture("survey_1_2.las"));
      const decompressed = zlib.gunzipSync(gz);
      const points = await parseUploadedFile(decompressed, "survey-data-h09092");
      expect(points.length).toBeGreaterThan(0);
    },
    15_000,
  );

  it(
    "decompresses and parses a gzip-wrapped LAZ file with no inner extension",
    async () => {
      const gz = zlib.gzipSync(fixture("survey.laz"));
      const decompressed = zlib.gunzipSync(gz);
      const points = await parseUploadedFile(decompressed, "survey-data-h09092");
      expect(points.length).toBeGreaterThan(0);
    },
    15_000,
  );
});
