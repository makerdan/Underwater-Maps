/**
 * multer-extension-reject.test.ts
 *
 * Security audit: verifies that the multer fileFilter on POST
 * /api/datasets/upload rejects every file extension that is NOT on the
 * explicit allowlist.  A disallowed extension must return HTTP 415 with the
 * standard `unsupported_file_type` error shape — never 200 or 500.
 *
 * Also confirms that each extension in the intended allowlist is accepted
 * (multer passes the file through; the route may still return 400 on parse
 * failure, but NOT 415).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const mock = createDbMock();
  return { ...mock, pool: { query: vi.fn().mockResolvedValue({ rows: [{ count: 1, oldest_epoch: Date.now() / 1000 }] }) } };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";

const E2E_USER = "user_ext_reject_test";
const TINY_CONTENT = Buffer.from("not real data");

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Disallowed extensions — must all be rejected with 415
// ---------------------------------------------------------------------------

const DISALLOWED_EXTENSIONS = [
  ".exe",
  ".sh",
  ".bat",
  ".php",
  ".js",
  ".py",
  ".zip",
  ".tar",
  ".html",
  ".svg",
  // ".pdf" removed — vector contour-map PDFs are an accepted upload type now.
  ".docx",
];

describe("POST /api/datasets/upload — disallowed extensions are rejected (415)", () => {
  for (const ext of DISALLOWED_EXTENSIONS) {
    it(`rejects ${ext} with 415 unsupported_file_type`, async () => {
      const res = await request(app)
        .post("/api/datasets/upload")
        .set("x-e2e-user-id", E2E_USER)
        .field("resolution", "128")
        .attach("file", TINY_CONTENT, `malicious${ext}`);

      expect(res.status).toBe(415);
      expect(res.body).toMatchObject({ error: "unsupported_file_type" });
    });
  }
});

// ---------------------------------------------------------------------------
// Allowlisted extensions — multer must pass these through (not 415)
// The route may return 400 (bad parse / validation) but must NOT return 415.
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = [
  ".csv",
  ".txt",
  ".xyz",
  ".gz",
  ".tif",
  ".tiff",
  ".nc",
  ".las",
  ".laz",
  ".bag",
  ".gpx",
  ".nmea",
  ".nme",
];

describe("POST /api/datasets/upload — allowlisted extensions pass the file filter (not 415)", () => {
  for (const ext of ALLOWED_EXTENSIONS) {
    it(`accepts ${ext} (not 415)`, async () => {
      const res = await request(app)
        .post("/api/datasets/upload")
        .set("x-e2e-user-id", E2E_USER)
        .field("resolution", "128")
        .attach("file", TINY_CONTENT, `survey${ext}`);

      expect(res.status).not.toBe(415);
    });
  }
});
