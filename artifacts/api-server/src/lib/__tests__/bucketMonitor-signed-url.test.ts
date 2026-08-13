/**
 * bucketMonitor-signed-url.test.ts
 *
 * Unit tests for the sidecar signed-URL boundary in `signDatasetUploadUrl`.
 *
 * The sidecar may return a malformed response (missing, wrong-type, or
 * non-URL `signed_url` field).  The Zod schema must catch these cases and
 * throw a descriptive error instead of propagating `undefined` as the upload
 * URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Stub every heavy dependency that runs at module-init time so the import of
// bucketMonitor doesn't fail in a unit-test environment.
// ---------------------------------------------------------------------------
vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn().mockImplementation(() => ({
    bucket: vi.fn().mockReturnValue({ file: vi.fn() }),
  })),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  customDatasetsTable: {},
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../cacheRegistry.js", () => ({ registerCache: vi.fn() }));

vi.mock("../terrain.js", () => ({
  parseXyzCsv: vi.fn(),
  gridPoints: vi.fn(),
}));

vi.mock("../uploadParsers.js", () => ({
  parseUploadedFile: vi.fn(),
}));

vi.mock("../tarDetect.js", () => ({
  isTarFile: vi.fn(),
  extractTarFile: vi.fn(),
  isGzipFile: vi.fn(),
}));

vi.mock("../noaaTarRouter.js", () => ({
  routeTarEntries: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module under test (imported after mocks are in place)
// ---------------------------------------------------------------------------
import { signDatasetUploadUrl } from "../bucketMonitor.js";

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response);
}

function makeFetchNotOk(status = 503): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv("DEFAULT_OBJECT_STORAGE_BUCKET_ID", "test-bucket");
});

describe("signDatasetUploadUrl — sidecar signed-URL validation", () => {
  it("returns uploadUrl when the sidecar responds with a valid signed_url", async () => {
    const fakeUrl = "https://storage.googleapis.com/bucket/object?sig=abc";
    vi.stubGlobal("fetch", makeFetchOk({ signed_url: fakeUrl }));

    const result = await signDatasetUploadUrl("user123", "survey.bag");

    expect(result.uploadUrl).toBe(fakeUrl);
    expect(result.objectKey).toMatch(/^pending-datasets\/user123\//);
  });

  it("throws a ZodError when signed_url is missing from the sidecar response", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ other_field: "unexpected" }));

    await expect(signDatasetUploadUrl("user123", "survey.bag")).rejects.toThrow();
  });

  it("throws a ZodError when signed_url is a number instead of a string URL", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ signed_url: 12345 }));

    await expect(signDatasetUploadUrl("user123", "survey.bag")).rejects.toThrow();
  });

  it("throws a ZodError when signed_url is an empty string (not a valid URL)", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ signed_url: "" }));

    await expect(signDatasetUploadUrl("user123", "survey.bag")).rejects.toThrow();
  });

  it("throws a ZodError when signed_url is a non-URL string", async () => {
    vi.stubGlobal("fetch", makeFetchOk({ signed_url: "not-a-url" }));

    await expect(signDatasetUploadUrl("user123", "survey.bag")).rejects.toThrow();
  });

  it("throws when sidecar returns non-OK status", async () => {
    vi.stubGlobal("fetch", makeFetchNotOk(503));

    await expect(signDatasetUploadUrl("user123", "survey.bag")).rejects.toThrow(
      "Failed to sign dataset upload URL: 503",
    );
  });
});
