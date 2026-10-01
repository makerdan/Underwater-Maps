import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createStepRecord,
  createStepReport,
  parseReportOption,
  validateStepReport,
  writeStepReport,
} from "../lib/step-report.mjs";

const timestamp = "2026-01-02T03:04:05.000Z";

test("parseReportOption removes one report option while preserving launcher arguments", () => {
  assert.deepEqual(parseReportOption([
    "standard",
    "--skip", "test:unit",
    "--report", "reports/run.json",
    "--allow-no-plan",
  ]), {
    argv: ["standard", "--skip", "test:unit", "--allow-no-plan"],
    reportPath: "reports/run.json",
  });
  assert.deepEqual(parseReportOption(["fast"]), { argv: ["fast"], reportPath: null });
});

test("parseReportOption rejects absent and duplicate report paths", () => {
  assert.throws(() => parseReportOption(["fast", "--report"]), /requires a file path/);
  assert.throws(() => parseReportOption(["fast", "--report", "a.json", "--report", "b.json"]), /only be specified once/);
});

test("step reports preserve raw failures and distinguish skipped/not-reached steps", () => {
  const report = createStepReport({
    runner: "test-heavy-serial",
    tier: "test-heavy",
    startedAt: timestamp,
    finishedAt: timestamp,
    rawExitStatus: 1,
    discovery: { testCases: { available: false, reason: "not exposed" } },
    steps: [
      createStepRecord({
        name: "PREFLIGHT",
        phase: "preflight",
        status: "failed",
        rawExitStatus: 23,
        startedAt: timestamp,
        finishedAt: timestamp,
        durationMs: 0,
      }),
      createStepRecord({
        name: "test:unit",
        phase: "heavy",
        status: "not_reached",
      }),
      createStepRecord({
        name: "optional-check",
        phase: "preflight",
        status: "skipped",
        reason: "explicitly skipped",
      }),
    ],
  });

  assert.equal(validateStepReport(report), report);
  assert.equal(report.steps[0].rawExitStatus, 23);
  assert.equal(report.steps[1].rawExitStatus, null);
  assert.equal(report.steps[2].status, "skipped");
});

test("writeStepReport writes valid JSON and refuses inconsistent step outcomes", () => {
  const directory = mkdtempSync(join(tmpdir(), "step-report-test-"));
  try {
    const path = join(directory, "report.json");
    const report = createStepReport({
      runner: "run-tier",
      tier: "fast",
      startedAt: timestamp,
      finishedAt: timestamp,
      rawExitStatus: 0,
      discovery: { registeredSteps: { available: true, names: ["typecheck"] } },
      steps: [
        createStepRecord({
          name: "typecheck",
          phase: "tier",
          status: "passed",
          rawExitStatus: 0,
          startedAt: timestamp,
          finishedAt: timestamp,
          durationMs: 0,
        }),
      ],
    });
    writeStepReport(path, report);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), report);
    assert.throws(() => validateStepReport({
      ...report,
      steps: [{ ...report.steps[0], status: "passed", rawExitStatus: 1 }],
    }), /passed without raw exit status 0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});