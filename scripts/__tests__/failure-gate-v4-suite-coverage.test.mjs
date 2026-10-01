import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasExactRegisteredCaseCoverage,
  requiredCaseSuitesForTier,
} from "../failure-gate-v4/suite-coverage.mjs";
import { validateTestCaseReport } from "../failure-gate-v4/test-case-report.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const unitObligations = [
  ["vitest", "api-server-unit", 2],
  ["vitest", "bathyscan-unit", 1],
  ["vitest", "api-zod-unit", 1],
  ["vitest", "lib-db-unit", 1],
  ["vitest", "poe-unit", 1],
  ["node-test", "scripts-unit", 1],
];

test("root test:unit continues through all six existing package suites after a package failure", () => {
  const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.match(
    rootPackage.scripts["test:unit"],
    /pnpm -r --if-present --no-bail run test:unit/,
  );
  const suitePackages = [
    "artifacts/api-server",
    "artifacts/bathyscan",
    "lib/api-zod",
    "lib/db",
    "lib/poe",
    "scripts",
  ];
  assert.deepEqual(
    suitePackages.filter((directory) => {
      const manifest = JSON.parse(readFileSync(resolve(root, directory, "package.json"), "utf8"));
      return typeof manifest.scripts?.["test:unit"] === "string";
    }),
    suitePackages,
  );
});

