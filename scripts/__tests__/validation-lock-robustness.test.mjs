import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const lockScript = join(root, "scripts/validation-lock.mjs");
const tierScript = join(root, "scripts/run-locked-tier.mjs");

let sandbox;
before(() => { sandbox = mkdtempSync(join(tmpdir(), "validation-lock-robustness-")); });
after(() => { rmSync(sandbox, { recursive: true, force: true }); });

function cleanEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VALIDATION_LOCK_HELD_PID")),
  );
  return { ...env, ...extra };
}

function runLock(args, env = {}) {
  return spawnSync(process.execPath, [lockScript, ...args], {
    encoding: "utf8",
    env: cleanEnv(env),
  });
}

function validPlan(name = "plan.md") {
  const plan = join(sandbox, name);
  writeFileSync(plan, [
    "# Plan",
    "",
    "## Validation",
    "**Command:** `test-fast`",
    "**Why:** focused script validation",
    "**Do not escalate:** run exactly this command",
  ].join("\n"));
  return plan;
}

test("rejects a non-numeric lock timing environment value at startup", () => {
  const result = runLock(["--", "node", "-e", "process.exit(0)"], {
    VALIDATION_LOCK_TIMEOUT_MS: "not-a-number",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /validation-lock: invalid value for VALIDATION_LOCK_TIMEOUT_MS: 'not-a-number'/);
});

test("rejects zero timing environment values", () => {
  const result = runLock(["--", "node", "-e", "process.exit(0)"], {
    VALIDATION_LOCK_POLL_MS: "0",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid value for VALIDATION_LOCK_POLL_MS: '0'/);
});

test("rejects a missing or empty-after-sanitization resource", () => {
  const empty = runLock(["--resource", "", "--", "node", "-e", "process.exit(0)"]);
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /Usage: validation-lock\.mjs --resource/);

  const punctuation = runLock(["--resource", "///", "--", "node", "-e", "process.exit(0)"]);
  assert.notEqual(punctuation.status, 0);
  assert.match(punctuation.stderr, /at least one alphanumeric character/);

  const missing = runLock(["--resource", "--priority", "3", "--", "node", "-e", "process.exit(0)"]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /requires a non-empty name/);
});

test("reports lock directory creation failures without an uncaught stack", () => {
  const parentFile = join(sandbox, "not-a-directory");
  writeFileSync(parentFile, "file");
  const result = runLock(["--", "node", "-e", "process.exit(0)"], {
    VALIDATION_LOCK_FILE: join(parentFile, "lock"),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /validation-lock: cannot create lock directory/);
  assert.doesNotMatch(result.stderr, / at file:\/\//);
});

test("reentrant execution preserves shell command behavior", () => {
  const output = join(sandbox, "reentrant-output.txt");
  const shellCommand = `printf reentrant-ok > "${output}"`;
  const result = runLock(
    ["--resource", "reentrant-test", "--", "sh", "-c", shellCommand],
    { VALIDATION_LOCK_HELD_PID_REENTRANT_TEST: String(process.pid) },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, "utf8"), "reentrant-ok");
});

test("run-locked-tier rejects extra positional plan files", () => {
  const plan = validPlan();
  const extra = validPlan("extra-plan.md");
  const result = spawnSync(process.execPath, [tierScript, "--dry-run", plan, extra], {
    encoding: "utf8",
    env: cleanEnv(),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected exactly one plan file argument/);
});