/**
 * poe-parse-boundaries.test.ts
 *
 * Covers three JSON.parse boundary fixes in routes/poe.ts:
 *
 *  1. evictStaleCacheEntries (lines 679-682): a cache file whose content is a
 *     JSON primitive (not an object) is treated as evictable — absent from the
 *     survivor set, never iterated.
 *
 *  2. Classify route in-memory cache hit (line 1447): a globalPoeCache entry
 *     whose value parses to a mixed-type array is rejected and treated as a
 *     cache miss. The route falls through to the depth-based heuristic when
 *     both Poe and the OpenAI fallback are unavailable.
 *
 *  3. Query route tool-argument parse (line 2097): when a function_call item's
 *     `arguments` field parses to a non-object (e.g. an array), the route logs
 *     a structured warning and uses {} as the args — the invalid value is never
 *     forwarded to callers.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import request from "supertest";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Hoist mock fns so they are available before any import() call.
// ---------------------------------------------------------------------------
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockReaddir = vi.hoisted(() => vi.fn<() => Promise<string[]>>().mockResolvedValue([]));
const mockReadFile = vi.hoisted(() =>
  vi.fn<(p: string) => Promise<string>>().mockRejectedValue(new Error("ENOENT")),
);
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUnlink = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// globalPoeCache.get is the key fixture for tests 2 (classify cache miss).
const mockPoeCacheGet = vi.hoisted(() =>
  vi.fn<(key: string) => string | undefined>().mockReturnValue(undefined),
);
const mockPoeCacheSet = vi.hoisted(() => vi.fn());

// responses.create mock used for the query route test (test 3).
const mockResponsesCreate = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// fs mock — passthrough for readFileSync (shoreZoneData.ts needs it at load)
// ---------------------------------------------------------------------------
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
// @workspace/poe — includes a PoeCircuitBreaker that tracks open/closed state
// so __forceOpenPoeBreaker / __resetPoeBreaker work correctly.
// ---------------------------------------------------------------------------
vi.mock("@workspace/poe", () => ({
  getPoeClient: vi.fn(() => ({
    responses: { create: mockResponsesCreate },
  })),
  withRetry: vi.fn((fn: () => unknown) => fn()),
  PoeCreditsError: class PoeCreditsError extends Error {},
  PoeRateLimitError: class PoeRateLimitError extends Error {},
  PoeAuthError: class PoeAuthError extends Error {},
  ZoneParseError: class ZoneParseError extends Error {},
  hashCacheKey: vi.fn((...args: string[]) => args.join("|")),
  globalPoeCache: {
    get: mockPoeCacheGet,
    set: mockPoeCacheSet,
    has: vi.fn().mockReturnValue(false),
    delete: vi.fn(),
    clear: vi.fn(),
  },
  buildVisionInput: vi.fn(() => []),
  POE_MODELS: {
    CLASSIFY: "poe-classify-model",
    QUERY_TOOLS: "poe-query-model",
    UPSCALE: "poe-upscale-model",
  },
  PoeCircuitBreaker: class PoeCircuitBreaker {
    private _open = false;
    isOpen() { return this._open; }
    forceOpen() { this._open = true; }
    recordSuccess() { this._open = false; }
    recordFailure() {}
  },
}));

// ---------------------------------------------------------------------------
// @workspace/integrations-openai-ai-server — null client forces tryGetOpenAiClient
// to return null, so the classify route always falls through to the heuristic.
// ---------------------------------------------------------------------------
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: null,
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
  stampBaselineRateLimitHeaders: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  __resetRateLimitMemory: vi.fn(),
}));

vi.mock("../lib/bucketMonitor.js", async () => {
  const { createBucketMonitorMock } = await import("./helpers/bucketMonitorMock.js");
  return createBucketMonitorMock();
});

vi.mock("../lib/cacheRegistry.js", () => ({
  registerCache: vi.fn(),
}));

vi.mock("../lib/substrateGrid.js", () => ({
  sampleSubstrateGrid: vi.fn(() => ({
    fingerprint: "00000000",
    hasCoverage: false,
    labels: [],
  })),
  substrateToZone: vi.fn((label: string) => label),
  substrateFingerprintForDataset: vi.fn(() => "00000000"),
}));

vi.mock("../lib/terrain.js", async () => {
  const { createTerrainMock } = await import("./helpers/terrainMock.js");
  return createTerrainMock();
});

vi.mock("../lib/tileClassify.js", async () => {
  const { createTileClassifyMock } = await import("./helpers/tileClassifyMock.js");
  return createTileClassifyMock({ TILE_CONCURRENCY: 2 });
});

vi.mock("../lib/uploadParsers.js", () => ({
  parseUploadedFile: vi.fn(),
}));

vi.mock("../lib/gunzipBounded.js", () => ({
  gunzipBounded: vi.fn(),
}));

// Logger is NOT mocked — pino-http requires the real pino instance (it accesses
// logger.levels, logger.bindings, etc.). Instead we spy on logger.warn in each
// suite that needs to assert on it (see getMockWarn helper below).

// ---------------------------------------------------------------------------
// Import module under test AFTER all mocks are in place.
// ---------------------------------------------------------------------------
import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";
import {
  evictStaleCacheEntries,
  __forceOpenPoeBreaker,
  __resetPoeBreaker,
  __resetOpenAiClientCacheForTests,
} from "../routes/poe.js";
import { logger } from "../lib/logger.js";

/** Spy on logger.warn and return the spy for assertions. Restored automatically
 *  when vi.restoreAllMocks() / vi.clearAllMocks() runs in the suite beforeEach. */
