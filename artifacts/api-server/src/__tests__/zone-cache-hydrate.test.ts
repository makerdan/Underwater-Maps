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
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoUpdate: () => Promise.resolve([]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  },
  poeUsageLogTable: {},
}));

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

vi.mock("../lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER all mocks are in place
// ---------------------------------------------------------------------------
import {
  hydrateCacheFromDisk,
  datasetZonesCache,
  ZONE_CACHE_SENTINEL,
} from "../routes/poe.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZONE_CACHE_DIR = "/tmp/zone-cache";

/** A valid 64-char sha256 hex string to use as a cache filename. */
const VALID_KEY = createHash("sha256").update("test-key").digest("hex");

/** Minimal valid CachedZones payload. */
const VALID_ENTRY = JSON.stringify({
  zones: ["sandy_shelf"],
  waterType: "saltwater",
  classifiedAt: 1_700_000_000_000,
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
