#!/usr/bin/env node
/**
 * check-runbutton-noop.mjs — Boot-storm guard for the run-button workflow.
 *
 * Background
 * ──────────
 * The `.replit` `runButton` setting names the workflow that fires every time
 * the environment restarts (which happens automatically after every task
 * merge). If that workflow contains `task = "workflow.run"` entries it will
 * launch multiple validation workflows in parallel, queueing hours of work on
 * the global validation lock — a "boot storm".
 *
 * The fix is to keep the run-button workflow as a single cheap no-op shell
 * command (e.g. `echo "…"`). This check enforces that convention:
 *
 *   FAIL  — the run-button workflow has more than one task, OR any of its
 *            tasks has `task = "workflow.run"`.
 *   PASS  — the run-button workflow has exactly one task and no
 *            `workflow.run` entries.
 *
 * Note: `.replit` cannot be edited directly by agents, but it is readable, so
 * this check is read-only and purely structural.
 *
 * Usage:
 *   node scripts/check-runbutton-noop.mjs
 *
 * Self-test:
 *   node --test scripts/__tests__/check-runbutton-noop.test.mjs
 *   (run automatically by the `check:runbutton-noop` npm script before the
 *   real scan, so a broken detector fails loudly instead of passing quietly)
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, "..");

/**
 * Minimal structural parser for the `.replit` TOML subset we care about.
 *
 * Returns:
 *   {
 *     runButton: string,          // value of workflows.runButton
 *     workflows: Array<{
 *       name: string,
 *       tasks: Array<{ task: string }>
 *     }>
 *   }
 *
 * The parser handles only the `[workflows]` / `[[workflows.workflow]]` /
 * `[[workflows.workflow.tasks]]` structure — it does not need to understand
 * the full TOML spec.
 */
export function parseReplitWorkflows(content) {
  const lines = content.split("\n");

  let runButton = "";
  const workflows = [];
  let currentWorkflow = null;

  // Section header patterns
  const WORKFLOW_HEADER = /^\s*\[\[workflows\.workflow\]\]\s*$/;
  const TASKS_HEADER = /^\s*\[\[workflows\.workflow\.tasks\]\]\s*$/;
  const WORKFLOWS_SECTION = /^\s*\[workflows\]\s*$/;
  const OTHER_SECTION = /^\s*\[(?!workflows\b)[^\]]+\]\s*$/;

  let inWorkflowsSection = false;
  let inTasksBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Section transitions
    if (WORKFLOW_HEADER.test(rawLine)) {
      currentWorkflow = { name: "", tasks: [] };
      workflows.push(currentWorkflow);
      inWorkflowsSection = false;
      inTasksBlock = false;
      continue;
    }

    if (TASKS_HEADER.test(rawLine)) {
      inTasksBlock = true;
      if (currentWorkflow) {
        currentWorkflow.tasks.push({ task: "" });
      }
      continue;
    }

    if (WORKFLOWS_SECTION.test(rawLine)) {
      inWorkflowsSection = true;
      currentWorkflow = null;
      inTasksBlock = false;
      continue;
    }

    if (OTHER_SECTION.test(rawLine)) {
      // A non-double-bracket section header; if it's not [[workflows.workflow]]
      // or [[workflows.workflow.tasks]], don't reset workflow — sub-tables like
      // [workflows.workflow.metadata] belong to the current workflow.
      if (/^\s*\[workflows\.workflow\b/.test(rawLine)) {
        // sub-table of the current workflow — stay in currentWorkflow context
        inTasksBlock = false;
      } else {
        inWorkflowsSection = false;
        inTasksBlock = false;
      }
      continue;
    }

    // Key = value parsing
    const kvMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const [, key, rawValue] = kvMatch;
    const value = parseTomlString(rawValue);

    if (inWorkflowsSection && key === "runButton") {
      runButton = value;
      continue;
    }

    if (currentWorkflow && !inTasksBlock && key === "name") {
      currentWorkflow.name = value;
      continue;
    }

    if (currentWorkflow && inTasksBlock && key === "task") {
      // Set on the last task entry
      const last = currentWorkflow.tasks[currentWorkflow.tasks.length - 1];
      if (last) last.task = value;
      continue;
    }
  }

  return { runButton, workflows };
}

/**
 * Strips TOML string delimiters from a raw value token.
 * Handles: "value", 'value', bare-word.
 */
function parseTomlString(raw) {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Main check logic.
 *
 * @param {string} [replitPath] Path to the .replit file (defaults to repo root).
 * @returns {{ ok: boolean, runButtonName: string, taskCount: number, workflowRunTasks: string[] }}
 */
export function checkRunButtonNoop(replitPath) {
  const filePath = replitPath ?? resolve(repoRoot, ".replit");
  const content = readFileSync(filePath, "utf8");
  const { runButton, workflows } = parseReplitWorkflows(content);

  if (!runButton) {
    return {
      ok: false,
      runButtonName: "",
      taskCount: 0,
      workflowRunTasks: [],
      error: "Could not find runButton setting in [workflows] section of .replit",
    };
  }

  const rbWorkflow = workflows.find((w) => w.name === runButton);
  if (!rbWorkflow) {
    return {
      ok: false,
      runButtonName: runButton,
      taskCount: 0,
      workflowRunTasks: [],
      error: `Run-button workflow "${runButton}" not found among [[workflows.workflow]] entries`,
    };
  }

  const taskCount = rbWorkflow.tasks.length;
  const workflowRunTasks = rbWorkflow.tasks
    .map((t) => t.task)
    .filter((t) => t === "workflow.run");

  const ok = taskCount <= 1 && workflowRunTasks.length === 0;
  return { ok, runButtonName: runButton, taskCount, workflowRunTasks };
}

// ── CLI entry point ────────────────────────────────────────────────────────

function main() {
  const result = checkRunButtonNoop();

  if (result.error) {
    console.error(`[check-runbutton-noop] FAIL — ${result.error}`);
    process.exit(1);
  }

  if (!result.ok) {
    const lines = [
      `[check-runbutton-noop] FAIL — run-button workflow "${result.runButtonName}" violates the no-op convention.`,
      "",
    ];

    if (result.workflowRunTasks.length > 0) {
      lines.push(
        `  Found ${result.workflowRunTasks.length} task(s) with task = "workflow.run".`,
        `  Each "workflow.run" entry in the run-button workflow launches a validation`,
        `  workflow on every environment restart (which happens after every task merge).`,
        `  With many such entries this creates a "boot storm" — all validation workflows`,
        `  queue at once on the global validation lock, blocking the environment for hours.`,
        "",
      );
    }

    if (result.taskCount > 1) {
      lines.push(
        `  Found ${result.taskCount} task(s) in the run-button workflow (max allowed: 1).`,
        "",
      );
    }

    lines.push(
      `  Convention: the run-button workflow ("${result.runButtonName}") must contain`,
      `  exactly ONE task of type shell.exec (a cheap no-op such as echo "…").`,
      `  It must NOT contain any task = "workflow.run" entries.`,
      "",
      `  To fix:`,
      `  1. Ask an agent to update the run-button workflow via verifyAndReplaceDotReplit`,
      `     (agents cannot edit .replit directly — a temp-file + replace flow is required).`,
      `  2. Keep the workflow as a single shell.exec echo command.`,
      `  3. Never add workflow.run tasks to the "${result.runButtonName}" workflow.`,
    );

    console.error(lines.join("\n"));
    process.exit(1);
  }

  console.log(
    `[check-runbutton-noop] OK — run-button workflow "${result.runButtonName}" ` +
      `has ${result.taskCount} task(s) and no workflow.run entries.`,
  );
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main();
}