function spyWarn(): MockInstance {
  return vi.spyOn(logger, "warn").mockImplementation(() => logger);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const ZONE_CACHE_DIR = process.env["POE_ZONE_CACHE_DIR"] ?? "/tmp/zone-cache";
const VALID_HEX_KEY = createHash("sha256").update("test-evict-key").digest("hex");

// ---------------------------------------------------------------------------
// 1. evictStaleCacheEntries — JSON primitive in cache file
// ---------------------------------------------------------------------------

describe("evictStaleCacheEntries — JSON primitive content is evictable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlink.mockResolvedValue(undefined);
  });

  it("a JSON number is not in the survivor set", async () => {
    mockReadFile.mockResolvedValueOnce("42");
    const survivors = await evictStaleCacheEntries([`${VALID_HEX_KEY}.json`]);
    expect(survivors.has(`${VALID_HEX_KEY}.json`)).toBe(false);
  });

  it("a JSON string is not in the survivor set", async () => {
    mockReadFile.mockResolvedValueOnce('"just a string"');
    const survivors = await evictStaleCacheEntries([`${VALID_HEX_KEY}.json`]);
    expect(survivors.has(`${VALID_HEX_KEY}.json`)).toBe(false);
  });

  it("a JSON array (even mixed-type) is not in the survivor set", async () => {
    mockReadFile.mockResolvedValueOnce('["sandy_shelf", 42, "silt"]');
    const survivors = await evictStaleCacheEntries([`${VALID_HEX_KEY}.json`]);
    expect(survivors.has(`${VALID_HEX_KEY}.json`)).toBe(false);
  });

  it("JSON null is not in the survivor set", async () => {
    mockReadFile.mockResolvedValueOnce("null");
    const survivors = await evictStaleCacheEntries([`${VALID_HEX_KEY}.json`]);
    expect(survivors.has(`${VALID_HEX_KEY}.json`)).toBe(false);
  });

  it("a recent valid-object entry IS in the survivor set", async () => {
    // Object with future classifiedAt — should survive age eviction.
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ classifiedAt: Date.now() + 60_000 }),
    );
    const survivors = await evictStaleCacheEntries([`${VALID_HEX_KEY}.json`]);
    expect(survivors.has(`${VALID_HEX_KEY}.json`)).toBe(true);
  });

  it("an unreadable file is not in the survivor set and is not unlinked by eviction", async () => {
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    const survivors = await evictStaleCacheEntries([`${VALID_HEX_KEY}.json`]);
    expect(survivors.has(`${VALID_HEX_KEY}.json`)).toBe(false);
    // The entry was absent from the list, so unlink must not have been called for it.
    const unlinked = mockUnlink.mock.calls.map((c) => c[0] as string);
    expect(unlinked).not.toContain(`${ZONE_CACHE_DIR}/${VALID_HEX_KEY}.json`);
  });
});

// ---------------------------------------------------------------------------
// 2. Classify route — mixed-type array in globalPoeCache treated as miss
// ---------------------------------------------------------------------------

