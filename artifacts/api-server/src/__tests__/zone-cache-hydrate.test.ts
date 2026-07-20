/**
 * zone-cache-hydrate.test.ts
 *
 * Covers the three distinct paths inside `hydrateCacheFromDisk`:
 *
 *   1. **First boot (no sentinel)** — .v2 is absent, so every .json file in the
 *      directory is deleted (purge of stale pre-userId-partitioned entries) and
 *      the sentinel is written. The in-memory cache stays empty.
 *
 *   2. **Normal hydration (sentinel present, valid file)** — .v2 exists and a
 *      properly-named 64-char hex file is present; its content is parsed and
 *      stored in `datasetZonesCache`.
 *
 *   3. **Normal hydration (sentinel present, invalid filename)** — .v2 exists but
 *      a file with a non-hex name is present; it is deleted and nothing is loaded.
 *
 *   4. **readdir failure** — the entire function swallows the error and leaves the
 *      cache empty (non-fatal startup error).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import { loggerMockFactory } from "./helpers/mockLogger.js";

// ---------------------------------------------------------------------------
// Hoist fs mock fns so they are available before any import() call
// ---------------------------------------------------------------------------
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockReaddir = vi.hoisted(() => vi.fn<() => Promise<string[]>>().mockResolvedValue([]));
const mockReadFile = vi.hoisted(() => vi.fn<(p: string) => Promise<string>>());
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUnlink = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("fs", () => ({
  promises: {
    mkdir: mockMkdir,
    readdir: mockReaddir,
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    unlink: mockUnlink,
  },
}));

// ---------------------------------------------------------------------------
// Mock all heavy poe.ts dependencies so the module loads without side-effects
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock();
});

vi.mock("@workspace/db/schema", () => ({
  poeUsageLogTable: {},
}));

vi.mock("@workspace/poe", () => ({
  getPoeClient: vi.fn(),
  withRetry: vi.fn(),
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
}));

vi.mock("../middlewares/rateLimit.js", () => ({
  createRateLimit: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  stampBaselineRateLimitHeaders: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  __resetRateLimitMemory: vi.fn(),
}));

vi.mock("../lib/bucketMonitor.js", () => ({
  signDatasetUploadUrl: vi.fn(),
  getJobByObjectKey: vi.fn(),
  recoverGcsJobStatus: vi.fn(),
}));

vi.mock("../lib/cacheRegistry.js", () => ({
  registerCache: vi.fn(),
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

vi.mock("../lib/uploadParsers.js", () => ({
  parseUploadedFile: vi.fn(),
}));

vi.mock("../lib/gunzipBounded.js", () => ({
  gunzipBounded: vi.fn(),
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

vi.mock("../lib/logger.js", () => loggerMockFactory());

// ---------------------------------------------------------------------------
// Import the module under test AFTER all mocks are in place
// ---------------------------------------------------------------------------
import {
  hydrateCacheFromDisk,
  datasetZonesCache,
  ZONE_CACHE_SENTINEL,
  evictStaleCacheEntries,
  ZONE_CACHE_MAX_AGE_MS,
  ZONE_CACHE_MAX_FILES,
} from "../routes/poe.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Read from the same env var that poe.ts uses so mocked-fs call assertions
// match the actual paths poe.ts passes to mkdir/readdir/unlink.  setup.ts sets
// this to a pid-unique dir before any test file loads.
const ZONE_CACHE_DIR =
  process.env["POE_ZONE_CACHE_DIR"] ?? "/tmp/zone-cache";

/** A valid 64-char sha256 hex string to use as a cache filename. */
const VALID_KEY = createHash("sha256").update("test-key").digest("hex");

/**
 * Minimal valid CachedZones payload.
 * classifiedAt is set to "now" so eviction (age-check) never removes it
 * during normal-hydration tests.
 */
const FRESH_CLASSIFIED_AT = Date.now();
const VALID_ENTRY = JSON.stringify({
  zones: ["sandy_shelf"],
  waterType: "saltwater",
  classifiedAt: FRESH_CLASSIFIED_AT,
  source: "ai",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  datasetZonesCache.clear();
  // Default: readdir returns an empty directory (sentinel absent)
  mockReaddir.mockResolvedValue([]);
  mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  mockWriteFile.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
});

