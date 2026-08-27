import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wrapper = resolve(repoRoot, "scripts/run-with-timeout.mjs");
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const scriptsPackage = JSON.parse(readFileSync(resolve(repoRoot, "scripts/package.json"), "utf8"));
const budgets = JSON.parse(readFileSync(resolve(repoRoot, "tests/timeout-guard/budgets.json"), "utf8"));

function spawnWrapper(budget, args) {
  return spawn(process.execPath, [wrapper, budget, "--", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

test("unit entry points use dedicated timeout guards", () => {
  assert.match(rootPackage.scripts["test:unit"], /run-with-timeout\.mjs rootUnit/);
  assert.match(scriptsPackage.scripts["test:unit"], /run-with-timeout\.mjs scriptsUnit/);
  assert.match(
    scriptsPackage.scripts["test:unit"],
    /--test-concurrency=1/,
    "scripts unit tests must run serially so lock subprocess tests cannot overlap other script-test files",
  );
  assert.ok(budgets.rootUnit.runBudgetMs > 0);
  assert.ok(budgets.scriptsUnit.runBudgetMs > 0);
});

test("normal completion preserves the wrapped command exit code", async () => {
  const child = spawnWrapper("5000", ["node", "-e", "process.exit(7)"]);
  const result = await waitForExit(child);
  assert.equal(result.code, 7);
  assert.equal(result.signal, null);
});

test("budget breach remains exit 124", async () => {
  const child = spawnWrapper("50", ["node", "-e", "setTimeout(() => {}, 60000)"]);
  const result = await waitForExit(child);
  assert.equal(result.code, 124);
  assert.equal(result.signal, null);
});

test("interrupting an outer wrapper cleans up nested detached child groups", async () => {
  const markerDir = mkdtempSync(resolve(tmpdir(), "timeout-guard-test-"));
  const marker = resolve(markerDir, "child.pid");
  const outer = spawnWrapper("60000", [
    process.execPath,
    wrapper,
    "60000",
    "--",
    process.execPath,
    "-e",
    `require("fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setTimeout(() => {}, 60000)`,
  ]);
  let output = "";
  outer.stdout.on("data", (chunk) => { output += chunk; });
  outer.stderr.on("data", (chunk) => { output += chunk; });
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`nested child did not start: ${output}`));
    }, 15_000);
    const poll = setInterval(() => {
      if (existsSync(marker)) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolveReady();
      }
    }, 25);
  });

  outer.kill("SIGTERM");
  const result = await waitForExit(outer);
  assert.notEqual(result.code, 0);
  assert.ok(result.signal || result.code !== 0, "interrupted wrapper must exit non-successfully");

  const childPid = readFileSync(marker, "utf8").trim();
  // The nested wrapper and its long-lived child share the nested wrapper's
  // detached process group. A direct PID probe proves that group was cleaned.
  const probe = spawn("kill", ["-0", childPid]);
  const probeResult = await waitForExit(probe);
  rmSync(markerDir, { recursive: true, force: true });
  assert.notEqual(probeResult.code, 0, "nested detached child must be gone");
});