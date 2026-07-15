/**
 * bagWorkerWarmup.ts — vitest setupFiles entry that pre-spawns the BAG worker
 * and triggers h5py import before any test runs.
 *
 * Listed first in vitest.config.ts setupFiles so the Python subprocess starts
 * and loads h5py during suite initialisation, overlapping that ~5 s cold-start
 * cost with the rest of test setup rather than paying it inside the first
 * parseBag() call.
 *
 * Why setupFiles (not globalSetup):
 *   vitest's globalSetup runs in the main orchestrator process, which is
 *   separate from the singleFork worker process that owns the bagWorker
 *   singleton (stored under Symbol.for("bathyscan.bagWorkerProcess")).
 *   setupFiles run directly inside that fork, so they can reach the same
 *   globalThis and the same Python child process.
 *
 * Protocol:
 *   warmup() sends "__WARMUP__\n" to the Python worker.  bag_worker.py imports
 *   h5py at module scope (startup time) and replies with "__WARMUP_OK__\n".
 *   The returned Promise resolves once that ACK is received, guaranteeing that
 *   h5py is fully loaded before the first parseBag() call runs.
 *
 * Shutdown:
 *   process.on("exit") sends stdin EOF to the Python worker, letting it exit
 *   cleanly.  Because the subprocess is unref'd, it never prevents the Node
 *   process from exiting on its own.
 */

import { beforeAll } from "vitest";
import { bagWorker } from "../lib/bagWorker.js";

// Guard: only register warmup + exit handler once, even though this setupFile
// is executed once per test file (vitest re-imports setupFiles for each file).
const WARMUP_DONE_KEY = Symbol.for("bathyscan.bagWorkerWarmupRegistered");
const g = globalThis as Record<symbol, boolean | undefined>;

if (!g[WARMUP_DONE_KEY]) {
  g[WARMUP_DONE_KEY] = true;

  // Kick off warmup immediately (fire-and-forget) so Python begins loading
  // h5py in parallel with vitest's transform/collect phase.
  const warmupPromise = bagWorker.warmup().catch(() => {
    // If warmup fails (e.g. python3 not available in CI), we log but don't
    // abort the suite — the individual tests will surface a clearer error.
  });

  // Wait for warmup ACK before any test in this file runs.
  // beforeAll is a no-op if warmup already resolved (subsequent test files).
  beforeAll(async () => {
    await warmupPromise;
  }, 30_000);

  // Graceful shutdown: close stdin → Python reads EOF → process exits cleanly.
  process.on("exit", () => {
    bagWorker.shutdown();
  });
}
