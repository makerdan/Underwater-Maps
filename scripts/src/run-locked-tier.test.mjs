import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "..", "run-locked-tier.mjs");

let workDir;
before(() => {
  workDir = mkdtempSync(join(tmpdir(), "rlt-test-"));
});
after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let fileCounter = 0;
function writePlan(content) {
  const filePath = join(workDir, `plan-${fileCounter++}.md`);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * Run run-locked-tier.mjs with the given args and return { code, stdout, stderr }.
 */
function run(args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// Helper plan content builders
// ---------------------------------------------------------------------------

function planWithCommand(tier) {
  return `# Test Plan

## Steps
1. Do something.

## Pre-existing failures to ignore
None known at plan time.

## Validation
**Command:** \`${tier}\`
**Why:** Unit tests cover the new script.
**Do not escalate:** Run exactly this command.
`;
}

const PLAN_NO_VALIDATION = `# Test Plan

## Steps
1. Do something.

## Pre-existing failures to ignore
None known at plan time.
`;

const PLAN_VALIDATION_NO_COMMAND = `# Test Plan

## Validation
**Why:** Something.
**Do not escalate:** Run exactly this command.
`;

const PLAN_COMMAND_NO_BACKTICK = `# Test Plan

## Validation
**Command:** test-standard
**Why:** Something.
`;

const PLAN_UNRECOGNISED_TIER = `# Test Plan

## Validation
**Command:** \`test-nonexistent-tier\`
**Why:** Something.
**Do not escalate:** Run exactly this command.
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("--dry-run: valid plan resolves correct command and exits 0", () => {
  const planFile = writePlan(planWithCommand("test-standard"));
  const { code, stdout } = run(["--dry-run", planFile]);
  assert.equal(code, 0, `expected exit 0, got ${code}`);
  assert.match(stdout, /test-standard/, "stdout should mention the tier name");
  assert.match(stdout, /run-with-timeout/, "stdout should show the resolved command");
});

test("--dry-run: test-fast tier resolves to the fast command", () => {
  const planFile = writePlan(planWithCommand("test-fast"));
  const { code, stdout } = run(["--dry-run", planFile]);
  assert.equal(code, 0);
  assert.match(stdout, /test-fast/);
  assert.match(stdout, /tierFast/);
});

test("--dry-run: test-heavy tier resolves to the heavy command", () => {
  const planFile = writePlan(planWithCommand("test-heavy"));
  const { code, stdout } = run(["--dry-run", planFile]);
  assert.equal(code, 0);
  assert.match(stdout, /test-heavy/);
  assert.match(stdout, /aggregate/);
});

test("--dry-run: test-standard-plus tier resolves to the standard-plus command", () => {
  const planFile = writePlan(planWithCommand("test-standard-plus"));
  const { code, stdout } = run(["--dry-run", planFile]);
  assert.equal(code, 0);
  assert.match(stdout, /test-standard-plus/);
  assert.match(stdout, /tierStandardPlus/);
});

test("missing plan file exits 1 with a clear error", () => {
  const { code, stderr } = run(["--dry-run", "/tmp/does-not-exist-plan-9999.md"]);
  assert.equal(code, 1);
  assert.match(stderr, /cannot read plan file/);
});

test("no argument exits 1 with usage hint", () => {
  const { code, stderr } = run([]);
  assert.equal(code, 1);
  assert.match(stderr, /missing plan file argument/);
});

test("plan with no ## Validation section exits 2 (graceful degradation)", () => {
  const planFile = writePlan(PLAN_NO_VALIDATION);
  const { code, stderr } = run(["--dry-run", planFile]);
  assert.equal(code, 2);
  assert.match(stderr, /no "## Validation" section/);
});

test("## Validation present but no **Command:** line exits 1", () => {
  const planFile = writePlan(PLAN_VALIDATION_NO_COMMAND);
  const { code, stderr } = run(["--dry-run", planFile]);
  assert.equal(code, 1);
  assert.match(stderr, /no \*\*Command:\*\* line/);
});

test("**Command:** present but no backtick-quoted value exits 1", () => {
  const planFile = writePlan(PLAN_COMMAND_NO_BACKTICK);
  const { code, stderr } = run(["--dry-run", planFile]);
  assert.equal(code, 1);
  assert.match(stderr, /does not contain a backtick-quoted tier name/);
});

test("unrecognised tier name exits 1 with valid tier list", () => {
  const planFile = writePlan(PLAN_UNRECOGNISED_TIER);
  const { code, stderr } = run(["--dry-run", planFile]);
  assert.equal(code, 1);
  assert.match(stderr, /not a registered tier name/);
  // Should mention at least one valid tier name
  assert.match(stderr, /test-standard/);
});

test("--dry-run does not launch the actual validation command", () => {
  // test-heavy would take ~45 min; dry-run must return quickly
  const planFile = writePlan(planWithCommand("test-heavy"));
  const start = Date.now();
  const { code } = run(["--dry-run", planFile]);
  const elapsed = Date.now() - start;
  assert.equal(code, 0);
  assert.ok(elapsed < 5_000, `dry-run should be fast; took ${elapsed}ms`);
});
