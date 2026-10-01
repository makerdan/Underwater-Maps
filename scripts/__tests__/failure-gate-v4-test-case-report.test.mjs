import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import FailureGatePlaywrightReporter from "../failure-gate-v4/playwright-reporter.mjs";
import { parseNodeTap } from "../failure-gate-v4/node-tap-report.mjs";
import {
  loadTestCaseReports,
  stableTestCaseId,
  writeTestCaseReport,
} from "../failure-gate-v4/test-case-report.mjs";
import { createHash } from "node:crypto";
import FailureGateVitestReporter from "../failure-gate-v4/vitest-reporter.mjs";

async function makeDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "failure-gate-case-reports-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("Vitest configs omit the reporters property when Failure Gate reporting is disabled", async () => {
  const projectRoot = path.resolve(import.meta.dirname, "../..");
  const configs = [
    "artifacts/api-server/vitest.config.ts",
    "artifacts/api-server/vitest.config.validation.ts",
    "artifacts/bathyscan/vitest.config.ts",
    "artifacts/bathyscan/vitest.config.validation.ts",
    "lib/api-zod/vitest.config.ts",
    "lib/db/vitest.config.ts",
    "lib/poe/vitest.config.ts",
  ];
  for (const config of configs) {
    const source = await readFile(path.join(projectRoot, config), "utf8");
    assert.doesNotMatch(
      source,
      /reporters:\s*process\.env\.FAILURE_GATE_TEST_CASE_REPORT_DIR[\s\S]{0,500}?:\s*undefined,/,
      `${config} must not set reporters to undefined`,
    );
    assert.match(source, /\.\.\.\(process\.env\.FAILURE_GATE_TEST_CASE_REPORT_DIR/);
  }
});

test("Playwright config uses a config-relative custom reporter path", async () => {
  const projectRoot = path.resolve(import.meta.dirname, "../..");
  const source = await readFile(path.join(projectRoot, "playwright.config.ts"), "utf8");
  assert.match(source, /"\.\/scripts\/failure-gate-v4\/playwright-reporter\.mjs"/);
  assert.doesNotMatch(source, /fileURLToPath\(new URL\("\.\/scripts\/failure-gate-v4\/playwright-reporter\.mjs", import\.meta\.url\)\)/);
});

