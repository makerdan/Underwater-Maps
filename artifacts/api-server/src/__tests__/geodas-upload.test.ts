/**
 * geodas-upload.test.ts
 *
 * Integration tests covering the full upload pipeline for GEODAS .xyz.gz files
 * that use non-comma delimiters (tab-delimited and space-delimited), and
 * verifying that quality_code / active filtering is applied when those columns
 * are present in the uploaded file.
 *
 * Pipeline under test:
 *   POST /api/datasets/upload (multipart)
 *     → processUploadJob
 *       → streamGunzipToFile  (decompress .gz)
 *       → runParseWorker      (worker thread)
 *         → parseXyzCsv       (reads decompressed .xyz as whitespace-delimited)
 *           quality_code / active columns are filtered when present
 *         → gridPoints        (produces terrain + overview grids)
 *     → 200 { terrain, overview }
 *
 * Resolution is pinned to 32 so gridPoints stays fast with sparse fixture data.
 *
 * Quality-filtering strategy
 * ──────────────────────────
 * "Bad" rows in the mixed-quality fixtures carry an artificially extreme depth
 * (5 000 m) while "good" rows all stay ≤ 200 m.  After the upload we assert
 * that terrain.maxDepth is well below 5 000, confirming the bad rows were
 * excluded before gridding.  If the filter were absent the IDW fill would pull
 * all cells toward 5 000 m and the assertion would fail.
 *
 * NOAA tar-router path
 * ────────────────────
 * That path uses parseGeodasXyz (noaaTarRouter.ts) which has its own dedicated
 * unit-test suite (lib/__tests__/parseGeodasXyz.test.ts).  The tests below
 * focus exclusively on the browser-upload path.
 */

import { describe, it, expect, vi } from "vitest";
import * as zlib from "zlib";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const insertReturningMock = vi.fn().mockResolvedValue([
    {
      id: "geodas-test-dataset-id",
      name: "geodas survey",
      minDepth: 10,
      maxDepth: 100,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ]);
  const valuesMock = vi.fn().mockReturnValue({ returning: insertReturningMock });
  const selectWhereMock = vi.fn().mockResolvedValue([]);
  const fromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: fromMock }),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => {
    const header = req.headers["x-mock-clerk-user-id"];
    return { userId: header ?? null };
  }),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_geodas_tests" };

// ── Fixture builders ──────────────────────────────────────────────────────────

/**
 * Builds a gzip-compressed GEODAS XYZ file with tab-delimited columns:
 *   survey_id  lat  lon  depth  quality_code  active
 *
 * All rows have quality_code=1 and active=1. parseXyzCsv uses /\s+/ for .xyz
 * files and detects lat/lon/depth by column name, so tabs are handled natively.
 */
function makeTabDelimitedGeodasGz(pointCount = 12): Buffer {
  const rows = ["survey_id\tlat\tlon\tdepth\tquality_code\tactive"];
  for (let i = 0; i < pointCount; i++) {
    const lat = (55.700 + i * 0.01).toFixed(4);
    const lon = (-132.530 + i * 0.01).toFixed(4);
    const depth = (15.2 + i * 5).toFixed(1);
    rows.push(`H09084\t${lat}\t${lon}\t${depth}\t1\t1`);
  }
  return zlib.gzipSync(Buffer.from(rows.join("\n") + "\n", "utf8"));
}

/**
 * Builds a gzip-compressed GEODAS XYZ file with space-delimited columns
 * (two-space separation, matching common GEODAS export formats).
 *
 * parseXyzCsv uses /\s+/ for .xyz files so multi-space sequences collapse
 * into a single separator during the split.
 */
function makeSpaceDelimitedGeodasGz(pointCount = 12): Buffer {
  const rows = ["survey_id  lat  lon  depth  quality_code  active"];
  for (let i = 0; i < pointCount; i++) {
    const lat = (55.700 + i * 0.01).toFixed(4);
    const lon = (-132.530 + i * 0.01).toFixed(4);
    const depth = (15.2 + i * 5).toFixed(1);
    rows.push(`H09084  ${lat}  ${lon}  ${depth}  1  1`);
  }
  return zlib.gzipSync(Buffer.from(rows.join("\n") + "\n", "utf8"));
}

