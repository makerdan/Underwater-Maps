import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchTaskValidation } from "../lib/task-validation-launch.mjs";
import { VALIDATION_COMMANDS } from "../register-validation-commands.mjs";

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
function run(args, { env } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    env,
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

test("accepts pnpm's conventional -- argument separator", () => {
  const planFile = writePlan(planWithCommand("test-fast"));
  const { code, stdout } = run(["--", "--dry-run", planFile]);
  assert.equal(code, 0);
  assert.match(stdout, /test-fast/);
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

test("plan with no ## Validation section exits 1 with required-section error", () => {
  const planFile = writePlan(PLAN_NO_VALIDATION);
  const { code, stderr } = run(["--dry-run", planFile]);
  assert.equal(code, 1);
  assert.match(stderr, /no "## Validation" section/);
  assert.match(stderr, /required/);
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

test("task validation scopes the exact plan without mutating .replit", () => {
  const dotReplitPath = resolve(here, "..", "..", ".replit");
  const before = readFileSync(dotReplitPath);
  const planFile = writePlan(planWithCommand("test-fast"));
  let observed;

  const result = launchTaskValidation(
    "node scripts/run-with-timeout.mjs tierFast -- node scripts/run-tier.mjs fast",
    planFile,
    {
      env: { EXISTING_VALUE: "preserved" },
      spawn(command, options) {
        observed = { command, options };
        return { status: 0 };
      },
    },
  );

  assert.equal(result.status, 0);
  assert.equal(
    observed.command,
    "node scripts/run-with-timeout.mjs tierFast -- node scripts/run-tier.mjs fast",
  );
  assert.equal(observed.options.shell, true);
  assert.equal(observed.options.stdio, "inherit");
  assert.deepEqual(observed.options.env, {
    EXISTING_VALUE: "preserved",
    TASK_PLAN_FILE: planFile,
  });
  assert.deepEqual(
    readFileSync(dotReplitPath),
    before,
    "launching task validation must not rewrite workflow registration",
  );
});

test("managed task validation passes the exact plan to its selected registered tier without changing workflow definitions", () => {
  const dotReplitPath = resolve(here, "..", "..", ".replit");
  const manifestPath = resolve(here, "..", "register-validation-commands.mjs");
  const beforeDotReplit = readFileSync(dotReplitPath);
  const beforeManifest = readFileSync(manifestPath);
  const beforeCommands = structuredClone(VALIDATION_COMMANDS);
  const planFile = writePlan(planWithCommand("test-standard"));
  const fakeBin = join(workDir, "fake-bin");
  const capturePath = join(workDir, "managed-validation-capture.txt");
  mkdirSync(fakeBin);
  const fakeNode = join(fakeBin, "node");
  writeFileSync(
    fakeNode,
    [
      "#!/bin/sh",
      "printf 'plan=%s\\n' \"$TASK_PLAN_FILE\" > \"$TASK_VALIDATE_CAPTURE\"",
      "printf 'args=%s\\n' \"$*\" >> \"$TASK_VALIDATE_CAPTURE\"",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakeNode, 0o755);

  const result = run(["--", planFile], {
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      TASK_VALIDATE_CAPTURE: capturePath,
    },
  });

  assert.equal(result.code, 0, result.stderr);
  const launched = readFileSync(capturePath, "utf8");
  assert.match(launched, new RegExp(`^plan=${planFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.match(
    launched,
    /^args=scripts\/run-with-timeout\.mjs tierStandard -- node scripts\/run-tier\.mjs standard$/m,
    "the plan-selected canonical test-standard command should be launched",
  );
  assert.deepEqual(
    readFileSync(dotReplitPath),
    beforeDotReplit,
    "managed task validation must not rewrite .replit",
  );
  assert.deepEqual(
    readFileSync(manifestPath),
    beforeManifest,
    "managed task validation must not rewrite the registered validation command manifest",
  );
  assert.deepEqual(
    VALIDATION_COMMANDS,
    beforeCommands,
    "managed task validation must not mutate the registered validation command set",
  );
});

test("managed task validation does not launch a tier when the supplied plan is unreadable", () => {
  const fakeBin = join(workDir, "unreadable-fake-bin");
  const capturePath = join(workDir, "unreadable-validation-capture.txt");
  mkdirSync(fakeBin);
  const fakeNode = join(fakeBin, "node");
  writeFileSync(fakeNode, "#!/bin/sh\n: > \"$TASK_VALIDATE_CAPTURE\"\n", "utf8");
  chmodSync(fakeNode, 0o755);

  // Directories are not readable as UTF-8 files on the supported Node runtime.
  const result = run([workDir], {
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      TASK_VALIDATE_CAPTURE: capturePath,
    },
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /cannot read plan file/);
  assert.throws(() => readFileSync(capturePath), { code: "ENOENT" });
});