test("Playwright config loads with --list both with and without Failure Gate reporting", async (t) => {
  const projectRoot = path.resolve(import.meta.dirname, "../..");
  const outputDirectory = await makeDirectory(t);
  const cliPath = path.join(projectRoot, "node_modules/@playwright/test/cli.js");
  const listTests = (reportingEnabled) => {
    const env = {
      ...process.env,
      PW_E2E_PORT_SWEEP_DONE: "1",
    };
    delete env.E2E_REAL_CLERK;
    if (reportingEnabled) env.FAILURE_GATE_TEST_CASE_REPORT_DIR = outputDirectory;
    else delete env.FAILURE_GATE_TEST_CASE_REPORT_DIR;
    return spawnSync(process.execPath, [
      cliPath,
      "test",
      "--config=playwright.config.ts",
      "--list",
      "tests/e2e/api-liveness.setup.ts",
    ], {
      cwd: projectRoot,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
  };

  for (const reportingEnabled of [false, true]) {
    const result = listTests(reportingEnabled);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(
      result.status,
      0,
      `Playwright config failed to load with reporting ${reportingEnabled ? "enabled" : "disabled"}:\n${result.stderr}\n${result.stdout}`,
    );
    assert.match(result.stdout, /Listing tests:/);
    assert.match(result.stdout, /api-liveness\.setup\.ts/);
  }
});

test("Node TAP discovery matches the runner summary and preserves skipped results", () => {
  const output = [
    "TAP version 13",
    "# Subtest: passes",
    "ok 1 - passes",
    "# Subtest: is explicitly skipped",
    "ok 2 - is explicitly skipped # SKIP platform requirement",
    "1..2",
    "# tests 2",
    "# pass 1",
    "# fail 0",
    "# cancelled 0",
    "# skipped 1",
    "# todo 0",
  ].join("\n");
  const result = parseNodeTap(output);
  assert.equal(result.complete, true);
  assert.deepEqual(result.cases.map((entry) => entry.status), ["passed", "skipped"]);
  assert.notEqual(result.cases[0].id, result.cases[1].id);
});

test("Node TAP discovery counts nested test cases without counting suite summaries", () => {
  const output = [
    "TAP version 13",
    "ok 1 - unannotated case",
    "# Subtest: nested suite",
    "    # Subtest: passes",
    "    ok 1 - passes",
    "      ---",
    "      type: 'test'",
    "      ...",
    "    # Subtest: fails",
    "    not ok 2 - fails",
    "      ---",
    "      type: 'test'",
    "      ...",
    "    # Subtest: is explicitly skipped",
    "    ok 3 - is explicitly skipped # SKIP platform requirement",
    "      ---",
    "      type: 'test'",
    "      ...",
    "    1..3",
    "not ok 2 - nested suite",
    "  ---",
    "  type: 'suite'",
    "  ...",
    "ok 3 - deferred case # TODO waiting for upstream fix",
    "  ---",
    "  type: 'test'",
    "  ...",
    "1..3",
    "# tests 5",
    "# pass 2",
    "# fail 1",
    "# cancelled 0",
    "# skipped 1",
    "# todo 1",
  ].join("\n");
  const result = parseNodeTap(output);
  assert.equal(result.complete, true);
  assert.equal(result.tests, 5);
  assert.deepEqual(result.cases.map((entry) => entry.status), [
    "passed",
    "passed",
    "failed",
    "skipped",
    "skipped",
  ]);
  assert.deepEqual(result.cases.map((entry) => entry.title), [
    "unannotated case",
    "passes",
    "fails",
    "is explicitly skipped",
    "deferred case",
  ]);
  assert.equal(new Set(result.cases.map((entry) => entry.id)).size, 5);
});

test("Node TAP discovery is incomplete when report totals omit a result", () => {
  const result = parseNodeTap([
    "TAP version 13",
    "ok 1 - first",
    "1..2",
    "# tests 2",
    "# pass 2",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
  ].join("\n"));
  assert.equal(result.complete, false);
});

test("Vitest reporter writes actual discovered case outcomes with a digestable report", async (t) => {
  const outputDirectory = await makeDirectory(t);
  const reporter = new FailureGateVitestReporter({ outputDirectory, suite: "fixture-unit" });
  const testCase = {
    fullName: "group › passes",
    location: { line: 12, column: 4 },
    result: () => ({ state: "passed" }),
  };
  const module = {
    moduleId: path.join(process.cwd(), "tests", "fixture.test.ts"),
    children: { allTests: () => [testCase] },
  };
  await reporter.onTestRunEnd([module], [], "passed");
  const loaded = await loadTestCaseReports(outputDirectory);
  assert.equal(loaded.available, true);
  assert.equal(loaded.allPassed, true);
  assert.equal(loaded.caseCount, 1);
  assert.equal(loaded.reports[0].report.cases[0].title, "group › passes");
  assert.match(loaded.reports[0].digest, /^[0-9a-f]{64}$/);
});

test("Vitest skipped cases are retained but cannot count as all passed", async (t) => {
  const outputDirectory = await makeDirectory(t);
  const reporter = new FailureGateVitestReporter({ outputDirectory, suite: "fixture-unit" });
  await reporter.onTestRunEnd([{
    moduleId: "tests/fixture.test.ts",
    children: { allTests: () => [{
      fullName: "group › skipped",
      location: { line: 8, column: 1 },
      result: () => ({ state: "skipped" }),
    }] },
  }], [], "passed");
  const loaded = await loadTestCaseReports(outputDirectory);
  assert.equal(loaded.available, true);
  assert.equal(loaded.allPassed, false);
  assert.equal(loaded.counts.skipped, 1);
});

test("Vitest does not accept a final pass when its result retains retry errors", async (t) => {
  const outputDirectory = await makeDirectory(t);
  const reporter = new FailureGateVitestReporter({ outputDirectory, suite: "fixture-unit" });
  await reporter.onTestRunEnd([{
    moduleId: "tests/fixture.test.ts",
    children: { allTests: () => [{
      fullName: "group › retries after failure",
      location: { line: 16, column: 2 },
      result: () => ({ state: "passed", errors: [{ message: "first attempt failed" }] }),
    }] },
  }], [], "passed");
  const loaded = await loadTestCaseReports(outputDirectory);
  assert.equal(loaded.available, false);
  assert.equal(loaded.allPassed, false);
  assert.equal(loaded.reports[0].report.cases[0].status, "unknown");
  assert.equal(loaded.reports[0].report.cases[0].reportedStatus, "passed");
  assert.equal(loaded.reports[0].report.cases[0].errorCount, 1);
});

test("Playwright reporter retains retry outcomes and does not call a flaky case all passed", async (t) => {
  const outputDirectory = await makeDirectory(t);
  const reporter = new FailureGatePlaywrightReporter({ outputDirectory, suite: "fixture-e2e" });
  const playwrightTest = {
    id: "project-file-line-title",
    title: "renders the panel",
    titlePath: () => ["chromium", "panel.spec.ts", "renders the panel"],
    location: { file: path.join(process.cwd(), "tests/e2e/panel.spec.ts"), line: 9 },
    expectedStatus: "passed",
  };
  reporter.onBegin({}, { allTests: () => [playwrightTest] });
  reporter.onTestEnd(playwrightTest, { status: "failed", retry: 0 });
  reporter.onTestEnd(playwrightTest, { status: "passed", retry: 1 });
  await reporter.onEnd({ status: "passed" });
  const loaded = await loadTestCaseReports(outputDirectory);
  assert.equal(loaded.available, true);
  assert.equal(loaded.allPassed, false);
  assert.equal(loaded.reports[0].report.cases[0].title, "chromium › panel.spec.ts › renders the panel");
  assert.deepEqual(
    loaded.reports[0].report.cases[0].attempts.map((attempt) => attempt.rawStatus),
    ["failed", "passed"],
  );
});

test("raw Node TAP is digest-checked and unreferenced files invalidate discovery", async (t) => {
  const outputDirectory = await makeDirectory(t);
  const rawReport = "TAP version 13\n# tests 1\n";
  const rawReference = "node-tap-fixture.tap";
  await writeFile(path.join(outputDirectory, rawReference), rawReport, { mode: 0o600 });
  await writeTestCaseReport({
    outputDirectory,
    engine: "node-test",
    suite: "fixture",
    outcome: "passed",
    complete: true,
    rawReport: {
      reference: rawReference,
      digest: createHash("sha256").update(rawReport).digest("hex"),
    },
    cases: [{
      id: stableTestCaseId({
        engine: "node-test",
        suite: "fixture",
        source: "node:test/1",
        title: "one",
      }),
      source: "node:test/1",
      title: "one",
      line: null,
      status: "passed",
    }],
  });
  const legacyLoaded = await loadTestCaseReports(outputDirectory);
  assert.equal(legacyLoaded.available, true);
  assert.equal(legacyLoaded.allPassed, false);
  await writeFile(path.join(outputDirectory, rawReference), `${rawReport}tampered`);
  await assert.rejects(loadTestCaseReports(outputDirectory), /raw report is unsafe/);
  await writeFile(path.join(outputDirectory, rawReference), rawReport);
  await writeFile(path.join(outputDirectory, "unreferenced.tap"), "unknown");
  await assert.rejects(loadTestCaseReports(outputDirectory), /unreferenced file/);
  assert.equal((await readdir(outputDirectory)).length, 3);
});