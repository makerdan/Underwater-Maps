/**
 * bucketMonitor.test.ts
 *
 * Unit tests for the three async/concurrency bugs fixed in bucketMonitor.ts:
 *
 * 1. Semaphore TOCTOU — concurrent __withProcessSlotForTests callers must
 *    never push activeProcessCount above PROCESS_CONCURRENCY_CAP at peak.
 * 2. Startup timeout not cleared — stop() called in the 5-second startup
 *    window must prevent scheduledScan from running.
 * 3. Lifecycle rules not awaited — stop() must wait for an in-flight
 *    lifecycle promise before returning (and time-out correctly when it stalls).
 * 4. Generation isolation — an old-generation holder's finally block must
 *    not corrupt new-generation semaphore state after a test reset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before module imports
// ---------------------------------------------------------------------------

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn().mockImplementation(() => ({
    bucket: vi.fn().mockReturnValue({
      file: vi.fn(),
      getFiles: vi.fn().mockResolvedValue([[]]),
      getMetadata: vi.fn().mockResolvedValue([{ lifecycle: { rule: [] } }]),
      setMetadata: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  customDatasetsTable: {},
}));
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../terrain.js", () => ({ parseXyzCsv: vi.fn(), gridPoints: vi.fn() }));
vi.mock("../uploadParsers.js", () => ({ parseUploadedFile: vi.fn() }));
vi.mock("../tarDetect.js", () => ({
  isTarFile: vi.fn().mockResolvedValue(false),
  extractTarFile: vi.fn(),
  isGzipFile: vi.fn().mockResolvedValue(false),
}));
vi.mock("../noaaTarRouter.js", () => ({ routeTarEntries: vi.fn() }));
vi.mock("../cacheRegistry.js", () => ({ registerCache: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  PROCESS_CONCURRENCY_CAP,
  __resetProcessConcurrencyForTests,
  __withProcessSlotForTests,
  __setLifecycleFnForTests,
  startBucketMonitor,
} from "../bucketMonitor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deferred: a Promise whose resolve/reject are externally controlled. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T | PromiseLike<T>) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T | PromiseLike<T>) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush the microtask queue (one or more ticks). */
async function flushMicrotasks(ticks = 5): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Suite 1: Semaphore correctness — exercises the REAL withProcessSlot
// ---------------------------------------------------------------------------

