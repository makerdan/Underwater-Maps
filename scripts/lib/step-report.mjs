import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const STEP_REPORT_SCHEMA_VERSION = 1;

export function parseReportOption(argv) {
  const remaining = [];
  let reportPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--report") {
      remaining.push(argv[index]);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--report requires a file path");
    }
    if (reportPath !== null) throw new Error("--report may only be specified once");
    reportPath = value;
    index += 1;
  }
  return { argv: remaining, reportPath };
}

export function createStepReport({
  runner,
  tier,
  startedAt,
  finishedAt = new Date().toISOString(),
  rawExitStatus,
  discovery,
  steps,
}) {
  const report = {
    schemaVersion: STEP_REPORT_SCHEMA_VERSION,
    runner,
    tier,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    rawExitStatus,
    discovery,
    steps,
  };
  validateStepReport(report);
  return report;
}

export function createStepRecord({
  name,
  phase,
  status,
  rawExitStatus = null,
  signal = null,
  startedAt = null,
  finishedAt = null,
  durationMs = null,
  discovery = null,
  reason = null,
}) {
  return {
    name,
    phase,
    status,
    rawExitStatus,
    signal,
    startedAt,
    finishedAt,
    durationMs,
    discovery,
    reason,
  };
}

export function writeStepReport(path, report) {
  validateStepReport(report);
  const outputPath = resolve(path);
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
  renameSync(temporaryPath, outputPath);
  return outputPath;
}

export function validateStepReport(report) {
  const fail = (message) => {
    throw new TypeError(`invalid step report: ${message}`);
  };
  if (!report || typeof report !== "object" || Array.isArray(report)) fail("expected an object");
  if (report.schemaVersion !== STEP_REPORT_SCHEMA_VERSION) fail("unsupported schemaVersion");
  if (typeof report.runner !== "string" || !report.runner) fail("runner is required");
  if (typeof report.tier !== "string" || !report.tier) fail("tier is required");
  if (!isTimestamp(report.startedAt) || !isTimestamp(report.finishedAt)) fail("timestamps are required");
  if (!Number.isFinite(report.durationMs) || report.durationMs < 0) fail("durationMs must be non-negative");
  if (!isExitStatus(report.rawExitStatus)) fail("rawExitStatus must be an integer or null");
  if (!report.discovery || typeof report.discovery !== "object" || Array.isArray(report.discovery)) {
    fail("discovery must describe availability");
  }
  if (!Array.isArray(report.steps)) fail("steps must be an array");
  for (const [index, step] of report.steps.entries()) {
    if (!step || typeof step !== "object" || Array.isArray(step)) fail(`steps[${index}] must be an object`);
    if (typeof step.name !== "string" || !step.name) fail(`steps[${index}].name is required`);
    if (typeof step.phase !== "string" || !step.phase) fail(`steps[${index}].phase is required`);
    if (!["passed", "failed", "not_reached", "skipped", "unknown"].includes(step.status)) {
      fail(`steps[${index}].status is invalid`);
    }
    if (!isExitStatus(step.rawExitStatus)) fail(`steps[${index}].rawExitStatus must be an integer or null`);
    if (step.signal !== null && typeof step.signal !== "string") fail(`steps[${index}].signal must be a string or null`);
    if (step.startedAt !== null && !isTimestamp(step.startedAt)) fail(`steps[${index}].startedAt is invalid`);
    if (step.finishedAt !== null && !isTimestamp(step.finishedAt)) fail(`steps[${index}].finishedAt is invalid`);
    if (step.durationMs !== null && (!Number.isFinite(step.durationMs) || step.durationMs < 0)) {
      fail(`steps[${index}].durationMs must be non-negative or null`);
    }
    if (step.status === "passed" && step.rawExitStatus !== 0) fail(`steps[${index}] passed without raw exit status 0`);
    if (step.status === "failed" && step.rawExitStatus === 0) fail(`steps[${index}] failed with raw exit status 0`);
    if ((step.status === "not_reached" || step.status === "skipped") &&
        (step.rawExitStatus !== null || step.startedAt !== null || step.finishedAt !== null)) {
      fail(`steps[${index}] was not launched but contains execution results`);
    }
    if (step.status === "unknown" && (typeof step.reason !== "string" || !step.reason)) {
      fail(`steps[${index}] with unknown status requires a reason`);
    }
  }
  return report;
}

function isExitStatus(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

function isTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}