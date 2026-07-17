/**
 * Layer 3 — per-test-file wall-clock budget guard for Vitest suites.
 *
 * Import and call `installFileBudgetGuard("<budgetKey>")` from a package's
 * setup file. Because setup files are (re)imported once per test file, the
 * call-time start timestamp marks the beginning of the current file.
 *
 * After every test we check elapsed wall-clock time against the file budget
 * from tests/timeout-guard/budgets.json. On breach we throw with a full
 * diagnostic (elapsed vs budget, slowest tests so far, suggestions) and
 * write a JSON report to .local/test-timeout-reports/, so the run fails
 * fast with an explanation instead of dragging on.
 *
 * Layers 1+2 (per-test / per-hook timeouts) are enforced separately via
 * testTimeout/hookTimeout in each vitest config, sourced from the same
 * budgets.json.
 *
 * RSS high-water-mark tracking (Layer 3.5):
 * After every test, process.memoryUsage().rss is sampled and the per-file
 * peak is tracked. After all tests in a file complete, a one-line summary is
 * printed. If the peak crosses the optional `rssWarnMb` threshold defined in
 * budgets.json, a prominent warning is emitted with actionable suggestions so
 * memory growth shows up in CI output before it hits the heap limit.
 *
 * Shipped as .mjs (with vitest-guard.d.ts) rather than .ts so that package
 * tsconfigs with a package-local rootDir don't pull this file into their
 * compilation unit.
 */
import { afterAll, afterEach, beforeEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const budgets = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "budgets.json"), "utf8"),
);

/** Walk up from cwd to the pnpm workspace root so reports land in one place. */
function findRepoRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * @param {"apiServerUnit"|"apiServerValidation"|"bathyscanUnit"|"bathyscanValidation"|"apiZod"} key
 */
