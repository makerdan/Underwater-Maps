/**
 * noaaTarRouter.test.ts — Unit tests for the NOAA tar.gz entry router.
 *
 * Verifies:
 *   - classifyTarEntry: correctly maps path patterns to parser keys (incl. root-level)
 *   - classifyTarEntry: marks unsupported/unrecognised entries as "skip"
 *   - routeTarEntries: throws NO_PARSEABLE_DATA when no entries match
 *   - routeTarEntries: dispatches recognised entries (stubs return [])
 *   - routeTarEntries: derives dataset name from surveys.txt H-number
 *   - routeTarEntries: falls back to archive filename when surveys.txt absent
 *   - routeTarEntries: aggregates points from multiple entries
 *   - parseSmoothSheetsGeoTiff: gunzips inner tif.gz and delegates to parseGeoTiff
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as zlib from "zlib";
import { writeArrayBuffer } from "geotiff";
import type { RawPoint } from "../uploadParsers.js";
import {
  classifyTarEntry,
  routeTarEntries,
  parserDispatch,
  parseSmoothSheetsGeoTiff,
} from "../noaaTarRouter.js";

// ---------------------------------------------------------------------------
// classifyTarEntry — routing table
// ---------------------------------------------------------------------------

describe("classifyTarEntry", () => {
  it("classifies surveys.xyz at archive root", () => {
    expect(classifyTarEntry("surveys.xyz")).toBe("noaa-surveys-xyz");
  });

  it("classifies surveys.xyz in a subdirectory", () => {
    expect(classifyTarEntry("H09084/surveys.xyz")).toBe("noaa-surveys-xyz");
  });

  it("classifies GEODAS .xyz.gz as geodas-xyz (nested)", () => {
    expect(classifyTarEntry("H09084/GEODAS/h09084.xyz.gz")).toBe("geodas-xyz");
  });

  it("classifies GEODAS .xyz.gz at archive root (no leading directory)", () => {
    expect(classifyTarEntry("GEODAS/h09084.xyz.gz")).toBe("geodas-xyz");
  });

  it("classifies GEODAS .xyz.gz case-insensitively", () => {
    expect(classifyTarEntry("H09084/geodas/h09084.xyz.gz")).toBe("geodas-xyz");
  });

  it("classifies GEODAS .a93.gz as hyd93-a93 (nested)", () => {
    expect(classifyTarEntry("H09084/GEODAS/h09084.a93.gz")).toBe("hyd93-a93");
  });

  it("classifies GEODAS .a93.gz at archive root", () => {
    expect(classifyTarEntry("GEODAS/h09084.a93.gz")).toBe("hyd93-a93");
  });

  it("classifies Bottom_Samples _BSText.txt as bottom-samples (nested)", () => {
    expect(classifyTarEntry("H09084/Bottom_Samples/h09084_BSText.txt")).toBe("bottom-samples");
  });

  it("classifies Bottom_Samples _BSText.txt at archive root", () => {
    expect(classifyTarEntry("Bottom_Samples/h09084_BSText.txt")).toBe("bottom-samples");
  });

  it("classifies Bottom_Samples case-insensitively", () => {
    expect(classifyTarEntry("H09084/bottom_samples/h09084_bstext.txt")).toBe("bottom-samples");
  });

  it("classifies Smooth_Sheets .tif.gz as inner-geotiff (nested)", () => {
    expect(classifyTarEntry("H09084/Smooth_Sheets/H09084.tif.gz")).toBe("inner-geotiff");
  });

  it("classifies Smooth_Sheets .tif.gz at archive root", () => {
    expect(classifyTarEntry("Smooth_Sheets/H09084.tif.gz")).toBe("inner-geotiff");
  });

  it("classifies Smooth_Sheets case-insensitively", () => {
    expect(classifyTarEntry("H09084/smooth_sheets/h09084.tif.gz")).toBe("inner-geotiff");
  });

  it("skips .sid files", () => {
    expect(classifyTarEntry("H09084/H09084.sid")).toBe("skip");
  });

  it("skips .sid.gz files", () => {
    expect(classifyTarEntry("H09084/H09084.sid.gz")).toBe("skip");
  });

  it("skips .pdf files", () => {
    expect(classifyTarEntry("H09084/H09084.pdf")).toBe("skip");
  });

  it("skips .htm files", () => {
    expect(classifyTarEntry("H09084/index.htm")).toBe("skip");
  });

  it("skips .html files", () => {
    expect(classifyTarEntry("H09084/index.html")).toBe("skip");
  });

  it("skips surveys.txt metadata file", () => {
    expect(classifyTarEntry("surveys.txt")).toBe("skip");
  });

  it("skips unrecognised .dat files", () => {
    expect(classifyTarEntry("H09084/somefile.dat")).toBe("skip");
  });

  it("handles Windows-style backslash separators", () => {
    expect(classifyTarEntry("H09084\\GEODAS\\h09084.xyz.gz")).toBe("geodas-xyz");
  });
});

// ---------------------------------------------------------------------------
// routeTarEntries — main router
// ---------------------------------------------------------------------------

/** Ten minimal points that pass the gridPoints ≥10 check. */
function makePts(n = 10): RawPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    lon: -132.5 - i * 0.01,
    lat: 55.7 + i * 0.01,
    depth: 10 + i,
  }));
}

