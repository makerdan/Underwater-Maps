/**
 * gz-upload.test.ts
 *
 * Covers the three distinct code branches in the .gz decompression path of
 * POST /api/datasets/upload:
 *
 *  1. Valid gzip → 200 with parsed terrain data
 *  2. Malformed gzip (bad magic / corrupt bytes) → 422 decompress_error
 *  3. Decompressed size exceeds 200 MB limit → 422 decompressed_too_large
 *
 * The "oversized" test uses vi.hoisted + vi.mock("zlib") to override
 * createGunzip with a Transform that emits 201 MB when triggered.
 * Buffer.alloc is an O(n) memset — fast — so there is no synchronous
 * compression step.  The flag is toggled per-test and reset in afterEach.
 *
 * Resolution is pinned to 32 for the valid test: the IDW fill in gridPoints
 * is O(N⁴) for very sparse data; the default 256 with only 12 points would
 * take several minutes.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as zlib from "zlib";
import { Transform } from "stream";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import request from "supertest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Zlib mock (hoisted so the factory can reference the shared flag) ──────────
//
// vi.hoisted runs before vi.mock hoisting, so its return value is available
// inside the factory closure.  When useOversized is true, createGunzip returns
// a Transform that emits a buffer large enough to trip the 200 MB size guard.
const zlibMockState = vi.hoisted(() => ({ useOversized: false }));

vi.mock("zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zlib")>();
  return {
    ...actual,
    createGunzip: () => {
      if (zlibMockState.useOversized) {
        const OVER_LIMIT = 200 * 1024 * 1024 + 1; // 1 byte past the 200 MB cap
        const oversizedChunk = Buffer.alloc(OVER_LIMIT, 0);
        return new Transform({
          transform(_chunk, _encoding, callback) {
            this.push(oversizedChunk);
            callback();
          },
        }) as unknown as ReturnType<typeof actual.createGunzip>;
      }
      return actual.createGunzip();
    },
  };
});

// ── Remaining mocks ────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const insertReturningMock = vi.fn().mockResolvedValue([
    {
      id: "gz-test-dataset-id",
      name: "survey xyz",
      minDepth: 1000,
      maxDepth: 1550,
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

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_gz_tests" };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a gzip-compressed XYZ/CSV file with `pointCount` depth rows.
 * All coordinates are valid so parseXyzCsv produces the ≥10 points required.
 */
function makeValidGzXyz(pointCount = 12): Buffer {
  const lines = ["lon,lat,depth"];
  for (let i = 0; i < pointCount; i++) {
    const lon = (142.0 + i * 0.01).toFixed(4);
    const lat = (11.0 + i * 0.01).toFixed(4);
    const depth = 1000 + i * 50;
    lines.push(`${lon},${lat},${depth}`);
  }
  return zlib.gzipSync(Buffer.from(lines.join("\n"), "utf8"));
}

/**
 * Builds a gzip-compressed LAS file from the real survey_1_2.las fixture.
 * The fixture contains enough points to satisfy the ≥10 point requirement.
 */
function makeValidGzLas(): Buffer {
  const lasBuffer = readFileSync(resolve(__dirname, "fixtures/survey_1_2.las"));
  return zlib.gzipSync(lasBuffer);
}

/**
 * Builds a gzip-compressed GPX file with a 20×20 grid of track points.
 * Lat varies only with row, lon only with col, so the 400 points form a true
 * 2-D grid spanning 19°×19°.  At res=32 (32×32=1024 cells, 0.59°/cell) each
 * 1°-spaced point lands in a distinct cell → ~39 % coverage — above the 30 %
 * sparse-survey threshold.  Each trkpt has a negative <ele> so parseGpxTerrain
 * produces valid positive-downward depth values.
 */
function makeValidGzGpx(): Buffer {
  const COLS = 20;
  const ROWS = 20;
  const trkpts: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // lat varies with row only, lon varies with col only → true 2-D grid.
      const lat = (11.0 + r * 1.0).toFixed(4);
      const lon = (142.0 + c * 1.0).toFixed(4);
      const ele = -(1000 + (r * COLS + c) * 2);
      trkpts.push(`      <trkpt lat="${lat}" lon="${lon}"><ele>${ele}.0</ele></trkpt>`);
    }
  }

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
${trkpts.join("\n")}
    </trkseg>
  </trk>
