/**
 * parse-worker-terminate.test.ts
 *
 * Confirms that runParseWorker() calls worker.terminate() on every error path:
 *   1. Worker posts { type: "error", message } via parentPort.
 *   2. Worker emits an unhandled "error" event (runtime crash in the thread).
 *
 * In both cases the Promise must reject AND terminate() must be called to
 * prevent the OS thread from lingering after the caller receives the error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import EventEmitter from "events";

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock();
});

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

vi.mock("../lib/bucketMonitor.js", async () => {
  const { createBucketMonitorMock } = await import("./helpers/bucketMonitorMock.js");
  return createBucketMonitorMock();
});

vi.mock("../lib/cacheRegistry.js", () => ({
  registerCache: vi.fn(),
}));

vi.mock("./poe.js", () => ({
  datasetZonesCache: new Map(),
  readZoneDiskByHash: vi.fn(),
  zoneCacheKey: vi.fn(),
}));

vi.mock("../lib/substrateGrid.js", () => ({
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

vi.mock("../lib/copernicusDem.js", () => ({
  fetchCopernicusDem: vi.fn(),
}));

vi.mock("../lib/satelliteTile.js", () => ({
  fetchSatelliteTile: vi.fn(),
}));

vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../middlewares/rateLimit.js", () => ({
  createRateLimit: vi.fn(() => () => (_req: unknown, _res: unknown, next: () => void) => next()),
  stampBaselineRateLimitHeaders: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  __resetRateLimitMemory: vi.fn(),
}));

vi.mock("../middlewares/asyncHandler.js", () => ({
  asyncHandler: (fn: unknown) => fn,
}));

class MockWorker extends EventEmitter {
  terminate = vi.fn().mockResolvedValue(0);
}

let mockWorkerInstance: MockWorker;

vi.mock("worker_threads", () => {
  return {
    Worker: vi.fn().mockImplementation(() => {
      mockWorkerInstance = new MockWorker();
      return mockWorkerInstance;
    }),
    workerData: {},
    parentPort: null,
  };
});

import { runParseWorker } from "../routes/datasets.js";

const BASE_PARAMS = {
  filePath: "/tmp/test.csv",
  fileName: "test.csv",
  resolution: 64,
  gridId: "test-grid-id",
  datasetName: "Test Dataset",
  smoothing: false,
  onProgress: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runParseWorker — terminate() on error paths", () => {
  it("calls terminate() and rejects when worker posts { type: 'error' }", async () => {
    const promise = runParseWorker(BASE_PARAMS);

    await Promise.resolve();

    mockWorkerInstance.emit("message", {
      type: "error",
      message: "File must contain at least 10 valid rows",
    });

    await expect(promise).rejects.toThrow("File must contain at least 10 valid rows");
    expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
  });

  it("calls terminate() and rejects when worker emits an error event", async () => {
    const promise = runParseWorker(BASE_PARAMS);

    await Promise.resolve();

    const workerErr = new Error("Worker thread crashed");
    mockWorkerInstance.emit("error", workerErr);

    await expect(promise).rejects.toThrow("Worker thread crashed");
    expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
  });

  it("calls terminate() and resolves when worker posts { type: 'result' }", async () => {
    const fakeResult = {
      terrain: { resolution: 64, depths: [], minDepth: 0, maxDepth: 100 },
      overview: { resolution: 64, depths: [], minDepth: 0, maxDepth: 100 },
    };

    const promise = runParseWorker(BASE_PARAMS);

    await Promise.resolve();

    mockWorkerInstance.emit("message", { type: "result", ...fakeResult });

    await expect(promise).resolves.toMatchObject({ terrain: fakeResult.terrain });
    expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not call terminate() a second time when exit fires after error", async () => {
    const promise = runParseWorker(BASE_PARAMS);

    await Promise.resolve();

    mockWorkerInstance.emit("message", {
      type: "error",
      message: "Parse failed",
    });

    await expect(promise).rejects.toThrow("Parse failed");

    mockWorkerInstance.emit("exit", 1);

    expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects with exit-code error when worker exits without settling", async () => {
    const promise = runParseWorker(BASE_PARAMS);

    await Promise.resolve();

    mockWorkerInstance.emit("exit", 2);

    await expect(promise).rejects.toThrow("Parse worker exited unexpectedly with code 2");
    expect(mockWorkerInstance.terminate).not.toHaveBeenCalled();
  });
});