describe("routeTarEntries", () => {
  let tmpDir: string;
  // Original dispatch entries replaced during tests
  const saved: Partial<typeof parserDispatch> = {};

  function mockParser(key: keyof typeof parserDispatch, pts: RawPoint[]) {
    saved[key] = parserDispatch[key];
    parserDispatch[key] = async () => pts;
  }

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "noaa-tar-router-test-"));
  });

  afterEach(async () => {
    // Restore any replaced parsers
    for (const [k, fn] of Object.entries(saved) as Array<[keyof typeof parserDispatch, (typeof parserDispatch)[keyof typeof parserDispatch]]>) {
      parserDispatch[k] = fn;
    }
    Object.keys(saved).forEach((k) => delete saved[k as keyof typeof parserDispatch]);
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("throws NO_PARSEABLE_DATA when all entries are skipped types", async () => {
    const entries = ["H09084/H09084.sid", "H09084/index.htm", "H09084/H09084.pdf"];
    await expect(
      routeTarEntries(tmpDir, entries, "H09084.tar.gz"),
    ).rejects.toMatchObject({
      message: "No parseable bathymetric data found in this archive.",
      code: "NO_PARSEABLE_DATA",
    });
  });

  it("throws NO_PARSEABLE_DATA when archive has no file entries", async () => {
    await expect(
      routeTarEntries(tmpDir, [], "empty.tar.gz"),
    ).rejects.toMatchObject({ code: "NO_PARSEABLE_DATA" });
  });

  it("throws NO_PARSEABLE_DATA when only directory entries are present", async () => {
    const entries = ["H09084/", "H09084/GEODAS/"];
    await expect(
      routeTarEntries(tmpDir, entries, "H09084.tar.gz"),
    ).rejects.toMatchObject({ code: "NO_PARSEABLE_DATA" });
  });

  it("surveys.xyz with a valid header+data row returns points (parser is implemented)", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "H09084"), { recursive: true });
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690\t42.5",
    ].join("\n");
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "surveys.xyz"), content);

    const result = await routeTarEntries(
      tmpDir,
      ["H09084/surveys.xyz"],
      "H09084.tar.gz",
    );

    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ lon: -132.53, lat: 55.69, depth: 42.5 });
  });

  it("surveys.xyz with no valid data rows throws NO_PARSEABLE_DATA", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "H09084"), { recursive: true });
    // depth 99999.9 is the NOAA no-data sentinel — filtered out by the parser.
    // When all points/substrate/raster collections remain empty after dispatch,
    // routeTarEntries throws NO_PARSEABLE_DATA so the caller gets a clear error.
    const content = "SURVEY\tLON\tLAT\tDEPTH\nH09084\t-132.530\t55.690\t99999.9\n";
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "surveys.xyz"), content);

    await expect(
      routeTarEntries(tmpDir, ["H09084/surveys.xyz"], "H09084.tar.gz"),
    ).rejects.toMatchObject({
      message: "No parseable bathymetric data found in this archive.",
      code: "NO_PARSEABLE_DATA",
    });
  });

  it("dispatches GEODAS xyz.gz entry to geodas-xyz parser (nested)", async () => {
    const geodasDir = path.join(tmpDir, "H09084", "GEODAS");
    await fs.promises.mkdir(geodasDir, { recursive: true });
    await fs.promises.writeFile(path.join(geodasDir, "h09084.xyz.gz"), "placeholder");
    mockParser("geodas-xyz", makePts(5));
    const result = await routeTarEntries(
      tmpDir,
      ["H09084/GEODAS/h09084.xyz.gz"],
      "H09084.tar.gz",
    );
    expect(result.points).toHaveLength(5);
  });

  it("dispatches GEODAS xyz.gz entry to geodas-xyz parser (root-level)", async () => {
    const geodasDir = path.join(tmpDir, "GEODAS");
    await fs.promises.mkdir(geodasDir, { recursive: true });
    await fs.promises.writeFile(path.join(geodasDir, "h09084.xyz.gz"), "placeholder");
    mockParser("geodas-xyz", makePts(7));
    const result = await routeTarEntries(
      tmpDir,
      ["GEODAS/h09084.xyz.gz"],
      "H09084.tar.gz",
    );
    expect(result.points).toHaveLength(7);
  });

  it("dispatches HYD93 a93.gz entry and returns sounding points", async () => {
    const geodasDir = path.join(tmpDir, "H09084", "GEODAS");
    await fs.promises.mkdir(geodasDir, { recursive: true });
    // One valid HYD93 sounding line (42 chars): lat=55.682411, lon=-132.500123, depth=550cm→5.5m
    const a93Text = "H09084     55682411  -132500123    5500711\n";
    const gz = zlib.gzipSync(Buffer.from(a93Text, "ascii"));
    await fs.promises.writeFile(path.join(geodasDir, "h09084.a93.gz"), gz);
    const result = await routeTarEntries(
      tmpDir,
      ["H09084/GEODAS/h09084.a93.gz"],
      "H09084.tar.gz",
    );
    expect(result.points).toHaveLength(1);
    expect(result.points[0]!.lat).toBeCloseTo(55.682411, 6);
    expect(result.points[0]!.lon).toBeCloseTo(-132.500123, 6);
    expect(result.points[0]!.depth).toBeCloseTo(5.5, 6);
  });

  it("dispatches Smooth_Sheets tif.gz entry to inner-geotiff parser and merges points", async () => {
    const ssDir = path.join(tmpDir, "H09084", "Smooth_Sheets");
    await fs.promises.mkdir(ssDir, { recursive: true });
    await fs.promises.writeFile(path.join(ssDir, "H09084.tif.gz"), "placeholder");
    mockParser("inner-geotiff", makePts(8));
    const result = await routeTarEntries(
      tmpDir,
      ["H09084/Smooth_Sheets/H09084.tif.gz"],
      "H09084.tar.gz",
    );
    expect(result.points).toHaveLength(8);
  });

  it("raster-only archive (Smooth_Sheets, no xyz soundings) passes when inner-geotiff returns points", async () => {
    // Regression guard: an archive whose ONLY parseable entry is a Smooth_Sheets
    // GeoTIFF must NOT hit the NO_PARSEABLE_DATA guard — the raster path populates
    // allPoints just like the sounding parsers do.
    const ssDir = path.join(tmpDir, "H09084", "Smooth_Sheets");
    await fs.promises.mkdir(ssDir, { recursive: true });
    // Write a placeholder .tif.gz — the inner-geotiff parser is mocked below.
    await fs.promises.writeFile(path.join(ssDir, "H09084.tif.gz"), "placeholder");
    mockParser("inner-geotiff", makePts(6));

    const result = await routeTarEntries(
      tmpDir,
      [
        // Only smooth-sheet raster — no surveys.xyz, no GEODAS, no BSText
        "H09084/Smooth_Sheets/H09084.tif.gz",
      ],
      "H09084.tar.gz",
    );

    expect(result.points).toHaveLength(6);
    expect(result.substratePoints).toHaveLength(0);
  });

  it("raster-only archive where inner-geotiff returns [] captures raster buffer (no throw)", async () => {
    // When parseSmoothSheetsGeoTiff returns [] it means the raster has no
    // georeferencing tags.  The router must NOT throw NO_PARSEABLE_DATA in this
    // case — instead it captures the raw .tif.gz bytes in smoothSheetRasterBuffer
    // so the caller can persist them for the interactive georeferencing wizard.
    // The post-parse guard fires only when allPoints, allSubstratePoints, AND
    // smoothSheetRasterBuffer are all empty simultaneously.
    const ssDir = path.join(tmpDir, "H09084", "Smooth_Sheets");
    await fs.promises.mkdir(ssDir, { recursive: true });
    const gzPayload = Buffer.from("placeholder");
    await fs.promises.writeFile(path.join(ssDir, "H09084.tif.gz"), gzPayload);
    mockParser("inner-geotiff", []);

    const result = await routeTarEntries(
      tmpDir,
      ["H09084/Smooth_Sheets/H09084.tif.gz"],
      "H09084.tar.gz",
    );

    // No depth soundings were parsed — but the archive is still valid because
    // the raster buffer was captured for later georeferencing.
    expect(result.points).toHaveLength(0);
    expect(result.smoothSheetRasterBuffer).toEqual(gzPayload);
    expect(result.smoothSheetRasterFilename).toBe("H09084.tif.gz");
    expect(result.substratePoints).toHaveLength(0);
  });

  it("derives dataset name from surveys.txt H-number and area", async () => {
    // Write surveys.txt and a surveys.xyz placeholder
    await fs.promises.writeFile(
      path.join(tmpDir, "surveys.txt"),
      "H09084  THORNE BAY  AK  1985\n",
    );
    await fs.promises.mkdir(path.join(tmpDir, "H09084"), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "surveys.xyz"), "placeholder");

    mockParser("noaa-surveys-xyz", makePts());

    const result = await routeTarEntries(
      tmpDir,
      ["surveys.txt", "H09084/surveys.xyz"],
      "H09084.tar.gz",
    );

    expect(result.datasetName).toBe("H09084 — Thorne Bay");
    expect(result.points).toHaveLength(10);
  });

  it("falls back to archive filename when surveys.txt is absent", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "H09084"), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "surveys.xyz"), "placeholder");
    mockParser("noaa-surveys-xyz", makePts());

    const result = await routeTarEntries(
      tmpDir,
      ["H09084/surveys.xyz"],
      "alaska-bathymetric-H09092.tar.gz",
    );

    expect(result.datasetName).toBe("alaska bathymetric H09092");
  });

  it("aggregates points from multiple recognised entries", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "H09084", "GEODAS"), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "surveys.xyz"), "placeholder");
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "GEODAS", "h09084.xyz.gz"), "placeholder");

    mockParser("noaa-surveys-xyz", makePts(10));
    mockParser("geodas-xyz", makePts(12));

    const result = await routeTarEntries(
      tmpDir,
      ["H09084/surveys.xyz", "H09084/GEODAS/h09084.xyz.gz"],
      "H09084.tar.gz",
    );

    expect(result.points).toHaveLength(22);
  });

  it("skipped entries (.sid, .pdf) do not contribute points and do not cause failure", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "H09084"), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "surveys.xyz"), "placeholder");
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "scan.sid"), "placeholder");
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "readme.pdf"), "placeholder");

    mockParser("noaa-surveys-xyz", makePts());

    const result = await routeTarEntries(
      tmpDir,
      ["H09084/surveys.xyz", "H09084/scan.sid", "H09084/readme.pdf"],
      "H09084.tar.gz",
    );

    expect(result.points).toHaveLength(10);
  });

  it("NO_PARSEABLE_DATA error has the canonical user-facing message", async () => {
    await expect(
      routeTarEntries(tmpDir, ["H09084/scan.sid"], "H09084.tar.gz"),
    ).rejects.toMatchObject({
      message: "No parseable bathymetric data found in this archive.",
      code: "NO_PARSEABLE_DATA",
    });
  });

  it("substrate-only archive (BSText with no soundings) succeeds without throwing", async () => {
    // Archives that ship only a BSText file (no XYZ soundings) must not be
    // rejected.  The post-parse guard should pass because substratePoints > 0.
    const bsDir = path.join(tmpDir, "Bottom_Samples");
    await fs.promises.mkdir(bsDir, { recursive: true });

    const bsContent = [
      "LAT\tLON\tCOLOUR\tNAT",
      "55.70\t-132.50\tSAND\tFIRM",
      "55.71\t-132.51\tMUD\tSOFT",
    ].join("\n");
    await fs.promises.writeFile(
      path.join(bsDir, "h09084_BSText.txt"),
      bsContent,
      "utf8",
    );

    const result = await routeTarEntries(
      tmpDir,
      ["Bottom_Samples/h09084_BSText.txt"],
      "H09084.tar.gz",
    );

    expect(result.points).toHaveLength(0);
    expect(result.substratePoints).toHaveLength(2);
    expect(result.substratePoints[0]!.substrateType).toBe("sand");
    expect(result.substratePoints[1]!.substrateType).toBe("mud");
  });
});

