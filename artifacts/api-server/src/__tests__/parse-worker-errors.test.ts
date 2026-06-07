/**
 * parse-worker-errors.test.ts
 *
 * Confirms that POST /api/datasets/upload returns a structured 422 — not
 * an unhandled 500 — when a supported file format (CSV, GeoTIFF, BAG, LAZ)
 * contains deliberately malformed or truncated content that causes the parser
 * to throw.
 *
 * Each sub-test sends a minimal buffer that looks like the target format but
 * will fail parsing, validating the try/catch block in the upload handler
 * that wraps parseXyzCsv and parseUploadedFile:
 *
 *   } catch (err) {
 *     res.status(422).json({ error: "parse_error", details: msg });
 *   }
 *
 * We also confirm the insufficient-data path (< 10 valid rows) returns 400,
 * demonstrating the full parse-validation pipeline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock();
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";

const E2E_USER = "user_parse_error_test";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
});

describe("POST /api/datasets/upload — parse error → 422", () => {
  it("returns 422 with parse_error for a malformed GeoTIFF (wrong magic bytes)", async () => {
    const malformedTiff = Buffer.from([
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", malformedTiff, "survey.tif");

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "parse_error" });
  });

  it("returns 422 with parse_error for a malformed BAG file (not HDF5)", async () => {
    const malformedBag = Buffer.from("NOT_HDF5_CONTENT_AT_ALL_PADDING_PADDING_PADDING");

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", malformedBag, "survey.bag");

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "parse_error" });
  });

  it("returns 422 with parse_error for a malformed LAZ file (wrong magic)", async () => {
    const malformedLaz = Buffer.alloc(32, 0xff);

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", malformedLaz, "survey.laz");

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "parse_error" });
  });

  it("returns 400 insufficient_data for a CSV with fewer than 10 valid rows", async () => {
    const tinyValidCsv = "lon,lat,depth\n-136.0,58.5,50\n-136.1,58.6,55\n";

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .attach("file", Buffer.from(tinyValidCsv), "small.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "insufficient_data" });
  });

  it("returns 401 when unauthenticated (no bypass header)", async () => {
    vi.unstubAllEnvs();
    const res = await request(app)
      .post("/api/datasets/upload")
      .attach("file", Buffer.from("lon,lat,depth\n"), "test.csv");

    expect(res.status).toBe(401);
  });
});