/**
 * Builds a gzip-compressed GEODAS XYZ fixture that mixes:
 *   - 12 "good" rows  (quality_code=1, active=1)  depth 50–105 m
 *   -  3 "bad quality" rows (quality_code=0, active=1) depth 5 000 m
 *   -  3 "bad active" rows  (quality_code=1, active=0) depth 5 500 m
 *   -  2 "both bad" rows    (quality_code=0, active=0) depth 6 000 m
 *
 * The delimiter is chosen by the `delim` parameter so a single builder can
 * cover both tab-delimited and comma-delimited variants.
 *
 * If quality filtering is applied, terrain.maxDepth ≤ ~105.
 * If filtering is absent, terrain.maxDepth would approach 6 000.
 */
function makeMixedQualityGeodasGz(delim: "\t" | ","): Buffer {
  const sep = delim;
  const header = ["survey_id", "lat", "lon", "depth", "quality_code", "active"].join(sep);
  const rows: string[] = [header];

  // 12 good rows (quality_code=1, active=1): depths 50–105 m
  for (let i = 0; i < 12; i++) {
    const lat = (55.700 + i * 0.01).toFixed(4);
    const lon = (-132.530 + i * 0.01).toFixed(4);
    const depth = (50.0 + i * 5).toFixed(1);
    rows.push([`H09084`, lat, lon, depth, "1", "1"].join(sep));
  }

  // 3 bad-quality rows: quality_code=0, depth 5 000 m
  for (let i = 0; i < 3; i++) {
    const lat = (56.000 + i * 0.01).toFixed(4);
    const lon = (-133.000 + i * 0.01).toFixed(4);
    rows.push([`H09084`, lat, lon, "5000.0", "0", "1"].join(sep));
  }

  // 3 bad-active rows: active=0, depth 5 500 m
  for (let i = 0; i < 3; i++) {
    const lat = (56.100 + i * 0.01).toFixed(4);
    const lon = (-133.100 + i * 0.01).toFixed(4);
    rows.push([`H09084`, lat, lon, "5500.0", "1", "0"].join(sep));
  }

  // 2 both-bad rows: quality_code=0, active=0, depth 6 000 m
  for (let i = 0; i < 2; i++) {
    const lat = (56.200 + i * 0.01).toFixed(4);
    const lon = (-133.200 + i * 0.01).toFixed(4);
    rows.push([`H09084`, lat, lon, "6000.0", "0", "0"].join(sep));
  }

  return zlib.gzipSync(Buffer.from(rows.join("\n") + "\n", "utf8"));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/datasets/upload — GEODAS .xyz.gz (tab- and space-delimited)", () => {
  it(
    "accepts a tab-delimited GEODAS .xyz.gz file and returns 200 with terrain data",
    async () => {
      const gzBuf = makeTabDelimitedGeodasGz();

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "h09084_tab.xyz.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("terrain");
      expect(res.body.terrain).toHaveProperty("depths");
      expect(Array.isArray(res.body.terrain.depths)).toBe(true);
      expect(res.body).toHaveProperty("overview");
    },
    15_000,
  );

  it(
    "accepts a space-delimited GEODAS .xyz.gz file and returns 200 with terrain data",
    async () => {
      const gzBuf = makeSpaceDelimitedGeodasGz();

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "h09084_space.xyz.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("terrain");
      expect(res.body.terrain).toHaveProperty("depths");
      expect(Array.isArray(res.body.terrain.depths)).toBe(true);
      expect(res.body).toHaveProperty("overview");
    },
    15_000,
  );
});

