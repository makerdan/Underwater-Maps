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
        // Give the single long-lived worker enough heap to run the full suite
        // without hitting "Ineffective mark-compacts near heap limit" (OOM).
        // The default V8 heap is ~1.5 GB; BAG-parsing tests accumulate well
        // beyond that over a single-fork run.
        execArgv: ["--max-old-space-size=8192"],
      },
    },
  },
});
