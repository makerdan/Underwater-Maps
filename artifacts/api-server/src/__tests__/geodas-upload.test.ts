/**
 * geodas-upload.test.ts
 *
 * Integration tests covering the full upload pipeline for GEODAS .xyz.gz files
 * that use non-comma delimiters (tab-delimited and space-delimited).
 *
 * Pipeline under test:
 *   POST /api/datasets/upload (multipart)
 *     → processUploadJob
 *       → streamGunzipToFile  (decompress .gz)
 *       → runParseWorker      (worker thread)
 *         → parseXyzCsv       (reads decompressed .xyz as whitespace-delimited)
 *         → gridPoints        (produces terrain + overview grids)
 *     → 200 { terrain, overview }
 *
 * Resolution is pinned to 32 so gridPoints stays fast with sparse fixture data.
 * The GEODAS header columns (survey_id, lat, lon, depth, quality_code, active)
 * are handled by parseXyzCsv's column-name detection; quality_code and active
 * become no-ops (extra ignored columns) at this layer — they are only filtered
 * by parseGeodasXyz in the NOAA tar-router path.
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
