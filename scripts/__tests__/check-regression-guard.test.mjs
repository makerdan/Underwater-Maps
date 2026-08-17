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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
  const res = spawnSync("node", [scriptPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd,
    env: { ...process.env, ...env },
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
