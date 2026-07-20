import { defineConfig } from "vitest/config";
import { BaseSequencer } from "vitest/node";
import type { TestFile } from "vitest/node";
import budgets from "../../tests/timeout-guard/budgets.json";

/**
 * Run high-priority files first in the sequential singleFork queue.
 *
 * portFailFast.spawn.test.ts — hoisted to position 1 so the esbuild build (if
 * stale) and its 3 spawn tests always have the full suite budget ahead of them.
 *
 * markers.test.ts and markers-delete.test.ts — hoisted to positions 2–3.
 * Both files import the full Express app via vi.importActual(@workspace/poe),
 * which creates large module closures in the V8 heap.  When they run late in
 * the 140+ file singleFork queue the cumulative RSS can exceed the
 * --max-old-space-size ceiling and OOM-crash the remaining tests.  Running
 * them second and third (heap still fresh) keeps peak RSS well below the
 * limit.
 */
class PortTestFirstSequencer extends BaseSequencer {
  override async sort(files: TestFile[]) {
    const sorted = await super.sort(files);
    const portFirst = sorted.filter((f) =>
      f.moduleId.includes("portFailFast"),
    );
    const markersEarly = sorted.filter(
      (f) =>
        (f.moduleId.includes("/markers.test.") ||
          f.moduleId.includes("/markers-delete.test.")) &&
        !f.moduleId.includes("portFailFast"),
    );
    const rest = sorted.filter(
      (f) =>
        !f.moduleId.includes("portFailFast") &&
        !f.moduleId.includes("/markers.test.") &&
        !f.moduleId.includes("/markers-delete.test."),
    );
    return [...portFirst, ...markersEarly, ...rest];
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