describe("POST /api/datasets/upload — GEODAS quality_code / active filtering", () => {
  /**
   * Tab-delimited upload (.xyz.gz): verify rows with quality_code=0 or
   * active=0 are excluded from the terrain grid.
   *
   * The fixture carries 12 good rows (depth ≤ 105 m) and 8 bad rows
   * (depth 5 000–6 000 m).  If filtering is applied, terrain.maxDepth stays
   * well below 5 000.  If the filter is absent, the grid absorbs the extreme
   * depths and maxDepth would be several thousand metres.
   */
  it(
    "tab-delimited upload excludes rows with quality_code=0 or active=0",
    async () => {
      const gzBuf = makeMixedQualityGeodasGz("\t");

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "h09084_mixed_quality.xyz.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("terrain");

      // Good rows span depths 50–105 m.  IDW fill may push cells slightly
      // beyond the input max, so we allow up to 200 m as headroom.
      // If bad rows (5 000–6 000 m) were included this check would fail.
      const maxDepth: number = res.body.terrain.maxDepth;
      expect(maxDepth).toBeGreaterThan(0);
      expect(maxDepth).toBeLessThan(200);
    },
    15_000,
  );

  /**
   * Comma-delimited upload (.csv.gz): same quality-filter assertions using
   * comma as the column delimiter (tests the CSV branch of parseXyzCsv).
   */
  it(
    "comma-delimited upload excludes rows with quality_code=0 or active=0",
    async () => {
      const gzBuf = makeMixedQualityGeodasGz(",");

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "h09084_mixed_quality.csv.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("terrain");

      const maxDepth: number = res.body.terrain.maxDepth;
      expect(maxDepth).toBeGreaterThan(0);
      expect(maxDepth).toBeLessThan(200);
    },
    15_000,
  );

  /**
   * Files without quality_code / active columns must still parse normally —
   * no filtering is applied, all rows with valid coordinates are included.
   */
  it(
    "files without quality_code / active columns are not filtered",
    async () => {
      const rows = ["survey_id,lat,lon,depth"];
      for (let i = 0; i < 12; i++) {
        const lat = (55.700 + i * 0.01).toFixed(4);
        const lon = (-132.530 + i * 0.01).toFixed(4);
        const depth = (50.0 + i * 5).toFixed(1);
        rows.push(`H09084,${lat},${lon},${depth}`);
      }
      const gzBuf = zlib.gzipSync(Buffer.from(rows.join("\n") + "\n", "utf8"));

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "h09084_no_quality_cols.csv.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("terrain");
      expect(Array.isArray(res.body.terrain.depths)).toBe(true);
    },
    15_000,
  );

  /**
   * Regression guard: a generic (non-GEODAS) CSV that happens to have a
   * "status" or "flag" column must NOT be filtered on that column.
   *
   * The fixture below has 12 rows all with status="open" (not the integer 1).
   * If the quality filter incorrectly matched "status" as an active synonym,
   * all rows would be dropped and the upload would fail with a parsing error.
   * The correct behaviour is to include every row and return 200 with terrain.
   */
  it(
    "generic CSV with a 'status' column is not filtered by quality logic",
    async () => {
      const rows = ["lon,lat,depth,status"];
      for (let i = 0; i < 12; i++) {
        const lon = (142.0 + i * 0.01).toFixed(4);
        const lat = (11.0 + i * 0.01).toFixed(4);
        const depth = 100 + i * 5;
        rows.push(`${lon},${lat},${depth},open`);
      }
      const gzBuf = zlib.gzipSync(Buffer.from(rows.join("\n") + "\n", "utf8"));

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "generic_with_status.csv.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("terrain");
      expect(Array.isArray(res.body.terrain.depths)).toBe(true);
    },
    15_000,
  );

  /**
   * Regression guard: a generic CSV with a "flag" column (another common
   * synonym rejected for broad matching) must not lose rows.
   */
  it(
    "generic CSV with a 'flag' column is not filtered by quality logic",
    async () => {
      const rows = ["lon,lat,depth,flag"];
      for (let i = 0; i < 12; i++) {
        const lon = (142.0 + i * 0.01).toFixed(4);
        const lat = (11.0 + i * 0.01).toFixed(4);
        const depth = 100 + i * 5;
        // flag = 2 — would be dropped if incorrectly treated as quality_code
        rows.push(`${lon},${lat},${depth},2`);
      }
      const gzBuf = zlib.gzipSync(Buffer.from(rows.join("\n") + "\n", "utf8"));

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "generic_with_flag.csv.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("terrain");
      // All 12 rows contribute; terrain.maxDepth should reflect them
      expect(res.body.terrain.maxDepth).toBeGreaterThan(0);
    },
    15_000,
  );
});
