/**
 * Shared diagnostic-report emitter for the test timeout-guard system.
 *
 * Used by:
 *  - scripts/run-with-timeout.mjs  (Layer 4: per-runner-invocation guard,
 *    Layer 5: aggregate test-all guard)
 *  - tests/timeout-guard/vitest-guard.ts re-implements the same format
 *    inline (it runs inside the vitest worker and must stay dependency-free).
 *
 * Reports are printed to the console AND appended as JSON files under
 * .local/test-timeout-reports/ so a breach in a long CI-style run leaves a
 * durable artifact even if the console scrolls away.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Anchor the report dir to the repo root (this file lives at
// tests/timeout-guard/), not process.cwd(), so per-package wrapped scripts
// all write to the same place.
export const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../.local/test-timeout-reports");

/**
 * @param {object} opts
 * @param {"test"|"hook"|"file"|"run"|"aggregate"} opts.layer
 * @param {string} opts.name        offending test/file/command name
 * @param {number} opts.elapsedMs
 * @param {number} opts.budgetMs
 * @param {Array<{name: string, durationMs: number}>} [opts.slowest]
 * @param {string[]} [opts.suggestions]
 * @param {string} [opts.extra]
 * @param {object} [opts.loadContext]  system-load snapshot at breach time
 *   ({load1, cpuCount, otherRunners, overloaded}) so reports can distinguish
 *   "budget breach under load" from a real hang.
 */
export function emitBreachReport(opts) {
  const { layer, name, elapsedMs, budgetMs, slowest = [], suggestions = [], extra, loadContext } = opts;
  const lines = [
    "",
    "════════════════════════════════════════════════════════════════",
    `⏱  TEST TIME-BUDGET BREACH — layer: ${layer.toUpperCase()}`,
    "════════════════════════════════════════════════════════════════",
    `Offender : ${name}`,
    `Elapsed  : ${(elapsedMs / 1000).toFixed(1)}s  (budget: ${(budgetMs / 1000).toFixed(1)}s, over by ${((elapsedMs - budgetMs) / 1000).toFixed(1)}s)`,
  ];
  if (slowest.length > 0) {
    lines.push("Slowest observed:");
    for (const s of slowest) {
      lines.push(`  - ${(s.durationMs / 1000).toFixed(1)}s  ${s.name}`);
    }
  }
  const allSuggestions = [
    ...suggestions,
    "Budgets live in tests/timeout-guard/budgets.json — raise the relevant budget only if the extra time is legitimate.",
    "Common causes: un-awaited promises, missing vi.useFakeTimers() for long setTimeout chains, BAG worker cold start (warm it in globalSetup), real network calls that should be mocked.",
  ];
  lines.push("Suggestions:");
  for (const s of allSuggestions) lines.push(`  • ${s}`);
  if (extra) lines.push(extra);
  lines.push("════════════════════════════════════════════════════════════════", "");
  const text = lines.join("\n");
  console.error(text);

  try {
    mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = resolve(REPORT_DIR, `${stamp}-${layer}.json`);
    writeFileSync(
      file,
      JSON.stringify({ layer, name, elapsedMs, budgetMs, slowest, suggestions: allSuggestions, loadContext, at: new Date().toISOString() }, null, 2),
    );
    console.error(`Diagnostic report written to ${file}`);
  } catch (err) {
    console.error(`(could not write report file: ${err})`);
  }
  return text;
}
