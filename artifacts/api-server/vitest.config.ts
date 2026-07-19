import { defineConfig } from "vitest/config";
import { BaseSequencer } from "vitest/node";
import type { TestFile } from "vitest/node";
import budgets from "../../tests/timeout-guard/budgets.json";

/**
 * Run portFailFast.spawn.test.ts first in the sequential singleFork queue.
 *
 * Without this, vitest schedules files in inode-creation order — newer files
 * sort last. portFailFast was created recently, so it lands at position ~140
 * and starts with ≈0 s left in the 600 s budget.  Hoisting it to position 1
 * gives it the full budget for its esbuild build (if stale) + 3 spawn tests,
 * and leaves the remaining 140 files to fill the rest of the window.
 */
class PortTestFirstSequencer extends BaseSequencer {
  override async sort(files: TestFile[]) {
    const sorted = await super.sort(files);
    const portFirst = sorted.filter((f) =>
      f.moduleId.includes("portFailFast"),
    );
    const rest = sorted.filter((f) => !f.moduleId.includes("portFailFast"));
    return [...portFirst, ...rest];
  }
}

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
        // --max-old-space-size is set to 8192 MB to give the 140-file
        // singleFork suite enough headroom so that the heaviest files
        // (efhData, catalog-save-delete, parseHyd93A93, chunk-finalize-validation)
        // don't push RSS over the OS limit before the per-file gc() calls
        // can reclaim their large GeoJSON/app fixtures.  Keeping an explicit
        // ceiling means a future regression causes a clear V8 OOM error rather
        // than a silent OS-level kill.
        execArgv: ["--max-old-space-size=8192", "--expose-gc"],
      },
    },
    // portFailFast runs first so the esbuild build (if triggered) and the
    // 3 spawn tests always have the full suite budget ahead of them.
    sequence: {
      sequencer: PortTestFirstSequencer,
    },
  },
});
