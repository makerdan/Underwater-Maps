/**
 * Self-test for the checkTierLock() function in scripts/run-tier.mjs.
 *
 * Run via:  node --test scripts/__tests__/run-tier-check.test.mjs
 *
 * Uses the --check-tier-only flag so only the tier-lock pre-check runs —
 * no actual validation steps execute, making this fast and self-contained.
 *
 * Covers:
 *   (a) TASK_PLAN_FILE absent → warn + exit 0 (graceful degradation)
 *   (b) Plan has no ## Validation section → warn + exit 0 (graceful degradation)
 *   (c) Plan tier matches the requested tier → exit 0
 *   (d) Plan tier does not match the requested tier → TIER-LOCK VIOLATION, exit 1
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runTierScript = resolve(__dirname, "..", "run-tier.mjs");

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "run-tier-check-test-"));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Spawns run-tier.mjs with --check-tier-only so only the tier-lock pre-check
 * runs. Returns { status, stdout, stderr }.
 *
 * @param {string} tier - tier argument ("fast" | "standard" | "full")
 * @param {string|undefined} planFile - value for TASK_PLAN_FILE, or undefined to unset
 */
function runCheck(tier, planFile) {
  const env = { ...process.env };
  if (planFile !== undefined) {
    env.TASK_PLAN_FILE = planFile;
  } else {
    delete env.TASK_PLAN_FILE;
  }
  const res = spawnSync(
    process.execPath,
    [runTierScript, tier, "--check-tier-only"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env },
  );
  return {
    status: res.status ?? 1,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

/**
 * Writes a minimal plan file with a ## Validation section whose **Command:**
 * line names the given tier. Returns the file path.
 */
function writePlanWithTier(name, tierName) {
  const content = [
    "# Task Plan",
    "",
    "## Summary",
    "A test plan.",
    "",
    "## Validation",
    `**Command:** \`${tierName}\``,
    "",
    "Run the command above to validate.",
  ].join("\n");
  const filePath = join(sandbox, name);
  writeFileSync(filePath, content);
  return filePath;
}

/**
 * Writes a plan file with NO ## Validation section. Returns the file path.
 */
function writePlanWithoutValidation(name) {
  const content = [
    "# Task Plan",
    "",
    "## Summary",
    "An old plan that predates the Validation section convention.",
  ].join("\n");
  const filePath = join(sandbox, name);
  writeFileSync(filePath, content);
  return filePath;
}

// ── (a) TASK_PLAN_FILE absent ───────────────────────────────────────────────

describe("TASK_PLAN_FILE absent", () => {
  it("warns and exits 0 (graceful degradation)", () => {
    const result = runCheck("fast", undefined);
    assert.equal(
      result.status,
      0,
      `expected exit 0 when TASK_PLAN_FILE is unset, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("WARNING") && result.stderr.includes("TASK_PLAN_FILE"),
      `stderr should warn about missing TASK_PLAN_FILE.\nstderr: ${result.stderr}`,
    );
  });
});

// ── (b) Plan has no ## Validation section ───────────────────────────────────

describe("plan without ## Validation section", () => {
  it("warns and exits 0 (graceful degradation for old plans)", () => {
    const planFile = writePlanWithoutValidation("plan-no-validation.md");
    const result = runCheck("standard", planFile);
    assert.equal(
      result.status,
      0,
      `expected exit 0 when plan has no ## Validation section, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("WARNING"),
      `stderr should contain a WARNING.\nstderr: ${result.stderr}`,
    );
  });
});

// ── (c) Plan tier matches the requested tier ────────────────────────────────

describe("tier matches", () => {
  it("test-fast / fast → exit 0", () => {
    const planFile = writePlanWithTier("plan-fast.md", "test-fast");
    const result = runCheck("fast", planFile);
    assert.equal(
      result.status,
      0,
      `expected exit 0 when plan tier matches, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes("tier-lock pre-check passed"),
      `stdout should confirm the tier-lock passed.\nstdout: ${result.stdout}`,
    );
  });

  it("test-standard / standard → exit 0", () => {
    const planFile = writePlanWithTier("plan-standard.md", "test-standard");
    const result = runCheck("standard", planFile);
    assert.equal(
      result.status,
      0,
      `expected exit 0 for standard match, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes("tier-lock pre-check passed"),
      `stdout should confirm the tier-lock passed.\nstdout: ${result.stdout}`,
    );
  });

  it("test-standard-plus / full → exit 0 (test-standard-plus maps to full)", () => {
    const planFile = writePlanWithTier("plan-standard-plus.md", "test-standard-plus");
    const result = runCheck("full", planFile);
    assert.equal(
      result.status,
      0,
      `expected exit 0 for test-standard-plus→full match, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("test-heavy / full → exit 0 (test-heavy maps to full)", () => {
    const planFile = writePlanWithTier("plan-heavy.md", "test-heavy");
    const result = runCheck("full", planFile);
    assert.equal(
      result.status,
      0,
      `expected exit 0 for test-heavy→full match, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ── Regression: heavy-runner internal preflight must not be blocked by the
//    outer plan ceiling ──────────────────────────────────────────────────────
//
// test-heavy-serial.mjs: outer check passes (plan says test-heavy), then
// spawns run-tier.mjs standard --skip test:unit WITHOUT TASK_PLAN_FILE.
// Without stripping the env var the internal standard run would see a
// test-heavy plan and raise a TIER-LOCK VIOLATION against its own preflight.

describe("heavy-runner internal preflight regression", () => {
  it("run-tier standard with TASK_PLAN_FILE=test-heavy plan exits 1 (outer check correctly blocks wrong caller)", () => {
    // Confirms the outer guard works: a standard run with a test-heavy plan
    // must be rejected, which is what the heavy runner's outer check prevents.
    const planFile = writePlanWithTier("plan-heavy-outer.md", "test-heavy");
    const result = runCheck("standard", planFile);
    assert.equal(
      result.status,
      1,
      `expected exit 1: standard run must be blocked when plan requires test-heavy, got ${result.status}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("TIER-LOCK VIOLATION"),
      `stderr should contain TIER-LOCK VIOLATION.\nstderr: ${result.stderr}`,
    );
  });

  it("run-tier standard WITHOUT TASK_PLAN_FILE exits 0 (simulates preflight after env-var strip)", () => {
    // After the outer heavy-runner tier-lock check passes, test-heavy-serial
    // strips TASK_PLAN_FILE before invoking the internal standard preflight.
    // This test confirms that the stripped-env call is not blocked.
    const result = runCheck("standard", undefined);
    assert.equal(
      result.status,
      0,
      `expected exit 0 when TASK_PLAN_FILE is absent (stripped env), got ${result.status}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("WARNING") && result.stderr.includes("TASK_PLAN_FILE"),
      `stderr should warn about absent TASK_PLAN_FILE (graceful degradation).\nstderr: ${result.stderr}`,
    );
  });
});

// ── (d) Plan tier does not match the requested tier ─────────────────────────

describe("tier mismatch — TIER-LOCK VIOLATION", () => {
  it("plan requires test-standard but tier=fast → exit 1 with TIER-LOCK VIOLATION", () => {
    const planFile = writePlanWithTier("plan-mismatch-standard-vs-fast.md", "test-standard");
    const result = runCheck("fast", planFile);
    assert.equal(
      result.status,
      1,
      `expected exit 1 on tier mismatch, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("TIER-LOCK VIOLATION"),
      `stderr should contain TIER-LOCK VIOLATION.\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("test-standard"),
      `stderr should name the required tier.\nstderr: ${result.stderr}`,
    );
  });

  it("plan requires test-fast but tier=standard → exit 1 with TIER-LOCK VIOLATION", () => {
    const planFile = writePlanWithTier("plan-mismatch-fast-vs-standard.md", "test-fast");
    const result = runCheck("standard", planFile);
    assert.equal(
      result.status,
      1,
      `expected exit 1 on tier mismatch, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("TIER-LOCK VIOLATION"),
      `stderr should contain TIER-LOCK VIOLATION.\nstderr: ${result.stderr}`,
    );
  });

  it("plan requires test-fast but tier=full → exit 1 with TIER-LOCK VIOLATION", () => {
    const planFile = writePlanWithTier("plan-mismatch-fast-vs-full.md", "test-fast");
    const result = runCheck("full", planFile);
    assert.equal(
      result.status,
      1,
      `expected exit 1 on tier mismatch, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("TIER-LOCK VIOLATION"),
      `stderr should contain TIER-LOCK VIOLATION.\nstderr: ${result.stderr}`,
    );
  });

  it("plan requires test-standard-plus but tier=standard → exit 1 (test-standard-plus maps to full)", () => {
    const planFile = writePlanWithTier("plan-mismatch-splus-vs-standard.md", "test-standard-plus");
    const result = runCheck("standard", planFile);
    assert.equal(
      result.status,
      1,
      `expected exit 1: test-standard-plus maps to full, not standard, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("TIER-LOCK VIOLATION"),
      `stderr should contain TIER-LOCK VIOLATION.\nstderr: ${result.stderr}`,
    );
  });

  it("plan requires an unregistered placeholder tier name → TIER-LOCK VIOLATION, exits 1", () => {
    // An unfilled placeholder like "<replace with tier>" has a ## Validation
    // section but its tier name is not registered. This must be a hard
    // TIER-LOCK VIOLATION (exit 1), not graceful degradation — a plan that
    // has a Validation section but an invalid tier name must not silently pass.
    const content = [
      "# Task Plan",
      "",
      "## Validation",
      "**Command:** `<replace with one-line justification>`",
    ].join("\n");
    const planFile = join(sandbox, "plan-placeholder.md");
    writeFileSync(planFile, content);

    const result = runCheck("fast", planFile);
    assert.equal(
      result.status,
      1,
      `expected exit 1 (TIER-LOCK VIOLATION) for unregistered tier name, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("TIER-LOCK VIOLATION"),
      `stderr should contain TIER-LOCK VIOLATION.\nstderr: ${result.stderr}`,
    );
    assert.ok(
      !result.stdout.includes("tier-lock pre-check passed"),
      `stdout must not claim the tier-lock passed for a placeholder tier.\nstdout: ${result.stdout}`,
    );
  });

  it("plan with no ## Validation section → warns and exits 0 (graceful degradation for old plans)", () => {
    // A plan file that exists but has NO ## Validation section at all is an
    // old plan predating the convention — graceful degradation, not a violation.
    const planFile = writePlanWithoutValidation("plan-no-val-mismatch.md");
    const result = runCheck("standard", planFile);
    assert.equal(
      result.status,
      0,
      `expected exit 0 (graceful degradation) for plan with no ## Validation section, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("WARNING"),
      `stderr should contain a WARNING.\nstderr: ${result.stderr}`,
    );
  });
});
