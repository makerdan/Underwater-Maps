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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  __resetRateLimitMemory: vi.fn(),
}));

vi.mock("../lib/substrateGrid.js", () => ({
  sampleSubstrateGrid: vi.fn(),
  substrateToZone: vi.fn(),
  substrateFingerprintForDataset: vi.fn(),
}));

vi.mock("../lib/terrain.js", () => ({
  NYSDEC_BATHY_FEATURE_SERVICE: "https://example.com/nysdec",
  MN_DNR_BATHY_FEATURE_SERVICE: "https://example.com/mn-dnr",
  BUNDLED_TERRAIN: {},
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
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";
import {
  upscaleMemCache,
  upscaleCacheKey,
  UPSCALE_CACHE_TTL_MS,
  __resetUpscaleCacheCounters,
} from "../routes/poe.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("upscale cache — server-side", () => {
  beforeEach(() => {
  __resetRateLimitMemory();
    upscaleMemCache.clear();
    mockCreate.mockReset();
    __resetUpscaleCacheCounters();
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

// ---------------------------------------------------------------------------
// TTL eviction hardening — fake-timer tests
// ---------------------------------------------------------------------------
// These tests use vi.useFakeTimers / vi.setSystemTime so that Date.now() inside
// getMemCacheEntry and readUpscaleDisk returns a time past the TTL, verifying
// that:
//   a) the in-memory entry is evicted (not served stale)
//   b) the disk entry is deleted via fsPromises.unlink (not served stale)
//   c) Poe is called to produce a fresh result
// ---------------------------------------------------------------------------

describe("upscale cache — TTL eviction with fake timers", () => {
  afterEach(() => {
    // Restore real timers after each test in this suite to avoid leaking
    // fake-timer state into other describe blocks.
    vi.useRealTimers();
    upscaleMemCache.clear();
    mockCreate.mockReset();
    mockUnlink.mockReset();
    mockReadFile.mockReset();
    mockReadFile.mockRejectedValue(new Error("ENOENT")); // restore default
    __resetUpscaleCacheCounters();
  });

  it("evicts an expired in-memory entry and an expired disk entry, then calls Poe", async () => {
    vi.useFakeTimers();

    const imageBase64 = "data:image/png;base64,TTLFakeTimerTest==";
    const factor = 2;
    const staleData = "data:image/png;base64,staleUpscaled==";
    const key = upscaleCacheKey(imageBase64, factor);

    // Record "now" before advancing time
    const seedTime = Date.now();

    // Seed the in-memory cache at the current fake time
    upscaleMemCache.set(key, { data: staleData, cachedAt: seedTime, bytes: staleData.length });

    // Seed the disk mock so readUpscaleDisk finds an entry with the same cachedAt.
    // This will be treated as expired once we advance the clock.
    mockReadFile.mockResolvedValue(
      JSON.stringify({ imageBase64: staleData, cachedAt: seedTime, bytes: staleData.length }),
    );

    // Advance system time past the TTL
    vi.setSystemTime(seedTime + UPSCALE_CACHE_TTL_MS + 1_000);

    // Poe returns a fresh result after the cache miss
    const freshResult = "data:image/png;base64,FreshAfterTTLEviction==";
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: freshResult } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });

    const res = await request(app)
      .post("/api/poe/upscale")
      .send({ imageBase64, upscaleFactor: factor });

    expect(res.status).toBe(200);
    expect(res.body.imageBase64).toBe(freshResult);

    // Both the memory entry and the disk entry were expired — Poe must have been called
    expect(mockCreate).toHaveBeenCalledOnce();

    // The expired disk entry must have been deleted
    expect(mockUnlink).toHaveBeenCalled();

    // The in-memory cache must no longer contain the stale entry
    expect(upscaleMemCache.get(key)?.data).not.toBe(staleData);
  });
});
