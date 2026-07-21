/**
 * raster-routes.test.ts
 *
 * Route-level tests for the two-step raster contour upload pipeline:
 *   POST /api/datasets/raster-extract
 *   POST /api/datasets/raster-commit
 *
 * Done-looks-like (task-3079):
 *  - raster-extract: auth guard (401), missing file (400), wrong extension (415),
 *    extraction failure (422), happy path returns token + labels (200)
 *  - raster-commit: auth guard (401), invalid body (400), bad/expired token (422),
 *    happy path returns terrain + savedDatasetId (200)
 *  - correctedLabels sent to raster-commit are forwarded to commitCachedExtraction
 *    (verifying corrections override cached OCR labels at the route boundary)
 *
 * Mock approach: pdfContourRaster is fully mocked so the tests focus on HTTP
 * behaviour (auth, validation, error mapping, response shape) without running
 * the real Python subprocess.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Capture DB inserts so success tests can assert on the saved dataset.
const insertedRows: Array<Record<string, unknown>> = [];

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const { vi: vitest } = await import("vitest");
  const insertReturningMock = vitest.fn().mockImplementation(async () => [
    {
      id: "raster-test-dataset-id",
      name: "my contour map",
      minDepth: insertedRows[insertedRows.length - 1]?.minDepth ?? 1,
      maxDepth: insertedRows[insertedRows.length - 1]?.maxDepth ?? 10,
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

// Mock the raster contour library so these route tests never shell out to
// Python. The mocks are configured per-test via mockReturnValue / mockRejectedValue.
//
// vi.hoisted() is required because vi.mock() factory closures run before
// module-level let/const declarations (they are hoisted to the top of the
// file). Without vi.hoisted(), the factory sees uninitialized variables and
// throws a TDZ ReferenceError.
const { mockExtractRasterImageContoursOnly, mockCommitCachedExtraction } = vi.hoisted(() => ({
  mockExtractRasterImageContoursOnly: vi.fn(),
  mockCommitCachedExtraction: vi.fn(),
}));

vi.mock("../lib/pdfContourRaster.js", () => ({
  extractRasterImageContoursOnly: mockExtractRasterImageContoursOnly,
  commitCachedExtraction: mockCommitCachedExtraction,
  extractRasterContours: vi.fn(),
  parseRasterPdfContourFile: vi.fn(),
  parseRasterImageContourFile: vi.fn(),
  retrieveCachedExtraction: vi.fn(),
}));

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";
import { PdfStageError } from "../lib/pdfContour.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTHED = { "x-mock-clerk-user-id": "user_raster_route_tests" };
const VALID_BBOX = JSON.stringify({ minLon: -93.5, minLat: 45.1, maxLon: -93.4, maxLat: 45.2 });

/** A minimal valid PNG header (89 50 4E 47 …) that passes the multer filter. */
const FAKE_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
  "2e00000000c49444154789c6260000000020001e221bc330000000049454e44ae426082",
  "hex",
);

/** 20 synthetic RawPoints spread across the valid bbox. */
function makeFakePoints(n = 20) {
  return Array.from({ length: n }, (_, i) => ({
    lon: -93.5 + (i % 5) * 0.02,
    lat: 45.1 + Math.floor(i / 5) * 0.02,
    depth: 5 + (i % 4) * 5,
  }));
}

/** Default happy-path return value for extractRasterImageContoursOnly. */
const FAKE_EXTRACT_RESULT = {
  token: "fake-token-abc123",
  labels: [
    { x: 100, y: 200, value: 10, text: "10" },
    { x: 200, y: 300, value: 20, text: "20" },
    { x: 300, y: 400, value: 30, text: "30" },
  ],
  polylineCount: 3,
  width: 500,
  height: 400,
};

beforeEach(() => {
  __resetRateLimitMemory();
  insertedRows.length = 0;
  vi.clearAllMocks();
});

// ── POST /api/datasets/raster-extract ────────────────────────────────────────

