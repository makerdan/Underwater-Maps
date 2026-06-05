/**
 * etaCalibration.test.ts
 *
 * Unit tests for the per-file-type throughput calibration table and
 * ETA estimation logic in lib/etaCalibration.ts.
 *
 * Coverage:
 *  - recordExtensionDuration: bounded ring (CALIBRATION_MAX_SAMPLES = 10),
 *    insertion order, empty-extension no-op.
 *  - historicalMedianMs: null when empty, single sample, odd-count median,
 *    even-count median (average of two middle values).
 *  - updateProgressWithEta:
 *      · progress = 100 → eta = 0
 *      · progress = 88 + soundingCount → eta = 1 (overview-done shortcut)
 *      · progress = 80 + soundingCount + prior t60 → terrain-rate estimate
 *      · < 2 milestones, no history → eta = null
 *      · < 2 milestones, history present → eta seeded from median fraction
 *      · < 2 milestones, history + elapsed → elapsed anchors the estimate
 *      · 2nd milestone (historicalWeight = 1) → eta driven purely by historical
 *      · 5th milestone (historicalWeight = 0) → eta driven purely by live rate
 *      · milestone ring capped at 5: 6th call evicts oldest
 *      · gzip extension key (.gz) is stored and retrieved correctly
 *
 * Each test runs with fake timers for deterministic Date.now() control.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordExtensionDuration,
  historicalMedianMs,
  updateProgressWithEta,
  clearCalibrationHistoryForTest,
  CALIBRATION_MAX_SAMPLES,
  MIN_MILESTONE_DELTA_MS,
  MIN_MILESTONE_DELTA_PROGRESS,
  type EtaJobState,
} from "../lib/etaCalibration.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<EtaJobState> = {}): EtaJobState {
  return {
    progress: 0,
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  clearCalibrationHistoryForTest();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// recordExtensionDuration
// ─────────────────────────────────────────────────────────────────────────────

describe("recordExtensionDuration", () => {
  it("records the first entry for a new extension", () => {
    recordExtensionDuration(".laz", 5000);
    expect(historicalMedianMs(".laz")).toBe(5000);
  });

  it("appends multiple entries and they all contribute to the median", () => {
    recordExtensionDuration(".laz", 2000);
    recordExtensionDuration(".laz", 6000);
    recordExtensionDuration(".laz", 4000);
    expect(historicalMedianMs(".laz")).toBe(4000);
  });

  it(`caps the ring at CALIBRATION_MAX_SAMPLES (${CALIBRATION_MAX_SAMPLES}), dropping the oldest`, () => {
    for (let i = 1; i <= CALIBRATION_MAX_SAMPLES; i++) {
      recordExtensionDuration(".nc", i * 1000);
    }
    expect(historicalMedianMs(".nc")).not.toBeNull();

    recordExtensionDuration(".nc", (CALIBRATION_MAX_SAMPLES + 1) * 1000);

    const median = historicalMedianMs(".nc");
    expect(median).not.toBeNull();

    const allIncludingFirst = Array.from(
      { length: CALIBRATION_MAX_SAMPLES + 1 },
      (_, i) => (i + 1) * 1000,
    );
    const withoutFirst = allIncludingFirst.slice(1);
    const sorted = [...withoutFirst].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const expectedMedian =
      sorted.length % 2 === 0
        ? (sorted[mid - 1]! + sorted[mid]!) / 2
        : sorted[mid]!;

    expect(median).toBe(expectedMedian);
  });

  it("is a no-op for an empty string extension", () => {
    recordExtensionDuration("", 9999);
    expect(historicalMedianMs("")).toBeNull();
  });

  it("keeps histories for different extensions independent", () => {
    recordExtensionDuration(".laz", 1000);
    recordExtensionDuration(".csv", 8000);
    expect(historicalMedianMs(".laz")).toBe(1000);
    expect(historicalMedianMs(".csv")).toBe(8000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// historicalMedianMs
// ─────────────────────────────────────────────────────────────────────────────

describe("historicalMedianMs", () => {
  it("returns null for an unknown extension", () => {
    expect(historicalMedianMs(".xyz")).toBeNull();
  });

  it("returns the single value when there is only one sample", () => {
    recordExtensionDuration(".tif", 12345);
    expect(historicalMedianMs(".tif")).toBe(12345);
  });

  it("returns the middle element for an odd number of samples", () => {
    recordExtensionDuration(".las", 10000);
    recordExtensionDuration(".las", 30000);
    recordExtensionDuration(".las", 20000);
    expect(historicalMedianMs(".las")).toBe(20000);
  });

  it("returns the average of the two middle values for an even number of samples", () => {
    recordExtensionDuration(".bag", 10000);
    recordExtensionDuration(".bag", 40000);
    recordExtensionDuration(".bag", 30000);
    recordExtensionDuration(".bag", 20000);
    expect(historicalMedianMs(".bag")).toBe(25000);
  });

  it("sorts numerically (not lexicographically) before computing median", () => {
    recordExtensionDuration(".gpx", 9000);
    recordExtensionDuration(".gpx", 100000);
    recordExtensionDuration(".gpx", 1000);
    const median = historicalMedianMs(".gpx");
    expect(median).toBe(9000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProgressWithEta — terminal / shortcut paths
// ─────────────────────────────────────────────────────────────────────────────

describe("updateProgressWithEta — terminal and shortcut paths", () => {
  it("sets eta = 0 when progress reaches 100", () => {
    const job = makeJob();
    vi.setSystemTime(0);
    updateProgressWithEta(job, 100);
    expect(job.eta).toBe(0);
    expect(job.progress).toBe(100);
  });

  it("sets eta = 1 at progress 88 when soundingCount is set (overview-done shortcut)", () => {
    const job = makeJob({ soundingCount: 1000 });
    vi.setSystemTime(0);
    updateProgressWithEta(job, 88);
    expect(job.eta).toBe(1);
  });

  it("uses terrain-rate estimate at progress 80 with soundingCount and prior t60 milestone", () => {
    const job = makeJob({ soundingCount: 5000 });

    vi.setSystemTime(1000);
    updateProgressWithEta(job, 60);

    vi.setSystemTime(11000);
    updateProgressWithEta(job, 80);

    const terrainMs = 11000 - 1000;
    const overviewEstimateMs = terrainMs * 0.3;
    const dbEstimateMs = 500;
    const expectedEta = Math.max(
      1,
      Math.round((overviewEstimateMs + dbEstimateMs) / 1000),
    );

    expect(job.eta).toBe(expectedEta);
    expect(job.eta).toBeGreaterThanOrEqual(1);
  });

  it("updates stageStartedAt to current time on each call", () => {
    const job = makeJob();
    vi.setSystemTime(42000);
    updateProgressWithEta(job, 50);
    expect(job.stageStartedAt).toEqual(new Date(42000));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProgressWithEta — historical seed (< 2 milestones)
// ─────────────────────────────────────────────────────────────────────────────

describe("updateProgressWithEta — historical seed (< 2 milestones)", () => {
  it("eta is null when there is no history and only 1 milestone", () => {
    const job = makeJob({ fileExt: ".laz" });
    vi.setSystemTime(0);
    updateProgressWithEta(job, 20);
    expect(job.eta).toBeNull();
  });

  it("eta is null when fileExt is undefined and there is only 1 milestone", () => {
    const job = makeJob();
    vi.setSystemTime(0);
    updateProgressWithEta(job, 20);
    expect(job.eta).toBeNull();
  });

  it("seeds eta from historical median at the first milestone when history exists", () => {
    const medianMs = 60_000;
    recordExtensionDuration(".laz", medianMs);

    const job = makeJob({ fileExt: ".laz" });
    vi.setSystemTime(0);
    updateProgressWithEta(job, 20);

    const remaining = 100 - 20;
    const elapsed = 0;
    const estimatedRemaining = Math.max(medianMs - elapsed, medianMs * (remaining / 100));
    const expectedEta = Math.max(1, Math.round(estimatedRemaining / 1000));

    expect(job.eta).toBe(expectedEta);
    expect(job.eta).toBeGreaterThanOrEqual(1);
  });

  it("anchors estimate to elapsed time when jobStartedAt is set", () => {
    const medianMs = 30_000;
    recordExtensionDuration(".nc", medianMs);

    const job = makeJob({ fileExt: ".nc", jobStartedAt: 0 });

    vi.setSystemTime(20_000);
    updateProgressWithEta(job, 20);

    const remaining = 80;
    const elapsed = 20_000;
    const estimatedRemaining = Math.max(
      medianMs - elapsed,
      medianMs * (remaining / 100),
    );
    const expectedEta = Math.max(1, Math.round(estimatedRemaining / 1000));

    expect(job.eta).toBe(expectedEta);
  });

  it("eta is at least 1 second even when median - elapsed < 1000", () => {
    const medianMs = 1000;
    recordExtensionDuration(".csv", medianMs);

    const job = makeJob({ fileExt: ".csv", jobStartedAt: 0 });
    vi.setSystemTime(999);
    updateProgressWithEta(job, 5);

    expect(job.eta).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProgressWithEta — blended estimate (2–4 milestones)
// ─────────────────────────────────────────────────────────────────────────────

describe("updateProgressWithEta — blended estimate at 2nd milestone (historicalWeight = 1)", () => {
  it("eta equals the historical estimate when weight is 1.0 at the 2nd milestone", () => {
    const medianMs = 60_000;
    recordExtensionDuration(".laz", medianMs);

    const job = makeJob({ fileExt: ".laz", jobStartedAt: 0 });

    vi.setSystemTime(5_000);
    updateProgressWithEta(job, 20);

    vi.setSystemTime(10_000);
    updateProgressWithEta(job, 35);

    expect(job.stageTimestamps).toHaveLength(2);

    const milestoneCount = 2;
    const remaining = 100 - 35;
    const elapsed = 10_000;
    const historicalRemaining = Math.max(medianMs - elapsed, medianMs * (remaining / 100));
    const historicalEtaSec = Math.max(1, Math.round(historicalRemaining / 1000));
    const historicalWeight = Math.max(0, 1 - (milestoneCount - 2) / 3);
    expect(historicalWeight).toBe(1);

    expect(job.eta).toBe(historicalEtaSec);
  });

  it("eta blends towards live rate at the 3rd milestone (historicalWeight = 2/3)", () => {
    const medianMs = 30_000;
    recordExtensionDuration(".nc", medianMs);

    const job = makeJob({ fileExt: ".nc", jobStartedAt: 0 });

    vi.setSystemTime(1_000);
    updateProgressWithEta(job, 20);

    vi.setSystemTime(2_000);
    updateProgressWithEta(job, 40);

    vi.setSystemTime(3_000);
    updateProgressWithEta(job, 50);

    const milestoneCount = 3;
    const progress = 50;
    const remaining = 100 - progress;
    const elapsed = 3_000;
    const now = 3_000;

    const deltaProgress = 50 - 40;
    const deltaMs = 3_000 - 2_000;
    const ratePerMs = deltaProgress / deltaMs;
    const penalty = 1.0;
    const liveEtaSec = Math.max(1, Math.round(((remaining / ratePerMs) * penalty) / 1000));

    const historicalWeight = Math.max(0, 1 - (milestoneCount - 2) / 3);
    expect(historicalWeight).toBeCloseTo(2 / 3);

    const historicalRemaining = Math.max(medianMs - elapsed, medianMs * (remaining / 100));
    const historicalEtaSec = Math.max(1, Math.round(historicalRemaining / 1000));
    const expectedEta = Math.round(historicalWeight * historicalEtaSec + (1 - historicalWeight) * liveEtaSec);

    expect(job.eta).toBe(expectedEta);
    void now;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProgressWithEta — pure live rate (≥ 5 milestones)
// ─────────────────────────────────────────────────────────────────────────────

describe("updateProgressWithEta — pure live rate at 5th milestone (historicalWeight = 0)", () => {
  it("eta equals live-rate estimate with no historical blending at the 5th milestone", () => {
    const job = makeJob();

    const timestamps = [0, 1_000, 2_000, 3_000, 4_000];
    const progresses = [5, 10, 20, 30, 40];

    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(timestamps[i]!);
      updateProgressWithEta(job, progresses[i]!);
    }

    expect(job.stageTimestamps).toHaveLength(5);

    const milestoneCount = 5;
    const historicalWeight = Math.max(0, 1 - (milestoneCount - 2) / 3);
    expect(historicalWeight).toBe(0);

    const progress = 40;
    const remaining = 100 - progress;
    const deltaProgress = 40 - 30;
    const deltaMs = 4_000 - 3_000;
    const ratePerMs = deltaProgress / deltaMs;
    const penalty = 1.0;
    const expectedEta = Math.max(1, Math.round(((remaining / ratePerMs) * penalty) / 1000));

    expect(job.eta).toBe(expectedEta);
    expect(job.eta).toBeGreaterThanOrEqual(1);
  });

  it("eta matches live-rate even when history is seeded (weight is 0 at 5th milestone)", () => {
    recordExtensionDuration(".laz", 999_000);

    const job = makeJob({ fileExt: ".laz", jobStartedAt: 0 });

    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(i * 1_000);
      updateProgressWithEta(job, (i + 1) * 10);
    }

    const progress = 50;
    const remaining = 100 - progress;
    const deltaProgress = 50 - 40;
    const deltaMs = 4_000 - 3_000;
    const ratePerMs = deltaProgress / deltaMs;
    const penalty = 1.0;
    const expectedEta = Math.max(1, Math.round(((remaining / ratePerMs) * penalty) / 1000));

    expect(job.eta).toBe(expectedEta);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProgressWithEta — milestone ring bounded at 5
// ─────────────────────────────────────────────────────────────────────────────

describe("updateProgressWithEta — milestone ring bounded at 5 entries", () => {
  it("keeps only the last 5 milestones after the 6th call", () => {
    const job = makeJob();
    const progresses = [5, 10, 20, 30, 40, 50];

    for (let i = 0; i < progresses.length; i++) {
      vi.setSystemTime(i * 1_000);
      updateProgressWithEta(job, progresses[i]!);
    }

    expect(job.stageTimestamps).toHaveLength(5);
    const recordedProgresses = job.stageTimestamps!.map((m) => m.progress);
    expect(recordedProgresses).toEqual([10, 20, 30, 40, 50]);
    expect(recordedProgresses).not.toContain(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProgressWithEta — gzip extension key
// ─────────────────────────────────────────────────────────────────────────────

describe("updateProgressWithEta — gzip extension key (.gz)", () => {
  it("correctly seeds ETA from .gz history when fileExt is .gz", () => {
    const medianMs = 45_000;
    recordExtensionDuration(".gz", medianMs);

    const job = makeJob({ fileExt: ".gz" });
    vi.setSystemTime(0);
    updateProgressWithEta(job, 5);

    const remaining = 95;
    const estimatedRemaining = Math.max(medianMs, medianMs * (remaining / 100));
    const expectedEta = Math.max(1, Math.round(estimatedRemaining / 1000));

    expect(job.eta).toBe(expectedEta);
    expect(job.eta).toBeGreaterThanOrEqual(1);
  });

  it(".gz history does not contaminate other extension lookups", () => {
    recordExtensionDuration(".gz", 45_000);

    const job = makeJob({ fileExt: ".laz" });
    vi.setSystemTime(0);
    updateProgressWithEta(job, 5);

    expect(job.eta).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProgressWithEta — rapid-milestone coalescing (out-of-order / burst)
// ─────────────────────────────────────────────────────────────────────────────

describe("updateProgressWithEta — rapid small-delta milestones are coalesced", () => {
  it("skips a milestone that arrives within MIN_MILESTONE_DELTA_MS and MIN_MILESTONE_DELTA_PROGRESS of the previous one", () => {
    const job = makeJob();

    vi.setSystemTime(0);
    updateProgressWithEta(job, 35);

    vi.setSystemTime(MIN_MILESTONE_DELTA_MS - 1);
    updateProgressWithEta(job, 35 + MIN_MILESTONE_DELTA_PROGRESS - 1);

    expect(job.stageTimestamps).toHaveLength(1);
    expect(job.stageTimestamps![0]!.progress).toBe(35);
  });

  it("does NOT skip a milestone when deltaMs meets the threshold", () => {
    const job = makeJob();

    vi.setSystemTime(0);
    updateProgressWithEta(job, 35);

    vi.setSystemTime(MIN_MILESTONE_DELTA_MS);
    updateProgressWithEta(job, 36);

    expect(job.stageTimestamps).toHaveLength(2);
  });

  it("does NOT skip a milestone when deltaProgress meets the threshold", () => {
    const job = makeJob();

    vi.setSystemTime(0);
    updateProgressWithEta(job, 35);

    vi.setSystemTime(MIN_MILESTONE_DELTA_MS - 1);
    updateProgressWithEta(job, 35 + MIN_MILESTONE_DELTA_PROGRESS);

    expect(job.stageTimestamps).toHaveLength(2);
  });

  it("still updates job.progress and job.stageStartedAt even when the milestone is skipped", () => {
    const job = makeJob();

    vi.setSystemTime(0);
    updateProgressWithEta(job, 35);

    vi.setSystemTime(10);
    updateProgressWithEta(job, 36);

    expect(job.progress).toBe(36);
    expect(job.stageStartedAt).toEqual(new Date(10));
    expect(job.stageTimestamps).toHaveLength(1);
  });

  it("ETA does not jump unrealistically low after a burst of rapid small-step milestones", () => {
    const job = makeJob({ jobStartedAt: 0 });

    vi.setSystemTime(0);
    updateProgressWithEta(job, 20);

    vi.setSystemTime(10_000);
    updateProgressWithEta(job, 35);

    const etaAfterLegitimate = job.eta!;
    expect(etaAfterLegitimate).toBeGreaterThan(0);

    vi.setSystemTime(10_050);
    updateProgressWithEta(job, 36);

    vi.setSystemTime(10_100);
    updateProgressWithEta(job, 37);

    expect(job.stageTimestamps).toHaveLength(2);

    const etaAfterRapidBurst = job.eta!;

    const poisonedRatePerMs = 1 / 50;
    const remaining = 100 - 37;
    const poisonedEta = Math.round((remaining / poisonedRatePerMs) / 1000);
    expect(etaAfterRapidBurst).toBeGreaterThan(poisonedEta);

    expect(etaAfterRapidBurst).toBeGreaterThanOrEqual(etaAfterLegitimate - 3);
  });

  it("first milestone is always recorded (no previous entry to compare against)", () => {
    const job = makeJob();

    vi.setSystemTime(0);
    updateProgressWithEta(job, 10);

    expect(job.stageTimestamps).toHaveLength(1);
  });

  it("a legitimate milestone after a skipped burst uses the pre-burst entry as its baseline", () => {
    const job = makeJob({ jobStartedAt: 0 });

    vi.setSystemTime(0);
    updateProgressWithEta(job, 20);

    vi.setSystemTime(50);
    updateProgressWithEta(job, 21);

    vi.setSystemTime(100);
    updateProgressWithEta(job, 22);

    vi.setSystemTime(10_000);
    updateProgressWithEta(job, 40);

    expect(job.stageTimestamps).toHaveLength(2);

    const [first, second] = job.stageTimestamps!;
    expect(first!.progress).toBe(20);
    expect(second!.progress).toBe(40);

    const deltaProgress = 40 - 20;
    const deltaMs = 10_000 - 0;
    const ratePerMs = deltaProgress / deltaMs;
    const remaining = 100 - 40;
    const expectedEta = Math.max(1, Math.round((remaining / ratePerMs) / 1000));
    expect(job.eta).toBe(expectedEta);
  });
});
