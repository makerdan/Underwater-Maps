import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const heavyRunner = resolve(root, "scripts/test-heavy-serial.mjs");
let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "test-heavy-tier-lock-"));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function writePlan(name, tier) {
  const filePath = join(sandbox, name);
  writeFileSync(
    filePath,
    [
      "# Task Plan",
      "",
      "## Validation",
      `**Command:** \`${tier}\``,
      "",
    ].join("\n"),
  );
  return filePath;
}

function runTierLockCheck(planFile, args = []) {
  const env = { ...process.env };
  delete env.TASK_PLAN_FILE;
  delete env.VALIDATION_REPORT_FILE;
  if (planFile) env.TASK_PLAN_FILE = planFile;

  const result = spawnSync(
    process.execPath,
    [heavyRunner, "--check-tier-only", ...args],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env, timeout: 15000 },
  );
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

describe("test-heavy tier lock preflight", () => {
  it("allows an independent caller without task-plan metadata and labels it diagnostic", () => {
    const result = runTierLockCheck(undefined);
    assert.equal(
      result.status,
      0,
      `expected independent preflight to pass without starting suites, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(result.stderr, /INDEPENDENT DIAGNOSTIC/);
    assert.match(result.stderr, /not task-validation evidence/);
    assert.match(result.stdout, /heavy suites were not started/);
  });

  it("accepts a supplied test-heavy plan for the check-only preflight", () => {
    const planFile = writePlan("heavy.md", "test-heavy");
    const result = runTierLockCheck(planFile);
    assert.equal(
      result.status,
      0,
      `expected matching test-heavy plan to pass preflight, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(result.stdout, /tier-lock pre-check passed/);
  });

  it("rejects a supplied lighter plan even when the legacy flag is present", () => {
    const planFile = writePlan("standard.md", "test-standard");
    const result = runTierLockCheck(planFile, ["--allow-no-plan"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /TIER-LOCK VIOLATION/);
    assert.match(result.stderr, /test-standard/);
  });
});