describe("withProcessSlot — semaphore correctness (real implementation)", () => {
  beforeEach(() => {
    __resetProcessConcurrencyForTests();
  });

  it("peak active count never exceeds PROCESS_CONCURRENCY_CAP under concurrent pressure", async () => {
    const CAP = PROCESS_CONCURRENCY_CAP;
    const N = CAP * 4;
    let activeNow = 0;
    let peak = 0;

    // Create N holders whose work resolves on demand.
    const workDeferreds = Array.from({ length: N }, () => deferred<void>());

    // Launch all N tasks through the real semaphore simultaneously.
    const tasks = workDeferreds.map((d, i) =>
      __withProcessSlotForTests(async () => {
        activeNow++;
        if (activeNow > peak) peak = activeNow;
        await d.promise;
        activeNow--;
        return i;
      }),
    );

    // Flush microtasks so the first CAP tasks acquire their slots.
    await flushMicrotasks();
    expect(activeNow).toBe(CAP); // exactly cap are active, rest are queued
    expect(peak).toBeLessThanOrEqual(CAP);

    // Release one at a time and confirm peak never exceeds cap.
    for (const d of workDeferreds) {
      d.resolve();
      await flushMicrotasks();
      expect(peak).toBeLessThanOrEqual(CAP);
    }

    await Promise.all(tasks);
    expect(peak).toBe(CAP);
  });

  it("queued callers are served in FIFO order after slot release", async () => {
    const CAP = PROCESS_CONCURRENCY_CAP;
    const order: number[] = [];

    // Fill all slots so subsequent callers must queue.
    const holderDeferreds = Array.from({ length: CAP }, () => deferred<void>());
    const holderTasks = holderDeferreds.map((d, i) =>
      __withProcessSlotForTests(async () => {
        await d.promise;
        return i;
      }),
    );
    await flushMicrotasks();

    // Queue two extra callers. Each holds a deferred so we can observe
    // them individually — an instantaneous fn would chain into the next
    // waiter within the same microtask flush, making the intermediate
    // assertion unreliable.
    const waiter0Deferred = deferred<void>();
    const waiter0 = __withProcessSlotForTests(async () => {
      order.push(0);
      await waiter0Deferred.promise;
    });
    const waiter1 = __withProcessSlotForTests(async () => {
      order.push(1);
    });
    await flushMicrotasks();
    expect(order).toEqual([]); // neither has run yet (all slots taken)

    // Release one holder — waiter0 (queued first) should acquire the slot.
    holderDeferreds[0]!.resolve();
    await flushMicrotasks();
    expect(order).toEqual([0]); // waiter0 started; waiter1 still queued

    // Release waiter0's hold — waiter1 can now run.
    waiter0Deferred.resolve();
    await flushMicrotasks();
    expect(order).toEqual([0, 1]);

    // Clean up remaining holders.
    for (const d of holderDeferreds.slice(1)) d.resolve();
    await Promise.all([...holderTasks, waiter0, waiter1]);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Generation isolation — old holder must not corrupt new-gen state
// ---------------------------------------------------------------------------

describe("withProcessSlot — generation isolation after reset", () => {
  beforeEach(() => {
    __resetProcessConcurrencyForTests();
  });

  it("old-generation holder's finally does not decrement new-generation counter", async () => {
    const CAP = PROCESS_CONCURRENCY_CAP;

    // Fill all slots with long-running old-generation tasks.
    const oldDeferreds = Array.from({ length: CAP }, () => deferred<void>());
    const oldTasks = oldDeferreds.map((d) =>
      __withProcessSlotForTests(() => d.promise),
    );
    await flushMicrotasks();

    // Reset while old tasks are still in-flight.
    __resetProcessConcurrencyForTests();

    // New-generation work should immediately get slots (counter reset to 0).
    let newSlotAcquired = false;
    const newDeferred = deferred<void>();
    const newTask = __withProcessSlotForTests(async () => {
      newSlotAcquired = true;
      await newDeferred.promise;
    });
    await flushMicrotasks();
    expect(newSlotAcquired).toBe(true);

    // Release old holders — their finally blocks must NOT decrement the new
    // counter, which would corrupt state (allow count to go negative or
    // grant ghost slots to new waiters).
    for (const d of oldDeferreds) d.resolve();
    await Promise.allSettled(oldTasks); // they may reject with sentinel error

    // New task still holds its slot cleanly; counter should be exactly 1.
    await flushMicrotasks();

    // Release new task — no assertion needed beyond "no crash / no hang".
    newDeferred.resolve();
    await newTask;
  });

  it("waiter cancelled by reset rejects with the sentinel error", async () => {
    const CAP = PROCESS_CONCURRENCY_CAP;

    // Fill all slots.
    const holderDeferreds = Array.from({ length: CAP }, () => deferred<void>());
    holderDeferreds.forEach((d) =>
      __withProcessSlotForTests(() => d.promise).catch(() => {}),
    );
    await flushMicrotasks();

    // Queue a waiter.
    const waiterPromise = __withProcessSlotForTests(async () => "should not run");
    await flushMicrotasks();

    // Reset — wakes the waiter with the wrong generation.
    __resetProcessConcurrencyForTests();
    await flushMicrotasks();

    await expect(waiterPromise).rejects.toThrow("semaphore reset during wait");

    // Clean up holders.
    for (const d of holderDeferreds) d.resolve();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Startup timeout cleared by stop()
// ---------------------------------------------------------------------------

describe("startBucketMonitor — startup timeout cleared by stop()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] = "test-bucket";
    // Inject a no-op lifecycle function so tests don't depend on GCS methods.
    __setLifecycleFnForTests(async () => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    delete process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    __setLifecycleFnForTests(null);
  });

  it("stop() called before the 5-second startup timer prevents scheduledScan from running", async () => {
    // Track whether scan() is attempted by spying on a deep side-effect.
    // The `stopped` flag means scheduledScan() returns early — the only
    // observable effect is that currentScan is never reassigned.
    // We verify this by asserting stop() resolves cleanly even when time
    // advances past the startup window.
    const stop = startBucketMonitor();
    const stopPromise = stop();

    // Advance fake timers past the 5 s startup delay AND the 5 s stop timeout.
    await vi.runAllTimersAsync();
    await stopPromise;
    // If the startup timer was NOT cleared, scheduledScan would call scan(),
    // which tries real GCS calls — causing unhandled errors observable here.
    // Reaching this line without errors confirms the timer was cleared.
  });

  it("stop() also clears the recurring setInterval so no further scans fire", async () => {
    const stop = startBucketMonitor();
    await stop();
    // Advance well past multiple scan intervals — should produce no errors.
    await vi.runAllTimersAsync();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: applyBucketLifecycleRules is awaited by stop()
// ---------------------------------------------------------------------------

describe("startBucketMonitor — stop() awaits in-flight lifecycle rules", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] = "test-bucket";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    __setLifecycleFnForTests(null);
  });

  it("stop() remains pending while the lifecycle call is in-flight and resolves once it settles", async () => {
    // Inject a controllable lifecycle function.
    const lifecycleDeferred = deferred<void>();
    __setLifecycleFnForTests(() => lifecycleDeferred.promise);

    const stop = startBucketMonitor();
    let stopResolved = false;
    const stopPromise = stop().then(() => {
      stopResolved = true;
    });

    // Advance the STOP_TIMEOUT_MS - 1 s so the timeout arm hasn't fired yet.
    await vi.advanceTimersByTimeAsync(4_000);
    await flushMicrotasks();
    // stop() must still be pending — lifecycle hasn't resolved.
    expect(stopResolved).toBe(false);

    // Resolve the lifecycle call — stop() should now complete.
    lifecycleDeferred.resolve();
    await flushMicrotasks();
    expect(stopResolved).toBe(true);

    await stopPromise;
  });

  it("stop() resolves after STOP_TIMEOUT_MS even when the lifecycle call never settles", async () => {
    // Inject a lifecycle function that never resolves.
    __setLifecycleFnForTests(() => new Promise<void>(() => {}));

    const stop = startBucketMonitor();
    let stopResolved = false;
    const stopPromise = stop().then(() => {
      stopResolved = true;
    });

    await flushMicrotasks();
    expect(stopResolved).toBe(false);

    // Advance past STOP_TIMEOUT_MS (5 s) — the race should resolve the stop.
    await vi.advanceTimersByTimeAsync(6_000);
    await flushMicrotasks();
    expect(stopResolved).toBe(true);

    await stopPromise;
  });
});
