/**
 * Self-test for the checkTierLock() function in scripts/run-tier.mjs.
 *
 * Run via:  node --test scripts/__tests__/run-tier-check.test.mjs
 *
 * Uses the --check-tier-only flag so only the tier-lock pre-check runs —
 * no actual validation steps execute, making this fast and self-contained.
 *
 * Covers:
 *   (a) TASK_PLAN_FILE absent + --allow-no-plan → warn + exit 0 (opt-out for non-task runs)
 *   (a2) TASK_PLAN_FILE absent, no --allow-no-plan → TIER-LOCK VIOLATION, exit 1
 *   (b) Plan has no ## Validation section → TIER-LOCK VIOLATION, exit 1 (the
 *       Failure Gate mandate requires every active plan to carry a Validation
 *       section; run-locked-tier --dry-run exits non-zero for missing sections)
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
import { runTierLockDryRun } from "../lib/tier-lock-check.mjs";
import { VALIDATION_COMMANDS } from "../register-validation-commands.mjs";

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
 * @param {{ allowNoPlan?: boolean }} [opts]
 */
function runCheck(tier, planFile, opts = {}) {
  const env = { ...process.env };
  if (planFile !== undefined) {
    env.TASK_PLAN_FILE = planFile;
  } else {
    delete env.TASK_PLAN_FILE;
  }
  const extraArgs = opts.allowNoPlan ? ["--allow-no-plan"] : [];
  const res = spawnSync(
    process.execPath,
    [runTierScript, tier, "--check-tier-only", ...extraArgs],
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
  it("exits 1 with TIER-LOCK VIOLATION when --allow-no-plan is NOT passed", () => {
    // Task-driven invocations always have TASK_PLAN_FILE set.  When it is
    // missing and the caller has not explicitly opted out with --allow-no-plan,
    // run-tier.mjs must hard-error so agents cannot bypass tier enforcement
    // simply by omitting the env var.
    const result = runCheck("fast", undefined);
    assert.equal(
      result.status,
      1,
      `expected exit 1 (hard error) when TASK_PLAN_FILE is unset and --allow-no-plan absent, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("TIER-LOCK VIOLATION") && result.stderr.includes("TASK_PLAN_FILE"),
      `stderr should emit TIER-LOCK VIOLATION mentioning TASK_PLAN_FILE.\nstderr: ${result.stderr}`,
    );
  });

  it("warns and exits 0 when --allow-no-plan IS passed (opt-out for ad-hoc / non-task runs)", () => {
    // Non-task callers (ad-hoc developer runs, test-heavy-serial.mjs internal
    // preflight after stripping TASK_PLAN_FILE) pass --allow-no-plan to revert
    // to the old warn-and-continue behaviour.
    const result = runCheck("fast", undefined, { allowNoPlan: true });
    assert.equal(
      result.status,
      0,
      `expected exit 0 when TASK_PLAN_FILE is unset but --allow-no-plan is set, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("WARNING") && result.stderr.includes("TASK_PLAN_FILE"),
      `stderr should warn about missing TASK_PLAN_FILE.\nstderr: ${result.stderr}`,
    );
  });
});

describe("unparseable tier-lock output", () => {
  it("returns an explicit unparseable result for successful output without a resolved tier", () => {
    const result = runTierLockDryRun(join(sandbox, "plan-valid.md"), {
      spawn: () => ({ status: 0, stdout: "helper completed without a resolution\n", stderr: "" }),
    });
    assert.deepEqual(result, {
      kind: "unparseable",
      output: "helper completed without a resolution",
    });
  });
});

describe("registered validation entrypoints", () => {
  const tierCommands = VALIDATION_COMMANDS.filter(({ name }) => name.startsWith("test-"));

  it("contains only the four canonical task-locked tiers", () => {
    assert.deepEqual(
      tierCommands.map(({ name }) => name),
      ["test-fast", "test-standard", "test-standard-plus", "test-heavy"],
    );
  });

  for (const { name, command } of tierCommands) {
    it(`${name} remains fail-closed when TASK_PLAN_FILE is absent`, () => {
      assert.doesNotMatch(
        command,
        /--allow-no-plan/,
        "registered task entrypoints must not opt out of tier enforcement",
      );
    });
  }
});

// ── (b) Plan has no ## Validation section ───────────────────────────────────

describe("plan without ## Validation section", () => {
  it("exits 1 with TIER-LOCK VIOLATION (active plans must carry a Validation section)", () => {
    // The Failure Gate mandate requires every active plan file to contain a
    // ## Validation section. A plan without one cannot resolve to a tier, so
    // run-tier.mjs must hard-fail rather than silently run an arbitrary tier.
    // (Legacy pre-mandate plans in .local/tasks were bulk-backfilled, so this
    // no longer needs graceful degradation.)
    const planFile = writePlanWithoutValidation("plan-no-validation.md");
    const result = runCheck("standard", planFile);
    assert.equal(
      result.status,
      1,
      `expected exit 1 (TIER-LOCK VIOLATION) when plan has no ## Validation section, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("TIER-LOCK VIOLATION"),
      `stderr should contain TIER-LOCK VIOLATION.\nstderr: ${result.stderr}`,
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

  it("run-tier standard WITHOUT TASK_PLAN_FILE and WITH --allow-no-plan exits 0 (simulates preflight after env-var strip)", () => {
    // After the outer heavy-runner tier-lock check passes, test-heavy-serial
    // strips TASK_PLAN_FILE and passes --allow-no-plan before invoking the
    // internal standard preflight.  This test confirms that the stripped-env
    // call with --allow-no-plan is not blocked.
    const result = runCheck("standard", undefined, { allowNoPlan: true });
    assert.equal(
      result.status,
      0,
      `expected exit 0 when TASK_PLAN_FILE is absent (stripped env) + --allow-no-plan, got ${result.status}\nstderr: ${result.stderr}`,
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

  it("plan with no ## Validation section → exits 1 with TIER-LOCK VIOLATION", () => {
    // A plan file with NO ## Validation section cannot resolve to a tier.
    // Since the Failure Gate mandate (and the bulk backfill of legacy plans),
    // this is a hard violation — not graceful degradation; the section is
    // mandatory and check-failure-gate --fix-stub can auto-add it.
    const planFile = writePlanWithoutValidation("plan-no-val-mismatch.md");
    const result = runCheck("standard", planFile);
    assert.equal(
      result.status,
      1,
      `expected exit 1 (TIER-LOCK VIOLATION) for plan with no ## Validation section, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("TIER-LOCK VIOLATION"),
      `stderr should contain TIER-LOCK VIOLATION.\nstderr: ${result.stderr}`,
    );
  });
});