describe("hydrateCacheFromDisk — first-boot migration (no .v2 sentinel)", () => {
  it("deletes every .json file when .v2 sentinel is absent", async () => {
    const legacyJsonA = `${VALID_KEY}.json`;
    const legacyJsonB = "old-legacy-file.json";
    mockReaddir.mockResolvedValue([legacyJsonA, legacyJsonB]);

    await hydrateCacheFromDisk();

    // Both .json files must be unlinked
    const unlinkedPaths = mockUnlink.mock.calls.map((c) => c[0]);
    expect(unlinkedPaths).toContain(`${ZONE_CACHE_DIR}/${legacyJsonA}`);
    expect(unlinkedPaths).toContain(`${ZONE_CACHE_DIR}/${legacyJsonB}`);
  });

  it("creates the .v2 sentinel after purging", async () => {
    mockReaddir.mockResolvedValue([`${VALID_KEY}.json`]);

    await hydrateCacheFromDisk();

    expect(mockWriteFile).toHaveBeenCalledWith(ZONE_CACHE_SENTINEL, "", "utf8");
  });

  it("leaves in-memory cache empty after purge", async () => {
    mockReaddir.mockResolvedValue([`${VALID_KEY}.json`]);
    // readFile would return valid JSON — but it should never be called during purge
    mockReadFile.mockResolvedValue(VALID_ENTRY);

    await hydrateCacheFromDisk();

    expect(datasetZonesCache.size).toBe(0);
  });

  it("does not load or read .json files during purge (never calls readFile)", async () => {
    mockReaddir.mockResolvedValue([`${VALID_KEY}.json`]);
    mockReadFile.mockResolvedValue(VALID_ENTRY);

    await hydrateCacheFromDisk();

    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("ignores non-.json files during purge (does not unlink them)", async () => {
    mockReaddir.mockResolvedValue([".v1", "README.txt", `${VALID_KEY}.json`]);

    await hydrateCacheFromDisk();

    const unlinkedPaths = mockUnlink.mock.calls.map((c) => c[0]);
    expect(unlinkedPaths).not.toContain(`${ZONE_CACHE_DIR}/.v1`);
    expect(unlinkedPaths).not.toContain(`${ZONE_CACHE_DIR}/README.txt`);
    expect(unlinkedPaths).toContain(`${ZONE_CACHE_DIR}/${VALID_KEY}.json`);
  });

  it("still writes the sentinel even when the directory is already empty", async () => {
    mockReaddir.mockResolvedValue([]);

    await hydrateCacheFromDisk();

    expect(mockWriteFile).toHaveBeenCalledWith(ZONE_CACHE_SENTINEL, "", "utf8");
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});

describe("hydrateCacheFromDisk — normal hydration (sentinel present)", () => {
  it("loads a valid hex-named entry into the in-memory cache", async () => {
    mockReaddir.mockResolvedValue([".v2", `${VALID_KEY}.json`]);
    mockReadFile.mockResolvedValue(VALID_ENTRY);

    await hydrateCacheFromDisk();

    expect(datasetZonesCache.has(VALID_KEY)).toBe(true);
    const entry = datasetZonesCache.get(VALID_KEY);
    expect(entry?.waterType).toBe("saltwater");
    expect(entry?.zones).toContain("sandy_shelf");
  });

  it("does not write a new sentinel when one already exists", async () => {
    mockReaddir.mockResolvedValue([".v2", `${VALID_KEY}.json`]);
    mockReadFile.mockResolvedValue(VALID_ENTRY);

    await hydrateCacheFromDisk();

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("deletes a file whose name is not a valid 64-char hex key", async () => {
    const badFile = "not-a-hex-key.json";
    mockReaddir.mockResolvedValue([".v2", badFile]);

    await hydrateCacheFromDisk();

    const unlinkedPaths = mockUnlink.mock.calls.map((c) => c[0]);
    expect(unlinkedPaths).toContain(`${ZONE_CACHE_DIR}/${badFile}`);
    expect(datasetZonesCache.size).toBe(0);
  });

  it("does not load an entry whose key is already in the in-memory cache", async () => {
    const existing = {
      zones: ["silt_plain"],
      waterType: "saltwater" as const,
      classifiedAt: 999,
    };
    datasetZonesCache.set(VALID_KEY, existing);

    mockReaddir.mockResolvedValue([".v2", `${VALID_KEY}.json`]);
    mockReadFile.mockResolvedValue(VALID_ENTRY);

    await hydrateCacheFromDisk();

    // The pre-existing entry must not be overwritten
    expect(datasetZonesCache.get(VALID_KEY)).toBe(existing);
  });

  it("skips non-.json filenames (including the sentinel itself)", async () => {
    mockReaddir.mockResolvedValue([".v2"]);

    await hydrateCacheFromDisk();

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(datasetZonesCache.size).toBe(0);
  });
});

describe("hydrateCacheFromDisk — error resilience", () => {
  it("does not throw when readdir rejects (non-fatal)", async () => {
    mockReaddir.mockRejectedValue(new Error("disk error"));

    await expect(hydrateCacheFromDisk()).resolves.toBeUndefined();
    expect(datasetZonesCache.size).toBe(0);
  });

  it("does not throw when readFile fails for one entry (best-effort load)", async () => {
    mockReaddir.mockResolvedValue([".v2", `${VALID_KEY}.json`]);
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    await expect(hydrateCacheFromDisk()).resolves.toBeUndefined();
    expect(datasetZonesCache.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// evictStaleCacheEntries — direct unit tests
// ---------------------------------------------------------------------------

describe("evictStaleCacheEntries — age eviction", () => {
  it("evicts a file whose classifiedAt is older than ZONE_CACHE_MAX_AGE_MS", async () => {
    const staleAt = Date.now() - ZONE_CACHE_MAX_AGE_MS - 1_000; // 1 s past TTL
    const staleEntry = JSON.stringify({ zones: [], waterType: "saltwater", classifiedAt: staleAt });
    const staleFile = `${VALID_KEY}.json`;

    mockReadFile.mockResolvedValue(staleEntry);

    const survivors = await evictStaleCacheEntries([staleFile]);

    expect(survivors.has(staleFile)).toBe(false);
    expect(mockUnlink).toHaveBeenCalledWith(`${ZONE_CACHE_DIR}/${staleFile}`);
  });

  it("keeps a file whose classifiedAt is within ZONE_CACHE_MAX_AGE_MS", async () => {
    const freshEntry = VALID_ENTRY; // classifiedAt = Date.now()
    const freshFile = `${VALID_KEY}.json`;

    mockReadFile.mockResolvedValue(freshEntry);

    const survivors = await evictStaleCacheEntries([freshFile]);

    expect(survivors.has(freshFile)).toBe(true);
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("returns an empty set and unlinks a stale file even if unlink fails", async () => {
    const staleAt = Date.now() - ZONE_CACHE_MAX_AGE_MS - 1_000;
    const staleEntry = JSON.stringify({ zones: [], waterType: "saltwater", classifiedAt: staleAt });

    mockReadFile.mockResolvedValue(staleEntry);
    mockUnlink.mockRejectedValue(new Error("EPERM"));

    const survivors = await evictStaleCacheEntries([`${VALID_KEY}.json`]);

    expect(survivors.size).toBe(0);
  });

  it("treats an entry with no classifiedAt field as age 0 (epoch) and evicts it", async () => {
    const noTimestamp = JSON.stringify({ zones: [], waterType: "saltwater" });
    const file = `${VALID_KEY}.json`;

    mockReadFile.mockResolvedValue(noTimestamp);

    const survivors = await evictStaleCacheEntries([file]);

    expect(survivors.has(file)).toBe(false);
    expect(mockUnlink).toHaveBeenCalledWith(`${ZONE_CACHE_DIR}/${file}`);
  });

  it("skips a file that cannot be read (returns no survivor, no unlink)", async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    const survivors = await evictStaleCacheEntries([`${VALID_KEY}.json`]);

    expect(survivors.size).toBe(0);
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("returns an empty set for an empty input list", async () => {
    const survivors = await evictStaleCacheEntries([]);
    expect(survivors.size).toBe(0);
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});

describe("evictStaleCacheEntries — file count cap", () => {
  const makeKey = (seed: string) => createHash("sha256").update(seed).digest("hex");

  it("evicts oldest files when count exceeds ZONE_CACHE_MAX_FILES", async () => {
    // Build ZONE_CACHE_MAX_FILES + 2 fresh files with distinct classifiedAt values.
    const count = ZONE_CACHE_MAX_FILES + 2;
    const keys: string[] = [];
    const entries: { file: string; classifiedAt: number }[] = [];

    for (let i = 0; i < count; i++) {
      const key = makeKey(`count-test-${i}`);
      const file = `${key}.json`;
      // Spread classifiedAt so sort order is deterministic; all are recent (not age-evicted).
      const classifiedAt = Date.now() - (count - i) * 1_000; // oldest has smallest i
      keys.push(key);
      entries.push({ file, classifiedAt });
    }

    const allFiles = entries.map((e) => e.file);

    // readFile returns the matching entry JSON based on the filename argument.
    mockReadFile.mockImplementation((p: string) => {
      const basename = (p as string).split("/").pop()!;
      const entry = entries.find((e) => e.file === basename);
      if (!entry) return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(
        JSON.stringify({ zones: [], waterType: "saltwater", classifiedAt: entry.classifiedAt }),
      );
    });

    const survivors = await evictStaleCacheEntries(allFiles);

    // Exactly ZONE_CACHE_MAX_FILES must survive.
    expect(survivors.size).toBe(ZONE_CACHE_MAX_FILES);

    // The two oldest files (entries[0] and entries[1]) must be evicted.
    expect(survivors.has(entries[0]!.file)).toBe(false);
    expect(survivors.has(entries[1]!.file)).toBe(false);

    // The most recent files must survive.
    expect(survivors.has(entries[count - 1]!.file)).toBe(true);
    expect(survivors.has(entries[count - 2]!.file)).toBe(true);

    // Two unlink calls for the two evicted files.
    expect(mockUnlink).toHaveBeenCalledTimes(2);
  });

  it("does not evict anything when count equals ZONE_CACHE_MAX_FILES", async () => {
    const count = ZONE_CACHE_MAX_FILES;
    const allFiles: string[] = [];

    for (let i = 0; i < count; i++) {
      allFiles.push(`${makeKey(`exact-cap-${i}`)}.json`);
    }

    mockReadFile.mockResolvedValue(VALID_ENTRY); // all fresh

    const survivors = await evictStaleCacheEntries(allFiles);

    expect(survivors.size).toBe(ZONE_CACHE_MAX_FILES);
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});

describe("hydrateCacheFromDisk — eviction integration", () => {
  it("does not load a stale entry (age limit) into the in-memory cache", async () => {
    const staleAt = Date.now() - ZONE_CACHE_MAX_AGE_MS - 1_000;
    const staleEntry = JSON.stringify({
      zones: ["sandy_shelf"],
      waterType: "saltwater",
      classifiedAt: staleAt,
      source: "ai",
    });

    mockReaddir.mockResolvedValue([".v2", `${VALID_KEY}.json`]);
    mockReadFile.mockResolvedValue(staleEntry);

    await hydrateCacheFromDisk();

    expect(mockUnlink).toHaveBeenCalledWith(`${ZONE_CACHE_DIR}/${VALID_KEY}.json`);
    expect(datasetZonesCache.size).toBe(0);
  });

  it("loads a fresh entry into the in-memory cache after eviction pass", async () => {
    mockReaddir.mockResolvedValue([".v2", `${VALID_KEY}.json`]);
    mockReadFile.mockResolvedValue(VALID_ENTRY); // fresh classifiedAt

    await hydrateCacheFromDisk();

    expect(datasetZonesCache.has(VALID_KEY)).toBe(true);
    expect(datasetZonesCache.get(VALID_KEY)?.zones).toContain("sandy_shelf");
  });
});
