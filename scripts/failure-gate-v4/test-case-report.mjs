import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, lstat, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  ENGINE_EVIDENCE_STEPS,
  verifyTestCaseReportBinding,
} from "./engine-evidence.mjs";

export const TEST_CASE_REPORT_SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const CASE_STATUSES = new Set(["passed", "failed", "skipped", "not_run", "unknown"]);
const MAX_REPORT_BYTES = 8 * 1024 * 1024;

export function stableTestCaseId({ engine, suite, source, title, line = null, column = null }) {
  return createHash("sha256")
    .update(JSON.stringify([engine, suite, source, title, line, column]))
    .digest("hex");
}

function validateLegacyTestCaseReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report) ||
      report.schemaVersion !== LEGACY_SCHEMA_VERSION ||
      typeof report.engine !== "string" || !report.engine ||
      typeof report.suite !== "string" || !report.suite ||
      typeof report.outcome !== "string" || !report.outcome ||
      typeof report.complete !== "boolean" ||
      !Array.isArray(report.cases) || (report.complete && report.cases.length === 0)) {
    throw new TypeError("invalid test-case report header or empty successful discovery");
  }
  const ids = new Set();
  for (const entry of report.cases) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        typeof entry.id !== "string" || !/^[0-9a-f]{64}$/.test(entry.id) ||
        typeof entry.source !== "string" || !entry.source ||
        typeof entry.title !== "string" || !entry.title ||
        !CASE_STATUSES.has(entry.status) ||
        (entry.reportedStatus !== undefined &&
          !["passed", "failed", "skipped", "pending"].includes(entry.reportedStatus)) ||
        (entry.errorCount !== undefined &&
          (!Number.isInteger(entry.errorCount) || entry.errorCount < 0)) ||
        (entry.line !== null && (!Number.isInteger(entry.line) || entry.line < 1))) {
      throw new TypeError("invalid test-case report entry");
    }
    if (entry.attempts !== undefined &&
        (!Array.isArray(entry.attempts) || entry.attempts.some((attempt) =>
          !attempt || typeof attempt !== "object" || Array.isArray(attempt) ||
          typeof attempt.rawStatus !== "string" ||
          !Number.isInteger(attempt.retry) || attempt.retry < 0 ||
          typeof attempt.expectedStatus !== "string"))) {
      throw new TypeError("invalid raw test-case attempt history");
    }
    if (ids.has(entry.id)) throw new TypeError("duplicate test-case report id");
    ids.add(entry.id);
  }
  if (report.complete && report.cases.some((entry) =>
    entry.status === "not_run" || entry.status === "unknown")) {
    throw new TypeError("complete test-case report has an unresolved execution result");
  }
  if (report.rawReport !== undefined &&
      (!report.rawReport || typeof report.rawReport !== "object" || Array.isArray(report.rawReport) ||
       typeof report.rawReport.reference !== "string" ||
       report.rawReport.reference !== report.rawReport.reference.split(/[\\/]/).at(-1) ||
       !/^[0-9a-f]{64}$/.test(report.rawReport.digest ?? ""))) {
    throw new TypeError("invalid raw test report reference or digest");
  }
  return report;
}

function validateV2TestCaseReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report) ||
      report.schemaVersion !== TEST_CASE_REPORT_SCHEMA_VERSION ||
      !["node-test", "vitest", "playwright"].includes(report.engine) ||
      typeof report.suite !== "string" ||
      (report.step !== null && !ENGINE_EVIDENCE_STEPS.includes(report.step)) ||
      typeof report.outcome !== "string" ||
      typeof report.complete !== "boolean" ||
      !report.environment || typeof report.environment !== "object" ||
      !Array.isArray(report.cases) || (report.complete && report.cases.length === 0) ||
      !report.rawReport || typeof report.rawReport !== "object" ||
      Array.isArray(report.rawReport) ||
      typeof report.rawReport.reference !== "string" ||
      report.rawReport.reference !== report.rawReport.reference.split(/[\\/]/).at(-1) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(report.rawReport.reference) ||
      !/\.(?:engine|jsonl)$/.test(report.rawReport.reference) ||
      !/^[0-9a-f]{64}$/.test(report.rawReport.digest ?? "")) {
    throw new TypeError("invalid v2 test-case report or raw binding");
  }
  const ids = new Set();
  for (const entry of report.cases) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        typeof entry.id !== "string" || !/^[0-9a-f]{64}$/.test(entry.id) ||
        typeof entry.source !== "string" || typeof entry.title !== "string" ||
        (entry.line !== null && !Number.isInteger(entry.line)) ||
        (entry.column !== null && !Number.isInteger(entry.column)) ||
        !CASE_STATUSES.has(entry.status) ||
        typeof entry.reportedStatus !== "string" ||
        !Number.isInteger(entry.errorCount) || entry.errorCount < 0 ||
        (entry.failureSignature !== null &&
          !/^[0-9a-f]{64}$/.test(entry.failureSignature)) ||
        !Array.isArray(entry.attempts) ||
        entry.attempts.some((attempt) => !attempt ||
          typeof attempt.rawStatus !== "string" ||
          typeof attempt.expectedStatus !== "string" ||
          !Number.isInteger(attempt.retry) || attempt.retry < 0)) {
      throw new TypeError("invalid v2 test-case report entry");
    }
    if (ids.has(entry.id)) throw new TypeError("duplicate test-case report id");
    ids.add(entry.id);
  }
  return report;
}

