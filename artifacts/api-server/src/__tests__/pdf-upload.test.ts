/**
 * pdf-upload.test.ts
 *
 * Integration tests for the PDF contour-map path of POST /api/datasets/upload.
 *
 * Done-looks-like (task-3037):
 *  - A vector contour PDF with a valid pdfBbox uploads successfully and the
 *    resulting dataset's maxDepth ≈ 30 ft → 9.144 m (±10%)
 *  - Missing pdfBbox → 400 pdf_georeference_required
 *  - Malformed pdfBbox JSON → 400 pdf_georeference_required
 *  - Raster-only PDF → 422 pdf_extract_error with a "not supported yet" message
 *  - Corrupt PDF bytes → 422 pdf_parse_error
 *
 * Mock setup modelled after gpx-nmea-upload.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Captures the dataset row values passed to db.insert(...).values(...) so the
// success test can assert on the computed maxDepth.
const insertedRows: Array<Record<string, unknown>> = [];

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const { vi: vitest } = await import("vitest");
  const insertReturningMock = vitest.fn().mockImplementation(async () => [
    {
      id: "pdf-test-dataset-id",
      name: "test dataset",
      minDepth: insertedRows[insertedRows.length - 1]?.minDepth ?? 0,
      maxDepth: insertedRows[insertedRows.length - 1]?.maxDepth ?? 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ]);
  const valuesMock = vitest.fn().mockImplementation((row: Record<string, unknown>) => {
    insertedRows.push(row);
    return { returning: insertReturningMock };
  });
  const selectWhereMock = vitest.fn().mockResolvedValue([]);
  const fromMock = vitest.fn().mockReturnValue({ where: selectWhereMock });
  return createDbMock({
    db: {
      select: vitest.fn().mockReturnValue({ from: fromMock }),
      insert: vitest.fn().mockReturnValue({ values: valuesMock }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
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
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";
import {
  makeContourPdf,
  makeRasterOnlyPdf,
  makeCorruptPdf,
} from "./helpers/pdfFixture.js";

beforeEach(() => {
  __resetRateLimitMemory();
  insertedRows.length = 0;
});

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_pdf_tests" };
const VALID_BBOX = JSON.stringify({ minLon: -93.5, minLat: 45.1, maxLon: -93.4, maxLat: 45.2 });

function postPdf(buf: Buffer): request.Test {
  return request(app)
    .post("/api/datasets/upload")
    .set(AUTHED_HEADER)
    .attach("file", buf, { filename: "lake-contours.pdf", contentType: "application/pdf" });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/datasets/upload — PDF contour maps", () => {
  it("uploads a vector contour PDF with georeferencing and grids maxDepth ≈ 9.144 m (30 ft)", async () => {
    const res = await postPdf(makeContourPdf())
      .field("resolution", "256")
      .field("pdfBbox", VALID_BBOX)
      .field("pdfDepthUnit", "feet");

    expect(res.status).toBe(200);
    expect(insertedRows.length).toBe(1);
    const maxDepth = insertedRows[0]!.maxDepth as number;
    // Deepest labeled contour is 30 ft = 9.144 m; IDW gridding stays within 10%.
    expect(maxDepth).toBeGreaterThan(9.144 * 0.9);
    expect(maxDepth).toBeLessThan(9.144 * 1.1);
  }, 30_000);

  it("returns 400 pdf_georeference_required when pdfBbox is missing", async () => {
    const res = await postPdf(makeContourPdf());
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "pdf_georeference_required");
  });

  it("returns 400 invalid_param for malformed pdfBbox JSON", async () => {
    const res = await postPdf(makeContourPdf()).field("pdfBbox", "not-json");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_param");
  });

  it("returns 422 pdf_extract_error with 'not supported yet' for a raster-only PDF", async () => {
    const res = await postPdf(makeRasterOnlyPdf()).field("pdfBbox", VALID_BBOX);
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error", "pdf_extract_error");
    expect(String(res.body.details)).toMatch(/not supported yet/i);
  }, 30_000);

  it("returns 422 pdf_parse_error for corrupt PDF bytes", async () => {
    const res = await postPdf(makeCorruptPdf()).field("pdfBbox", VALID_BBOX);
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error", "pdf_parse_error");
  }, 30_000);
});
