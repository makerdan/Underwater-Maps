/**
 * parseBottomSamples.test.ts — Unit tests for the NOAA BSText substrate parser.
 *
 * Verifies:
 *   - normaliseSubstrate: keyword → category mapping for all families
 *   - normaliseSubstrate: falls back to raw label when no keyword matches
 *   - parseBottomSamples: reads a real-format fixture and maps 5 rows correctly
 *   - parseBottomSamples: handles missing COLOUR/NAT columns gracefully
 *   - parseBottomSamples: skips rows with missing or non-numeric coordinates
 *   - parseBottomSamples: rejects files without LAT/LON header columns
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { normaliseSubstrate, parseBottomSamples } from "../noaaTarRouter.js";

// ---------------------------------------------------------------------------
// normaliseSubstrate
// ---------------------------------------------------------------------------

describe("normaliseSubstrate", () => {
  it("maps MUD to mud", () => {
    expect(normaliseSubstrate("MUD GREEN")).toBe("mud");
  });

  it("maps SILT to mud", () => {
    expect(normaliseSubstrate("SILT")).toBe("mud");
  });

  it("maps OOZE to mud", () => {
    expect(normaliseSubstrate("OOZE")).toBe("mud");
  });

  it("maps CLAY to mud", () => {
    expect(normaliseSubstrate("BLUE CLAY")).toBe("mud");
  });

  it("maps ROCK to rock", () => {
    expect(normaliseSubstrate("ROCK")).toBe("rock");
  });

  it("maps HARD ROCK to rock", () => {
    expect(normaliseSubstrate("HARD ROCK")).toBe("rock");
  });

  it("maps BEDROCK to rock", () => {
    expect(normaliseSubstrate("BEDROCK")).toBe("rock");
  });

  it("maps BOULDER to rock", () => {
    expect(normaliseSubstrate("BOULDER")).toBe("rock");
  });

  it("maps STONE to rock", () => {
    expect(normaliseSubstrate("STONE")).toBe("rock");
  });

  it("maps SHORE to rock", () => {
    expect(normaliseSubstrate("SHORE")).toBe("rock");
  });

  it("maps SAND to sand", () => {
    expect(normaliseSubstrate("SAND")).toBe("sand");
  });

  it("maps SANDY to sand", () => {
    expect(normaliseSubstrate("SANDY BOTTOM")).toBe("sand");
  });

  it("maps PEBBLE to gravel", () => {
    expect(normaliseSubstrate("PEBBLES")).toBe("gravel");
  });

  it("maps GRAVEL to gravel", () => {
    expect(normaliseSubstrate("GRAVEL")).toBe("gravel");
  });

  it("maps SHELL to gravel", () => {
    expect(normaliseSubstrate("SHELLS BROKEN")).toBe("gravel");
  });

  it("maps COQUINA to gravel", () => {
    expect(normaliseSubstrate("COQUINA")).toBe("gravel");
  });

  it("maps KELP to kelp", () => {
    expect(normaliseSubstrate("KELP")).toBe("kelp");
  });

  it("maps SEAWEED to kelp", () => {
    expect(normaliseSubstrate("SEAWEED")).toBe("kelp");
  });

  it("maps WEED to kelp", () => {
    expect(normaliseSubstrate("KELP WEED")).toBe("kelp");
  });

  it("falls back to the raw label for unrecognised descriptions", () => {
    expect(normaliseSubstrate("CORAL")).toBe("CORAL");
  });

  it("falls back to 'unknown' for blank input", () => {
    expect(normaliseSubstrate("")).toBe("unknown");
  });

  it("is case-insensitive (lower-case input)", () => {
    expect(normaliseSubstrate("mud green")).toBe("mud");
  });

  it("MUD takes priority over earlier SHELL when both present", () => {
    // Combined label "MUD GREEN SHELLS BROKEN" — MUD is listed first in the
    // keyword table so mud wins.
    expect(normaliseSubstrate("MUD GREEN SHELLS BROKEN")).toBe("mud");
  });
});

// ---------------------------------------------------------------------------
// normaliseSubstrate — Wentworth phi-scale parsing
// ---------------------------------------------------------------------------

describe("normaliseSubstrate — phi-scale grain-size values", () => {
  it("phi < -1 maps to gravel (-2 PHI)", () => {
    expect(normaliseSubstrate("-2 PHI")).toBe("gravel");
  });

  it("phi < -1 maps to gravel (-5 PHI, coarse cobble)", () => {
    expect(normaliseSubstrate("-5 PHI")).toBe("gravel");
  });

  it("phi = -1 maps to sand (boundary — lower sand limit)", () => {
    expect(normaliseSubstrate("-1 PHI")).toBe("sand");
  });

  it("phi 0 maps to sand (medium sand)", () => {
    expect(normaliseSubstrate("0 PHI")).toBe("sand");
  });

  it("phi 3 maps to sand (very fine sand)", () => {
    expect(normaliseSubstrate("3 PHI")).toBe("sand");
  });

  it("phi = 4 maps to mud (boundary — coarse silt)", () => {
    expect(normaliseSubstrate("4 PHI")).toBe("mud");
  });

  it("phi 7 maps to mud (medium silt)", () => {
    expect(normaliseSubstrate("7 PHI")).toBe("mud");
  });

  it("phi > 8 maps to mud (clay)", () => {
    expect(normaliseSubstrate("9 PHI")).toBe("mud");
  });

  it("recognises PHI suffix without a space (e.g. '4PHI')", () => {
    expect(normaliseSubstrate("4PHI")).toBe("mud");
  });

  it("recognises a bare negative integer as a phi value (e.g. '-2')", () => {
    expect(normaliseSubstrate("-2")).toBe("gravel");
  });

  it("recognises a bare positive integer as a phi value (e.g. '5')", () => {
    expect(normaliseSubstrate("5")).toBe("mud");
  });

  it("phi parsing is case-insensitive ('2 phi' lower-case)", () => {
    expect(normaliseSubstrate("2 phi")).toBe("sand");
  });

  it("verbal keyword still matches when no phi value present", () => {
    expect(normaliseSubstrate("SAND FIRM")).toBe("sand");
  });
});

// ---------------------------------------------------------------------------
// parseBottomSamples — 5-row H09084 fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../__tests__/fixtures/h09084_BSText.txt",
);

describe("parseBottomSamples — H09084 fixture", () => {
  it("parses all 5 rows from the fixture file", async () => {
    const pts = await parseBottomSamples(FIXTURE_PATH);
    expect(pts).toHaveLength(5);
  });

  it("extracts correct lat/lon for first row", async () => {
    const pts = await parseBottomSamples(FIXTURE_PATH);
    expect(pts[0]!.lat).toBeCloseTo(55.7012, 4);
    expect(pts[0]!.lon).toBeCloseTo(-132.5034, 4);
  });

  it("normalises MUD GREEN → mud", async () => {
    const pts = await parseBottomSamples(FIXTURE_PATH);
    expect(pts[0]!.substrateType).toBe("mud");
  });

  it("preserves rawLabel for first row", async () => {
    const pts = await parseBottomSamples(FIXTURE_PATH);
    expect(pts[0]!.rawLabel).toBe("MUD GREEN SOFT");
  });

  it("normalises HARD ROCK → rock", async () => {
    const pts = await parseBottomSamples(FIXTURE_PATH);
    expect(pts[1]!.substrateType).toBe("rock");
  });

  it("normalises SAND → sand", async () => {
    const pts = await parseBottomSamples(FIXTURE_PATH);
    expect(pts[2]!.substrateType).toBe("sand");
  });

  it("normalises SHELLS BROKEN → gravel", async () => {
    const pts = await parseBottomSamples(FIXTURE_PATH);
    expect(pts[3]!.substrateType).toBe("gravel");
  });

  it("normalises SEAWEED/KELP WEED → kelp", async () => {
    const pts = await parseBottomSamples(FIXTURE_PATH);
    expect(pts[4]!.substrateType).toBe("kelp");
  });
});

// ---------------------------------------------------------------------------
// parseBottomSamples — edge cases (temporary files)
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bs-parse-test-"));
});

afterAll(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

function writeTmp(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

describe("parseBottomSamples — edge cases", () => {
  it("returns empty array for header-only file", async () => {
    const p = writeTmp("header_only.txt", "SHT_NUM\tLAT\tLON\tCOLOUR\tNAT\n");
    expect(await parseBottomSamples(p)).toHaveLength(0);
  });

  it("skips rows with blank lat/lon values", async () => {
    const content = "LAT\tLON\tCOLOUR\tNAT\n\t-132.5\tSAND\tFIRM\n55.7\t\tMUD\tSOFT\n";
    const p = writeTmp("blank_coords.txt", content);
    expect(await parseBottomSamples(p)).toHaveLength(0);
  });

  it("skips rows with non-numeric coordinates", async () => {
    const content = "LAT\tLON\tCOLOUR\tNAT\nN/A\t-132.5\tSAND\tFIRM\n";
    const p = writeTmp("bad_coords.txt", content);
    expect(await parseBottomSamples(p)).toHaveLength(0);
  });

  it("parses rows without optional COLOUR column", async () => {
    const content = "LAT\tLON\tNAT\n55.7\t-132.5\tSOFT\n";
    const p = writeTmp("no_colour.txt", content);
    const pts = await parseBottomSamples(p);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.rawLabel).toBe("SOFT");
  });

  it("parses rows without optional NAT column", async () => {
    const content = "LAT\tLON\tCOLOUR\n55.7\t-132.5\tSAND\n";
    const p = writeTmp("no_nat.txt", content);
    const pts = await parseBottomSamples(p);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.substrateType).toBe("sand");
  });

  it("throws a descriptive error when LAT column is missing", async () => {
    const content = "SHT_NUM\tLON\tCOLOUR\n55.7\t-132.5\tSAND\n";
    const p = writeTmp("no_lat.txt", content);
    await expect(parseBottomSamples(p)).rejects.toThrow(/no LAT or LON column/i);
  });

  it("throws a descriptive error when file does not exist", async () => {
    await expect(
      parseBottomSamples(path.join(tmpDir, "does_not_exist.txt")),
    ).rejects.toThrow(/failed to read/i);
  });

  it("stores unrecognised description as rawLabel substrateType", async () => {
    // "CORAL HARD" — no keyword matches, so substrateType falls back to the
    // full combined COLOUR+NAT string (the same value as rawLabel).
    const content = "LAT\tLON\tCOLOUR\tNAT\n55.7\t-132.5\tCORAL\tHARD\n";
    const p = writeTmp("unrecognised.txt", content);
    const pts = await parseBottomSamples(p);
    expect(pts[0]!.rawLabel).toBe("CORAL HARD");
    expect(pts[0]!.substrateType).toBe("CORAL HARD");
  });

  it("handles CRLF line endings", async () => {
    const content = "LAT\tLON\tCOLOUR\tNAT\r\n55.7\t-132.5\tSAND\tFIRM\r\n";
    const p = writeTmp("crlf.txt", content);
    const pts = await parseBottomSamples(p);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.substrateType).toBe("sand");
  });
});

// ---------------------------------------------------------------------------
// routeTarEntries integration — bottom-samples no longer throws NOT_IMPLEMENTED
// ---------------------------------------------------------------------------

import * as fs2 from "fs";
import { routeTarEntries } from "../noaaTarRouter.js";

describe("routeTarEntries — bottom-samples integration", () => {
  it("populates substratePoints from a BSText file alongside a sounding file", async () => {
    const bsDir = path.join(tmpDir, "Bottom_Samples");
    await fs2.promises.mkdir(bsDir, { recursive: true });

    const bsFile = path.join(bsDir, "h09084_BSText.txt");
    const bsContent = [
      "LAT\tLON\tCOLOUR\tNAT",
      "55.70\t-132.50\tSAND\tFIRM",
      "55.71\t-132.51\tMUD\tSOFT",
    ].join("\n");
    await fs2.promises.writeFile(bsFile, bsContent, "utf8");

    // A surveys.xyz file provides at least one depth sounding so the router
    // does not throw NO_PARSEABLE_DATA (which it does when allPoints is empty).
    const xyzContent = [
      "SURVEY\tLON\tLAT\tDEPTH",
      "H09084\t-132.530\t55.690\t42.5",
    ].join("\n");
    await fs2.promises.writeFile(path.join(tmpDir, "surveys.xyz"), xyzContent, "utf8");

    const result = await routeTarEntries(
      tmpDir,
      ["surveys.xyz", "Bottom_Samples/h09084_BSText.txt"],
      "H09084.tar.gz",
    );

    expect(result.substratePoints).toHaveLength(2);
    expect(result.substratePoints[0]!.substrateType).toBe("sand");
    expect(result.substratePoints[1]!.substrateType).toBe("mud");
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ lon: -132.53, lat: 55.69, depth: 42.5 });
  });
});
