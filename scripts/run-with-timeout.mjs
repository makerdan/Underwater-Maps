#!/usr/bin/env node
/**
 * Layer 4/5 total-run timeout wrapper.
 *
 * Usage:
 *   node scripts/run-with-timeout.mjs <budgetKey|milliseconds> [--label NAME] -- <command...>
 *
 * <budgetKey> resolves `runBudgetMs` (or `totalBudgetMs` for "aggregate")
 * from tests/timeout-guard/budgets.json. A raw millisecond number is also
 * accepted for ad-hoc use.
 *
 * The wrapped command runs in its own process group. On budget breach the
 * whole group receives SIGTERM, then SIGKILL after 10 s, and a diagnostic
 * report is emitted (console + .local/test-timeout-reports/).
 *
 * For the aggregate (test-all) layer, per-step elapsed times are echoed by
 * scripts/test-all-steps.mjs so a breach report can attribute time to steps.
 */
import { spawn, spawnSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { emitBreachReport } from "../tests/timeout-guard/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const budgets = JSON.parse(readFileSync(resolve(here, "../tests/timeout-guard/budgets.json"), "utf8"));

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === 0) {
  console.error("Usage: run-with-timeout.mjs <budgetKey|ms> [--label NAME] -- <command...>");
  process.exit(2);
}
const head = argv.slice(0, sep);
const command = argv.slice(sep + 1);
const budgetKeyOrMs = head[0];
let label = command.join(" ");
const labelIdx = head.indexOf("--label");
if (labelIdx !== -1 && head[labelIdx + 1]) label = head[labelIdx + 1];

let budgetMs;
if (/^\d+$/.test(budgetKeyOrMs)) {
  budgetMs = Number(budgetKeyOrMs);
} else {
  const entry = budgets[budgetKeyOrMs];
  if (!entry) {
    console.error(`Unknown budget key "${budgetKeyOrMs}". Known: ${Object.keys(budgets).filter((k) => !k.startsWith("$")).join(", ")}`);
    process.exit(2);
  }
  budgetMs = entry.runBudgetMs ?? entry.totalBudgetMs;
  if (!budgetMs) {
    console.error(`Budget key "${budgetKeyOrMs}" has no runBudgetMs/totalBudgetMs.`);
    process.exit(2);
  }
}

const layer = budgetKeyOrMs === "aggregate" ? "aggregate" : "run";
// E2E runs boot Playwright webServers on the fixed E2E ports; a SIGKILL of
// such a run can orphan those servers. Detect both a direct playwright
// invocation and the aggregate (test-all) layer, which includes the e2e step.
const isE2eRun =
  command.some((part) => part.includes("playwright")) ||
  budgetKeyOrMs === "e2e" ||
  layer === "aggregate";
const start = Date.now();
console.log(`[timeout-guard] ${layer} budget ${(budgetMs / 1000).toFixed(0)}s for: ${label}`);

const child = spawn(command[0], command.slice(1), {
  stdio: "inherit",
  detached: true,
  env: { ...process.env, TIMEOUT_GUARD_RUN_START: String(start) },
});

/**
 * Snapshot system load and other concurrently-running test runners at breach
 * time so the report can distinguish "budget breach under load" (machine
 * overloaded by parallel suites — the tests themselves are fine) from a real
 * hang inside this run.
 */
function captureLoadContext() {
  const [load1] = loadavg();
  const cpuCount = cpus().length || 1;
  let otherRunners = [];
  try {
    const ps = spawnSync("ps", ["-eo", "pid,ppid,pgid,args"], { encoding: "utf8" });
    if (ps.status === 0) {
      const rows = ps.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const m = l.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
          return m ? { pid: m[1], ppid: m[2], pgid: m[3], args: m[4] } : null;
        })
        .filter(Boolean);
      const byPid = new Map(rows.map((r) => [r.pid, r]));
      // Exclude everything belonging to this run itself:
      //  - the wrapped run's process group (child.pid is the group leader),
      //  - this wrapper's own process group, and
      //  - the full ancestor chain (parent shells, pnpm, and orchestrators
      //    like test-heavy-serial.mjs that invoked this wrapper — they are
      //    part of THIS run, not concurrent load).
      const ownRow = byPid.get(String(process.pid));
      const excludedPgids = new Set([String(child.pid), ownRow?.pgid].filter(Boolean));
      const ancestorPids = new Set();
      for (let cur = ownRow, hops = 0; cur && hops < 30; hops++) {
        ancestorPids.add(cur.pid);
        excludedPgids.add(cur.pgid);
        cur = byPid.get(cur.ppid);
      }
      otherRunners = rows
        .filter((r) => /vitest|playwright|run-with-timeout|test-heavy-serial/.test(r.args))
        .filter((r) => !excludedPgids.has(r.pgid) && !ancestorPids.has(r.pid))
        .filter((r) => !r.args.includes("ps -eo"))
        .map((r) => `${r.pid} ${r.args}`)
        .slice(0, 10);
    }
  } catch { /* ps unavailable — load1 alone still helps */ }
  const overloaded = load1 > cpuCount * 1.5 || otherRunners.length > 0;
  return { load1, cpuCount, otherRunners, overloaded };
}

let breached = false;
const timer = setTimeout(() => {
  breached = true;
  const loadCtx = captureLoadContext();
  const loadLines = [
    `Load context at breach: loadavg(1m)=${loadCtx.load1.toFixed(1)} on ${loadCtx.cpuCount} CPUs; ${loadCtx.otherRunners.length} other test-runner process(es) detected.`,
    ...loadCtx.otherRunners.map((r) => `  other runner: ${r}`),
    loadCtx.overloaded
      ? "VERDICT: LIKELY BUDGET BREACH UNDER LOAD — other suites were running in parallel and/or the machine was overloaded. Re-run this suite alone (or via the serialized test-heavy command) before treating this as a real hang."
      : "VERDICT: NO CONCURRENT LOAD DETECTED — this looks like a real hang or genuinely slow run, not machine contention.",
  ];
  emitBreachReport({
    loadContext: loadCtx,
    extra: loadLines.join("\n"),
    layer,
    name: label,
    elapsedMs: Date.now() - start,
    budgetMs,
    suggestions:
      layer === "aggregate"
        ? [
            "Check the [test-all] step timing lines above to see which step consumed the budget.",
            "Run the offending step alone with its own Layer-4 wrapper to get a per-file breakdown.",
          ]
        : [
            "Re-run this suite alone with `vitest run --reporter=verbose` (or `playwright test --reporter=list`) to find the hanging file.",
            "A run-level hang with no file-level breach usually means a stuck globalSetup, webServer boot, or a worker process that never exits.",
          ],
  });
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch { /* already gone */ }
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch { /* already gone */ }
    // A SIGKILLed Playwright run never tears down its webServer children,
    // leaving orphans holding the fixed E2E ports and poisoning the next run.
    // Sweep those ports so the next e2e run starts clean. Only done for runs
    // that actually boot e2e web servers, so a breached unit run can never
    // kill a concurrently-running legitimate e2e session.
    if (isE2eRun) {
      console.error("[timeout-guard] sweeping E2E ports left behind by the killed run…");
      spawnSync("node", [resolve(here, "kill-port-holders.mjs"), "--e2e"], {
        stdio: "inherit",
      });
    }
  }, 10_000).unref();
}, budgetMs);
timer.unref();

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (breached) {
    console.error(`[timeout-guard] killed after budget breach (ran ${elapsed}s)`);
    process.exit(124);
  }
  console.log(`[timeout-guard] ${label} finished in ${elapsed}s (budget ${(budgetMs / 1000).toFixed(0)}s)`);
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
