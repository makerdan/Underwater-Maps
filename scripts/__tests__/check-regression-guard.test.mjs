/**
 * Self-test for scripts/check-regression-guard.mjs
 *
 * Run via:  node --test scripts/__tests__/check-regression-guard.test.mjs
 * (wired into the `check:regression-guard` npm script so it runs alongside
 * the runtime check, matching the pattern of `check:skip-count` and
 * `check:testdb-schema-drift`.)
 *
 * Covers every compliance branch:
 *   (A) Self-satisfying declaration → passes
 *   (B) Valid N/A (Why N/A filled)  → passes
 *   (C) N/A without Why N/A line    → fails
 *   (D) Why N/A with placeholder    → fails
 *   (E) Filled template             → passes
 *   (F) Template with placeholder   → fails
 *   (G) Missing section, strict     → fails
 *   (H) Missing section, --stubs-only → passes (grandfathered)
 *
 * The script resolves TASKS_DIR as ".local/tasks" relative to cwd, so every
 * test points spawnSync's cwd at a fresh sandbox that contains that subtree.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "..", "check-regression-guard.mjs");

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "reg-guard-test-"));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh cwd with an empty .local/tasks directory. */
function makeTasksDir(name) {
  const dir = join(sandbox, name);
  mkdirSync(join(dir, ".local", "tasks"), { recursive: true });
  return dir;
}

/** Write a plan file into <dir>/.local/tasks/<filename>. */
function writePlan(dir, filename, content) {
  writeFileSync(join(dir, ".local", "tasks", filename), content);
}

