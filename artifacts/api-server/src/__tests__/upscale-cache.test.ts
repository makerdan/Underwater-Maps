/**
 * upscale-cache.test.ts
 *
 * Verifies that the server-side upscale cache returns a stored result without
 * making a Poe call on the second request for the same image + factor.
 *
 * Strategy:
 *   1. Mock Poe's `getPoeClient` to return a tracked fake client.
 *   2. Prime `upscaleMemCache` directly with a pre-computed key → result entry.
 *   3. POST to /api/poe/upscale with the corresponding input.
 *   4. Assert the response carries the cached image and the Poe mock was never
 *      invoked.
 *
 * The test exercises the in-memory fast path exclusively; disk I/O is mocked
 * out to keep the test hermetic and fast.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoist fs mock so it is available before module imports.
// Use importOriginal so readFileSync (needed by shoreZoneData.ts at module
// load) passes through, while only overriding the async promises methods.
// ---------------------------------------------------------------------------
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockReaddir = vi.hoisted(() => vi.fn<() => Promise<string[]>>().mockResolvedValue([]));
const mockReadFile = vi.hoisted(() => vi.fn<(p: string) => Promise<string>>().mockRejectedValue(new Error("ENOENT")));
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUnlink = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: mockMkdir,
      readdir: mockReaddir,
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      unlink: mockUnlink,
    },
  };
});

// ---------------------------------------------------------------------------
// Track Poe calls
// ---------------------------------------------------------------------------
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@workspace/poe", () => ({
  getPoeClient: vi.fn(() => ({
    chat: { completions: { create: mockCreate } },
  })),
  withRetry: vi.fn((fn: () => unknown) => fn()),
  PoeCreditsError: class PoeCreditsError extends Error {},
  PoeRateLimitError: class PoeRateLimitError extends Error {},
  PoeAuthError: class PoeAuthError extends Error {},
  ZoneParseError: class ZoneParseError extends Error {},
  hashCacheKey: vi.fn(),
  globalPoeCache: { get: vi.fn(), set: vi.fn(), has: vi.fn(), delete: vi.fn() },
  buildVisionInput: vi.fn(),
  POE_MODELS: {},
  PoeCircuitBreaker: class PoeCircuitBreaker {
    isOpen() { return false; }
    recordSuccess() {}
    recordFailure() {}
  },
}));

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock();
});

vi.mock("@workspace/db/schema", () => ({
  poeUsageLogTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
  lt: vi.fn(() => "lt-condition"),
  desc: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  ne: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  inArray: vi.fn(),
  notInArray: vi.fn(),
  or: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuthenticatedUserId: vi.fn(() => "user_test"),
}));

vi.mock("../middlewares/rateLimit.js", () => ({
  createRateLimit: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  stampBaselineRateLimitHeaders: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../lib/substrateGrid.js", () => ({
  sampleSubstrateGrid: vi.fn(),
  substrateToZone: vi.fn(),
  substrateFingerprintForDataset: vi.fn(),
}));

vi.mock("../lib/terrain.js", () => ({
  ALL_PRESET_DATASETS: [],
  buildTerrainGrid: vi.fn(),
  parseXyzCsv: vi.fn(),
  gridPoints: vi.fn(),
  previewDataset: vi.fn(),
  previewBboxForDownload: vi.fn(),
  buildBboxCsvRows: vi.fn(),
}));

vi.mock("../lib/tileClassify.js", () => ({
  MAX_TILES_PER_SIDE: 4,
  TILE_CONCURRENCY: 2,
  TILE_SIZE: 32,
  planTiles: vi.fn(),
  extractTileDepths32: vi.fn(),
  tileFingerprint: vi.fn(),
  stitchTileLabels: vi.fn(),
  mapWithConcurrency: vi.fn(),
  tileDepthsToPngDataUrl: vi.fn(),
}));

vi.mock("../lib/bucketMonitor.js", () => ({
  signDatasetUploadUrl: vi.fn(),
  getJobByObjectKey: vi.fn(),
  recoverGcsJobStatus: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import app + cache helpers after mocks are registered
// ---------------------------------------------------------------------------

import app from "../app.js";
import { upscaleMemCache, upscaleCacheKey } from "../routes/poe.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("upscale cache — server-side", () => {
  beforeEach(() => {
    upscaleMemCache.clear();
    mockCreate.mockReset();
  });

  it("returns the cached result without calling Poe when the in-memory cache is primed", async () => {
    const imageBase64 = "data:image/png;base64,iVBORw0KGgo=";
    const factor = 2;
    const cachedResult = "data:image/png;base64,UPSCALEDresult==";

    // Prime the in-memory cache with the full UpscaleMemEntry structure
    const key = upscaleCacheKey(imageBase64, factor);
    upscaleMemCache.set(key, { data: cachedResult, cachedAt: Date.now(), bytes: cachedResult.length });

    const res = await request(app)
      .post("/api/poe/upscale")
      .send({ imageBase64, upscaleFactor: factor });

    expect(res.status).toBe(200);
    expect(res.body.imageBase64).toBe(cachedResult);

    // Poe must not have been called at all
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("treats an in-memory entry as a miss when its TTL has expired", async () => {
    const imageBase64 = "data:image/png;base64,EXPIREDimage==";
    const factor = 2;
    const expiredResult = "data:image/png;base64,EXPIREDresult=";

    // Prime cache with a timestamp well in the past (8 days ago → beyond 7-day TTL)
    const key = upscaleCacheKey(imageBase64, factor);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    upscaleMemCache.set(key, { data: expiredResult, cachedAt: eightDaysAgo, bytes: expiredResult.length });

    // Poe should be called because the memory entry is expired
    const freshResult = "data:image/png;base64,FRESHresult==";
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: freshResult } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });

    const res = await request(app)
      .post("/api/poe/upscale")
      .send({ imageBase64, upscaleFactor: factor });

    expect(res.status).toBe(200);
    expect(res.body.imageBase64).toBe(freshResult);
    // Poe was called because the expired entry was treated as a miss
    expect(mockCreate).toHaveBeenCalledOnce();
    // The key is now in memory with the fresh data (not the old expired data)
    expect(upscaleMemCache.get(key)?.data).toBe(freshResult);
  });

  it("calls Poe and stores the result when no cache entry exists", async () => {
    const imageBase64 = "data:image/png;base64,FRESHimage==";
    const factor = 2;
    const poeResult = "data:image/png;base64,POEupscaled==";

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: { content: poeResult },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const res = await request(app)
      .post("/api/poe/upscale")
      .send({ imageBase64, upscaleFactor: factor });

    expect(res.status).toBe(200);
    expect(res.body.imageBase64).toBe(poeResult);
    expect(mockCreate).toHaveBeenCalledOnce();

    // Result should now be in the in-memory cache with metadata
    const key = upscaleCacheKey(imageBase64, factor);
    expect(upscaleMemCache.get(key)?.data).toBe(poeResult);
  });

  it("upscaleCacheKey strips data-URL prefix so prefixed and bare base64 produce the same key", () => {
    const bare = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==";
    const withPrefix = `data:image/png;base64,${bare}`;
    expect(upscaleCacheKey(bare, 2)).toBe(upscaleCacheKey(withPrefix, 2));
  });

  it("uses different cache keys for different upscale factors", () => {
    const imageBase64 = "data:image/png;base64,abc123";
    expect(upscaleCacheKey(imageBase64, 2)).not.toBe(upscaleCacheKey(imageBase64, 4));
  });
});