describe("classify route — mixed-type array in globalPoeCache is a cache miss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoeCacheGet.mockReturnValue(undefined);
    mockPoeCacheSet.mockReset();
    __resetRateLimitMemory();
    // Force the circuit breaker open so the live classify path short-circuits
    // to the depth-based heuristic — no Poe network calls made.
    __forceOpenPoeBreaker();
    // Reset the OpenAI client cache so the dynamic import (mocked to throw)
    // is re-evaluated and correctly resolves to null.
    __resetOpenAiClientCacheForTests();
  });

  afterEach(() => {
    __resetPoeBreaker();
  });

  it("falls through to heuristic (fromCache: false) when the cache entry is a mixed-type array", async () => {
    const poisoned = JSON.stringify(["sandy_shelf", 42, "silt"]);
    mockPoeCacheGet.mockReturnValue(poisoned);

    const res = await request(app)
      .post("/api/poe/classify")
      .send({ gridBase64: "data:image/png;base64,iVBORw0KGgo=" });

    // The heuristic fallback always returns 200.
    expect(res.status).toBe(200);
    // The poisoned entry must NOT have triggered a fromCache: true response.
    expect(res.body.fromCache).toBe(false);
    expect(res.body.source).toBe("heuristic");
  });

  it("logs a warning when the cache entry is a mixed-type array", async () => {
    const warnSpy = spyWarn();
    const poisoned = JSON.stringify(["sandy_shelf", 42, "silt"]);
    mockPoeCacheGet.mockReturnValue(poisoned);

    await request(app)
      .post("/api/poe/classify")
      .send({ gridBase64: "data:image/png;base64,iVBORw0KGgo=" });

    const warnMessages: string[] = warnSpy.mock.calls.map((c) => c[1] as string);
    expect(warnMessages.some((m) => m.includes("non-string-array"))).toBe(true);
  });

  it("returns fromCache: true when the cache entry is a valid all-string array of the right length", async () => {
    const TILE_SIZE = 32;
    const validZones = new Array<string>(TILE_SIZE * TILE_SIZE).fill("sandy_shelf");
    mockPoeCacheGet.mockReturnValue(JSON.stringify(validZones));
    // Breaker must be closed so a cache hit is served — reset it first.
    __resetPoeBreaker();

    const res = await request(app)
      .post("/api/poe/classify")
      .send({ gridBase64: "data:image/png;base64,iVBORw0KGgo=" });

    expect(res.status).toBe(200);
    expect(res.body.fromCache).toBe(true);
    expect(res.body.source).toBe("ai");
  });
});

// ---------------------------------------------------------------------------
// 3. Query route — non-object tool-call arguments
// ---------------------------------------------------------------------------

describe("query route — non-object tool-call arguments replaced with {}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoeCacheGet.mockReturnValue(undefined);
    __resetRateLimitMemory();
    mockResponsesCreate.mockReset();
  });

  it("returns empty args when the tool-call arguments parse to an array", async () => {
    mockResponsesCreate.mockResolvedValue({
      id: "resp_1",
      output_text: "",
      output: [
        {
          type: "function_call",
          name: "navigateToLocation",
          // A JSON array is not a Record — must be rejected.
          arguments: JSON.stringify(["not", "an", "object"]),
          call_id: "call_1",
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const res = await request(app)
      .post("/api/poe/query")
      .send({ userMessage: "go to deep trench" });

    expect(res.status).toBe(200);
    expect(res.body.toolCalls).toHaveLength(1);
    expect(res.body.toolCalls[0].name).toBe("navigateToLocation");
    // Non-record args must be replaced with an empty object.
    expect(res.body.toolCalls[0].args).toEqual({});
  });

  it("returns empty args when the tool-call arguments parse to a JSON number", async () => {
    mockResponsesCreate.mockResolvedValue({
      id: "resp_2",
      output_text: "",
      output: [
        {
          type: "function_call",
          name: "highlightZone",
          arguments: "42",
          call_id: "call_2",
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const res = await request(app)
      .post("/api/poe/query")
      .send({ userMessage: "highlight zone" });

    expect(res.status).toBe(200);
    expect(res.body.toolCalls[0].args).toEqual({});
  });

  it("logs a structured warning when tool-call arguments have an unexpected shape", async () => {
    const warnSpy = spyWarn();
    mockResponsesCreate.mockResolvedValue({
      id: "resp_3",
      output_text: "",
      output: [
        {
          type: "function_call",
          name: "navigateToLocation",
          arguments: JSON.stringify(["not", "a", "record"]),
          call_id: "call_3",
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await request(app)
      .post("/api/poe/query")
      .send({ userMessage: "navigate" });

    const warnMessages: string[] = warnSpy.mock.calls.map((c) => c[1] as string);
    expect(warnMessages.some((m) => m.includes("unexpected shape"))).toBe(true);
  });

  it("passes valid record args unchanged to the caller", async () => {
    mockResponsesCreate.mockResolvedValue({
      id: "resp_4",
      output_text: "",
      output: [
        {
          type: "function_call",
          name: "navigateToLocation",
          arguments: JSON.stringify({ lon: -122.4, lat: 37.8, depth: 50 }),
          call_id: "call_4",
        },
      ],
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    const res = await request(app)
      .post("/api/poe/query")
      .send({ userMessage: "go to San Francisco Bay" });

    expect(res.status).toBe(200);
    expect(res.body.toolCalls[0].args).toEqual({ lon: -122.4, lat: 37.8, depth: 50 });
  });
});
