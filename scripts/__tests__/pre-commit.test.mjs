/**
 * Regression test for .githooks/pre-commit.
 *
 * Run:
 *   node --test scripts/__tests__/pre-commit.test.mjs
 *
 * The hook is exercised against a throwaway Git repository.  A temporary
 * `node` shim isolates the OpenAPI documentation generator from the real
 * checkout while delegating every other Node invocation to the real runtime.
 */
import test from "node:test";
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");
const hookPath = resolve(projectRoot, ".githooks", "pre-commit");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function git(cwd, args) {
  const result = run("git", args, { cwd });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  return result;
}

function createRepository(name) {
  const root = mkdtempSync(join(tmpdir(), `pre-commit-${name}-`));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "pre-commit-test@example.invalid"]);
  git(root, ["config", "user.name", "pre-commit test"]);
  writeFileSync(join(root, "tracked.txt"), "initial\n", "utf8");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-qm", "initial"]);
  return root;
}

function stageChange(root, relativePath, content) {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
  git(root, ["add", relativePath]);
}

function createNodeShim(root) {
  const shimDir = join(root, "bin");
  mkdirSync(shimDir);
  const shimPath = join(shimDir, "node");
  const quoteForShell = (value) => `'${value.replaceAll("'", "'\\''")}'`;

  writeFileSync(
    shimPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "scripts/generate-api-docs.mjs" ]; then',
      '  printf "docs-generator-called\\n" > "$HOOK_TEST_MARKER"',
      '  printf "generated-by-hook-test\\n" >> "$HOOK_TEST_README"',
      '  printf "generated-by-hook-test\\n" >> "$HOOK_TEST_REPLIT"',
      "  exit 0",
      "fi",
      `exec ${quoteForShell(process.execPath)} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(shimPath, 0o755);
  return shimDir;
}

function runHook(root, { taskPlanFile, nodeShimDir, docsHarness } = {}) {
  const gitDir = join(root, ".git");
  const env = {
    ...process.env,
    GIT_DIR: gitDir,
    GIT_WORK_TREE: root,
    PATH: nodeShimDir
      ? `${nodeShimDir}:${process.env.PATH ?? ""}`
      : process.env.PATH,
  };
  if (taskPlanFile) env.TASK_PLAN_FILE = taskPlanFile;
  else delete env.TASK_PLAN_FILE;
  if (docsHarness) {
    env.HOOK_TEST_MARKER = docsHarness.markerPath;
    env.HOOK_TEST_README = docsHarness.readmePath;
    env.HOOK_TEST_REPLIT = docsHarness.replitPath;
  }

  return run(hookPath, [], {
    cwd: projectRoot,
    env,
  });
}

test("no-task commits use the fast pass path", (t) => {
  const root = createRepository("no-task");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  stageChange(root, "ordinary-change.txt", "no task plan\n");

  const result = runHook(root);

  assert.equal(
    result.status,
    0,
    `expected hook to pass without TASK_PLAN_FILE\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  assert.match(result.stdout, /check-failure-gate — no TASK_PLAN_FILE set/);
  assert.match(result.stdout, /check-regression-guard — no TASK_PLAN_FILE set/);
});

test("an incomplete task plan rejects the commit and reports the failure gate", (t) => {
  const root = createRepository("invalid-plan");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  stageChange(root, "ordinary-change.txt", "incomplete plan\n");

  const planPath = join(root, "incomplete-task.md");
  writeFileSync(
    planPath,
    [
      "# Incomplete task",
      "",
      "## Validation",
      "**Command:** `test-standard`",
      "**Why:** <replace with one-line justification>",
      "**Do not escalate:** Run exactly this command.",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runHook(root, { taskPlanFile: planPath });

  assert.equal(
    result.status,
    1,
    `expected hook to reject an incomplete task plan\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  assert.match(result.stdout, /check-failure-gate — single-file mode/);
  assert.match(result.stdout, /incomplete-task\.md/);
  assert.match(result.stdout, /unfilled stub placeholder/);
});

test("an incomplete regression guard rejects the commit after the failure gate passes", (t) => {
  const root = createRepository("invalid-regression-guard");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  stageChange(root, "ordinary-change.txt", "invalid regression guard\n");

  const planPath = join(root, "invalid-regression-guard.md");
  writeFileSync(
    planPath,
    [
      "# Incomplete regression guard",
      "",
      "## Pre-existing failures to ignore",
      "None known at plan time. Treat every failure as a potential regression.",
      "",
      "## Validation",
      "**Command:** `test-fast`",
      "**Why:** This plan covers a static hook test.",
      "**Do not escalate:** Run exactly this command.",
      "",
      "## Regression Guard",
      "**N/A**",
      "**Why N/A:** <explain why this task is N/A>",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runHook(root, { taskPlanFile: planPath });

  assert.equal(
    result.status,
    1,
    `expected hook to reject an incomplete regression guard\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  assert.match(result.stdout, /check-regression-guard — single-file mode/);
  assert.match(result.stdout, /invalid-regression-guard\.md/);
  assert.match(result.stdout, /Why N\/A.*placeholder text/);
});

test("the OpenAPI staged-file path regenerates and stages both documentation files", (t) => {
  const root = createRepository("openapi");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "README.md"), "README before\n", "utf8");
  writeFileSync(join(root, "replit.md"), "replit before\n", "utf8");
  stageChange(root, "lib/api-spec/openapi.yaml", "openapi: 3.0.0\n");

  const shimRoot = mkdtempSync(join(tmpdir(), "pre-commit-node-shim-"));
  t.after(() => rmSync(shimRoot, { recursive: true, force: true }));
  const nodeShimDir = createNodeShim(shimRoot);
  const markerPath = join(shimRoot, "generator-called.txt");

  const result = runHook(root, {
    nodeShimDir,
    docsHarness: {
      markerPath,
      readmePath: join(root, "README.md"),
      replitPath: join(root, "replit.md"),
    },
  });

  assert.equal(
    result.status,
    0,
    `expected OpenAPI hook path to pass\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  assert.equal(readFileSync(markerPath, "utf8"), "docs-generator-called\n");
  assert.match(readFileSync(join(root, "README.md"), "utf8"), /generated-by-hook-test/);
  assert.match(readFileSync(join(root, "replit.md"), "utf8"), /generated-by-hook-test/);

  const staged = git(root, ["diff", "--cached", "--name-only"]).stdout
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(
    staged.sort(),
    ["README.md", "lib/api-spec/openapi.yaml", "replit.md"].sort(),
  );
  assert.match(result.stdout, /README\.md and replit\.md updated and staged/);
});