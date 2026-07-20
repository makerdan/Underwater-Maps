/**
 * upload-response-validation.test.ts
 *
 * Confirms that response-schema validation (via validateResponse) on the
 * upload/job-status, Poe upscale, and surface-conditions routes returns a
 * structured 500 — not a crash or a silent mis-shape — when the handler
 * produces data that fails the schema.
 *
 * Routes covered:
 *   POST /api/datasets/upload/chunk                    — UploadDatasetChunkResponse
 *   GET  /api/datasets/upload/chunk/status/:uploadId   — GetChunkUploadStatusResponse
 *   POST /api/datasets/upload/chunk/finalize           — FinalizeChunkedUploadResponse
 *   POST /api/datasets/upload/request-gcs-url          — RequestGcsUploadUrlResponse
 *   GET  /api/datasets/upload/gcs-job-status           — GetGcsJobStatusResponse
 *   POST /api/poe/upscale                              — PoeUpscaleResponse
 *   GET  /api/surface-conditions                       — inline SurfaceConditionsResponseSchema
 *                                                        (validateResponse wiring tested via
 *                                                        the validateResponse module mock)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";

// ── Per-test schema-failure flags ────────────────────────────────────────────
const schemaState = vi.hoisted(() => ({
  throwUploadChunk: false,
  throwChunkStatus: false,
  throwFinalize: false,
  throwRequestGcsUrl: false,
  throwGcsJobStatus: false,
  throwPoeUpscale: false,
  throwSurfaceConditions: false,
}));

// ── Poe client stub (upscale route) ──────────────────────────────────────────
const { mockChatCreate, mockResponsesCreate } = vi.hoisted(() => ({
  mockChatCreate: vi.fn(),
  mockResponsesCreate: vi.fn().mockResolvedValue({
    id: "resp-mock-id",
    output_text: "",
    output: [],
    usage: { input_tokens: 1, output_tokens: 1 },
  }),
}));

// ── @workspace/api-zod mock ──────────────────────────────────────────────────
vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();

  const makeThrowable = (flag: keyof typeof schemaState, name: string) => ({
    parse: (x: unknown) => {
      if (schemaState[flag]) throw new Error(`bad shape: ${name}`);
      return x;
    },
    safeParse: (x: unknown) => {
      if (schemaState[flag]) return { success: false as const, error: { issues: [] } };
      return { success: true as const, data: x };
    },
  });

  return {
    ...actual,
    UploadDatasetChunkResponse: makeThrowable("throwUploadChunk", "UploadDatasetChunkResponse"),
    GetChunkUploadStatusResponse: makeThrowable("throwChunkStatus", "GetChunkUploadStatusResponse"),
    FinalizeChunkedUploadResponse: makeThrowable("throwFinalize", "FinalizeChunkedUploadResponse"),
    RequestGcsUploadUrlResponse: makeThrowable("throwRequestGcsUrl", "RequestGcsUploadUrlResponse"),
    GetGcsJobStatusResponse: makeThrowable("throwGcsJobStatus", "GetGcsJobStatusResponse"),
    PoeUpscaleResponse: makeThrowable("throwPoeUpscale", "PoeUpscaleResponse"),
  };
});

// ── validateResponse mock — surface-conditions uses an inline (non-api-zod)
//    schema, so schema-level flag injection is impossible there. Instead the
//    module is wrapped: when the surface-conditions flag is set and the route
//    label matches, throw the same shaped error the real helper would. All
//    other routes pass through to the real implementation (which picks up the
//    throwable api-zod schema mocks above). ─────────────────────────────────
vi.mock("../../middlewares/validateResponse.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/validateResponse.js")>();
  return {
    validateResponse: (schema: never, data: unknown, routeLabel: string) => {
      if (routeLabel === "GET /api/surface-conditions" && schemaState.throwSurfaceConditions) {
        throw Object.assign(new Error(`Response shape mismatch on ${routeLabel}`), { status: 500 });
      }
      return actual.validateResponse(schema, data, routeLabel);
    },
  };
});

// ── @workspace/db mock ───────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve([]),
        returning: () => Promise.resolve([]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  },
  pool: {},
  markersTable: {},
  catchEntriesTable: {},
  userSettingsTable: {},
  routesTable: {},
  gpsTrailsTable: {},
  customDatasetsTable: {},
  datasetFoldersTable: {},
  userCatalogSavesTable: {},
  trollingPresetsTable: {},
  trollingPresetFoldersTable: {},
  poeUsageLogTable: {},
  uploadJobsTable: {},
  schema: {},
}));

// ── @clerk/express mock ──────────────────────────────────────────────────────
vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: "test-user" })),
}));

// ── Misc infrastructure mocks ────────────────────────────────────────────────
vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("../../lib/logger.js");

// ── rateLimit mock ───────────────────────────────────────────────────────────
vi.mock("../../middlewares/rateLimit.js", () => ({
  createRateLimit: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  stampBaselineRateLimitHeaders: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  queryRateLimitUsage: vi.fn().mockResolvedValue([]),
  __resetRateLimitMemory: vi.fn(),
  __prefillRateLimitMemory: vi.fn(),
  __pruneMemoryBackend: vi.fn(),
}));

// ── @workspace/poe mock ──────────────────────────────────────────────────────
vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return {
    ...actual,
    getPoeClient: vi.fn(() => ({
      responses: { create: mockResponsesCreate },
      chat: { completions: { create: mockChatCreate } },
    })),
  };
});

// ── bucketMonitor mock (gcs-url / gcs-job-status routes) ─────────────────────
vi.mock("../../lib/bucketMonitor.js", () => ({
  getBucketStatus: vi.fn().mockResolvedValue({
    counts: { pending: 0, processing: 0, done: 0, failed: 0 },
    pending: [],
    processing: [],
    done: [],
    failed: [],
  }),
  getLifecycleApplyStatus: vi.fn().mockReturnValue({ appliedAt: null, error: null }),
  LIFECYCLE_TTLS: { processedDays: 30, failedDays: 14 },
  getLargeDatasetsDiff: vi.fn().mockResolvedValue({ changedCount: 0, unimportedCount: 0, entries: [] }),
  startBucketMonitor: vi.fn(),
  signDatasetUploadUrl: vi.fn().mockResolvedValue({
    uploadUrl: "https://storage.googleapis.com/bucket/pending-datasets/test-user/depths.csv?sig=x",
    objectKey: "pending-datasets/test-user/depths.csv",
  }),
  getJobByObjectKey: vi.fn().mockReturnValue({ status: "done", datasetId: "ds-1" }),
  recoverGcsJobStatus: vi.fn().mockResolvedValue({ status: "unknown" }),
  gcsClient: {},
}));

import app from "../../app.js";

const AUTH_HEADERS = {
  Authorization: "Bearer e2e-bypass",
  "x-e2e-user-id": "test-user",
} as const;

function authed(r: request.Test): request.Test {
  for (const [k, v] of Object.entries(AUTH_HEADERS)) r.set(k, v);
  return r;
}

/** Upload chunk 0 of a 1-chunk session; returns the uploadId. */
async function uploadChunkZero(): Promise<string> {
  const uploadId = randomUUID();
  const res = await authed(request(app).post("/api/datasets/upload/chunk"))
    .field("uploadId", uploadId)
    .field("chunkIndex", "0")
    .field("totalChunks", "1")
    .attach("file", Buffer.from("lat,lon,depth\n57.0,-135.0,10\n"), "slice.bin");
  expect(res.status).toBe(200);
  return uploadId;
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  for (const key of Object.keys(schemaState) as (keyof typeof schemaState)[]) {
    schemaState[key] = false;
  }
  mockChatCreate.mockResolvedValue({
    choices: [
      {
        message: {
          content: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
});

// ── Chunked upload routes ────────────────────────────────────────────────────

describe("POST /api/datasets/upload/chunk — response schema failure → 500", () => {
  it("returns 200 on the happy path", async () => {
    const uploadId = await uploadChunkZero();
    expect(uploadId).toBeTruthy();
  });

  it("returns 500 when UploadDatasetChunkResponse.parse() throws", async () => {
    schemaState.throwUploadChunk = true;
    const res = await authed(request(app).post("/api/datasets/upload/chunk"))
      .field("uploadId", randomUUID())
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("file", Buffer.from("lat,lon,depth\n"), "slice.bin");
    expect(res.status).toBe(500);
  });
});

describe("GET /api/datasets/upload/chunk/status/:uploadId — response schema failure → 500", () => {
  it("returns 500 when GetChunkUploadStatusResponse.parse() throws", async () => {
    const uploadId = await uploadChunkZero();

    // Sanity: happy path first.
    const ok = await authed(request(app).get(`/api/datasets/upload/chunk/status/${uploadId}`));
    expect(ok.status).toBe(200);
    expect(ok.body.uploadId).toBe(uploadId);

    schemaState.throwChunkStatus = true;
    const res = await authed(request(app).get(`/api/datasets/upload/chunk/status/${uploadId}`));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/datasets/upload/chunk/finalize — response schema failure → 500", () => {
  it("returns 500 when FinalizeChunkedUploadResponse.parse() throws", async () => {
    const uploadId = await uploadChunkZero();
    schemaState.throwFinalize = true;
    const res = await authed(request(app).post("/api/datasets/upload/chunk/finalize"))
      .send({ uploadId, fileName: "depths.csv", totalChunks: 1 });
    expect(res.status).toBe(500);
  });
});

// ── GCS upload routes ────────────────────────────────────────────────────────

describe("POST /api/datasets/upload/request-gcs-url — response schema failure → 500", () => {
  it("returns 200 on the happy path", async () => {
    const res = await authed(request(app).post("/api/datasets/upload/request-gcs-url"))
      .send({ fileName: "depths.csv" });
    expect(res.status).toBe(200);
    expect(res.body.objectKey).toBe("pending-datasets/test-user/depths.csv");
  });

  it("returns 500 when RequestGcsUploadUrlResponse.parse() throws", async () => {
    schemaState.throwRequestGcsUrl = true;
    const res = await authed(request(app).post("/api/datasets/upload/request-gcs-url"))
      .send({ fileName: "depths.csv" });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/datasets/upload/gcs-job-status — response schema failure → 500", () => {
  it("returns 500 when GetGcsJobStatusResponse.parse() throws (in-memory job path)", async () => {
    schemaState.throwGcsJobStatus = true;
    const res = await authed(request(app).get("/api/datasets/upload/gcs-job-status"))
      .query({ objectKey: "pending-datasets/test-user/depths.csv" });
    expect(res.status).toBe(500);
  });
});

// ── Poe upscale ──────────────────────────────────────────────────────────────

describe("POST /api/poe/upscale — response schema failure → 500", () => {
  it("returns 500 when PoeUpscaleResponse.parse() throws (fresh Poe call path)", async () => {
    schemaState.throwPoeUpscale = true;
    const res = await authed(request(app).post("/api/poe/upscale"))
      // Unique payload per run so the shared upscale caches can never satisfy
      // the request before validateResponse is reached.
      .send({ imageBase64: `iVBORw0KGgo${randomUUID().replace(/-/g, "")}`, upscaleFactor: 2 });
    expect(res.status).toBe(500);
  });
});

// ── Surface conditions ───────────────────────────────────────────────────────

describe("GET /api/surface-conditions — response schema failure → 500", () => {
  it("returns 500 when validateResponse rejects the built response", async () => {
    schemaState.throwSurfaceConditions = true;
    // Fail all upstream fetches — the route degrades to estimated conditions,
    // which still flows through validateResponse before res.json.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network in test")));
    const res = await authed(request(app).get("/api/surface-conditions"))
      .query({ lat: 57.0, lon: -135.0 });
    vi.unstubAllGlobals();
    expect(res.status).toBe(500);
  });
});
