import { describe, it, expect, beforeEach } from "vitest";
import {
  useActiveLoadStore,
  computeProgress,
  median,
} from "@/lib/activeLoadStore";

beforeEach(() => {
  useActiveLoadStore.setState({ active: null, history: {} });
});

describe("median", () => {
  it("returns null for empty input", () => {
    expect(median([])).toBeNull();
  });
  it("returns the middle value for odd-length arrays", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the two middle values for even-length arrays", () => {
    expect(median([10, 30, 20, 40])).toBe(25);
  });
});

describe("activeLoadStore", () => {
  it("start / update / complete records the duration into the bucket", () => {
    const s = useActiveLoadStore.getState();
    s.start({ datasetId: "ds1", bucket: "ds1" });
    s.update("ds1", 100, 1000);
    expect(useActiveLoadStore.getState().active?.bytesLoaded).toBe(100);
    s.complete("ds1");
    const after = useActiveLoadStore.getState();
    expect(after.active).toBeNull();
    expect(after.history["ds1"]?.length).toBe(1);
  });

  it("update is monotonic — stale callbacks cannot rewind progress", () => {
    const s = useActiveLoadStore.getState();
    s.start({ datasetId: "ds1", bucket: "ds1" });
    s.update("ds1", 500, 1000);
    s.update("ds1", 100, 1000); // stale
    expect(useActiveLoadStore.getState().active?.bytesLoaded).toBe(500);
  });

  it("ignores updates for stale dataset ids", () => {
    const s = useActiveLoadStore.getState();
    s.start({ datasetId: "ds1", bucket: "ds1" });
    s.update("other", 999, 9999);
    expect(useActiveLoadStore.getState().active?.bytesLoaded).toBe(0);
  });

  it("history retains at most the last 10 entries per bucket", () => {
    const s = useActiveLoadStore.getState();
    for (let i = 0; i < 15; i++) {
      s.start({ datasetId: "ds1", bucket: "B" });
      s.complete("ds1");
    }
    expect(useActiveLoadStore.getState().history["B"]?.length).toBe(10);
  });
});

describe("computeProgress — real Content-Length", () => {
  it("returns bytesLoaded / bytesTotal", () => {
    const v = computeProgress(
      {
        datasetId: "x",
        bucket: "x",
        bytesLoaded: 250,
        bytesTotal: 1000,
        startedAt: Date.now() - 1000,
        tick: 0,
      },
      {},
    );
    expect(v.hasRealTotal).toBe(true);
    expect(v.progress).toBeCloseTo(0.25, 5);
    expect(v.etaMs).not.toBeNull();
    expect(v.etaMs!).toBeGreaterThan(0);
  });

  it("never reports progress >= 1 before completion (even on byte path)", () => {
    const v = computeProgress(
      {
        datasetId: "x",
        bucket: "x",
        bytesLoaded: 1000,
        bytesTotal: 1000,
        startedAt: Date.now(),
        tick: 0,
      },
      {},
    );
    expect(v.progress).toBeLessThan(1);
  });
});

describe("computeProgress — time-based fallback", () => {
  it("is asymptotic and never exceeds 0.99 before completion", () => {
    const startedAt = Date.now() - 100_000; // way past median
    const v = computeProgress(
      {
        datasetId: "x",
        bucket: "B",
        bytesLoaded: 0,
        bytesTotal: null,
        startedAt,
        tick: 0,
      },
      { B: [2000, 3000, 4000] },
    );
    expect(v.hasRealTotal).toBe(false);
    expect(v.progress).toBeLessThanOrEqual(0.99);
    expect(v.progress).toBeGreaterThan(0.9);
  });

  it("uses the bucket median rather than the default when history exists", () => {
    const startedAt = Date.now() - 100;
    const slow = computeProgress(
      {
        datasetId: "x",
        bucket: "slow",
        bytesLoaded: 0,
        bytesTotal: null,
        startedAt,
        tick: 0,
      },
      { slow: [60_000, 60_000, 60_000] },
    );
    const fast = computeProgress(
      {
        datasetId: "x",
        bucket: "fast",
        bytesLoaded: 0,
        bytesTotal: null,
        startedAt,
        tick: 0,
      },
      { fast: [200, 200, 200] },
    );
    // After 100ms, the fast bucket should be much further along.
    expect(fast.progress).toBeGreaterThan(slow.progress);
  });
});
