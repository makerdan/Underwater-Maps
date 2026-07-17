import { afterAll, beforeEach, vi } from "vitest";
import { clearAllCaches } from "../lib/cacheRegistry.js";
import { installFileBudgetGuard } from "../../../../tests/timeout-guard/vitest-guard.mjs";

// Layer 3: per-file wall-clock budget guard. Uses the validation budget when
// running under the validation config (name is set there), else the unit one.
installFileBudgetGuard(
  process.env["VITEST_VALIDATION"] === "1" ? "apiServerValidation" : "apiServerUnit",
);

// Restore real timers once per test FILE so that any file which called
// vi.useFakeTimers() without a matching cleanup does not leak fake-timer state
// into the next file in the singleFork suite.  Placing this at the top level
// of a setupFile means it runs at file-import time (once per test file), NOT
// before every individual test — so intra-file timer accumulation in tests
// like gcs-job-recovery is unaffected.
vi.useRealTimers();

beforeEach(() => {
  clearAllCaches();
});

// Force a major GC cycle after every test file completes.
//
// In singleFork mode all test files share one V8 heap.  Without explicit GC,
// old module registries — each potentially carrying WASM heaps (laz-perf,
// h5wasm) and large Buffers — accumulate until V8 decides to collect on its
// own, typically only when heap pressure is high.  With --expose-gc in
// vitest.config.ts, this afterAll is able to trigger a full sweep between
// files, keeping peak RSS well below the 4 GB safety ceiling.
//
// afterAll at the top level of a setupFile registers a hook that runs once
// after each test file's tests complete (not after every individual test).
afterAll(() => {
  // globalThis.gc is only defined when --expose-gc is passed to node.
  // The typeof guard avoids a ReferenceError if the flag is ever removed.
  if (typeof (globalThis as Record<string, unknown>)["gc"] === "function") {
    (globalThis as unknown as { gc: () => void }).gc();
  }
});