test("tier dispatch replaces fixture-provided reporter step context with code-owned step names", () => {
  const runTier = readFileSync(resolve(root, "scripts/run-tier.mjs"), "utf8");
  const heavyRunner = readFileSync(resolve(root, "scripts/test-heavy-serial.mjs"), "utf8");
  assert.match(runTier, /FAILURE_GATE_TEST_STEP:\s*ENGINE_EVIDENCE_STEPS\.includes\(step\.name\)\s*\?\s*step\.name\s*:\s*""/);
  assert.match(heavyRunner, /FAILURE_GATE_TEST_STEP:\s*name/);
  assert.match(heavyRunner, /FAILURE_GATE_VALIDATION_TIER\s*=\s*name/);
  assert.doesNotMatch(runTier, /FAILURE_GATE_TEST_STEP:\s*process\.env/);
  assert.doesNotMatch(heavyRunner, /FAILURE_GATE_TEST_STEP:\s*process\.env/);
  assert.match(heavyRunner, /setReportStarted\("PREFLIGHT",\s*preflightStart\);\s*if \(reportPath\) await writeHeavyReport\(null\);/);
  assert.match(heavyRunner, /setReportStarted\(name,\s*start\);\s*if \(reportPath\) await writeHeavyReport\(null\);\s*const res = spawnSync/);
  assert.match(heavyRunner, /console\.log\(`\[test-heavy\] ■ step "\$\{name\}" finished[\s\S]*?if \(reportPath\) await writeHeavyReport\(null\);/);
});

function boundReport({ step = "test:unit", engine, suite, index, status = "passed" }) {
  const id = String(index).padStart(64, "0");
  const reportReference = `case-report-${index}.json`;
  const rawReference = `engine-${index}.engine`;
  const engineVersion = engine === "node-test" ? "24"
    : engine === "playwright" ? "1.60.0" : "3.2.7";
  return {
    reference: reportReference,
    digest: String(index + 100).padStart(64, "0"),
    report: {
      schemaVersion: 2,
      engine,
      suite,
      step,
      outcome: engine === "node-test" ? "completed" : "passed",
      complete: true,
      environment: { nodeMajor: 24, engineVersion },
      cases: [{
        id,
        source: `suite-${index}.test.js`,
        title: `case ${index}`,
        line: null,
        column: null,
        status,
        reportedStatus: status,
        errorCount: status === "failed" ? 1 : 0,
        failureSignature: status === "failed" ? "f".repeat(64) : null,
        attempts: [],
      }],
      rawReport: {
        reference: rawReference,
        digest: String(index + 200).padStart(64, "0"),
      },
    },
  };
}

function unitReports() {
  let index = 1;
  return unitObligations.flatMap(([engine, suite, count]) =>
    Array.from({ length: count }, () =>
      boundReport({ engine, suite, index: index++ })));
}

function heavyReports() {
  const reports = unitReports();
  reports.push(
    boundReport({
      step: "e2e-palette",
      engine: "playwright",
      suite: "e2e-palette",
      index: 40,
    }),
    boundReport({
      step: "test:e2e",
      engine: "playwright",
      suite: "test:e2e",
      index: 41,
    }),
  );
  return reports;
}

test("registered case-suite obligations match the six existing unit suites and heavy browser steps", () => {
  assert.deepEqual(
    requiredCaseSuitesForTier("test-standard").map(({ engine, suite }) => [engine, suite]),
    unitObligations.map(([engine, suite]) => [engine, suite]),
  );
  assert.equal(requiredCaseSuitesForTier("test-fast").length, 0);
  assert.deepEqual(
    requiredCaseSuitesForTier("test-heavy").slice(-2).map(({ step, suite }) => [step, suite]),
    [["e2e-palette", "e2e-palette"], ["test:e2e", "test:e2e"]],
  );
  assert.throws(() => requiredCaseSuitesForTier("unregistered"), /unknown authorized validation tier/);
});

test("exact suite and step-bound reports satisfy standard and heavy coverage", () => {
  assert.equal(
    hasExactRegisteredCaseCoverage(unitReports(), ["test:unit"], "test-standard"),
    true,
  );
  assert.equal(
    hasExactRegisteredCaseCoverage(heavyReports(), ["test:unit", "e2e-palette", "test:e2e"], "test-heavy"),
    true,
  );
  assert.equal(hasExactRegisteredCaseCoverage([], [], "test-fast"), true);
});

test("palette and full-browser evidence are separate obligations and cannot substitute", () => {
  const reports = heavyReports().filter(({ report }) => report.step !== "test:e2e");
  assert.equal(
    hasExactRegisteredCaseCoverage(reports, ["test:unit", "e2e-palette", "test:e2e"], "test-heavy"),
    false,
  );
  const substituted = heavyReports().map((entry) =>
    entry.report.step === "test:e2e"
      ? { ...entry, report: { ...entry.report, step: "e2e-palette" } }
      : entry);
  assert.equal(
    hasExactRegisteredCaseCoverage(substituted, ["test:unit", "e2e-palette", "test:e2e"], "test-heavy"),
    false,
  );
});

test("missing, unknown, duplicate, or incorrectly bound suites fail closed", () => {
  const missing = unitReports().slice(1);
  assert.equal(hasExactRegisteredCaseCoverage(missing, ["test:unit"], "test-standard"), false);

  const unknown = unitReports();
  unknown[0] = {
    ...unknown[0],
    report: { ...unknown[0].report, suite: "fixture-injected-suite" },
  };
  assert.equal(hasExactRegisteredCaseCoverage(unknown, ["test:unit"], "test-standard"), false);

  const extraShard = unitReports();
  const duplicateShard = structuredClone(extraShard[0]);
  duplicateShard.reference = "extra-api-shard.json";
  duplicateShard.digest = "d".repeat(64);
  duplicateShard.report.rawReport.reference = "extra-api-shard.engine";
  duplicateShard.report.rawReport.digest = "e".repeat(64);
  duplicateShard.report.cases[0].id = "a".repeat(64);
  extraShard.push(duplicateShard);
  assert.equal(hasExactRegisteredCaseCoverage(extraShard, ["test:unit"], "test-standard"), false);

  const duplicateCase = unitReports();
  duplicateCase[1].report.cases[0].id = duplicateCase[0].report.cases[0].id;
  assert.equal(hasExactRegisteredCaseCoverage(duplicateCase, ["test:unit"], "test-standard"), false);

  const duplicateBinding = unitReports();
  duplicateBinding.push(structuredClone(duplicateBinding[0]));
  assert.equal(hasExactRegisteredCaseCoverage(duplicateBinding, ["test:unit"], "test-standard"), false);
});

test("skipped, unknown, not-run, and malformed case results cannot count as discovered coverage", () => {
  for (const status of ["skipped", "unknown", "not_run"]) {
    const reports = unitReports();
    reports[0].report.cases[0].status = status;
    assert.equal(
      hasExactRegisteredCaseCoverage(reports, ["test:unit"], "test-standard"),
      false,
      `${status} must not count as executed case coverage`,
    );
  }

  const failedButUnbound = unitReports();
  failedButUnbound[0].report.cases[0].status = "failed";
  failedButUnbound[0].report.cases[0].failureSignature = null;
  assert.equal(
    hasExactRegisteredCaseCoverage(failedButUnbound, ["test:unit"], "test-standard"),
    false,
  );
});

test("schema-1 reports remain parseable but do not satisfy a current v2 adapter", () => {
  const legacy = {
    schemaVersion: 1,
    engine: "vitest",
    suite: "api-server-unit",
    outcome: "passed",
    complete: true,
    cases: [{
      id: "1".repeat(64),
      source: "src/example.test.ts",
      title: "legacy case",
      line: null,
      status: "passed",
    }],
  };
  assert.equal(validateTestCaseReport(legacy), legacy);
  const reports = unitReports();
  reports[0] = {
    ...reports[0],
    report: { ...legacy, rawReport: reports[0].report.rawReport },
  };
  assert.equal(hasExactRegisteredCaseCoverage(reports, ["test:unit"], "test-standard"), false);
});