/**
 * bucketMonitorMock.ts — shared vi.mock factory for `lib/bucketMonitor.js`.
 *
 * Same pattern as terrainMock.ts: stubs EVERY runtime export of the real
 * module. Mocking bucketMonitor wholesale also prevents the real GCS
 * Storage client from being constructed in tests. The guard test in
 * `mock-factory-guards.test.ts` diffs the real module's exports against
 * this factory's keys, so a new module-init-consumed export fails there
 * first with a clear message instead of crashing every mocking suite.
 *
 * Usage:
 *
 *   vi.mock("../lib/bucketMonitor.js", async () => {
 *     const { createBucketMonitorMock } = await import(
 *       "./helpers/bucketMonitorMock.js"
 *     );
 *     return createBucketMonitorMock({
 *       getBucketStatus: vi.fn().mockResolvedValue(myStatus),
 *     });
 *   });
 */
import { vi } from "vitest";

/**
 * Build a full stub of lib/bucketMonitor.js's runtime exports. Constants
 * default to the real module's values; functions default to bare vi.fn().
 * Overrides are merged with property descriptors so getters survive.
 */
export function createBucketMonitorMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    // ── Constants / objects ──
    gcsClient: {},
    PROCESS_CONCURRENCY_CAP: 3,
    LIFECYCLE_TTLS: { processedDays: 30, failedDays: 14 },
    // ── Functions ──
    signDatasetUploadUrl: vi.fn(),
    getJobByObjectKey: vi.fn(),
    __resetProcessConcurrencyForTests: vi.fn(),
    processObject: vi.fn(),
    recoverGcsJobStatus: vi.fn(),
    getBucketStatus: vi.fn(),
    getLargeDatasetsDiff: vi.fn(),
    getLifecycleApplyStatus: vi.fn().mockReturnValue({ appliedAt: null, error: null }),
    applyBucketLifecycleRules: vi.fn(),
    startBucketMonitor: vi.fn(),
  };
  Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides));
  return base;
}
