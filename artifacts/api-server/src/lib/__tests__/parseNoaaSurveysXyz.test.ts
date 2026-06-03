/**
 * parseNoaaSurveysXyz.test.ts — Unit tests for the NOAA surveys.xyz TSV parser.
 *
 * Verifies:
 *   - Correct column ordering: LON before LAT (non-standard NOAA layout)
 *   - Header detection: case-insensitive, whitespace-trimmed column names
 *   - Null sentinel filtering: rows with DEPTH == 99999.9 are skipped
 *   - Invalid depth filtering: non-numeric / non-finite DEPTH rows are skipped
 *   - Coordinate bounds filtering: out-of-range lon/lat rows are skipped
 *   - Comment and blank lines are ignored
 *   - Error on missing or unrecognisable header
 *   - Depths are passed through as-is (positive-downward, already in metres)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseNoaaSurveysXyz } from "../noaaTarRouter.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "surveys-xyz-test-"));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function write(name: string, content: string): Promise<string> {
  const p = path.join(tmpDir, name);
  await fs.promises.writeFile(p, content, "utf8");
  return p;
}

// ---------------------------------------------------------------------------
// Happy-path: correct column ordering
// ---------------------------------------------------------------------------

describe("parseNoaaSurveysXyz — column ordering", () => {
  it("maps LON (col 1) and LAT (col 2) correctly — not swapped", async () => {
    const p = await write(
      "surveys.xyz",
      "SURVEY\tLON\tLAT\tDEPTH\nH09084\t-132.530\t55.690\t42.5\n",
    );
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ lon: -132.53, lat: 55.69, depth: 42.5 });
  });

  it("parses multiple valid rows", async () => {
    const rows = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690\t42.5",
      "H09084\t-132.540\t55.700\t38.0",
      "H09084\t-132.520\t55.680\t50.1",
    ].join("\n");
    const p = await write("surveys.xyz", rows);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(3);
    expect(pts[1]).toMatchObject({ lon: -132.54, lat: 55.7, depth: 38.0 });
  });

  it("depth values are passed through as-is (positive-downward metres)", async () => {
    const p = await write(
      "surveys.xyz",
      "SURVEY\tLON\tLAT\tDEPTH\nH09084\t10.0\t20.0\t100.0\n",
    );
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts[0]?.depth).toBe(100.0);
  });
});

// ---------------------------------------------------------------------------
// Header detection: case-insensitive, whitespace-trimmed
// ---------------------------------------------------------------------------

describe("parseNoaaSurveysXyz — header detection", () => {
  it("accepts lowercase header column names", async () => {
    const p = await write(
      "surveys.xyz",
      "survey\tlon\tlat\tdepth\nH09084\t-132.530\t55.690\t42.5\n",
    );
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });

  it("accepts mixed-case header column names", async () => {
    const p = await write(
      "surveys.xyz",
      "Survey\tLon\tLat\tDepth\nH09084\t-132.530\t55.690\t42.5\n",
    );
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });

  it("accepts header column names with surrounding whitespace", async () => {
    const p = await write(
      "surveys.xyz",
      " SURVEY \t LON \t LAT \t DEPTH \nH09084\t-132.530\t55.690\t42.5\n",
    );
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });

  it("skips leading comment lines before the header", async () => {
    const content = [
      "# This is a NOAA archive comment",
      "# Generated 2024-01-01",
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690\t42.5",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });

  it("throws when first content line is not a recognised header", async () => {
    const p = await write(
      "surveys.xyz",
      "-132.530\t55.690\t42.5\n",
    );
    await expect(parseNoaaSurveysXyz(p)).rejects.toThrow(/expected header row/i);
  });

  it("throws when file has only blank/comment lines (no header)", async () => {
    const p = await write("surveys.xyz", "# comment\n\n  \n");
    await expect(parseNoaaSurveysXyz(p)).rejects.toThrow(/no recognisable header/i);
  });
});

// ---------------------------------------------------------------------------
// Null sentinel filtering: DEPTH == 99999.9
// ---------------------------------------------------------------------------

describe("parseNoaaSurveysXyz — NOAA null sentinel (99999.9)", () => {
  it("skips rows where DEPTH is exactly 99999.9", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690\t99999.9",
      "H09084\t-132.540\t55.700\t38.0",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
    expect(pts[0]?.depth).toBe(38.0);
  });

  it("returns empty array when all rows have the null sentinel depth", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690\t99999.9",
      "H09084\t-132.540\t55.700\t99999.9",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid depth filtering
// ---------------------------------------------------------------------------

describe("parseNoaaSurveysXyz — invalid depth filtering", () => {
  it("skips rows where DEPTH is non-numeric text", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690\tN/A",
      "H09084\t-132.540\t55.700\t38.0",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });

  it("skips rows where DEPTH column is missing (too few columns)", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690",
      "H09084\t-132.540\t55.700\t38.0",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });

  it("skips rows where DEPTH is empty string", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690\t",
      "H09084\t-132.540\t55.700\t38.0",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Coordinate bounds filtering
// ---------------------------------------------------------------------------

describe("parseNoaaSurveysXyz — WGS84 coordinate validation", () => {
  it("skips rows where LAT is out of range (>90)", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t91.0\t42.5",
      "H09084\t-132.540\t55.700\t38.0",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
    expect(pts[0]?.lat).toBe(55.7);
  });

  it("skips rows where LON is out of range (<-180)", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-181.0\t55.690\t42.5",
      "H09084\t-132.540\t55.700\t38.0",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });

  it("skips rows where LON is non-numeric", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\tN/A\t55.690\t42.5",
      "H09084\t-132.540\t55.700\t38.0",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Blank lines and comment lines in data section
// ---------------------------------------------------------------------------

describe("parseNoaaSurveysXyz — blank/comment lines in data section", () => {
  it("ignores blank lines between data rows", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690\t42.5",
      "",
      "H09084\t-132.540\t55.700\t38.0",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(2);
  });

  it("ignores comment lines in the data section", async () => {
    const content = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "# inline comment",
      "H09084\t-132.530\t55.690\t42.5",
    ].join("\n");
    const p = await write("surveys.xyz", content);
    const pts = await parseNoaaSurveysXyz(p);
    expect(pts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// File I/O error
// ---------------------------------------------------------------------------

describe("parseNoaaSurveysXyz — file I/O", () => {
  it("throws a descriptive error when the file does not exist", async () => {
    await expect(
      parseNoaaSurveysXyz(path.join(tmpDir, "nonexistent.xyz")),
    ).rejects.toThrow(/Failed to read surveys\.xyz/i);
  });
});
