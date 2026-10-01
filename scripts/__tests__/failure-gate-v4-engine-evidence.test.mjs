import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import {
  createEngineEvidence,
  engineCaseId,
  engineEnvironment,
  resolveCaseObservation,
  verifyTestCaseReportBinding,
  writeEngineEvidenceReport,
} from "../failure-gate-v4/engine-evidence.mjs";
import { loadTestCaseReports } from "../failure-gate-v4/test-case-report.mjs";

async function makeDirectory(t) {
  await mkdir(path.join(process.cwd(), "tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(process.cwd(), "tmp", "engine-evidence-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function vitestEvidence({ message = "assertion failed", complete = true } = {}) {
  return createEngineEvidence({
    engine: "vitest",
    suite: "fixture-unit",
    step: "test:unit",
    outcome: "passed",
    complete,
    environment: engineEnvironment("vitest", "3.2.7"),
    reportedCaseCount: 2,
    cases: [
      {
        source: "tests/example.test.ts",
        title: "group › fails",
        line: 10,
        column: 2,
        status: "failed",
        rawStatus: "failed",
        expectedStatus: "",
        errors: [{ name: "AssertionError", message }],
        attempts: [],
      },
      {
        source: "tests/example.test.ts",
        title: "group › passes",
        line: 20,
        column: 3,
        status: "passed",
        rawStatus: "passed",
        expectedStatus: "",
        errors: [],
        attempts: [],
      },
    ],
  });
}

test("v2 engine evidence binds raw bytes and recomputes identities, signatures, step, and environment", async (t) => {
  const outputDirectory = await makeDirectory(t);
  const evidence = vitestEvidence({ message: "assertion failed token=secret-token-value" });
  const reportPath = await writeEngineEvidenceReport({ outputDirectory, evidence });
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const rawBytes = await readFile(path.join(outputDirectory, report.rawReport.reference));
  assert.equal(report.rawReport.reference.endsWith(".engine"), true);
  assert.equal(verifyTestCaseReportBinding({ report, rawReportBytes: rawBytes }), true);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.environment.nodeMajor, 24);
  assert.equal(report.environment.engineVersion, "3.2.7");
  assert.equal(report.step, "test:unit");
  assert.equal(rawBytes.includes(Buffer.from("secret-token-value")), false);
  assert.match(report.cases[0].failureSignature, /^[0-9a-f]{64}$/);
  const passingObservation = resolveCaseObservation({ report, entry: report.cases[1] });
  assert.equal(passingObservation.failureSignature, null);
  assert.equal(passingObservation.step, "test:unit");
  assert.equal(resolveCaseObservation({ report, entry: report.cases[0] }).failureSignature, report.cases[0].failureSignature);

  const forgedCase = structuredClone(report);
  forgedCase.cases[0].failureSignature = "0".repeat(64);
  assert.throws(() => verifyTestCaseReportBinding({ report: forgedCase, rawReportBytes: rawBytes }), /does not match/);
  assert.equal(resolveCaseObservation({ report: forgedCase, entry: forgedCase.cases[1] }), null);

  const forgedEnvironment = structuredClone(report);
  forgedEnvironment.environment.engineVersion = "3.2.6";
  assert.throws(() => verifyTestCaseReportBinding({ report: forgedEnvironment, rawReportBytes: rawBytes }), /does not match/);

  const forgedStep = structuredClone(report);
  forgedStep.step = "e2e-palette";
  assert.throws(() => verifyTestCaseReportBinding({ report: forgedStep, rawReportBytes: rawBytes }), /does not match/);

  const forgedDescriptor = structuredClone(report);
  forgedDescriptor.rawReport.reference = "../outside.engine";
  assert.throws(() => verifyTestCaseReportBinding({ report: forgedDescriptor, rawReportBytes: rawBytes }), /binding/);
  const jsonRawDescriptor = structuredClone(report);
  jsonRawDescriptor.rawReport.reference = "raw-engine.json";
  assert.throws(() => verifyTestCaseReportBinding({ report: jsonRawDescriptor, rawReportBytes: rawBytes }), /binding/);

  const changedRawBytes = Buffer.from(`${rawBytes.toString("utf8")} `);
  assert.throws(() => verifyTestCaseReportBinding({ report, rawReportBytes: changedRawBytes }), /digest/);

  const forgedMaterialized = structuredClone(report);
  forgedMaterialized.cases[0].status = "passed";
  assert.throws(() => verifyTestCaseReportBinding({ report: forgedMaterialized, rawReportBytes: rawBytes }), /does not match/);
});

test("engine identity excludes line and order, includes source and full title, and signatures use actual redacted errors", async (t) => {
  const first = engineCaseId({
    engine: "vitest",
    suite: "unit",
    source: "src/a.test.ts",
    title: "group › case",
  });
  assert.equal(first, engineCaseId({
    engine: "vitest",
    suite: "unit",
    source: "src/a.test.ts",
    title: "group › case",
  }));
  assert.notEqual(first, engineCaseId({
    engine: "vitest",
    suite: "unit",
    source: "src/b.test.ts",
    title: "group › case",
  }));
  assert.notEqual(first, engineCaseId({
    engine: "vitest",
    suite: "unit",
    source: "src/a.test.ts",
    title: "other group › case",
  }));
  const a = vitestEvidence({ message: "first actual assertion" });
  const b = vitestEvidence({ message: "changed actual assertion" });
  assert.notEqual(a.cases[0].errors[0].message, b.cases[0].errors[0].message);
  const outputDirectory = await makeDirectory(t);
  const aPath = await writeEngineEvidenceReport({ outputDirectory, evidence: a });
  const bPath = await writeEngineEvidenceReport({ outputDirectory, evidence: b });
  const aReport = JSON.parse(await readFile(aPath, "utf8"));
  const bReport = JSON.parse(await readFile(bPath, "utf8"));
  assert.notEqual(aReport.cases[0].failureSignature, bReport.cases[0].failureSignature);
  const idWithLocation = engineCaseId({
    engine: "vitest",
    suite: "fixture-unit",
    source: a.cases[0].source,
    title: a.cases[0].title,
  });
  const movedCaseId = engineCaseId({
    engine: "vitest",
    suite: "fixture-unit",
    source: "tests/example.test.ts",
    title: "group › fails",
  });
  assert.equal(idWithLocation, movedCaseId);
});

test("duplicate source/full-title identities are retained as incomplete, not passed", () => {
  const evidence = createEngineEvidence({
    engine: "vitest",
    suite: "fixture-unit",
    step: "test:unit",
    outcome: "passed",
    complete: true,
    environment: engineEnvironment("vitest", "3.2.7"),
    reportedCaseCount: 2,
    cases: [1, 2].map(() => ({
      source: "tests/example.test.ts",
      title: "same full title",
      status: "passed",
      rawStatus: "passed",
    })),
  });
  assert.equal(evidence.complete, false);
});

test("Playwright expected failures and skips never materialize as passing cases", () => {
  const evidence = createEngineEvidence({
    engine: "playwright",
    suite: "fixture-e2e",
    step: "test:e2e",
    outcome: "passed",
    complete: true,
    environment: engineEnvironment("playwright", "1.60.0"),
    reportedCaseCount: 2,
    cases: [
      {
        source: "tests/panel.spec.ts",
        title: "chromium › expected failure",
        status: "passed",
        rawStatus: "passed",
        expectedStatus: "failed",
        errors: [],
      },
      {
        source: "tests/panel.spec.ts",
        title: "chromium › skipped",
        status: "skipped",
        rawStatus: "skipped",
        expectedStatus: "passed",
        errors: [],
      },
    ],
  });
  assert.equal(evidence.cases[0].status, "failed");
  assert.equal(evidence.cases[1].status, "skipped");
  assert.equal(evidence.complete, false);
});

test("global hook errors and missing failure messages prevent complete evidence", () => {
  const evidence = vitestEvidence({ complete: false });
  assert.equal(evidence.complete, false);
  const missingError = createEngineEvidence({
    engine: "vitest",
    suite: "fixture-unit",
    step: "test:unit",
    outcome: "failed",
    complete: true,
    environment: engineEnvironment("vitest", "3.2.7"),
    reportedCaseCount: 1,
    globalErrors: [{ name: "Error", message: "beforeAll hook failed" }],
    cases: [{
      source: "tests/example.test.ts",
      title: "case",
      status: "failed",
      rawStatus: "failed",
      errors: [],
    }],
  });
  assert.equal(missingError.complete, false);
});

test("unscoped or unallowlisted test steps cannot produce completion observations", () => {
  const standalone = createEngineEvidence({
    ...vitestEvidence(),
    step: null,
  });
  assert.equal(standalone.step, null);
  const invalid = createEngineEvidence({
    ...vitestEvidence(),
    step: "arbitrary-step",
  });
  assert.equal(invalid.step, null);
  assert.equal(invalid.complete, false);
});

test("Node event reporter emits actual nested cases, skips, and redacted failures", async (t) => {
  const fixtureDirectory = await makeDirectory(t);
  const fixturePath = path.join(fixtureDirectory, "fixture.test.mjs");
  const outputPath = path.join(fixtureDirectory, "events.json");
  await writeFile(fixturePath, [
    'import { describe, test } from "node:test";',
    'describe("outer group", () => {',
    '  test("passes", () => {});',
    '  test.skip("skipped case", () => {});',
    '  test("fails", () => { throw new Error("fixture token=private-fixture-secret"); });',
    '});',
  ].join("\n"));
  const reporterPath = path.resolve(import.meta.dirname, "../failure-gate-v4/node-test-reporter.mjs");
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    "--test",
    `--test-reporter=${reporterPath}`,
    `--test-reporter-destination=${outputPath}`,
    fixturePath,
  ], { encoding: "utf8", timeout: 30_000, env: childEnvironment });
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const raw = await readFile(outputPath);
  assert.ok(raw.length > 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(raw.includes(Buffer.from("private-fixture-secret")), false);
  const evidence = JSON.parse(raw.toString("utf8"));
  assert.equal(evidence.engine, "node-test");
  assert.equal(evidence.cases.length, 3);
  assert.equal(evidence.complete, true);
  assert.ok(evidence.cases.some((entry) => entry.title === "outer group › passes"));
  assert.ok(evidence.cases.some((entry) => entry.status === "skipped"));
  assert.ok(evidence.cases.some((entry) =>
    entry.status === "failed" && entry.errors[0]?.message.includes("<redacted>")));
});

test("Node suite wrapper records bound event evidence for its assigned step", async (t) => {
  const fixtureDirectory = await makeDirectory(t);
  const fixturePath = path.join(fixtureDirectory, "passing.test.mjs");
  const outputDirectory = path.join(fixtureDirectory, "reports");
  await writeFile(fixturePath, [
    'import test from "node:test";',
    'test("passes", () => {});',
  ].join("\n"));
  const runnerPath = path.resolve(import.meta.dirname, "../failure-gate-v4/run-node-test-suite.mjs");
  const childEnvironment = {
    ...process.env,
    FAILURE_GATE_TEST_CASE_REPORT_DIR: outputDirectory,
    FAILURE_GATE_TEST_STEP: "test:unit",
  };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [runnerPath, "--test", fixturePath], {
    encoding: "utf8",
    timeout: 30_000,
    env: childEnvironment,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const loaded = await loadTestCaseReports(outputDirectory);
  assert.equal(loaded.available, true);
  assert.equal(loaded.allPassed, true);
  const { report } = loaded.reports[0];
  assert.equal(report.step, "test:unit");
  assert.ok(resolveCaseObservation({ report, entry: report.cases[0] }));
});

test("loaded v2 reports are verified and v1 case observations are never trusted", async (t) => {
  const outputDirectory = await makeDirectory(t);
  await writeEngineEvidenceReport({ outputDirectory, evidence: vitestEvidence() });
  const loaded = await loadTestCaseReports(outputDirectory);
  assert.equal(loaded.available, true);
  assert.ok(resolveCaseObservation({
    report: loaded.reports[0].report,
    entry: loaded.reports[0].report.cases[0],
  }));
  assert.equal(resolveCaseObservation({
    report: {
      schemaVersion: 1,
      complete: true,
      suite: "legacy",
      environment: { nodeMajor: 24, engineVersion: "3.2.7" },
      cases: [],
    },
    entry: { status: "failed", failureSignature: "f".repeat(64) },
  }), null);
});