import { defineConfig } from "vitest/config";
import budgets from "../../tests/timeout-guard/budgets.json";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Layers 1+2: per-test / per-hook timeouts from the shared budget config.
    testTimeout: budgets.apiServerUnit.testTimeoutMs,
    hookTimeout: budgets.apiServerUnit.hookTimeoutMs,
    setupFiles: [
      "./src/__tests__/bagWorkerWarmup.ts",
      "./src/__tests__/setup.ts",
    ],
    // Run all test files in a single forked process so the bagWorker singleton
    // (stored under a global symbol) is shared across all BAG test files.
    // This eliminates repeated Python + h5py cold-starts between test files.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        // --expose-gc lets setup.ts call global.gc() after each test file so
        // that old module registries (and their WASM heaps) are swept promptly
        // instead of accumulating across the 70+ file singleFork run.
        //
        // --max-old-space-size is kept at 4096 MB (halved from 8192) as a
        // safety ceiling.  With the laz-perf WASM singleton and the per-file
        // gc() call the peak heap should now stay well under the default
        // ~1.5 GB limit, but the explicit ceiling remains so that regressions
        // are caught as OOM crashes rather than silent slowness if the test
        // suite ever introduces a new large retained object.
        execArgv: ["--max-old-space-size=4096", "--expose-gc"],
      },
    },
  },
});