</gpx>`;
  return zlib.gzipSync(Buffer.from(gpx, "utf8"));
}

/**
 * Builds a gzip-compressed NMEA file with a 20×20 grid of position+depth
 * sentence pairs.  Lat varies only with row (48°–67°N), lon only with col
 * (011°–030°E), giving a true 2-D grid spanning 19°×19°.  At res=32 each
 * 1°-spaced point lands in a distinct cell → ~39 % coverage — above the 30 %
 * sparse-survey threshold.  No checksums — the validator accepts them absent.
 */
function makeValidGzNmea(): Buffer {
  const COLS = 20;
  const ROWS = 20;
  const lines: string[] = [];
  let seq = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // GPGGA latitude: DDMM.MMM — lat varies with row only.
      const latDeg = 48 + r;           // 48–67 degrees
      const latField = `${latDeg}00.000`;  // e.g. "4800.000"
      // GPGGA longitude: DDDMM.MMM — lon varies with col only.
      const lonDeg = String(11 + c).padStart(3, "0");  // "011"–"030"
      const lonField = `${lonDeg}00.000`;  // e.g. "01100.000"
      const hh = String(Math.floor(seq / 3600) % 24).padStart(2, "0");
      const mm = String(Math.floor(seq / 60) % 60).padStart(2, "0");
      const ss = String(seq % 60).padStart(2, "0");
      lines.push(
        `$GPGGA,${hh}${mm}${ss},${latField},N,${lonField},E,1,08,0.9,0.0,M,0.0,M,,`,
      );
      const depthM = (50 + (r * COLS + c) * 2).toFixed(1);
      lines.push(`$SDDBT,164.0,f,${depthM},M,27.0,F`);
      seq++;
    }
  }
  return zlib.gzipSync(Buffer.from(lines.join("\n"), "utf8"));
}

afterEach(() => {
  zlibMockState.useOversized = false;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/datasets/upload — .gz upload", () => {
  it(
    "accepts a valid gzip-compressed XYZ file and returns 200 with terrain data",
    async () => {
      const gzBuf = makeValidGzXyz();

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        // Use a small resolution so gridPoints stays fast in tests.
        // The default (256) with 12 sparse points triggers an O(N⁴) IDW fill.
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "survey.xyz.gz",
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
    "rejects a sparse gzip-compressed LAS file with 422 + coveragePercent",
    async () => {
      const gzBuf = makeValidGzLas();

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        // The survey_1_2.las fixture is sparse at res=32 (<30% grid coverage).
        // The sparse-survey guard (Task #2403) rejects it with 422.
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "survey.las.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "sparse_survey");
      expect(res.body).toHaveProperty("coveragePercent");
      expect(typeof res.body.coveragePercent).toBe("number");
      expect(res.body.coveragePercent).toBeLessThan(30);
    },
    15_000,
  );

  it(
    "accepts a valid gzip-compressed GPX file and returns 200 with terrain data",
    async () => {
      const gzBuf = makeValidGzGpx();

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "survey.gpx.gz",
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
    "accepts a valid gzip-compressed NMEA file and returns 200 with terrain data",
    async () => {
      const gzBuf = makeValidGzNmea();

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .field("resolution", "32")
        .attach("file", gzBuf, {
          filename: "survey.nmea.gz",
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
    "returns 422 with error 'decompress_error' for a malformed .gz buffer",
    async () => {
      const malformed = Buffer.from(
        "this is definitely not valid gzip data at all #$%^&",
      );

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .attach("file", malformed, {
          filename: "corrupt.xyz.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "decompress_error");
    },
    10_000,
  );

  it(
    "returns 422 with error 'decompressed_too_large' when decompressed content exceeds 200 MB",
    async () => {
      // Enable the oversized mock so createGunzip emits 201 MB.
      // Any valid .gz serves as the upload payload — the mock intercepts
      // before real inflate and emits a buffer large enough to trip the guard.
      zlibMockState.useOversized = true;
      const anyValidGz = zlib.gzipSync(Buffer.from("trigger"));

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .attach("file", anyValidGz, {
          filename: "huge.xyz.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "decompressed_too_large");
    },
    15_000,
  );
});