export function validateTestCaseReport(report) {
  return report?.schemaVersion === LEGACY_SCHEMA_VERSION
    ? validateLegacyTestCaseReport(report)
    : validateV2TestCaseReport(report);
}

export async function writeTestCaseReport({ outputDirectory, ...input }) {
  const report = validateLegacyTestCaseReport({
    schemaVersion: LEGACY_SCHEMA_VERSION,
    ...input,
  });
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `${report.engine}-${process.pid}-${randomUUID()}.json`;
  const destination = resolve(directory, name);
  const temporary = `${destination}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, destination);
  return destination;
}

export async function loadTestCaseReports(outputDirectory) {
  const directory = resolve(outputDirectory);
  const root = await realpath(directory);
  const directoryEntries = (await readdir(root)).sort();
  const names = directoryEntries.filter((name) => name.endsWith(".json"));
  const reports = [];
  const referencedFiles = new Set(names);
  for (const name of names) {
    const path = resolve(root, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() ||
        !path.startsWith(`${root}${sep}`) || info.size > MAX_REPORT_BYTES) {
      throw new Error("test-case report directory contains an unsafe or oversized entry");
    }
    const bytes = await readFile(path);
    const report = validateTestCaseReport(JSON.parse(bytes.toString("utf8")));
    if (report.rawReport) {
      referencedFiles.add(report.rawReport.reference);
      const rawPath = resolve(root, report.rawReport.reference);
      const rawInfo = await lstat(rawPath);
      if (!rawInfo.isFile() || rawInfo.isSymbolicLink() ||
          !rawPath.startsWith(`${root}${sep}`) || rawInfo.size > MAX_REPORT_BYTES) {
        throw new Error("test-case raw report is unsafe, oversized, or has a mismatched digest");
      }
      const rawBytes = await readFile(rawPath);
      if (createHash("sha256").update(rawBytes).digest("hex") !== report.rawReport.digest) {
        throw new Error("test-case raw report is unsafe, oversized, or has a mismatched digest");
      }
      if (report.schemaVersion === TEST_CASE_REPORT_SCHEMA_VERSION) {
        verifyTestCaseReportBinding({ report, rawReportBytes: rawBytes });
      }
    }
    reports.push({
      reference: relative(dirname(root), path),
      digest: createHash("sha256").update(bytes).digest("hex"),
      report,
    });
  }
  if (directoryEntries.some((name) => !referencedFiles.has(name))) {
    throw new Error("test-case report directory contains an unreferenced file");
  }
  const cases = reports.flatMap(({ report }) => report.cases);
  const available = reports.length > 0 && reports.every(({ report }) => report.complete) && cases.length > 0;
  return Object.freeze({
    available,
    reports: Object.freeze(reports),
    caseCount: cases.length,
    counts: Object.freeze(Object.fromEntries([...CASE_STATUSES].map((status) => [
      status,
      cases.filter((entry) => entry.status === status).length,
    ]))),
    allPassed: cases.length > 0 && available &&
      reports.every(({ report }) => report.schemaVersion === TEST_CASE_REPORT_SCHEMA_VERSION) &&
      cases.every((entry) =>
      entry.status === "passed" &&
      (!Array.isArray(entry.attempts) ||
        entry.attempts.every((attempt) =>
          attempt.rawStatus === attempt.expectedStatus ||
          (attempt.rawStatus === "passed" && attempt.expectedStatus === "passed")))),
  });
}

export async function collectTestCaseDiscovery(outputDirectory, { required } = {}) {
  if (!required) {
    return Object.freeze({
      schemaVersion: TEST_CASE_REPORT_SCHEMA_VERSION,
      available: false,
      notApplicable: true,
      reason: "this tier has no registered test-case suite",
      caseCount: 0,
      allPassed: false,
      reports: Object.freeze([]),
    });
  }
  if (typeof outputDirectory !== "string" || !outputDirectory) {
    return Object.freeze({
      schemaVersion: TEST_CASE_REPORT_SCHEMA_VERSION,
      available: false,
      notApplicable: false,
      reason: "test-case report directory was not configured",
      caseCount: 0,
      allPassed: false,
      reports: Object.freeze([]),
    });
  }
  try {
    const loaded = await loadTestCaseReports(outputDirectory);
    const reports = loaded.reports.map(({ reference, digest, report }) => ({
      reference,
      digest,
      engine: report.engine,
      suite: report.suite,
      ...(report.schemaVersion === TEST_CASE_REPORT_SCHEMA_VERSION ? { step: report.step } : {}),
      outcome: report.outcome,
      complete: report.complete,
      caseCount: report.cases.length,
      counts: report.cases.reduce((counts, entry) => {
        counts[entry.status] = (counts[entry.status] ?? 0) + 1;
        return counts;
      }, {}),
    }));
    return Object.freeze({
      schemaVersion: TEST_CASE_REPORT_SCHEMA_VERSION,
      available: loaded.available,
      notApplicable: false,
      ...(!loaded.available ? { reason: loaded.caseCount === 0
        ? "no test cases were discovered"
        : "one or more test-case reports are incomplete" } : {}),
      caseCount: loaded.caseCount,
      allPassed: loaded.allPassed,
      reports: Object.freeze(reports),
    });
  } catch {
    return Object.freeze({
      schemaVersion: TEST_CASE_REPORT_SCHEMA_VERSION,
      available: false,
      notApplicable: false,
      reason: "test-case reports are missing, malformed, or unsafe",
      caseCount: 0,
      allPassed: false,
      reports: Object.freeze([]),
    });
  }
}