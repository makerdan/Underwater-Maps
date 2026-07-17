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
        // instead of accumulating across the 140+ file singleFork run.
        //
        // --max-old-space-size is set to 6144 MB to give the 140-file
        // singleFork suite enough headroom so that the heaviest files
        // (efhData, catalog-save-delete, parseHyd93A93) don't push RSS
        // over the OS limit before the per-file gc() calls can reclaim
        // their large GeoJSON/app fixtures.  Keeping an explicit ceiling
        // means a future regression causes a clear V8 OOM error rather
        // than a silent OS-level kill.
        execArgv: ["--max-old-space-size=6144", "--expose-gc"],
      },
    },
  },
});
