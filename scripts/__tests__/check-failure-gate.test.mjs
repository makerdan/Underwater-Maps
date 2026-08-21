/**
 * Self-test for scripts/check-failure-gate.mjs
 *
 * Run via:  node --test scripts/__tests__/check-failure-gate.test.mjs
 *
 * Covers:
 *   (a) Placeholder detection — both the fix-stub wording and the skill-template
 *       angle-bracket forms for **Why:** are flagged as unfilled stubs.
 *   (b) --stubs-only mode still validates **Command:** tier names in present
 *       ## Validation sections (only the missing-section check is skipped).
 *   (c) End-to-end pipeline: --fix-stub → strict on a synthetic plan directory:
 *       - plan with no ## Validation section
 *       - plan with a ## Validation section but an angle-bracket **Why:**
 *       - plan with a ## Validation section but an unrecognised **Command:** tier
 *       - fully compliant plan
 *       Verifies: fix-stub exits 0 and all files gain the section; strict exits 1;
 *       the bad-tier and unfilled-placeholder files are reported; the compliant
 *       file is not reported.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { insertValidationLine } from "../check-failure-gate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "..", "check-failure-gate.mjs");

// ---------------------------------------------------------------------------
// Helper — run check-failure-gate.mjs from a specific working directory.
// Pass extraEnv to inject/override environment variables (merged with
// process.env so the script can still resolve modules).
// ---------------------------------------------------------------------------
function runScript(args, cwd, extraEnv = {}) {
  // Scrub TASK_PLAN_FILE (and any other scoping env vars) from the inherited
  // environment so tests that scan fixture directories are never forced into
  // single-file mode by the parent task-agent environment. Tests that need
  // single-file mode pass the var explicitly via extraEnv.
  const { TASK_PLAN_FILE: _scrubbed, ...baseEnv } = process.env;
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd,
    env: { ...baseEnv, ...extraEnv },
  });
  return {
    status: res.status ?? 1,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Helper — create a synthetic plan file at <sandbox>/.local/tasks/<name>
// ---------------------------------------------------------------------------
function writePlan(tasksDir, name, content) {
  const filePath = join(tasksDir, name);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Shared sandbox for all test groups
// ---------------------------------------------------------------------------
let sandbox;
let tasksDir;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "cfgt-test-"));
  tasksDir = join(sandbox, ".local", "tasks");
  mkdirSync(tasksDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// (e) --fix-stub write failures
// ---------------------------------------------------------------------------

describe("--fix-stub: a failed patch write is non-compliant", () => {
  let writeFailureDir;

  before(() => {
    writeFailureDir = mkdtempSync(join(tmpdir(), "cfgt-write-failure-"));
    const filePath = join(writeFailureDir, "write-failure.md");
    writeFileSync(filePath, "# Plan without required sections\n", "utf8");
    // The test runner owns this file, so removing write permission reliably
    // makes the final patch write throw EACCES after the read succeeds.
    chmodSync(filePath, 0o444);
  });

  after(() => {
    rmSync(writeFailureDir, { recursive: true, force: true });
  });

  it("exits 1 and names the affected file when the patch write throws", () => {
    const filePath = join(writeFailureDir, "write-failure.md");
    const result = runScript(["--fix-stub"], writeFailureDir, {
      TASK_PLAN_FILE: filePath,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(
      result.status,
      1,
      `expected --fix-stub to exit 1 after a write failure, got ${result.status}\n${output}`,
    );
    assert.ok(
      output.includes("write-failure.md"),
      `expected the affected file name in the write failure output\n${output}`,
    );
  });
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// (a) Placeholder detection
// ---------------------------------------------------------------------------

describe("placeholder detection — fix-stub wording in **Why:**", () => {
  let planFile;

  before(() => {
    planFile = writePlan(
      tasksDir,
      "a-placeholder-legacy.md",
      [
        "# Task Plan",
        "",
        "## Pre-existing failures to ignore",
        "None known.",
        "",
        "## Validation",
        "**Command:** `test-standard`",
        "**Why:** Placeholder — review before running this task (state what the command covers).",
        "**Do not escalate:** Run exactly this command.",
      ].join("\n"),
    );
  });

  after(() => {
    rmSync(planFile, { force: true });
  });

  it("flags the 'Placeholder — review before running this task' Why wording as unfilled (exit 1)", () => {
    const result = runScript([], sandbox);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for placeholder Why, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes("a-placeholder-legacy.md"),
      `expected file to appear in violations output\nstdout: ${result.stdout}`,
    );
  });

  it("--stubs-only also flags the placeholder Why (exit 1)", () => {
    const result = runScript(["--stubs-only"], sandbox);
    assert.equal(
      result.status,
      1,
      `expected exit 1 in --stubs-only mode for placeholder Why, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

describe("placeholder detection — skill-template angle-bracket Why (long form)", () => {
  let planFile;

  before(() => {
    planFile = writePlan(
      tasksDir,
      "a-placeholder-skill-template.md",
      [
        "# Task Plan",
        "",
        "## Pre-existing failures to ignore",
        "None known.",
        "",
        "## Validation",
        "**Command:** `test-standard`",
        "**Why:** <one-line justification — what this command covers and why it fits the scope of this task>",
        "**Do not escalate:** Run exactly this command.",
      ].join("\n"),
    );
  });

  after(() => {
    rmSync(planFile, { force: true });
  });

  it("flags the '<one-line justification — …>' skill-template Why as unfilled (exit 1)", () => {
    const result = runScript([], sandbox);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for skill-template Why, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes("a-placeholder-skill-template.md"),
      `expected file to appear in violations output\nstdout: ${result.stdout}`,
    );
  });
});

describe("placeholder detection — fix-stub <replace with one-line justification> Why (already caught)", () => {
  let planFile;

  before(() => {
    planFile = writePlan(
      tasksDir,
      "a-placeholder-replace.md",
      [
        "# Task Plan",
        "",
        "## Pre-existing failures to ignore",
        "None known.",
        "",
        "## Validation",
        "**Command:** `test-standard`",
        "**Why:** <replace with one-line justification>",
        "**Do not escalate:** Run exactly this command.",
      ].join("\n"),
    );
  });

  after(() => {
    rmSync(planFile, { force: true });
  });

  it("flags the '<replace with one-line justification>' Why as unfilled (exit 1)", () => {
    const result = runScript([], sandbox);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for <replace> Why placeholder, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (b) --stubs-only mode still validates **Command:** tier names
// ---------------------------------------------------------------------------

describe("--stubs-only: invalid **Command:** tier is still reported (exit 1)", () => {
  let planFile;

  before(() => {
    planFile = writePlan(
      tasksDir,
      "b-bad-tier-stubs-only.md",
      [
        "# Task Plan",
        "",
        "## Pre-existing failures to ignore",
        "None known.",
        "",
        "## Validation",
        "**Command:** `not-a-real-tier`",
        "**Why:** This task covers X and Y.",
        "**Do not escalate:** Run exactly this command.",
      ].join("\n"),
    );
  });

  after(() => {
    rmSync(planFile, { force: true });
  });

  it("reports invalid tier in --stubs-only mode and exits 1", () => {
    const result = runScript(["--stubs-only"], sandbox);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for invalid tier in --stubs-only mode, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes("b-bad-tier-stubs-only.md"),
      `expected file to appear in violations output\nstdout: ${result.stdout}`,
    );
  });

  it("a file without ## Validation section does NOT trigger a violation in --stubs-only mode", () => {
    // Create a file with no Validation section — --stubs-only skips this check
    const noValFile = writePlan(
      tasksDir,
      "b-no-validation-stubs-only.md",
      [
        "# Old Plan",
        "",
        "## Pre-existing failures to ignore",
        "None known.",
        "",
        "## Steps",
        "Do something.",
      ].join("\n"),
    );
    // Run --stubs-only; only b-bad-tier-stubs-only.md should be in violations,
    // b-no-validation-stubs-only.md should be skipped (missing section is ignored)
    const result = runScript(["--stubs-only"], sandbox);
    // b-no-validation-stubs-only.md must not appear in violations
    assert.ok(
      !result.stdout.includes("b-no-validation-stubs-only.md") ||
        result.stdout.match(/✓ b-no-validation-stubs-only\.md/),
      `b-no-validation-stubs-only.md must not be reported as a violation in --stubs-only mode\nstdout: ${result.stdout}`,
    );
    rmSync(noValFile, { force: true });
  });
});

// ---------------------------------------------------------------------------
// (c) End-to-end pipeline: --fix-stub → strict
// ---------------------------------------------------------------------------

describe("end-to-end pipeline: --fix-stub then strict", () => {
  let e2eDir;
  let e2eTasksDir;

  // File names for the four synthetic plans
  const MISSING_SECTION = "e2e-missing-section.md";
  const ANGLE_BRACKET_WHY = "e2e-angle-bracket-why.md";
  const BAD_TIER = "e2e-bad-tier.md";
  const COMPLIANT = "e2e-compliant.md";

  before(() => {
    e2eDir = mkdtempSync(join(tmpdir(), "cfgt-e2e-"));
    e2eTasksDir = join(e2eDir, ".local", "tasks");
    mkdirSync(e2eTasksDir, { recursive: true });

    // (1) Plan with no ## Validation section at all
    writeFileSync(
      join(e2eTasksDir, MISSING_SECTION),
      [
        "# Old Task Plan",
        "",
        "## Steps",
        "Do the work.",
      ].join("\n"),
      "utf8",
    );

    // (2) Plan with ## Validation but **Why:** is the skill-template angle-bracket form
    writeFileSync(
      join(e2eTasksDir, ANGLE_BRACKET_WHY),
      [
        "# Task with Angle-Bracket Why",
        "",
        "## Pre-existing failures to ignore",
        "None known.",
        "",
        "## Validation",
        "**Command:** `test-standard`",
        "**Why:** <one-line justification — what this command covers and why it fits the scope of this task>",
        "**Do not escalate:** Run exactly this command. Pre-existing failures are",
        "handled above — they are never a reason to run a heavier tier.",
      ].join("\n"),
      "utf8",
    );

    // (3) Plan with ## Validation but **Command:** has an unrecognised tier
    writeFileSync(
      join(e2eTasksDir, BAD_TIER),
      [
        "# Task with Bad Tier",
        "",
        "## Pre-existing failures to ignore",
        "None known.",
        "",
        "## Validation",
        "**Command:** `deploy-now`",
        "**Why:** Runs the deployment pipeline for this task.",
        "**Do not escalate:** Run exactly this command. Pre-existing failures are",
        "handled above — they are never a reason to run a heavier tier.",
      ].join("\n"),
      "utf8",
    );

    // (4) Fully compliant plan
    writeFileSync(
      join(e2eTasksDir, COMPLIANT),
      [
        "# Fully Compliant Task",
        "",
        "## Pre-existing failures to ignore",
        "None known at plan time. Treat every failure as a potential regression.",
        "",
        "**Flaky-test rule:** If a test fails, retry it 3× in isolation before concluding",
        "it is a regression you caused. Only treat a consistent 3/3 failure as your",
        "responsibility.",
        "",
        "## Validation",
        "**Command:** `test-standard`",
        "**Why:** Changes touch shared utility modules; test-standard covers unit tests plus typecheck and lint.",
        "**Do not escalate:** Run exactly this command. Pre-existing failures are",
        "handled above — they are never a reason to run a heavier tier.",
      ].join("\n"),
      "utf8",
    );
  });

  after(() => {
    rmSync(e2eDir, { recursive: true, force: true });
  });

  it("--fix-stub exits 0", () => {
    const result = runScript(["--fix-stub"], e2eDir);
    assert.equal(
      result.status,
      0,
      `expected --fix-stub to exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("after --fix-stub all files have a ## Validation section", () => {
    // Run fix-stub (idempotent if already run)
    runScript(["--fix-stub"], e2eDir);

    for (const name of [MISSING_SECTION, ANGLE_BRACKET_WHY, BAD_TIER, COMPLIANT]) {
      const content = readFileSync(join(e2eTasksDir, name), "utf8");
      assert.ok(
        content.includes("## Validation"),
        `expected ${name} to contain ## Validation after --fix-stub`,
      );
    }
  });

  it("strict check exits 1 (at least one violation remains after --fix-stub)", () => {
    runScript(["--fix-stub"], e2eDir);
    const result = runScript([], e2eDir);
    assert.equal(
      result.status,
      1,
      `expected strict check to exit 1 after --fix-stub, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("a plan without ## Validation is never reported as successfully line-patched", () => {
    const noValidation = join(e2eTasksDir, "e2e-no-validation-regression.md");
    const original = [
      "# Plan without validation",
      "",
      "## Steps",
      "Do the work.",
    ].join("\n");
    writeFileSync(noValidation, original, "utf8");

    const result = runScript([], e2eDir);
    assert.equal(result.status, 1, "missing ## Validation must remain non-compliant");
    assert.ok(
      result.stdout.includes("e2e-no-validation-regression.md"),
      `expected the file to remain in the violation output\nstdout: ${result.stdout}`,
    );
    assert.ok(
      !result.stdout.includes('inserted "**'),
      `must not report a missing-section file as line-patched\nstdout: ${result.stdout}`,
    );
    assert.equal(
      readFileSync(noValidation, "utf8"),
      original,
      "a strict check must not modify a plan missing ## Validation",
    );
    rmSync(noValidation, { force: true });
  });

  it("insertValidationLine returns unchanged content with changed=false when the section is absent", async () => {
    const noValidation = join(e2eTasksDir, "e2e-helper-no-validation.md");
    const original = ["# Plan without validation", "", "## Steps", "Do the work."].join("\n");
    writeFileSync(noValidation, original, "utf8");

    const result = await insertValidationLine(
      noValidation,
      original,
      "**Why:** Should not be inserted",
      "**Command:**",
    );

    assert.deepEqual(result, { content: original, changed: false });
    assert.equal(readFileSync(noValidation, "utf8"), original);
    rmSync(noValidation, { force: true });
  });

  it("strict check reports the angle-bracket-why file as a violation", () => {
    runScript(["--fix-stub"], e2eDir);
    const result = runScript([], e2eDir);
    assert.ok(
      result.stdout.includes(ANGLE_BRACKET_WHY),
      `expected ${ANGLE_BRACKET_WHY} to appear in violations output\nstdout: ${result.stdout}`,
    );
    assert.ok(
      result.stdout.includes("✗"),
      `expected at least one ✗ violation in output\nstdout: ${result.stdout}`,
    );
  });

  it("strict check reports the bad-tier file as a violation", () => {
    runScript(["--fix-stub"], e2eDir);
    const result = runScript([], e2eDir);
    assert.ok(
      result.stdout.includes(BAD_TIER),
      `expected ${BAD_TIER} to appear in violations output\nstdout: ${result.stdout}`,
    );
    // Verify the reason mentions the invalid tier
    const lineWithBadTier = result.stdout
      .split("\n")
      .find((l) => l.includes(BAD_TIER));
    assert.ok(
      lineWithBadTier && lineWithBadTier.includes("deploy-now"),
      `expected violation line to mention the invalid tier name "deploy-now"\nline: ${lineWithBadTier}\nstdout: ${result.stdout}`,
    );
  });

  it("strict check does NOT report the fully compliant file as a violation", () => {
    runScript(["--fix-stub"], e2eDir);
    const result = runScript([], e2eDir);
    // The compliant file should appear with ✓, not ✗
    const lines = result.stdout.split("\n");
    const compliantLine = lines.find((l) => l.includes(COMPLIANT));
    assert.ok(
      compliantLine,
      `expected ${COMPLIANT} to appear in output at all\nstdout: ${result.stdout}`,
    );
    assert.ok(
      compliantLine.includes("✓") && !compliantLine.includes("✗"),
      `expected ${COMPLIANT} to be marked ✓ (compliant), not ✗\nline: ${compliantLine}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (d) Single-file mode via TASK_PLAN_FILE
// ---------------------------------------------------------------------------

describe("single-file mode: TASK_PLAN_FILE set to a compliant plan", () => {
  let sfDir;
  let sfTasksDir;
  let compliantPath;
  let nonCompliantPath;

  before(() => {
    sfDir = mkdtempSync(join(tmpdir(), "cfgt-sf-compliant-"));
    sfTasksDir = join(sfDir, ".local", "tasks");
    mkdirSync(sfTasksDir, { recursive: true });

    // The file we will lint via TASK_PLAN_FILE — fully compliant
    compliantPath = join(sfTasksDir, "sf-compliant.md");
    writeFileSync(
      compliantPath,
      [
        "# My Task",
        "",
        "## Pre-existing failures to ignore",
        "None known at plan time. Treat every failure as a potential regression.",
        "",
        "**Flaky-test rule:** If a test fails, retry it 3× in isolation before concluding",
        "it is a regression you caused. Only treat a consistent 3/3 failure as your",
        "responsibility.",
        "",
        "## Validation",
        "**Command:** `test-fast`",
        "**Why:** Only check-failure-gate.mjs and its self-test are changed.",
        "**Do not escalate:** Run exactly this command. Pre-existing failures are",
        "handled above — they are never a reason to run a heavier tier.",
      ].join("\n"),
      "utf8",
    );

    // A non-compliant plan sitting in the same tasks dir — must be ignored
    nonCompliantPath = join(sfTasksDir, "sf-non-compliant.md");
    writeFileSync(
      nonCompliantPath,
      [
        "# Bad Plan",
        "",
        "## Validation",
        "**Command:** `test-standard`",
        "**Why:** <replace with one-line justification>",
        "**Do not escalate:** Run exactly this command.",
      ].join("\n"),
      "utf8",
    );
  });

  after(() => {
    rmSync(sfDir, { recursive: true, force: true });
  });

  it("exits 0 when TASK_PLAN_FILE points at a compliant plan", () => {
    const result = runScript([], sfDir, { TASK_PLAN_FILE: compliantPath });
    assert.equal(
      result.status,
      0,
      `expected exit 0 for compliant TASK_PLAN_FILE, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("logs the single-file mode notice", () => {
    const result = runScript([], sfDir, { TASK_PLAN_FILE: compliantPath });
    assert.ok(
      result.stdout.includes("single-file mode"),
      `expected 'single-file mode' in stdout\nstdout: ${result.stdout}`,
    );
  });

  it("does NOT report the non-compliant sibling file when linting a compliant target", () => {
    const result = runScript([], sfDir, { TASK_PLAN_FILE: compliantPath });
    assert.ok(
      !result.stdout.includes("sf-non-compliant.md"),
      `expected sibling non-compliant file to be ignored\nstdout: ${result.stdout}`,
    );
  });
});

describe("single-file mode: TASK_PLAN_FILE set to a non-compliant plan", () => {
  let sfDir;
  let sfTasksDir;
  let nonCompliantPath;
  let otherCompliantPath;

  before(() => {
    sfDir = mkdtempSync(join(tmpdir(), "cfgt-sf-noncompliant-"));
    sfTasksDir = join(sfDir, ".local", "tasks");
    mkdirSync(sfTasksDir, { recursive: true });

    // The file we will lint — has an unfilled Why placeholder
    nonCompliantPath = join(sfTasksDir, "sf-bad-plan.md");
    writeFileSync(
      nonCompliantPath,
      [
        "# Bad Plan",
        "",
        "## Pre-existing failures to ignore",
        "None known.",
        "",
        "## Validation",
        "**Command:** `test-standard`",
        "**Why:** <replace with one-line justification>",
        "**Do not escalate:** Run exactly this command.",
      ].join("\n"),
      "utf8",
    );

    // A compliant sibling — must be ignored entirely
    otherCompliantPath = join(sfTasksDir, "sf-other-good.md");
    writeFileSync(
      otherCompliantPath,
      [
        "# Good Plan",
        "",
        "## Pre-existing failures to ignore",
        "None known at plan time. Treat every failure as a potential regression.",
        "",
        "**Flaky-test rule:** If a test fails, retry it 3× in isolation before concluding",
        "it is a regression you caused. Only treat a consistent 3/3 failure as your",
        "responsibility.",
        "",
        "## Validation",
        "**Command:** `test-standard`",
        "**Why:** Covers all changed modules.",
        "**Do not escalate:** Run exactly this command. Pre-existing failures are",
        "handled above — they are never a reason to run a heavier tier.",
      ].join("\n"),
      "utf8",
    );
  });

  after(() => {
    rmSync(sfDir, { recursive: true, force: true });
  });

  it("exits 1 when TASK_PLAN_FILE points at a non-compliant plan", () => {
    const result = runScript([], sfDir, { TASK_PLAN_FILE: nonCompliantPath });
    assert.equal(
      result.status,
      1,
      `expected exit 1 for non-compliant TASK_PLAN_FILE, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("reports only the non-compliant target file, not the compliant sibling", () => {
    const result = runScript([], sfDir, { TASK_PLAN_FILE: nonCompliantPath });
    assert.ok(
      result.stdout.includes("sf-bad-plan.md"),
      `expected non-compliant target to appear in output\nstdout: ${result.stdout}`,
    );
    assert.ok(
      !result.stdout.includes("sf-other-good.md"),
      `expected compliant sibling to be ignored\nstdout: ${result.stdout}`,
    );
  });
});

describe("single-file mode: TASK_PLAN_FILE points at a missing file", () => {
  let sfDir;

  before(() => {
    sfDir = mkdtempSync(join(tmpdir(), "cfgt-sf-missing-"));
  });

  after(() => {
    rmSync(sfDir, { recursive: true, force: true });
  });

  it("exits 1 with a descriptive error when TASK_PLAN_FILE does not exist", () => {
    const missingPath = join(sfDir, "does-not-exist.md");
    const result = runScript([], sfDir, { TASK_PLAN_FILE: missingPath });
    assert.equal(
      result.status,
      1,
      `expected exit 1 for missing TASK_PLAN_FILE, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("does not exist") || result.stdout.includes("does not exist"),
      `expected 'does not exist' message in output\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("exits 1 with a descriptive error when TASK_PLAN_FILE is not a .md file", () => {
    const notMd = join(sfDir, "some-file.txt");
    writeFileSync(notMd, "content", "utf8");
    const result = runScript([], sfDir, { TASK_PLAN_FILE: notMd });
    assert.equal(
      result.status,
      1,
      `expected exit 1 for non-.md TASK_PLAN_FILE, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("not a .md file") || result.stdout.includes("not a .md file"),
      `expected 'not a .md file' message in output\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (e) Read failures must never be suppressed by --fix-stub
// ---------------------------------------------------------------------------

describe("--fix-stub: unreadable plan files are hard failures", () => {
  let unreadableDir;
  let unreadablePlanPath;

  before(() => {
    unreadableDir = mkdtempSync(join(tmpdir(), "cfgt-unreadable-"));
    // A directory with an .md suffix is included by archive scanning, but
    // readFile() reliably fails with EISDIR in every test environment,
    // including containers running the tests as root.
    unreadablePlanPath = join(unreadableDir, ".local", "tasks", "unreadable-plan.md");
    mkdirSync(unreadablePlanPath, { recursive: true });
  });

  after(() => {
    rmSync(unreadableDir, { recursive: true, force: true });
  });

  it("exits 1 and names the unreadable file", () => {
    const result = runScript(["--fix-stub"], unreadableDir, {
      TASK_PLAN_FILE: unreadablePlanPath,
    });
    assert.equal(
      result.status,
      1,
      `expected --fix-stub to exit 1 for unreadable plan, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr,
      new RegExp(`could not read "${unreadablePlanPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      `expected read failure diagnostic to name ${unreadablePlanPath}\nstderr: ${result.stderr}`,
    );
  });
});
