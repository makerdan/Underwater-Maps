/**
 * zone-cache-read-validation.test.ts — readZoneDiskByKey schema validation.
 *
 * Disk-cache files under /tmp are outside the process trust boundary; every
 * read must be validated. Corrupt JSON, schema-violating payloads, and
 * non-object junk must all be treated as a cache miss (null) with a logged
 * warning — never returned to callers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import { loggerMockFactory } from "./helpers/mockLogger.js";

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

vi.mock("../lib/terrain.js", async () => {
  const { createTerrainMock } = await import("./helpers/terrainMock.js");
  return createTerrainMock();
});

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

import { readZoneDiskByKey } from "../routes/poe.js";

const VALID_KEY = createHash("sha256").update("read-validation-key").digest("hex");

const VALID_ENTRY = {
  zones: ["sandy_shelf"],
  waterType: "saltwater",
  classifiedAt: Date.now(),
  source: "ai",
};

beforeEach(() => {
  mockReadFile.mockReset();
});

describe("readZoneDiskByKey — disk payload validation", () => {
  it("returns a valid entry unchanged", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(VALID_ENTRY));
    const result = await readZoneDiskByKey(VALID_KEY);
    expect(result).toMatchObject({ waterType: "saltwater", zones: ["sandy_shelf"] });
  });

  it("returns null for corrupt (truncated) JSON", async () => {
    mockReadFile.mockResolvedValue('{"zones": ["sandy_shelf", "wat');
    expect(await readZoneDiskByKey(VALID_KEY)).toBeNull();
  });

  it("returns null for valid JSON that is not an object", async () => {
    mockReadFile.mockResolvedValue('"just a string"');
    expect(await readZoneDiskByKey(VALID_KEY)).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ zones: ["a"] }));
    expect(await readZoneDiskByKey(VALID_KEY)).toBeNull();
  });

  it("returns null for an invalid waterType enum value", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ ...VALID_ENTRY, waterType: "lava" }),
    );
    expect(await readZoneDiskByKey(VALID_KEY)).toBeNull();
  });

  it("returns null when zones contains non-string entries", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ ...VALID_ENTRY, zones: [1, 2, 3] }),
    );
    expect(await readZoneDiskByKey(VALID_KEY)).toBeNull();
  });

  it("returns null (miss) when the file cannot be read", async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect(await readZoneDiskByKey(VALID_KEY)).toBeNull();
  });

  it("rejects a path-traversal cache key without touching the filesystem", async () => {
    expect(await readZoneDiskByKey("../../etc/passwd")).toBeNull();
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
