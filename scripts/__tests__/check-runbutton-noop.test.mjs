/**
 * Self-test for scripts/check-runbutton-noop.mjs.
 *
 * Run:
 *   node --test scripts/__tests__/check-runbutton-noop.test.mjs
 *
 * Covers:
 *   - Happy path: single shell.exec task, no workflow.run
 *   - Fail: workflow.run task present
 *   - Fail: more than one task
 *   - Fail: workflow.run plus multiple tasks
 *   - Edge: runButton not found
 *   - Edge: named workflow missing
 *   - parseReplitWorkflows: correct section parsing
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReplitWorkflows, checkRunButtonNoop } from "../check-runbutton-noop.mjs";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── parseReplitWorkflows unit tests ──────────────────────────────────────

describe("parseReplitWorkflows", () => {
  it("extracts runButton and a single-task noop workflow", () => {
    const content = `
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Project"
mode = "sequential"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "echo \\"ready\\""
`;
    const { runButton, workflows } = parseReplitWorkflows(content);
    assert.equal(runButton, "Project");
    assert.equal(workflows.length, 1);
    assert.equal(workflows[0].name, "Project");
    assert.equal(workflows[0].tasks.length, 1);
    assert.equal(workflows[0].tasks[0].task, "shell.exec");
  });

  it("extracts multiple workflows correctly", () => {
    const content = `
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Project"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "echo ok"

[[workflows.workflow]]
name = "typecheck"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "pnpm run typecheck"
`;
    const { runButton, workflows } = parseReplitWorkflows(content);
    assert.equal(runButton, "Project");
    assert.equal(workflows.length, 2);
    assert.equal(workflows[0].name, "Project");
    assert.equal(workflows[0].tasks.length, 1);
    assert.equal(workflows[1].name, "typecheck");
    assert.equal(workflows[1].tasks.length, 1);
  });

  it("detects workflow.run tasks", () => {
    const content = `
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Project"
mode = "sequential"

[[workflows.workflow.tasks]]
task = "workflow.run"
args = "typecheck"

[[workflows.workflow.tasks]]
task = "workflow.run"
args = "lint"
`;
    const { workflows } = parseReplitWorkflows(content);
    const project = workflows.find((w) => w.name === "Project");
    assert.ok(project);
    assert.equal(project.tasks.length, 2);
    assert.equal(project.tasks[0].task, "workflow.run");
    assert.equal(project.tasks[1].task, "workflow.run");
  });

  it("handles sub-table headers like [workflows.workflow.metadata]", () => {
    const content = `
[workflows]
runButton = "MyProject"

[[workflows.workflow]]
name = "MyProject"
mode = "sequential"
author = "agent"

[workflows.workflow.metadata]
isValidation = false

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "echo ok"
`;
    const { runButton, workflows } = parseReplitWorkflows(content);
    assert.equal(runButton, "MyProject");
    assert.equal(workflows.length, 1);
    assert.equal(workflows[0].name, "MyProject");
    assert.equal(workflows[0].tasks.length, 1);
  });
});

// ── checkRunButtonNoop integration tests ─────────────────────────────────

function writeTmp(content) {
  const p = join(tmpdir(), `replit-noop-test-${process.pid}-${Date.now()}.toml`);
  writeFileSync(p, content, "utf8");
  return p;
}

describe("checkRunButtonNoop", () => {
  it("passes for a single shell.exec task", () => {
    const p = writeTmp(`
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Project"
mode = "sequential"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "echo \\"BathyScan environment ready.\\""
`);
    try {
      const result = checkRunButtonNoop(p);
      assert.ok(result.ok, `Expected ok but got: ${JSON.stringify(result)}`);
      assert.equal(result.runButtonName, "Project");
      assert.equal(result.taskCount, 1);
      assert.deepEqual(result.workflowRunTasks, []);
    } finally {
      unlinkSync(p);
    }
  });

  it("fails when a workflow.run task is present", () => {
    const p = writeTmp(`
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Project"
mode = "sequential"

[[workflows.workflow.tasks]]
task = "workflow.run"
args = "typecheck"
`);
    try {
      const result = checkRunButtonNoop(p);
      assert.ok(!result.ok);
      assert.equal(result.workflowRunTasks.length, 1);
      assert.equal(result.workflowRunTasks[0], "workflow.run");
    } finally {
      unlinkSync(p);
    }
  });

  it("fails when there are multiple tasks even if none is workflow.run", () => {
    const p = writeTmp(`
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Project"
mode = "sequential"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "echo one"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "echo two"
`);
    try {
      const result = checkRunButtonNoop(p);
      assert.ok(!result.ok);
      assert.equal(result.taskCount, 2);
    } finally {
      unlinkSync(p);
    }
  });

  it("fails with both workflow.run and multiple tasks", () => {
    const p = writeTmp(`
[workflows]
runButton = "Project"

[[workflows.workflow]]
name = "Project"
mode = "sequential"

[[workflows.workflow.tasks]]
task = "workflow.run"
args = "typecheck"

[[workflows.workflow.tasks]]
task = "workflow.run"
args = "lint"
`);
    try {
      const result = checkRunButtonNoop(p);
      assert.ok(!result.ok);
      assert.equal(result.taskCount, 2);
      assert.equal(result.workflowRunTasks.length, 2);
    } finally {
      unlinkSync(p);
    }
  });

  it("returns error when runButton value is absent", () => {
    const p = writeTmp(`
[workflows]

[[workflows.workflow]]
name = "Project"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "echo ok"
`);
    try {
      const result = checkRunButtonNoop(p);
      assert.ok(!result.ok);
      assert.ok(result.error, "Expected error field");
    } finally {
      unlinkSync(p);
    }
  });

  it("returns error when named workflow is not found", () => {
    const p = writeTmp(`
[workflows]
runButton = "Missing"

[[workflows.workflow]]
name = "Project"

[[workflows.workflow.tasks]]
task = "shell.exec"
args = "echo ok"
`);
    try {
      const result = checkRunButtonNoop(p);
      assert.ok(!result.ok);
      assert.ok(result.error, "Expected error field");
    } finally {
      unlinkSync(p);
    }
  });
});
