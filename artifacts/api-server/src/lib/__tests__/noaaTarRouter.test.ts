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
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { RawPoint } from "../uploadParsers.js";
import {
  classifyTarEntry,
  routeTarEntries,
  parserDispatch,
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

  it("surveys.xyz with no valid data rows returns an empty points array", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "H09084"), { recursive: true });
    const content = "SURVEY\tLON\tLAT\tDEPTH\nH09084\t-132.530\t55.690\t99999.9\n";
    await fs.promises.writeFile(path.join(tmpDir, "H09084", "surveys.xyz"), content);

    const result = await routeTarEntries(
      tmpDir,
      ["H09084/surveys.xyz"],
      "H09084.tar.gz",
    );

    expect(result.points).toHaveLength(0);
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

  it("throws PARSER_NOT_IMPLEMENTED for HYD93 a93.gz entry", async () => {
    const geodasDir = path.join(tmpDir, "H09084", "GEODAS");
    await fs.promises.mkdir(geodasDir, { recursive: true });
    await fs.promises.writeFile(path.join(geodasDir, "h09084.a93.gz"), "placeholder");
    await expect(
      routeTarEntries(tmpDir, ["H09084/GEODAS/h09084.a93.gz"], "H09084.tar.gz"),
    ).rejects.toMatchObject({ code: "PARSER_NOT_IMPLEMENTED", parserKey: "hyd93-a93" });
  });

  it("throws PARSER_NOT_IMPLEMENTED for Smooth_Sheets tif.gz entry", async () => {
    const ssDir = path.join(tmpDir, "H09084", "Smooth_Sheets");
    await fs.promises.mkdir(ssDir, { recursive: true });
    await fs.promises.writeFile(path.join(ssDir, "H09084.tif.gz"), "placeholder");
    await expect(
      routeTarEntries(tmpDir, ["H09084/Smooth_Sheets/H09084.tif.gz"], "H09084.tar.gz"),
    ).rejects.toMatchObject({ code: "PARSER_NOT_IMPLEMENTED", parserKey: "inner-geotiff" });
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
});
