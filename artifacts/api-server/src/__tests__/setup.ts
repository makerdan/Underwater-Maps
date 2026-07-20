import { afterAll, beforeEach, vi } from "vitest";
import os from "os";
import path from "path";
import { clearAllCaches } from "../lib/cacheRegistry.js";
import { installFileBudgetGuard } from "../../../../tests/timeout-guard/vitest-guard.mjs";

// ---------------------------------------------------------------------------
// Per-run disk-cache isolation for Poe zone + upscale caches
//
// poe.ts stores classification and upscale results in /tmp subdirectories that
// survive between process invocations.  Without isolation, a file written by
// test run N is still present when test run N+1 starts, turning expected cache
// misses into spurious hits and making tests flaky across runs.
//
// Setting POE_ZONE_CACHE_DIR / POE_UPSCALE_CACHE_DIR to process-pid-scoped
// directories before poe.ts is first loaded ensures every `vitest` invocation
// gets its own namespace.  poe.ts reads these env vars at module-load time
// (module-level const), so the values must be in place before any test file
// imports the poe router.  setupFiles run before test-file imports in all
// vitest pool modes, so top-level assignment here is the right place.
//
// Within-run test-to-test contamination (test A writes a cache entry → test B
// gets a hit) is still handled by `__clearUpscaleCaches()` /
// `__clearZoneAndDatasetCaches()` calls in the beforeEach of poe.test.ts and
// poe-fallback.test.ts — those call sites remain necessary for that narrower
// scope and do not need to know the actual directory path.
// ---------------------------------------------------------------------------
const _runId = `test-${process.pid}`;
process.env["POE_ZONE_CACHE_DIR"] = path.join(
  os.tmpdir(),
  `zone-cache-${_runId}`,
);
process.env["POE_UPSCALE_CACHE_DIR"] = path.join(
  os.tmpdir(),
  `upscale-cache-${_runId}`,
);

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

beforeEach(async () => {
  clearAllCaches();
  // Reset in-memory rate-limit buckets before every test.
  //
  // In singleFork mode every test file shares the same V8 heap, so any
  // memoryBuckets entries written by test N are still present when test N+1
  // starts.  This beforeEach (in the setupFile) fires before every test in
  // every file, providing both file-level and per-test rate-limit isolation.
  //
  // Dynamic import (not a top-level static import) is intentional: by the
  // time beforeEach fires, vi.mock() in the test file has already been
  // applied to the module registry.  A top-level import of rateLimit.ts in
  // this setupFile would load it before vi.mock(), causing rateLimit.ts to
  // capture the real @workspace/db pool and break mock interception for tests
  // that mock @workspace/db.
  // Some test files vi.mock() rateLimit.js without stubbing this test-only
  // export; accessing a missing export on a mocked module throws, so tolerate
  // that case — a fully mocked rateLimit module has no real buckets to reset.
  try {
    const mod = await import("../middlewares/rateLimit.js");
    mod.__resetRateLimitMemory();
  } catch {
    // rateLimit.js is mocked without __resetRateLimitMemory — nothing to reset.
  }
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
