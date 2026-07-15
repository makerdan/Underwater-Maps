import { beforeEach, vi } from "vitest";
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
