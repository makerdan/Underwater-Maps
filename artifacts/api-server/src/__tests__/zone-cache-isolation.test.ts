/**
 * zone-cache-isolation.test.ts
 *
 * End-to-end isolation tests that prove the userId-partitioned zone cache
 * keeps user A's entries completely separate from user B's, even when both
 * users supply identical gridHash / waterType / substrateFp inputs.
 *
 * Covers:
 *   1. zoneCacheKey — pure key derivation produces distinct hashes per user
 *   2. In-memory cache (datasetZonesCache) — user A's write is invisible to B
 *   3. Disk cache (readZoneDiskByHash) — user A's file is invisible to B
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { loggerMockFactory } from "./helpers/mockLogger.js";

// ---------------------------------------------------------------------------
// Stub every heavy import that poe.ts pulls in at module load time so we can
// import just the cache helpers without spinning up a real server.
// ---------------------------------------------------------------------------

vi.mock("@workspace/poe", () => ({
  getPoeClient: vi.fn(),
  withRetry: vi.fn(),
  PoeCreditsError: class PoeCreditsError extends Error {},
  PoeRateLimitError: class PoeRateLimitError extends Error {},
  PoeAuthError: class PoeAuthError extends Error {},
  ZoneParseError: class ZoneParseError extends Error {},
  hashCacheKey: vi.fn(),
  globalPoeCache: new Map(),
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
  requireAuth: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../middlewares/rateLimit.js", () => ({
  createRateLimit: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  stampBaselineRateLimitHeaders: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../lib/logger.js", () => loggerMockFactory());

vi.mock("../lib/substrateGrid.js", () => ({
  sampleSubstrateGrid: vi.fn(),
  substrateToZone: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Now it is safe to import the cache helpers.
// ---------------------------------------------------------------------------

import {
  zoneCacheKey,
  readZoneDiskByHash,
  datasetZonesCache,
} from "../routes/poe.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_A = "user_aaa111";
const USER_B = "user_bbb222";

// Identical inputs for both users — isolation must come from the userId only.
const GRID_HASH = "abc123def456";
const WATER_TYPE = "saltwater" as const;
const SUBSTRATE_FP = "fp_deadbeef";

const FAKE_ZONES_A = {
  zones: ["zone-A-1", "zone-A-2"],
  waterType: WATER_TYPE,
  classifiedAt: 1_700_000_000,
  source: "ai" as const,
};

const FAKE_ZONES_B = {
  zones: ["zone-B-1"],
  waterType: WATER_TYPE,
  classifiedAt: 1_700_000_001,
  source: "ai" as const,
};

// ---------------------------------------------------------------------------
// Disk-cache temp dir management
//
// Read the same env var that poe.ts reads for ZONE_CACHE_DIR.  setup.ts sets
// this to a pid-unique path before any test file loads, so this test file and
// poe.ts always agree on the directory even when the path changes between runs.
// ---------------------------------------------------------------------------

const TEST_ZONE_CACHE_DIR =
  process.env["POE_ZONE_CACHE_DIR"] ?? "/tmp/zone-cache";

async function writeDiskEntry(
  userId: string,
  gridHash: string,
  waterType: "saltwater" | "freshwater",
  substrateFp: string,
  data: object,
): Promise<void> {
  const key = zoneCacheKey(userId, gridHash, waterType, substrateFp);
  await fs.mkdir(TEST_ZONE_CACHE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(TEST_ZONE_CACHE_DIR, `${key}.json`),
    JSON.stringify(data),
    "utf8",
  );
}

async function cleanDiskEntry(
  userId: string,
  gridHash: string,
  waterType: "saltwater" | "freshwater",
  substrateFp: string,
): Promise<void> {
  const key = zoneCacheKey(userId, gridHash, waterType, substrateFp);
  try {
    await fs.unlink(path.join(TEST_ZONE_CACHE_DIR, `${key}.json`));
  } catch {
    // already gone — fine
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("zoneCacheKey — isolation by userId", () => {
  it("produces different keys for user A and user B given identical inputs", () => {
    const keyA = zoneCacheKey(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
    const keyB = zoneCacheKey(USER_B, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);

    expect(keyA).not.toBe(keyB);
  });

  it("returns a stable 64-char lowercase hex string", () => {
    const keyA = zoneCacheKey(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
    expect(keyA).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns the same key for the same user on repeated calls (deterministic)", () => {
    const key1 = zoneCacheKey(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
    const key2 = zoneCacheKey(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
    expect(key1).toBe(key2);
  });
});

describe("datasetZonesCache — in-memory isolation across users", () => {
  beforeEach(() => {
    datasetZonesCache.clear();
  });

  it("a cache write under user A is not visible when looking up under user B", () => {
    const keyA = zoneCacheKey(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
    const keyB = zoneCacheKey(USER_B, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);

    // Write user A's entry directly into the in-memory map.
    datasetZonesCache.set(keyA, FAKE_ZONES_A);

    // User B's key must not resolve to user A's entry.
    expect(datasetZonesCache.get(keyB)).toBeUndefined();
  });

  it("each user's entry is stored and retrieved independently", () => {
    const keyA = zoneCacheKey(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
    const keyB = zoneCacheKey(USER_B, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);

    datasetZonesCache.set(keyA, FAKE_ZONES_A);
    datasetZonesCache.set(keyB, FAKE_ZONES_B);

    expect(datasetZonesCache.get(keyA)?.zones).toEqual(FAKE_ZONES_A.zones);
    expect(datasetZonesCache.get(keyB)?.zones).toEqual(FAKE_ZONES_B.zones);
    // Confirm the two entries are distinct objects.
    expect(datasetZonesCache.get(keyA)?.zones).not.toEqual(
      datasetZonesCache.get(keyB)?.zones,
    );
  });

  it("clearing user A's key does not affect user B's entry", () => {
    const keyA = zoneCacheKey(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
    const keyB = zoneCacheKey(USER_B, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);

    datasetZonesCache.set(keyA, FAKE_ZONES_A);
    datasetZonesCache.set(keyB, FAKE_ZONES_B);

    datasetZonesCache.delete(keyA);

    expect(datasetZonesCache.get(keyA)).toBeUndefined();
    expect(datasetZonesCache.get(keyB)?.zones).toEqual(FAKE_ZONES_B.zones);
  });
});

describe("readZoneDiskByHash — disk-cache isolation across users", () => {
  afterEach(async () => {
    await cleanDiskEntry(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
    await cleanDiskEntry(USER_B, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
  });

  it("returns null for user B when only user A's disk entry exists", async () => {
    await writeDiskEntry(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP, FAKE_ZONES_A);

    const result = await readZoneDiskByHash(USER_B, GRID_HASH, WATER_TYPE, SUBSTRATE_FP);
    expect(result).toBeNull();
  });

  it("returns the correct entry for user A and null for user B simultaneously", async () => {
    await writeDiskEntry(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP, FAKE_ZONES_A);

    const [resultA, resultB] = await Promise.all([
      readZoneDiskByHash(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP),
      readZoneDiskByHash(USER_B, GRID_HASH, WATER_TYPE, SUBSTRATE_FP),
    ]);

    expect(resultA?.zones).toEqual(FAKE_ZONES_A.zones);
    expect(resultB).toBeNull();
  });

  it("each user's disk entry is returned only to the correct user", async () => {
    await writeDiskEntry(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP, FAKE_ZONES_A);
    await writeDiskEntry(USER_B, GRID_HASH, WATER_TYPE, SUBSTRATE_FP, FAKE_ZONES_B);

    const [resultA, resultB] = await Promise.all([
      readZoneDiskByHash(USER_A, GRID_HASH, WATER_TYPE, SUBSTRATE_FP),
      readZoneDiskByHash(USER_B, GRID_HASH, WATER_TYPE, SUBSTRATE_FP),
    ]);

    expect(resultA?.zones).toEqual(FAKE_ZONES_A.zones);
    expect(resultB?.zones).toEqual(FAKE_ZONES_B.zones);
    expect(resultA?.zones).not.toEqual(resultB?.zones);
  });
});