/** Run the script with the given cwd, optional extra args, and optional env overrides. */
function run(cwd, args = [], env = {}) {
  // Scrub TASK_PLAN_FILE from the inherited environment so fixture-directory
  // tests are never forced into single-file mode by the parent task-agent
  // environment. Tests that need single-file mode pass the var via env.
  const { TASK_PLAN_FILE: _scrubbed, ...baseEnv } = process.env;
  const res = spawnSync("node", [scriptPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd,
    env: { ...baseEnv, ...env },
  });
  return {
    status: res.status,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

/** Wrap a Regression Guard section body in a minimal plan file. */
function planWith(sectionBody) {
  return `# Task Plan\n\nSome task description.\n\n## Regression Guard\n${sectionBody}\n## Next Steps\n\nFoo.\n`;
}

// ---------------------------------------------------------------------------
// (A) Self-satisfying declaration → passes
// ---------------------------------------------------------------------------

describe("self-satisfying declaration", () => {
  it("passes when **Self-satisfying** is present", () => {
    const dir = makeTasksDir("self-satisfying");
    writePlan(dir, "task-a.md", planWith("**Self-satisfying** — this task adds the tests.\n"));

    const result = run(dir);
    assert.equal(
      result.status,
      0,
      `expected exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("fails when **Self-satisfying** has no description", () => {
    const dir = makeTasksDir("self-satisfying-bare");
    writePlan(dir, "task-a-bare.md", planWith("**Self-satisfying**\n"));

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected bare marker to fail\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (B) Valid N/A (Why N/A filled) → passes
// ---------------------------------------------------------------------------

describe("valid N/A declaration", () => {
  it("passes when **N/A** + filled **Why N/A:** are present", () => {
    const dir = makeTasksDir("valid-na");
    writePlan(
      dir,
      "task-b.md",
      planWith(
        "**N/A**\n**Why N/A:** This task only changes documentation; no code path is affected.\n",
      ),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      0,
      `expected exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (C) N/A without Why N/A → fails
// ---------------------------------------------------------------------------

describe("N/A without Why N/A", () => {
  it("fails when **N/A** is present but **Why N/A:** line is missing", () => {
    const dir = makeTasksDir("na-no-why");
    writePlan(dir, "task-c.md", planWith("**N/A**\n"));

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("Why N/A") || result.stdout.includes("Why N/A"),
      `output should mention the missing Why N/A line\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (D) Why N/A with placeholder text → fails
// ---------------------------------------------------------------------------

describe("Why N/A with placeholder text", () => {
  it("fails when **Why N/A:** contains an angle-bracket placeholder", () => {
    const dir = makeTasksDir("na-placeholder-angle");
    writePlan(
      dir,
      "task-d1.md",
      planWith("**N/A**\n**Why N/A:** <explain why this task is N/A>\n"),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for <...> placeholder\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("fails when **Why N/A:** contains 'TBD'", () => {
    const dir = makeTasksDir("na-placeholder-tbd");
    writePlan(dir, "task-d2.md", planWith("**N/A**\n**Why N/A:** TBD\n"));

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for TBD placeholder\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("fails when **Why N/A:** contains 'FILL IN'", () => {
    const dir = makeTasksDir("na-placeholder-fillin");
    writePlan(dir, "task-d3.md", planWith("**N/A**\n**Why N/A:** fill in the reason here\n"));

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for FILL IN placeholder\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("fails when **Why N/A:** contains only a placeholder dash", () => {
    const dir = makeTasksDir("na-placeholder-dash");
    writePlan(dir, "task-d4.md", planWith("**N/A**\n**Why N/A:** -\n"));

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected short N/A reason to fail\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("passes when **Why N/A:** has a specific multi-word reason", () => {
    const dir = makeTasksDir("na-valid-long-reason");
    writePlan(
      dir,
      "task-d5.md",
      planWith("**N/A**\n**Why N/A:** The fix removes the feature entirely.\n"),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      0,
      `expected meaningful N/A reason to pass\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Indented section headings must terminate the Regression Guard section.
// ---------------------------------------------------------------------------

describe("section boundary detection", () => {
  it("stops at an indented ## heading", () => {
    const dir = makeTasksDir("indented-section-boundary");
    writePlan(
      dir,
      "task-indented-heading.md",
      "# Task Plan\n\n## Regression Guard\n**N/A**\n  ## Steps\n**Why N/A:** -\n",
    );

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected indented heading to end the section and expose missing Why N/A\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (E) Filled template (all three fields non-placeholder) → passes
// ---------------------------------------------------------------------------

describe("filled template", () => {
  it("passes when all three required fields are present and non-placeholder", () => {
    const dir = makeTasksDir("filled-template");
    writePlan(
      dir,
      "task-e.md",
      planWith(
        "**Covers:** the upload-retry path in uploadService.ts\n" +
          "**Test location:** artifacts/bathyscan/src/__tests__/uploadService.test.ts\n" +
          "**What it checks:** retries on transient 503, succeeds on the second attempt\n",
      ),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      0,
      `expected exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (F) Template with a placeholder in one field → fails
// ---------------------------------------------------------------------------

describe("template with a placeholder in one field", () => {
  it("fails when **Covers:** has a placeholder value", () => {
    const dir = makeTasksDir("template-placeholder-covers");
    writePlan(
      dir,
      "task-f1.md",
      planWith(
        "**Covers:** <describe what code path this covers>\n" +
          "**Test location:** artifacts/api-server/src/__tests__/foo.test.ts\n" +
          "**What it checks:** returns 200 on valid input\n",
      ),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for placeholder in Covers\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("**Covers:**") || result.stdout.includes("**Covers:**"),
      `output should name the offending field\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  });

  it("fails when **Test location:** is missing entirely", () => {
    const dir = makeTasksDir("template-missing-location");
    writePlan(
      dir,
      "task-f2.md",
      planWith(
        "**Covers:** the login flow in authService.ts\n" +
          "**What it checks:** returns 401 for expired tokens\n",
      ),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for missing Test location\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("**Test location:**") ||
        result.stdout.includes("**Test location:**"),
      `output should name the missing field\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  });

  it("fails when **What it checks:** has a TBD value", () => {
    const dir = makeTasksDir("template-placeholder-what");
    writePlan(
      dir,
      "task-f3.md",
      planWith(
        "**Covers:** the cache invalidation path\n" +
          "**Test location:** artifacts/api-server/src/__tests__/cache.test.ts\n" +
          "**What it checks:** TBD\n",
      ),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for TBD in What it checks\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (G) Missing section, strict mode → fails
// ---------------------------------------------------------------------------

describe("missing section — strict mode", () => {
  it("exits 1 when the plan has no ## Regression Guard section (default strict mode)", () => {
    const dir = makeTasksDir("missing-section-strict");
    writePlan(
      dir,
      "task-g.md",
      "# Task Plan\n\nSome description.\n\n## Validation\n\n- Run tests.\n",
    );

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("missing ## Regression Guard") ||
        result.stdout.includes("missing ## Regression Guard"),
      `output should mention the missing section\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (H) Missing section, --stubs-only mode → passes (grandfathered)
// ---------------------------------------------------------------------------

describe("missing section — --stubs-only mode", () => {
  it("exits 0 and treats missing section as compliant when --stubs-only is set", () => {
    const dir = makeTasksDir("missing-section-stubs-only");
    writePlan(
      dir,
      "task-h.md",
      "# Task Plan\n\nSome description without a Regression Guard section.\n",
    );

    const result = run(dir, ["--stubs-only"]);
    assert.equal(
      result.status,
      0,
      `expected exit 0 under --stubs-only, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("--stubs-only still fails on placeholder text in an existing section", () => {
    const dir = makeTasksDir("stubs-only-placeholder");
    writePlan(
      dir,
      "task-h2.md",
      planWith("**N/A**\n**Why N/A:** <fill in reason>\n"),
    );

    const result = run(dir, ["--stubs-only"]);
    assert.equal(
      result.status,
      1,
      `expected exit 1 (placeholder in existing section should still fail under --stubs-only)\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Multi-file: mix of compliant and non-compliant → exit 1, names only bad file
// ---------------------------------------------------------------------------

describe("multi-file mixed compliance", () => {
  it("fails and names only the non-compliant file when files are mixed", () => {
    const dir = makeTasksDir("multi-file-mixed");
    writePlan(
      dir,
      "good.md",
      planWith("**Self-satisfying** — this task adds the guard test.\n"),
    );
    writePlan(dir, "bad.md", planWith("**N/A**\n"));

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("bad.md"),
      `output should name the non-compliant file\n${output}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Empty tasks directory → exit 0 (nothing to check)
// ---------------------------------------------------------------------------

describe("empty tasks directory", () => {
  it("exits 0 with a 'nothing to check' message when no .md files are present", () => {
    const dir = makeTasksDir("empty-tasks");

    const result = run(dir);
    assert.equal(
      result.status,
      0,
      `expected exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes("Nothing to check") || result.stdout.includes("nothing to check"),
      `stdout should say nothing to check\nstdout: ${result.stdout}`,
    );
  });
});

// ---------------------------------------------------------------------------
// TASK_PLAN_FILE scoping
// ---------------------------------------------------------------------------

describe("TASK_PLAN_FILE scoping", () => {
  it("exits 0 when TASK_PLAN_FILE is compliant, even if archive has non-compliant files", () => {
    const dir = makeTasksDir("scope-compliant");
    // Compliant target file — write it into a separate location so we can
    // point TASK_PLAN_FILE at it directly.
    const targetPath = join(dir, ".local", "tasks", "task-target.md");
    writePlan(dir, "task-target.md", planWith("**Self-satisfying** — this task adds the tests.\n"));
    // Non-compliant archive file.
    writePlan(dir, "task-bad.md", planWith("**N/A**\n")); // missing Why N/A

    const result = run(dir, [], { TASK_PLAN_FILE: targetPath });
    assert.equal(
      result.status,
      0,
      `expected exit 0 (archive ignored in single-file mode)\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("exits 1 when TASK_PLAN_FILE is non-compliant (archive is empty)", () => {
    const dir = makeTasksDir("scope-noncompliant");
    const targetPath = join(dir, ".local", "tasks", "task-bad.md");
    writePlan(dir, "task-bad.md", planWith("**N/A**\n")); // missing Why N/A

    const result = run(dir, [], { TASK_PLAN_FILE: targetPath });
    assert.equal(
      result.status,
      1,
      `expected exit 1 for non-compliant TASK_PLAN_FILE\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("exits 1 when TASK_PLAN_FILE does not end in .md", () => {
    const dir = makeTasksDir("scope-not-md");
    const targetPath = join(dir, ".local", "tasks", "task-plan.txt");

    const result = run(dir, [], { TASK_PLAN_FILE: targetPath });
    assert.equal(
      result.status,
      1,
      `expected exit 1 for non-.md TASK_PLAN_FILE\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("not a .md file"),
      `stderr should mention the .md requirement\nstderr: ${result.stderr}`,
    );
  });

  it("exits 1 when TASK_PLAN_FILE path does not exist", () => {
    const dir = makeTasksDir("scope-missing-file");
    const targetPath = join(dir, ".local", "tasks", "nonexistent.md");

    const result = run(dir, [], { TASK_PLAN_FILE: targetPath });
    assert.equal(
      result.status,
      1,
      `expected exit 1 for missing TASK_PLAN_FILE\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("does not exist"),
      `stderr should mention the missing file\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Angle-bracket in mixed content — placeholder tightening
// ---------------------------------------------------------------------------

describe("angle-bracket in mixed content", () => {
  it("passes when **What it checks:** contains JSX-like content alongside real text", () => {
    const dir = makeTasksDir("mixed-angle-pass");
    writePlan(
      dir,
      "task-mixed-pass.md",
      planWith(
        "**Covers:** the render path in TerrainMesh.tsx\n" +
          "**Test location:** artifacts/bathyscan/src/__tests__/TerrainMesh.test.tsx\n" +
          "**What it checks:** renders <MyComponent /> without crashing\n",
      ),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      0,
      `expected exit 0 for mixed angle-bracket content\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("passes when **Why N/A:** contains an angle-bracket in a sentence", () => {
    const dir = makeTasksDir("mixed-angle-na-pass");
    writePlan(
      dir,
      "task-mixed-na-pass.md",
      planWith(
        "**N/A**\n**Why N/A:** No code path uses <color attach=\"background\"> in this task.\n",
      ),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      0,
      `expected exit 0 for angle-bracket embedded in sentence\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("fails when **What it checks:** is purely a placeholder token like <describe this>", () => {
    const dir = makeTasksDir("mixed-angle-fail");
    writePlan(
      dir,
      "task-mixed-fail.md",
      planWith(
        "**Covers:** the render path in TerrainMesh.tsx\n" +
          "**Test location:** artifacts/bathyscan/src/__tests__/TerrainMesh.test.tsx\n" +
          "**What it checks:** <describe this>\n",
      ),
    );

    const result = run(dir);
    assert.equal(
      result.status,
      1,
      `expected exit 1 for whole-token angle-bracket placeholder\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end pipeline: --fix-stub → strict
// ---------------------------------------------------------------------------

describe("end-to-end pipeline: --fix-stub then strict", () => {
  let e2eDir;
  let e2eTasksDir;

  // File names for the three synthetic plans
  const MISSING_SECTION = "e2e-rg-missing-section.md";
  const PLACEHOLDER_COVERS = "e2e-rg-placeholder-covers.md";
  const COMPLIANT = "e2e-rg-compliant.md";

  before(() => {
    e2eDir = mkdtempSync(join(tmpdir(), "crg-e2e-"));
    e2eTasksDir = join(e2eDir, ".local", "tasks");
    mkdirSync(e2eTasksDir, { recursive: true });

    // (1) Plan with no ## Regression Guard section at all
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

    // (2) Plan with ## Regression Guard but **Covers:** is a placeholder
    //     — fix-stub must NOT touch this (section already exists); it must
    //     remain a strict-mode violation after the pipeline runs.
    writeFileSync(
      join(e2eTasksDir, PLACEHOLDER_COVERS),
      [
        "# Task with Placeholder Covers",
        "",
        "## Regression Guard",
        "**Covers:** <describe what code path this covers>",
        "**Test location:** artifacts/api-server/src/__tests__/foo.test.ts",
        "**What it checks:** returns 200 on valid input",
      ].join("\n"),
      "utf8",
    );

    // (3) Fully compliant plan
    writeFileSync(
      join(e2eTasksDir, COMPLIANT),
      [
        "# Fully Compliant Task",
        "",
        "## Regression Guard",
        "**Self-satisfying** — this task adds the Regression Guard self-test coverage.",
      ].join("\n"),
      "utf8",
    );
  });

  after(() => {
    rmSync(e2eDir, { recursive: true, force: true });
  });

  it("--fix-stub exits 0", () => {
    const result = run(e2eDir, ["--fix-stub"]);
    assert.equal(
      result.status,
      0,
      `expected --fix-stub to exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("after --fix-stub the missing-section file contains ## Regression Guard", () => {
    // Run fix-stub (idempotent if already run in previous test)
    run(e2eDir, ["--fix-stub"]);

    const content = readFileSync(join(e2eTasksDir, MISSING_SECTION), "utf8");
    assert.ok(
      content.includes("## Regression Guard"),
      `expected ${MISSING_SECTION} to contain ## Regression Guard after --fix-stub\ncontent: ${content}`,
    );
  });

  it("strict check exits 1 (placeholder-covers violation remains after --fix-stub)", () => {
    run(e2eDir, ["--fix-stub"]);
    const result = run(e2eDir);
    assert.equal(
      result.status,
      1,
      `expected strict check to exit 1 after --fix-stub, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("strict check reports the placeholder-covers file as a violation", () => {
    run(e2eDir, ["--fix-stub"]);
    const result = run(e2eDir);
    assert.ok(
      result.stdout.includes(PLACEHOLDER_COVERS),
      `expected ${PLACEHOLDER_COVERS} to appear in violations output\nstdout: ${result.stdout}`,
    );
    assert.ok(
      result.stdout.includes("✗"),
      `expected at least one ✗ violation in output\nstdout: ${result.stdout}`,
    );
  });

  it("strict check does NOT report the patched missing-section file as a violation", () => {
    run(e2eDir, ["--fix-stub"]);
    const result = run(e2eDir);
    const lines = result.stdout.split("\n");
    const violationLine = lines.find(
      (l) => l.includes("✗") && l.includes(MISSING_SECTION),
    );
    assert.ok(
      !violationLine,
      `expected ${MISSING_SECTION} (patched by --fix-stub) to NOT be marked ✗\nline: ${violationLine}\nstdout: ${result.stdout}`,
    );
  });

  it("strict check does NOT report the fully compliant file as a violation", () => {
    run(e2eDir, ["--fix-stub"]);
    const result = run(e2eDir);
    // The compliant file should not appear in the ✗ lines
    const lines = result.stdout.split("\n");
    const violationLine = lines.find(
      (l) => l.includes("✗") && l.includes(COMPLIANT),
    );
    assert.ok(
      !violationLine,
      `expected ${COMPLIANT} to NOT be marked ✗ (violation)\nline: ${violationLine}\nstdout: ${result.stdout}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (K) --fix-stub on an already-compliant plan → no mutation, no misleading
//     "stub inserted" output (Task 4219 / #4196)
// ---------------------------------------------------------------------------

describe("--fix-stub idempotency on a fully-filled plan", () => {
  it("leaves the file untouched, exits 0, and does not claim a stub was inserted", () => {
    const dir = makeTasksDir("fixstub-idempotent");
    const planPath = join(dir, ".local", "tasks", "task-clean.md");
    writePlan(
      dir,
      "task-clean.md",
      planWith(
        "**Covers:** the upload-retry path in uploadService.ts\n" +
          "**Test location:** artifacts/bathyscan/src/__tests__/uploadService.test.ts\n" +
          "**What it checks:** retries on transient 503, succeeds on the second attempt\n",
      ),
    );
    const fileBefore = readFileSync(planPath, "utf8");

    const result = run(dir, ["--fix-stub"]);

    assert.equal(
      result.status,
      0,
      `expected exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // (a) the plan file must not be modified
    const fileAfter = readFileSync(planPath, "utf8");
    assert.equal(fileAfter, fileBefore, "plan file must not be mutated by --fix-stub");
    // (c) output must not mislead about work performed
    assert.ok(
      !/stubs? inserted/i.test(result.stdout),
      `stdout must not claim a stub was inserted\nstdout: ${result.stdout}`,
    );
    assert.ok(
      !result.stdout.includes("patched"),
      `stdout must not claim the file was patched\nstdout: ${result.stdout}`,
    );
  });
});

// ---------------------------------------------------------------------------
// --fix-stub must fail when a plan cannot be read.
// ---------------------------------------------------------------------------

describe("--fix-stub unreadable plans", () => {
  it("exits non-zero and names a plan that cannot be read", () => {
    const dir = makeTasksDir("fixstub-unreadable");
    // A directory with an .md suffix is returned by readdir but readFile()
    // rejects it with EISDIR on every supported test platform, including root.
    mkdirSync(join(dir, ".local", "tasks", "unreadable.md"));

    const result = run(dir, ["--fix-stub"]);
    assert.equal(
      result.status,
      1,
      `expected --fix-stub to fail for unreadable plan\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.ok(
      (result.stdout + result.stderr).includes("unreadable.md"),
      `diagnostic should name the unreadable plan\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});