describe("POST /api/datasets/raster-extract", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .post("/api/datasets/raster-extract")
      .attach("file", FAKE_PNG, { filename: "map.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("returns 400 missing_file when no file is uploaded", async () => {
    mockExtractRasterImageContoursOnly.mockResolvedValue(FAKE_EXTRACT_RESULT);
    const res = await request(app)
      .post("/api/datasets/raster-extract")
      .set(AUTHED);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "missing_file");
  });

  it("returns 415 unsupported_file_type for a non-image extension", async () => {
    mockExtractRasterImageContoursOnly.mockResolvedValue(FAKE_EXTRACT_RESULT);
    const res = await request(app)
      .post("/api/datasets/raster-extract")
      .set(AUTHED)
      .attach("file", FAKE_PNG, { filename: "contours.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(415);
    expect(res.body).toHaveProperty("error", "unsupported_file_type");
  });

  it("returns 422 pdf_extract_error when OCR/tracing fails", async () => {
    mockExtractRasterImageContoursOnly.mockRejectedValue(
      new PdfStageError("extract", "no contour lines were detected"),
    );
    const res = await request(app)
      .post("/api/datasets/raster-extract")
      .set(AUTHED)
      .attach("file", FAKE_PNG, { filename: "blank.png", contentType: "image/png" });
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error", "pdf_extract_error");
    expect(String(res.body.details)).toMatch(/contour/i);
  });

  it("returns 200 with token, labels, polylineCount, width, height on success", async () => {
    mockExtractRasterImageContoursOnly.mockResolvedValue(FAKE_EXTRACT_RESULT);
    const res = await request(app)
      .post("/api/datasets/raster-extract")
      .set(AUTHED)
      .attach("file", FAKE_PNG, { filename: "lake-contours.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token: FAKE_EXTRACT_RESULT.token,
      labels: FAKE_EXTRACT_RESULT.labels,
      polylineCount: 3,
      width: 500,
      height: 400,
    });
  });

  it("accepts .jpg extension", async () => {
    mockExtractRasterImageContoursOnly.mockResolvedValue(FAKE_EXTRACT_RESULT);
    const res = await request(app)
      .post("/api/datasets/raster-extract")
      .set(AUTHED)
      .attach("file", FAKE_PNG, { filename: "scan.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
  });
});

// ── POST /api/datasets/raster-commit ─────────────────────────────────────────

// correctedLabels is an array in the JSON body (pdfBbox is a JSON string because
// the route calls JSON.parse(pdfBbox) itself).
const VALID_COMMIT_BODY = {
  token: "fake-token-abc123",
  correctedLabels: [
    { x: 100, y: 200, value: 10, text: "10" },
    { x: 200, y: 300, value: 20, text: "20" },
    { x: 300, y: 400, value: 30, text: "30" },
  ],
  pdfBbox: VALID_BBOX,
  pdfDepthUnit: "feet",
  resolution: "256",
  fileName: "my-contour-map.png",
};

describe("POST /api/datasets/raster-commit", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .post("/api/datasets/raster-commit")
      .send(VALID_COMMIT_BODY);
    expect(res.status).toBe(401);
  });

  it("returns 400 invalid_param when required fields are missing", async () => {
    const res = await request(app)
      .post("/api/datasets/raster-commit")
      .set(AUTHED)
      .send({ token: "abc" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_param");
  });

  it("returns 400 invalid_param when correctedLabels is empty", async () => {
    const res = await request(app)
      .post("/api/datasets/raster-commit")
      .set(AUTHED)
      .send({
        ...VALID_COMMIT_BODY,
        correctedLabels: [],
      });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_param");
  });

  it("returns 400 invalid_param when pdfBbox is malformed JSON", async () => {
    const res = await request(app)
      .post("/api/datasets/raster-commit")
      .set(AUTHED)
      .send({ ...VALID_COMMIT_BODY, pdfBbox: "not-json" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_param");
  });

  it("returns 422 pdf_extract_error when the token is expired or unknown", async () => {
    mockCommitCachedExtraction.mockImplementation(() => {
      throw new PdfStageError("extract", "Extraction session has expired — please re-upload the file and try again.");
    });
    const res = await request(app)
      .post("/api/datasets/raster-commit")
      .set(AUTHED)
      .send(VALID_COMMIT_BODY);
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error", "pdf_extract_error");
    expect(String(res.body.details)).toMatch(/expired/i);
  });

  it("returns 200 with terrain + savedDatasetId on a successful commit", async () => {
    mockCommitCachedExtraction.mockReturnValue(makeFakePoints(20));
    const res = await request(app)
      .post("/api/datasets/raster-commit")
      .set(AUTHED)
      .send(VALID_COMMIT_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("terrain");
    expect(res.body).toHaveProperty("savedDatasetId", "raster-test-dataset-id");
  });

  it("forwards correctedLabels to commitCachedExtraction — overriding OCR output", async () => {
    mockCommitCachedExtraction.mockReturnValue(makeFakePoints(20));

    const overriddenLabels = [
      { x: 50, y: 60, value: 100, text: "100" },
      { x: 150, y: 160, value: 200, text: "200" },
    ];

    const res = await request(app)
      .post("/api/datasets/raster-commit")
      .set(AUTHED)
      .send({
        ...VALID_COMMIT_BODY,
        correctedLabels: overriddenLabels,
      });

    expect(res.status).toBe(200);

    // Verify the mock was called with exactly the corrected labels the client
    // sent — this confirms the route passes corrections through rather than
    // using whatever the original extraction stored.
    expect(mockCommitCachedExtraction).toHaveBeenCalledOnce();
    const [calledToken, calledLabels] = mockCommitCachedExtraction.mock.calls[0] as [string, unknown[]];
    expect(calledToken).toBe(VALID_COMMIT_BODY.token);
    expect(calledLabels).toEqual(overriddenLabels);
  });
});
