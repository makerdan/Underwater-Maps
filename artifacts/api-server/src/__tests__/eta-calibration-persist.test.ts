/**
 * eta-calibration-persist.test.ts
 *
 * Unit tests for the DB persistence layer around the per-extension ETA
 * calibration table (lib/etaCalibration.ts + routes/datasets.ts).
 *
 * Coverage:
 *   loadCalibrationFromDb:
 *     · happy path: DB rows are read into extensionDurationHistory on startup
 *     · skips rows with an empty durations array
 *     · skips rows where durations is not an array (corrupt data)
 *     · DB error is swallowed — function never throws
 *
 *   scheduleCalibrationPersistForTest / flushCalibrationPersistForTest:
 *     · after a duration is recorded and the debounce is flushed, the DB
 *       receives an upsert (insert + onConflictDoUpdate) with the correct
 *       extension and durations payload
 *     · a second flush with no pending work is a no-op (zero DB calls)
 *     · DB error during persist is swallowed — function never throws
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted control handles for the DB mock — shared between the mock factory
// and individual tests so we can override resolved values per-test.
// ---------------------------------------------------------------------------

const { dbControl } = vi.hoisted(() => {
  const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const where = vi.fn().mockResolvedValue([]);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  return {
    dbControl: { select, from, where, insert, values, onConflictDoUpdate },
  };
});

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import of the modules they replace.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: dbControl.select,
      insert: dbControl.insert,
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => `eq:${val}`),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  lt: vi.fn((_col: unknown, val: unknown) => ({ __lt: val })),
  inArray: vi.fn(() => "in-condition"),
  lte: vi.fn(() => "lte-condition"),
  gte: vi.fn(() => "gte-condition"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  isNull: vi.fn(() => "isNull-condition"),
  isNotNull: vi.fn(() => "isNotNull-condition"),
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("worker_threads")>();
  return { ...actual };
});

vi.mock("../lib/bucketMonitor.js", () => ({
  signDatasetUploadUrl: vi.fn(),
  getJobByObjectKey: vi.fn(),
  recoverGcsJobStatus: vi.fn(),
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

vi.mock("../lib/uploadParsers.js", () => ({ parseUploadedFile: vi.fn() }));

vi.mock("../lib/cacheRegistry.js", () => ({ registerCache: vi.fn() }));

vi.mock("../lib/logger.js", async () => {
  const { loggerMockFactory } = await import("./helpers/mockLogger.js");
  return loggerMockFactory();
});

// ---------------------------------------------------------------------------
// Import functions under test after all mocks.
// ---------------------------------------------------------------------------

import {
  loadCalibrationFromDb,
  flushCalibrationPersistForTest,
  scheduleCalibrationPersistForTest,
} from "../routes/datasets.js";

import {
  extensionDurationHistory,
  clearCalibrationHistoryForTest,
  recordExtensionDuration,
} from "../lib/etaCalibration.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetDbMocks(): void {
  dbControl.onConflictDoUpdate.mockReset().mockResolvedValue([]);
  dbControl.values.mockReset().mockReturnValue({ onConflictDoUpdate: dbControl.onConflictDoUpdate });
  dbControl.insert.mockReset().mockReturnValue({ values: dbControl.values });

  dbControl.where.mockReset().mockResolvedValue([]);
  dbControl.from.mockReset().mockReturnValue({ where: dbControl.where });
  dbControl.select.mockReset().mockReturnValue({ from: dbControl.from });
}

// ═══════════════════════════════════════════════════════════════════════════════
// loadCalibrationFromDb
// ═══════════════════════════════════════════════════════════════════════════════

describe("loadCalibrationFromDb", () => {
  beforeEach(() => {
    clearCalibrationHistoryForTest();
    resetDbMocks();
  });

  it("populates extensionDurationHistory from DB rows on startup", async () => {
    dbControl.from.mockReturnValue({
      where: dbControl.where,
    });
    dbControl.select.mockReturnValue({ from: dbControl.from });
    dbControl.from.mockResolvedValue([
      { extension: ".laz", durations: [5000, 7000, 6000] },
      { extension: ".nc", durations: [12000] },
    ]);

    await loadCalibrationFromDb();

    expect(extensionDurationHistory.get(".laz")).toEqual([5000, 7000, 6000]);
    expect(extensionDurationHistory.get(".nc")).toEqual([12000]);
  });

  it("skips rows where durations is an empty array", async () => {
    dbControl.from.mockResolvedValue([
      { extension: ".gz", durations: [] },
      { extension: ".csv", durations: [3000] },
    ]);

    await loadCalibrationFromDb();

    expect(extensionDurationHistory.has(".gz")).toBe(false);
    expect(extensionDurationHistory.get(".csv")).toEqual([3000]);
  });

  it("skips rows where durations is not an array (corrupt data)", async () => {
    dbControl.from.mockResolvedValue([
      { extension: ".bag", durations: null },
      { extension: ".laz", durations: [9000] },
    ]);

    await loadCalibrationFromDb();

    expect(extensionDurationHistory.has(".bag")).toBe(false);
    expect(extensionDurationHistory.get(".laz")).toEqual([9000]);
  });

  it("does not throw when the DB call rejects", async () => {
    dbControl.select.mockReturnValue({
      from: vi.fn().mockRejectedValue(new Error("DB connection refused")),
    });

    await expect(loadCalibrationFromDb()).resolves.toBeUndefined();
    expect(extensionDurationHistory.size).toBe(0);
  });

  it("does not throw when select itself throws synchronously", async () => {
    dbControl.select.mockImplementation(() => {
      throw new Error("pool not initialised");
    });

    await expect(loadCalibrationFromDb()).resolves.toBeUndefined();
  });

  it("handles multiple extensions and preserves all their histories", async () => {
    const rows = [
      { extension: ".laz", durations: [1000, 2000] },
      { extension: ".bag", durations: [8000, 9000, 10000] },
      { extension: ".nc", durations: [500] },
    ];
    dbControl.from.mockResolvedValue(rows);

    await loadCalibrationFromDb();

    expect(extensionDurationHistory.size).toBe(3);
    expect(extensionDurationHistory.get(".bag")).toEqual([8000, 9000, 10000]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Debounced persist path (scheduleCalibrationPersistForTest + flushCalibrationPersistForTest)
// ═══════════════════════════════════════════════════════════════════════════════

describe("calibration persist (debounced upsert)", () => {
  beforeEach(() => {
    clearCalibrationHistoryForTest();
    resetDbMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("upserts the correct extension and durations to the DB when flushed", async () => {
    recordExtensionDuration(".laz", 5000);
    scheduleCalibrationPersistForTest(".laz");

    await flushCalibrationPersistForTest();

    expect(dbControl.insert).toHaveBeenCalledOnce();
    expect(dbControl.values).toHaveBeenCalledOnce();

    const valuesArg = dbControl.values.mock.calls[0]?.[0] as { extension: string; durations: number[] };
    expect(valuesArg.extension).toBe(".laz");
    expect(valuesArg.durations).toEqual([5000]);
    expect(dbControl.onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  it("collapses multiple schedule calls for the same extension into one DB write", async () => {
    recordExtensionDuration(".nc", 3000);
    scheduleCalibrationPersistForTest(".nc");
    recordExtensionDuration(".nc", 4000);
    scheduleCalibrationPersistForTest(".nc");

    await flushCalibrationPersistForTest();

    expect(dbControl.insert).toHaveBeenCalledOnce();
    const valuesArg = dbControl.values.mock.calls[0]?.[0] as { extension: string; durations: number[] };
    expect(valuesArg.durations).toEqual([3000, 4000]);
  });

  it("flushes multiple different extensions in one call", async () => {
    recordExtensionDuration(".laz", 5000);
    recordExtensionDuration(".bag", 8000);
    scheduleCalibrationPersistForTest(".laz");
    scheduleCalibrationPersistForTest(".bag");

    await flushCalibrationPersistForTest();

    expect(dbControl.insert).toHaveBeenCalledTimes(2);
    const extensions = dbControl.values.mock.calls.map(
      (call) => (call[0] as { extension: string }).extension,
    );
    expect(extensions).toContain(".laz");
    expect(extensions).toContain(".bag");
  });

  it("second flush with no pending work makes zero DB calls", async () => {
    recordExtensionDuration(".gz", 2000);
    scheduleCalibrationPersistForTest(".gz");
    await flushCalibrationPersistForTest();

    dbControl.insert.mockClear();

    await flushCalibrationPersistForTest();

    expect(dbControl.insert).not.toHaveBeenCalled();
  });

  it("does not throw when the DB upsert rejects", async () => {
    recordExtensionDuration(".csv", 1000);
    scheduleCalibrationPersistForTest(".csv");
    dbControl.onConflictDoUpdate.mockRejectedValueOnce(new Error("constraint violation"));

    await expect(flushCalibrationPersistForTest()).resolves.toBeUndefined();
  });

  it("skips the DB call when the extension has no durations in the map", async () => {
    scheduleCalibrationPersistForTest(".unknown");

    await flushCalibrationPersistForTest();

    expect(dbControl.insert).not.toHaveBeenCalled();
  });
});
