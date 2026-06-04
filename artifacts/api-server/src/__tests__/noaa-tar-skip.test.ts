/**
 * noaa-tar-skip.test.ts
 *
 * Verifies that NOAA tar.gz archives containing only unsupported file types
 * are handled gracefully:
 *
 *  1. An archive with only unsupported files (.pdf, .sid.gz) throws a
 *     NO_PARSEABLE_DATA error with the expected user-facing message.
 *  2. Skipped entries are logged at INFO (never warn/error).
 *  3. When supported entries are mixed with unsupported ones, only the
 *     unsupported files are skipped; the upload succeeds with a non-empty
 *     skipped list in the result.
 *  4. surveys.txt is treated as metadata-only (skip) even though its
 *     extension looks text-like.
 *  5. An .a93.gz entry is superseded (skipped) when an .xyz.gz sibling
 *     exists in the same GEODAS subdirectory.
 *  6. An .a93.gz entry is NOT skipped when no .xyz.gz sibling exists.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { routeTarEntries, classifyTarEntry, parserDispatch } from "../lib/noaaTarRouter.js";

// ---------------------------------------------------------------------------
// Logger mock — capture info calls so we can assert on skip logging
// ---------------------------------------------------------------------------

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "../lib/logger.js";
const mockLogger = logger as unknown as { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

// ---------------------------------------------------------------------------
// parserDispatch mock — replace stubs with controllable fakes so tests that
// exercise the dispatch path do not hit PARSER_NOT_IMPLEMENTED.
// ---------------------------------------------------------------------------

const mockGeodasXyz = vi.fn().mockResolvedValue([
  { lon: -70.1, lat: 42.3, depth: 15 },
  { lon: -70.2, lat: 42.4, depth: 20 },
]);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the geodas-xyz parser to its default fake
  parserDispatch["geodas-xyz"] = mockGeodasXyz;
});

// ---------------------------------------------------------------------------
// classifyTarEntry unit tests
// ---------------------------------------------------------------------------

describe("classifyTarEntry", () => {
  it("classifies .pdf as skip", () => {
    expect(classifyTarEntry("H09084/report.pdf")).toBe("skip");
  });

  it("classifies .sid.gz as skip", () => {
    expect(classifyTarEntry("H09084/chart.sid.gz")).toBe("skip");
  });

  it("classifies .sid as skip", () => {
    expect(classifyTarEntry("raster.sid")).toBe("skip");
  });

  it("classifies .htm as skip", () => {
    expect(classifyTarEntry("GEODAS/index.htm")).toBe("skip");
  });

  it("classifies .html as skip", () => {
    expect(classifyTarEntry("meta.html")).toBe("skip");
  });

  it("classifies surveys.txt (root) as skip", () => {
    expect(classifyTarEntry("surveys.txt")).toBe("skip");
  });

  it("classifies surveys.txt (nested) as skip", () => {
    expect(classifyTarEntry("H09084/surveys.txt")).toBe("skip");
  });

  it("classifies surveys.xyz as noaa-surveys-xyz", () => {
    expect(classifyTarEntry("surveys.xyz")).toBe("noaa-surveys-xyz");
  });

  it("classifies GEODAS/*.xyz.gz as geodas-xyz", () => {
    expect(classifyTarEntry("GEODAS/H09084.xyz.gz")).toBe("geodas-xyz");
    expect(classifyTarEntry("H09084/GEODAS/H09084.xyz.gz")).toBe("geodas-xyz");
  });

  it("classifies GEODAS/*.a93.gz as hyd93-a93", () => {
    expect(classifyTarEntry("GEODAS/H09084.a93.gz")).toBe("hyd93-a93");
  });

  it("classifies unrecognised entries as skip", () => {
    expect(classifyTarEntry("thumbnail.png")).toBe("skip");
    expect(classifyTarEntry("readme.md")).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// routeTarEntries — only-unsupported archive
// ---------------------------------------------------------------------------

describe("routeTarEntries — all-unsupported archive", () => {
  it("throws NO_PARSEABLE_DATA when archive contains only .pdf and .sid.gz", async () => {
    const entries = ["H09084_report.pdf", "H09084_chart.sid.gz"];

    await expect(
      routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz"),
    ).rejects.toMatchObject({
      message: "No parseable bathymetric data found in this archive.",
      code: "NO_PARSEABLE_DATA",
    });
  });

  it("logs skipped files at INFO level (not warn/error)", async () => {
    const entries = ["report.pdf", "chart.sid.gz"];

    await expect(
      routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz"),
    ).rejects.toThrow();

    expect(mockLogger.warn).not.toHaveBeenCalled();

    const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls;
    const skipCalls = infoCalls.filter(([, msg]: [unknown, string]) =>
      typeof msg === "string" && msg.includes("skipping"),
    );
    expect(skipCalls.length).toBe(2);
  });

  it("throws NO_PARSEABLE_DATA when archive contains only surveys.txt", async () => {
    const entries = ["surveys.txt"];

    await expect(
      routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz"),
    ).rejects.toMatchObject({
      message: "No parseable bathymetric data found in this archive.",
      code: "NO_PARSEABLE_DATA",
    });
  });

  it("throws NO_PARSEABLE_DATA when archive is empty", async () => {
    await expect(
      routeTarEntries("/fake/extract/dir", [], "H09084.tar.gz"),
    ).rejects.toMatchObject({
      message: "No parseable bathymetric data found in this archive.",
      code: "NO_PARSEABLE_DATA",
    });
  });
});

// ---------------------------------------------------------------------------
// routeTarEntries — mixed archive (some supported, some not)
// ---------------------------------------------------------------------------

describe("routeTarEntries — mixed archive", () => {
  it("succeeds and populates skipped list when unsupported files accompany a supported entry", async () => {
    const entries = [
      "GEODAS/H09084.xyz.gz",
      "H09084_report.pdf",
      "H09084_chart.sid.gz",
      "surveys.txt",
    ];

    const result = await routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz");

    expect(result.points.length).toBeGreaterThan(0);
    expect(result.skipped).toHaveLength(3);

    const skippedPaths = result.skipped.map((s) => s.path);
    expect(skippedPaths).toContain("H09084_report.pdf");
    expect(skippedPaths).toContain("H09084_chart.sid.gz");
    expect(skippedPaths).toContain("surveys.txt");

    const reasons = result.skipped.map((s) => s.reason);
    expect(reasons).toContain("unsupported-format");
    expect(reasons).toContain("metadata-only");
  });

  it("does not call warn for skipped entries in a mixed archive", async () => {
    const entries = ["GEODAS/H09084.xyz.gz", "report.pdf"];

    await routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz");

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// routeTarEntries — .a93.gz sibling detection
// ---------------------------------------------------------------------------

describe("routeTarEntries — .a93.gz sibling detection", () => {
  it("skips .a93.gz with reason superseded-by-xyz when .xyz.gz exists in same GEODAS dir", async () => {
    const entries = [
      "GEODAS/H09084.xyz.gz",
      "GEODAS/H09084.a93.gz",
    ];

    const result = await routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz");

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.path).toBe("GEODAS/H09084.a93.gz");
    expect(result.skipped[0]!.reason).toBe("superseded-by-xyz");

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("does NOT skip .a93.gz when no .xyz.gz sibling exists — it attempts to parse it", async () => {
    // When there is no .xyz.gz sibling the router must NOT add the .a93.gz to
    // the skipped list; instead it attempts to parse it.  Since the fake path
    // does not exist on disk the real parseHyd93A93 will throw an ENOENT —
    // which is proof that the router reached the parse step rather than
    // silently skipping the file with reason "superseded-by-xyz".
    const entries = ["GEODAS/H09084.a93.gz"];

    await expect(
      routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz"),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^ENOENT$|^NO_PARSEABLE_DATA$/),
    });

    // Crucially, the error must NOT be NO_PARSEABLE_DATA (which is thrown
    // when no entries were even attempted) — it must be ENOENT (file missing),
    // proving the router tried to parse rather than skip.
    const err = await routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz").catch((e) => e);
    expect(err.code).not.toBe("NO_PARSEABLE_DATA");
  });

  it("skips nested GEODAS .a93.gz when nested .xyz.gz sibling exists in same folder", async () => {
    const entries = [
      "H09084/GEODAS/H09084.xyz.gz",
      "H09084/GEODAS/H09084.a93.gz",
    ];

    const result = await routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz");

    const superseded = result.skipped.find((s) => s.reason === "superseded-by-xyz");
    expect(superseded).toBeDefined();
    expect(superseded!.path).toBe("H09084/GEODAS/H09084.a93.gz");
  });
});

// ---------------------------------------------------------------------------
// routeTarEntries — post-parse zero-points behaviour
// ---------------------------------------------------------------------------
// routeTarEntries throws NO_PARSEABLE_DATA when all parsers return empty
// arrays and there are no substrate points or smooth-sheet raster data.

describe("routeTarEntries — zero points guard", () => {
  it("throws NO_PARSEABLE_DATA when all parsers return empty arrays", async () => {
    parserDispatch["geodas-xyz"] = vi.fn().mockResolvedValue([]);

    const entries = ["GEODAS/H09084.xyz.gz"];

    await expect(
      routeTarEntries("/fake/extract/dir", entries, "H09084.tar.gz"),
    ).rejects.toMatchObject({
      message: "No parseable bathymetric data found in this archive.",
      code: "NO_PARSEABLE_DATA",
    });
  });
});
