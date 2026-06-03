/**
 * gpx-nmea-upload.test.ts
 *
 * Integration tests for the GPX and NMEA parse-error path of
 * POST /api/datasets/upload.
 *
 * Done-looks-like (task-1202):
 *  - A GPX file with no <ele> tags returns 422 with error "parse_error" and
 *    a non-empty `details` string that mentions "elevation" (from parseGpxTerrain)
 *  - An NMEA file with no depth sentences returns 422 with error "parse_error"
 *    and a non-empty `details` string that mentions "NMEA" (from parseNmea)
 *
 * The mock setup is modelled after gz-upload.test.ts and bag-upload.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import * as zlib from "zlib";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const insertReturningMock = vi.fn().mockResolvedValue([
    {
      id: "gpx-nmea-test-dataset-id",
      name: "test dataset",
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
  or: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn(() => "in-condition"),
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

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_gpx_nmea_tests" };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * A GPX buffer where every trkpt is missing the <ele> child.
 * parseGpxTerrain will throw because no elevation/depth points are found.
 */
function makeGpxNoElevation(): Buffer {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="55.0000" lon="10.0000"><name>Point A</name></trkpt>
      <trkpt lat="55.0100" lon="10.0100"><name>Point B</name></trkpt>
      <trkpt lat="55.0200" lon="10.0200"><name>Point C</name></trkpt>
    </trkseg>
  </trk>
</gpx>`;
  return Buffer.from(gpx, "utf8");
}

/**
 * An NMEA buffer that contains a valid position sentence but no depth
 * sentences (no $SDDBT / $SDDBS / $SDDPT).
 * parseNmea will throw because no position+depth pairs can be formed.
 */
function makeNmeaNoDepth(): Buffer {
  const nmea = [
    "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47",
    // Intentionally no $SDDBT / $SDDBS / $SDDPT line follows
    "$GPGGA,123620,4908.046,N,01231.001,E,1,05,1.2,600.0,M,46.9,M,,*53",
  ].join("\n");
  return Buffer.from(nmea, "utf8");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/datasets/upload — GPX/NMEA 422 parse errors", () => {
  it(
    "returns 422 with parse_error and an elevation-related details string for a GPX with no <ele> tags",
    async () => {
      const buf = makeGpxNoElevation();

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .attach("file", buf, {
          filename: "track.gpx",
          contentType: "application/gpx+xml",
        });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "parse_error");
      expect(typeof res.body.details).toBe("string");
      expect((res.body.details as string).length).toBeGreaterThan(0);
      // parseGpxTerrain throws with a message that mentions "elevation"
      expect(res.body.details as string).toMatch(/elevation/i);
    },
    10_000,
  );

  it(
    "returns 422 with parse_error and an NMEA-related details string for an NMEA file with no depth sentences",
    async () => {
      const buf = makeNmeaNoDepth();

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .attach("file", buf, {
          filename: "log.nmea",
          contentType: "text/plain",
        });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "parse_error");
      expect(typeof res.body.details).toBe("string");
      expect((res.body.details as string).length).toBeGreaterThan(0);
      // parseNmea throws with a message that mentions "NMEA"
      expect(res.body.details as string).toMatch(/NMEA/i);
    },
    10_000,
  );

  it(
    "returns 422 with parse_error and details field (not detail) — verifying the field name is consistent",
    async () => {
      const buf = makeGpxNoElevation();

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .attach("file", buf, {
          filename: "no-ele.gpx",
          contentType: "application/gpx+xml",
        });

      expect(res.status).toBe(422);
      // Must have `details` (plural), consistent with all other 4xx routes in this API.
      // The frontend reads `e?.data?.details` to display the error in the toast/banner.
      expect(res.body).toHaveProperty("details");
      // Must NOT have the old `detail` (singular) key that was a bug.
      expect(res.body).not.toHaveProperty("detail");
    },
    10_000,
  );
});

// ── .gz-compressed XYZ/CSV parse-error tests ──────────────────────────────────
//
// These tests exercise the gunzipBounded → parseXyzCsv branch that fires when
// the inner extension is csv/xyz/txt.  A header-only CSV (no data rows) must
// produce a 422 parse_error with a meaningful `details` string — identical
// contract to the GPX/NMEA parse-error path above.

/**
 * A CSV buffer with only a header row and no data rows.
 * parseXyzCsv will throw because no numeric (lon, lat, depth) rows are found.
 */
function makeCsvHeaderOnly(): Buffer {
  return Buffer.from("lon,lat,depth\n", "utf8");
}

/**
 * An XYZ buffer with only a header row and no data rows.
 */
function makeXyzHeaderOnly(): Buffer {
  return Buffer.from("lon lat depth\n", "utf8");
}

describe("POST /api/datasets/upload — .gz-compressed XYZ/CSV 422 parse errors", () => {
  it(
    "returns 422 with parse_error and a data-related details string for a .gz-wrapped CSV with only a header row",
    async () => {
      const gzBuf = zlib.gzipSync(makeCsvHeaderOnly());

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .attach("file", gzBuf, {
          filename: "survey.csv.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "parse_error");
      expect(typeof res.body.details).toBe("string");
      expect((res.body.details as string).length).toBeGreaterThan(0);
      // parseXyzCsv throws with a message mentioning "data", "row", or "point"
      expect(res.body.details as string).toMatch(/point|row|data/i);
    },
    10_000,
  );

  it(
    "returns 422 with parse_error and a data-related details string for a .gz-wrapped XYZ file with only a header row",
    async () => {
      const gzBuf = zlib.gzipSync(makeXyzHeaderOnly());

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .attach("file", gzBuf, {
          filename: "survey.xyz.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "parse_error");
      expect(typeof res.body.details).toBe("string");
      expect((res.body.details as string).length).toBeGreaterThan(0);
      expect(res.body.details as string).toMatch(/point|row|data/i);
    },
    10_000,
  );
});

// ── .gz-compressed GPX/NMEA parse-error tests ─────────────────────────────────
//
// These tests exercise the distinct gunzipBounded → parseUploadedFile code
// branch that runs when the upload filename ends in .gz.  A valid .gz wrapping
// a corrupt GPX/NMEA payload should still produce a 422 parse_error with a
// meaningful `details` string — the same contract as the bare-file path above.

describe("POST /api/datasets/upload — .gz-compressed GPX/NMEA 422 parse errors", () => {
  it(
    "returns 422 with parse_error and an elevation-related details string for a .gz-wrapped GPX with no <ele> tags",
    async () => {
      const gzBuf = zlib.gzipSync(makeGpxNoElevation());

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .attach("file", gzBuf, {
          filename: "track.gpx.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "parse_error");
      expect(typeof res.body.details).toBe("string");
      expect((res.body.details as string).length).toBeGreaterThan(0);
      expect(res.body.details as string).toMatch(/elevation/i);
    },
    10_000,
  );

  it(
    "returns 422 with parse_error and an NMEA-related details string for a .gz-wrapped NMEA file with no depth sentences",
    async () => {
      const gzBuf = zlib.gzipSync(makeNmeaNoDepth());

      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTHED_HEADER)
        .attach("file", gzBuf, {
          filename: "log.nmea.gz",
          contentType: "application/gzip",
        });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "parse_error");
      expect(typeof res.body.details).toBe("string");
      expect((res.body.details as string).length).toBeGreaterThan(0);
      expect(res.body.details as string).toMatch(/NMEA/i);
    },
    10_000,
  );
});