export function installFileBudgetGuard(key) {
  const budget = budgets[key];
  if (!budget || typeof budget.fileBudgetMs !== "number") {
    throw new Error(`[timeout-guard] Unknown budget key "${key}" in tests/timeout-guard/budgets.json`);
  }
  const fileBudgetMs = budget.fileBudgetMs;
  /** Optional RSS soft-warn threshold in bytes (from budgets.json rssWarnMb field). */
  const rssWarnBytes =
    typeof budget.rssWarnMb === "number" ? budget.rssWarnMb * 1024 * 1024 : null;

  const fileStart = Date.now();
  /** @type {Array<{name: string, durationMs: number}>} */
  const slowest = [];
  let breached = false;
  let testStart = 0;

  // --- RSS tracking ---
  let peakRssBytes = process.memoryUsage().rss;
  let currentFileName = "unknown file";

  beforeEach(() => {
    testStart = Date.now();
  });

  afterEach((ctx) => {
    const now = Date.now();
    const task = ctx && ctx.task;
    const fileName = (task && task.file && task.file.name) || "unknown file";
    currentFileName = fileName;
    const testName = task ? `${fileName} > ${task.name}` : "unknown test";
    slowest.push({ name: testName, durationMs: now - testStart });
    slowest.sort((a, b) => b.durationMs - a.durationMs);
    if (slowest.length > 5) slowest.length = 5;

    // Sample RSS after every test and update the per-file high-water mark.
    const rss = process.memoryUsage().rss;
    if (rss > peakRssBytes) peakRssBytes = rss;

    const elapsedMs = now - fileStart;
    if (elapsedMs > fileBudgetMs && !breached) {
      breached = true;
      const suggestions = [
        `Raise fileBudgetMs for "${key}" in tests/timeout-guard/budgets.json only if this file legitimately needs more time.`,
        "Check for un-awaited promises, real network/DB calls that should be mocked, or long setTimeout chains missing vi.useFakeTimers().",
        "If this is a BAG-worker file: warm the worker up in a globalSetup instead of paying the Python cold start here.",
        "Consider splitting the file — smaller files localise failures and keep budgets meaningful.",
      ];
      const lines = [
        "",
        "════════════════════════════════════════════════════════════════",
        "⏱  TEST TIME-BUDGET BREACH — layer: FILE",
        "════════════════════════════════════════════════════════════════",
        `Offender : ${fileName} (budget key: ${key})`,
        `Elapsed  : ${(elapsedMs / 1000).toFixed(1)}s  (budget: ${(fileBudgetMs / 1000).toFixed(1)}s, over by ${((elapsedMs - fileBudgetMs) / 1000).toFixed(1)}s)`,
        "Slowest tests in this file so far:",
        ...slowest.map((s) => `  - ${(s.durationMs / 1000).toFixed(1)}s  ${s.name}`),
        "Suggestions:",
        ...suggestions.map((s) => `  • ${s}`),
        "════════════════════════════════════════════════════════════════",
        "",
      ];
      console.error(lines.join("\n"));
      try {
        const dir = resolve(findRepoRoot(), ".local/test-timeout-reports");
        mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        writeFileSync(
          resolve(dir, `${stamp}-file.json`),
          JSON.stringify(
            { layer: "file", name: fileName, budgetKey: key, elapsedMs, budgetMs: fileBudgetMs, slowest, suggestions, at: new Date().toISOString() },
            null,
            2,
          ),
        );
      } catch {
        // reporting must never mask the primary failure
      }
      throw new Error(
        `[timeout-guard] Test file exceeded its ${(fileBudgetMs / 1000).toFixed(0)}s wall-clock budget ` +
          `(elapsed ${(elapsedMs / 1000).toFixed(1)}s). See diagnostic above.`,
      );
    }
  });

  // --- RSS high-water-mark report (runs after all tests in this file) ---
  afterAll(() => {
    // currentFileName is kept current by afterEach; use it as the file label.
    const fileName = currentFileName;

    const peakMb = (peakRssBytes / (1024 * 1024)).toFixed(0);
    const currentRss = process.memoryUsage().rss;
    const currentMb = (currentRss / (1024 * 1024)).toFixed(0);

    const exceeded = rssWarnBytes !== null && peakRssBytes > rssWarnBytes;

    if (exceeded) {
      const warnMb = (rssWarnBytes / (1024 * 1024)).toFixed(0);
      const lines = [
        "",
        "════════════════════════════════════════════════════════════════",
        "🚨  RSS HIGH-WATER-MARK WARNING — layer: FILE",
        "════════════════════════════════════════════════════════════════",
        `File     : ${fileName}`,
        `Peak RSS : ${peakMb} MB  (warn threshold: ${warnMb} MB, current: ${currentMb} MB)`,
        "This file dominates process heap — if more heavy files are added",
        "the singleFork suite will OOM before hitting the heap size limit.",
        "Suggestions:",
        `  • Split this file into smaller fixtures or test groups.`,
        `  • Verify large in-memory datasets are released after use (check afterAll cleanup).`,
        `  • Run with --reporter=verbose to identify which tests hold the most data.`,
        `  • Raise the rssWarnMb threshold in tests/timeout-guard/budgets.json only`,
        `    if you have also raised --max-old-space-size in artifacts/api-server/vitest.config.ts.`,
        "════════════════════════════════════════════════════════════════",
        "",
      ];
      console.error(lines.join("\n"));

      try {
        const dir = resolve(findRepoRoot(), ".local/test-timeout-reports");
        mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        writeFileSync(
          resolve(dir, `${stamp}-rss.json`),
          JSON.stringify(
            {
              layer: "rss",
              name: fileName,
              budgetKey: key,
              peakRssMb: Number(peakMb),
              currentRssMb: Number(currentMb),
              warnMb: Number((rssWarnBytes / (1024 * 1024)).toFixed(0)),
              at: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
      } catch {
        // reporting must never mask the primary failure
      }
    } else {
      // Always print a one-line RSS summary so the trend is visible in CI logs
      // even when no threshold is crossed.
      const thresholdNote =
        rssWarnBytes !== null
          ? `  warn@${(rssWarnBytes / (1024 * 1024)).toFixed(0)} MB`
          : "";
      console.log(
        `[rss-guard] ${fileName}  peak=${peakMb} MB  current=${currentMb} MB${thresholdNote}`,
      );
    }
  });
}