// ---------------------------------------------------------------------------
// parseSmoothSheetsGeoTiff — gunzip + parseGeoTiff delegation
// ---------------------------------------------------------------------------

/**
 * Build a minimal 2×2 float32 GeoTIFF with proper georeferencing tags and
 * return it as a gzip-compressed Buffer suitable for use as a .tif.gz fixture.
 *
 * Uses the same `writeArrayBuffer` helper as generate.mjs so the structure
 * is guaranteed to be parseable by the geotiff library.  Depth values are
 * stored as positive numbers (positive-downward) to avoid the sign-flip
 * applied by parseGeoTiff.
 */
async function buildMinimalTifGz(): Promise<Buffer> {
  const WIDTH = 2;
  const HEIGHT = 2;
  const flatData = new Float32Array([10, 20, 30, 40]);

  const ab = await writeArrayBuffer(flatData, {
    width: WIDTH,
    height: HEIGHT,
    ModelPixelScale: [0.01, 0.01, 0],
    ModelTiepoint: [0, 0, 0, -132.5, 55.71, 0],
  });

  const tifBuffer = Buffer.from(ab);
  return zlib.gzipSync(tifBuffer);
}

describe("parseSmoothSheetsGeoTiff", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "smooth-sheets-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("gunzips the inner tif.gz and returns depth points (georeferenced case)", async () => {
    const tifGzBuffer = await buildMinimalTifGz();
    const filePath = path.join(tmpDir, "H09084.tif.gz");
    await fs.promises.writeFile(filePath, tifGzBuffer);

    const points = await parseSmoothSheetsGeoTiff(filePath);

    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(Number.isFinite(p.lon)).toBe(true);
      expect(Number.isFinite(p.lat)).toBe(true);
      expect(Number.isFinite(p.depth)).toBe(true);
      expect(p.depth).toBeGreaterThan(0);
    }
  });

  it("throws when the file cannot be read", async () => {
    await expect(
      parseSmoothSheetsGeoTiff(path.join(tmpDir, "missing.tif.gz")),
    ).rejects.toThrow(/Failed to read inner tif\.gz/);
  });

  it("throws when the file is not valid gzip data", async () => {
    const filePath = path.join(tmpDir, "corrupt.tif.gz");
    await fs.promises.writeFile(filePath, Buffer.from("not-gzip-data"));
    await expect(parseSmoothSheetsGeoTiff(filePath)).rejects.toThrow(
      /Failed to decompress inner tif\.gz/,
    );
  });
});
