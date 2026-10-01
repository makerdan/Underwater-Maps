import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

export const ENGINE_EVIDENCE_SCHEMA_VERSION = 1;
export const TEST_CASE_REPORT_SCHEMA_VERSION = 2;
export const REDACTION_VERSION = 1;
export const MAX_ENGINE_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const ENGINE_EVIDENCE_STEPS = Object.freeze(["test:unit", "e2e-palette", "test:e2e"]);
const MAX_CASES = 20_000;
const MAX_ERRORS_PER_CASE = 8;
const MAX_ATTEMPTS_PER_CASE = 20;
const MAX_TITLE_LENGTH = 512;
const MAX_SOURCE_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 1024;
const ENGINES = new Set(["node-test", "vitest", "playwright"]);
const ENVIRONMENT_VERSIONS = Object.freeze({
  "node-test": "24",
  vitest: "3.2.7",
  playwright: "1.60.0",
});
const STATUSES = new Set(["passed", "failed", "skipped", "not_run", "unknown"]);
const NODE_STATUSES = new Set(["passed", "failed", "skipped", "unknown"]);
const VITEST_STATUSES = new Set(["passed", "failed", "skipped", "pending", "todo", "unknown"]);
const PLAYWRIGHT_STATUSES = new Set(["passed", "failed", "skipped", "timedOut", "interrupted", "unknown"]);
const VERIFIED_REPORTS = new WeakMap();
const RAW_KEYS = [
  "schemaVersion", "redactionVersion", "engine", "suite", "step", "outcome", "complete",
  "environment", "reportedCaseCount", "globalErrors", "cases",
];
const CASE_KEYS = [
  "source", "title", "line", "column", "status", "rawStatus", "expectedStatus",
  "errorCount", "errors", "attempts",
];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function boundedString(value, max, { allowEmpty = false } = {}) {
  return typeof value === "string" && value.length <= max &&
    (allowEmpty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function redactMessage(value) {
  if (typeof value !== "string") return "";
  let message = value.slice(0, MAX_MESSAGE_LENGTH);
  message = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g, "<redacted>")
    .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1$2<redacted>")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "<url>")
    .replace(/(?:file:\/\/)?\/(?:[\w.-]+\/){2,}[\w.-]+/g, "<path>")
    .replace(/(?:^|\n)\s*(?:actual|expected)\s*[:=].*(?=\n|$)/gi, "")
    .replace(/\n\s*(?:Actual|Expected)(?:\s|:)[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
  return message;
}

export function summarizeEngineError(error) {
  if (!isRecord(error)) return null;
  const rawName = typeof error.name === "string" ? error.name : "";
  const name = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(rawName) ? rawName : "";
  const message = redactMessage(error.message);
  if (!name || !message) return null;
  return Object.freeze({ name, message });
}

function safeErrorList(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, MAX_ERRORS_PER_CASE)
    .map(summarizeEngineError)
    .filter(Boolean);
}

function safeSource(value) {
  if (typeof value !== "string") return "";
  const source = value.replaceAll("\\", "/");
  if (!source || source.length > MAX_SOURCE_LENGTH || source.startsWith("/") ||
      /^[A-Za-z]:\//.test(source) || /^(?:https?|file):/i.test(source) ||
      source.split("/").some((part) => part === ".." || part === "")) {
    return "";
  }
  return redactMessage(source).slice(0, MAX_SOURCE_LENGTH);
}

function safeTitle(value) {
  return typeof value === "string"
    ? redactMessage(value).slice(0, MAX_TITLE_LENGTH)
    : "";
}

function safeSuite(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value)
    ? value
    : "unknown-suite";
}

function safeStep(value) {
  return ENGINE_EVIDENCE_STEPS.includes(value) ? value : null;
}

function versionFor(engine, observedVersion) {
  if (engine === "node-test") {
    return process.versions.node.split(".")[0] === "24" ? "24" : "unsupported";
  }
  return observedVersion === ENVIRONMENT_VERSIONS[engine]
    ? ENVIRONMENT_VERSIONS[engine]
    : "unsupported";
}

export function engineEnvironment(engine, observedVersion = ENVIRONMENT_VERSIONS[engine]) {
  if (!ENGINES.has(engine)) throw new TypeError("unsupported test engine");
  return Object.freeze({
    nodeMajor: process.versions.node.split(".")[0] === "24" ? 24 : 0,
    engineVersion: versionFor(engine, observedVersion),
  });
}

function safeLocation(value) {
  return Number.isInteger(value) && value > 0 && value <= 10_000_000 ? value : null;
}

function safeExpectedStatus(value, engine) {
  const allowed = engine === "playwright"
    ? new Set(["passed", "failed", "skipped"])
    : new Set([""]);
  return typeof value === "string" && allowed.has(value) ? value : "";
}

function safeOutcome(value, engine) {
  const allowed = engine === "node-test"
    ? new Set(["completed", "missing-summary", "failed", "unknown"])
    : new Set(["passed", "failed", "interrupted", "unknown"]);
  return typeof value === "string" && allowed.has(value) ? value : "unknown";
}

function safeRawStatus(engine, status) {
  const allow = engine === "node-test" ? NODE_STATUSES
    : engine === "vitest" ? VITEST_STATUSES
      : PLAYWRIGHT_STATUSES;
  return typeof status === "string" && allow.has(status) ? status : "unknown";
}

function canonicalStatus(engine, rawStatus, expectedStatus) {
  if (rawStatus === "unknown" || rawStatus === "interrupted") return "unknown";
  if (rawStatus === "skipped" || rawStatus === "pending" || rawStatus === "todo") return "skipped";
  if (rawStatus === "passed") {
    return engine === "playwright" && expectedStatus && expectedStatus !== "passed"
      ? "failed"
      : "passed";
  }
  return rawStatus === "failed" || rawStatus === "timedOut" ? "failed" : "unknown";
}

function normalizeAttempt(attempt, engine) {
  const rawStatus = safeRawStatus(engine, attempt?.rawStatus);
  const expectedStatus = safeExpectedStatus(attempt?.expectedStatus, engine);
  const retry = Number.isInteger(attempt?.retry) && attempt.retry >= 0
    ? attempt.retry
    : 0;
  return {
    rawStatus,
    expectedStatus,
    retry,
    errorCount: Number.isInteger(attempt?.errorCount) && attempt.errorCount >= 0
      ? Math.min(attempt.errorCount, MAX_ERRORS_PER_CASE)
      : Array.isArray(attempt?.errors) ? Math.min(attempt.errors.length, MAX_ERRORS_PER_CASE) : 0,
    errors: safeErrorList(attempt?.errors),
  };
}

function normalizeCase(testCase, engine) {
  const rawStatus = safeRawStatus(engine, testCase?.rawStatus ?? testCase?.status);
  const expectedStatus = safeExpectedStatus(testCase?.expectedStatus, engine);
  const mappedStatus = canonicalStatus(engine, rawStatus, expectedStatus);
  const status = testCase?.status === "unknown" ? "unknown" : mappedStatus;
  const attempts = Array.isArray(testCase?.attempts)
    ? testCase.attempts.slice(0, MAX_ATTEMPTS_PER_CASE).map((attempt) => normalizeAttempt(attempt, engine))
    : [];
  return {
    source: safeSource(testCase?.source),
    title: safeTitle(testCase?.title),
    line: safeLocation(testCase?.line),
    column: safeLocation(testCase?.column),
    status,
    rawStatus,
    expectedStatus,
    errorCount: Number.isInteger(testCase?.errorCount) && testCase.errorCount >= 0
      ? Math.min(testCase.errorCount, MAX_ERRORS_PER_CASE)
      : Array.isArray(testCase?.errors) ? Math.min(testCase.errors.length, MAX_ERRORS_PER_CASE) : 0,
    errors: safeErrorList(testCase?.errors),
    attempts,
  };
}

export function createEngineEvidence({
  engine,
  suite,
  step = process.env.FAILURE_GATE_TEST_STEP ?? null,
  outcome,
  complete,
  environment = engineEnvironment(engine),
  reportedCaseCount = null,
  globalErrors = [],
  cases = [],
}) {
  if (!ENGINES.has(engine)) throw new TypeError("unsupported test engine");
  const sourceCases = Array.isArray(cases) ? cases : [];
  const safeCases = sourceCases.slice(0, MAX_CASES).map((entry) => normalizeCase(entry, engine));
  const version = versionFor(engine, environment?.engineVersion);
  const env = {
    nodeMajor: process.versions.node.split(".")[0] === "24" ? 24 : 0,
    engineVersion: version,
  };
  const evidence = {
    schemaVersion: ENGINE_EVIDENCE_SCHEMA_VERSION,
    redactionVersion: REDACTION_VERSION,
    engine,
    suite: safeSuite(suite),
    step: safeStep(step),
    outcome: safeOutcome(outcome, engine),
    complete: complete === true &&
      env.nodeMajor === 24 &&
      version !== "unsupported" &&
      safeSuite(suite) === suite &&
      (step === null || safeStep(step) === step) &&
      safeOutcome(outcome, engine) !== "unknown" &&
      safeCases.length > 0 &&
      safeCases.length === sourceCases.length &&
      sourceCases.length <= MAX_CASES &&
      sourceCases.every((entry) => {
        const attempts = Array.isArray(entry?.attempts) ? entry.attempts : [];
        return (Array.isArray(entry?.errors) ? entry.errors.length : 0) <= MAX_ERRORS_PER_CASE &&
          attempts.length <= MAX_ATTEMPTS_PER_CASE &&
          attempts.every((attempt) => (Array.isArray(attempt?.errors) ? attempt.errors.length : 0) <= MAX_ERRORS_PER_CASE);
      }) &&
      safeCases.every((entry) => entry.source && entry.title &&
        entry.status !== "unknown" && entry.status !== "not_run" &&
        (entry.status !== "failed" || entry.errors.length > 0)) &&
      new Set(safeCases.map((entry) => `${entry.source}\u0000${entry.title}`)).size === safeCases.length &&
      (!Array.isArray(globalErrors) || globalErrors.length === 0),
    environment: env,
    reportedCaseCount: Number.isInteger(reportedCaseCount) &&
      reportedCaseCount >= 0 && reportedCaseCount <= MAX_CASES
      ? reportedCaseCount
      : safeCases.length,
    globalErrors: safeErrorList(globalErrors),
    cases: safeCases,
  };
  validateRawEvidence(evidence);
  return evidence;
}

function validateError(error) {
  return exactKeys(error, ["name", "message"]) &&
    boundedString(error.name, 64) &&
    /^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(error.name) &&
    boundedString(error.message, MAX_MESSAGE_LENGTH) &&
    redactMessage(error.message) === error.message;
}

function validateAttempt(attempt, engine) {
  return exactKeys(attempt, ["rawStatus", "expectedStatus", "retry", "errorCount", "errors"]) &&
    safeRawStatus(engine, attempt.rawStatus) === attempt.rawStatus &&
    safeExpectedStatus(attempt.expectedStatus, engine) === attempt.expectedStatus &&
    Number.isInteger(attempt.retry) && attempt.retry >= 0 && attempt.retry < MAX_ATTEMPTS_PER_CASE &&
    Number.isInteger(attempt.errorCount) && attempt.errorCount >= attempt.errors.length &&
    attempt.errorCount <= MAX_ERRORS_PER_CASE &&
    Array.isArray(attempt.errors) && attempt.errors.length <= MAX_ERRORS_PER_CASE &&
    attempt.errors.every(validateError);
}

export function validateRawEvidence(evidence) {
  if (!exactKeys(evidence, RAW_KEYS) ||
      evidence.schemaVersion !== ENGINE_EVIDENCE_SCHEMA_VERSION ||
      evidence.redactionVersion !== REDACTION_VERSION ||
      !ENGINES.has(evidence.engine) ||
      !boundedString(evidence.suite, 80) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(evidence.suite) ||
      (evidence.step !== null && !ENGINE_EVIDENCE_STEPS.includes(evidence.step)) ||
      !boundedString(evidence.outcome, 80) ||
      safeOutcome(evidence.outcome, evidence.engine) !== evidence.outcome ||
      typeof evidence.complete !== "boolean" ||
      !exactKeys(evidence.environment, ["nodeMajor", "engineVersion"]) ||
      ![0, 24].includes(evidence.environment.nodeMajor) ||
      !["24", "3.2.7", "1.60.0", "unsupported"].includes(evidence.environment.engineVersion) ||
      (evidence.engine === "node-test" && !["24", "unsupported"].includes(evidence.environment.engineVersion)) ||
      (evidence.engine === "vitest" && !["3.2.7", "unsupported"].includes(evidence.environment.engineVersion)) ||
      (evidence.engine === "playwright" && !["1.60.0", "unsupported"].includes(evidence.environment.engineVersion)) ||
      (evidence.reportedCaseCount !== null &&
        (!Number.isInteger(evidence.reportedCaseCount) ||
          evidence.reportedCaseCount < 0 || evidence.reportedCaseCount > MAX_CASES)) ||
      !Array.isArray(evidence.globalErrors) || evidence.globalErrors.length > MAX_ERRORS_PER_CASE ||
      !evidence.globalErrors.every(validateError) ||
      !Array.isArray(evidence.cases) || evidence.cases.length > MAX_CASES) {
    throw new TypeError("invalid engine evidence header");
  }
  for (const testCase of evidence.cases) {
    if (!exactKeys(testCase, CASE_KEYS) ||
        !boundedString(testCase.source, MAX_SOURCE_LENGTH, { allowEmpty: true }) ||
        !boundedString(testCase.title, MAX_TITLE_LENGTH, { allowEmpty: true }) ||
        (testCase.line !== null && (!Number.isInteger(testCase.line) ||
          testCase.line < 1 || testCase.line > 10_000_000)) ||
        (testCase.column !== null && (!Number.isInteger(testCase.column) ||
          testCase.column < 1 || testCase.column > 10_000_000)) ||
        !STATUSES.has(testCase.status) ||
        safeRawStatus(evidence.engine, testCase.rawStatus) !== testCase.rawStatus ||
        safeExpectedStatus(testCase.expectedStatus, evidence.engine) !== testCase.expectedStatus ||
        !Number.isInteger(testCase.errorCount) || testCase.errorCount < testCase.errors?.length ||
        testCase.errorCount > MAX_ERRORS_PER_CASE ||
        !Array.isArray(testCase.errors) || testCase.errors.length > MAX_ERRORS_PER_CASE ||
        !testCase.errors.every(validateError) ||
        !Array.isArray(testCase.attempts) || testCase.attempts.length > MAX_ATTEMPTS_PER_CASE ||
        !testCase.attempts.every((attempt) => validateAttempt(attempt, evidence.engine))) {
      throw new TypeError("invalid engine evidence case");
    }
    if ((testCase.source && safeSource(testCase.source) !== testCase.source) ||
        (testCase.title && safeTitle(testCase.title) !== testCase.title)) {
      throw new TypeError("engine evidence contains an unsafe identity field");
    }
    if (testCase.status !== canonicalStatus(evidence.engine, testCase.rawStatus, testCase.expectedStatus) &&
        testCase.status !== "unknown") {
      throw new TypeError("engine evidence status does not match raw status");
    }
  }
  return evidence;
}

export function engineCaseId({ engine, suite, source, title }) {
  return createHash("sha256")
    .update(JSON.stringify(["failure-gate-engine-case-v2", engine, suite, source, title]))
    .digest("hex");
}

function failureSignature(testCase) {
  if (testCase.status !== "failed") return null;
  const errors = testCase.errors.length
    ? testCase.errors
    : testCase.attempts.flatMap((attempt) => attempt.errors);
  if (errors.length === 0) return null;
  return createHash("sha256")
    .update(JSON.stringify(["failure-gate-error-signature-v1", errors.slice(0, MAX_ERRORS_PER_CASE)]))
    .digest("hex");
}

function projectCase(testCase, engine, suite, duplicate = false) {
  const status = duplicate || !testCase.source || !testCase.title
    ? "unknown"
    : testCase.status;
  return {
    id: engineCaseId({ engine, suite, source: testCase.source, title: testCase.title }),
    source: testCase.source,
    title: testCase.title,
    line: testCase.line,
    column: testCase.column,
    status,
    reportedStatus: testCase.rawStatus,
    errorCount: testCase.errorCount +
      testCase.attempts.reduce((total, attempt) => total + attempt.errorCount, 0),
    failureSignature: duplicate ? null : failureSignature(testCase),
    attempts: testCase.attempts.map(({ rawStatus, expectedStatus, retry }) => ({
      rawStatus,
      expectedStatus,
      retry,
    })),
  };
}

function deriveReportFields(evidence) {
  validateRawEvidence(evidence);
  const identityCounts = new Map();
  for (const testCase of evidence.cases) {
    const key = `${testCase.source}\u0000${testCase.title}`;
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  const cases = [];
  const emitted = new Set();
  for (const testCase of evidence.cases) {
    const key = `${testCase.source}\u0000${testCase.title}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    cases.push(projectCase(testCase, evidence.engine, evidence.suite, identityCounts.get(key) > 1));
  }
  const complete = evidence.complete &&
    evidence.reportedCaseCount === evidence.cases.length &&
    cases.length === evidence.cases.length &&
    cases.length > 0 &&
    cases.every((testCase) => testCase.status !== "unknown" && testCase.status !== "not_run" &&
      (testCase.status !== "failed" || testCase.failureSignature !== null));
  return {
    schemaVersion: TEST_CASE_REPORT_SCHEMA_VERSION,
    engine: evidence.engine,
    suite: evidence.suite,
    step: evidence.step,
    outcome: evidence.outcome,
    complete,
    environment: evidence.environment,
    cases,
  };
}

function strictJsonBytes(rawReportBytes) {
  if (!Buffer.isBuffer(rawReportBytes) && !(rawReportBytes instanceof Uint8Array)) {
    throw new TypeError("raw engine evidence must be bytes");
  }
  const bytes = Buffer.from(rawReportBytes);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ENGINE_EVIDENCE_BYTES) {
    throw new TypeError("raw engine evidence is empty or oversized");
  }
  const evidence = JSON.parse(bytes.toString("utf8"));
  validateRawEvidence(evidence);
  if (!Buffer.from(JSON.stringify(evidence)).equals(bytes)) {
    throw new TypeError("raw engine evidence is not canonical JSON");
  }
  return evidence;
}

function validateRawDescriptor(rawReport) {
  return exactKeys(rawReport, ["reference", "digest"]) &&
    typeof rawReport.reference === "string" &&
    rawReport.reference === basename(rawReport.reference) &&
    rawReport.reference !== "." && rawReport.reference !== ".." &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(rawReport.reference) &&
    /\.(?:engine|jsonl)$/.test(rawReport.reference) &&
    /^[0-9a-f]{64}$/.test(rawReport.digest);
}

export function verifyTestCaseReportBinding({ report, rawReportBytes }) {
  if (!isRecord(report) || report.schemaVersion !== TEST_CASE_REPORT_SCHEMA_VERSION ||
      !validateRawDescriptor(report.rawReport)) {
    throw new TypeError("invalid v2 test-case report binding");
  }
  if (!Buffer.isBuffer(rawReportBytes) && !(rawReportBytes instanceof Uint8Array)) {
    throw new TypeError("raw engine evidence must be bytes");
  }
  const bytes = Buffer.from(rawReportBytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== report.rawReport.digest) throw new TypeError("raw engine evidence digest mismatch");
  const evidence = strictJsonBytes(bytes);
  const expected = deriveReportFields(evidence);
  const actual = { ...report };
  delete actual.rawReport;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError("materialized test-case report does not match its raw evidence");
  }
  VERIFIED_REPORTS.set(report, JSON.stringify(report));
  return true;
}

export function resolveCaseObservation({ report, entry }) {
  if (!report || report.schemaVersion !== TEST_CASE_REPORT_SCHEMA_VERSION ||
      VERIFIED_REPORTS.get(report) !== JSON.stringify(report) ||
      !report.complete || !entry || !Array.isArray(report.cases) ||
      !report.cases.includes(entry) || !report.environment ||
      !ENGINE_EVIDENCE_STEPS.includes(report.step) ||
      report.environment.nodeMajor !== 24 ||
      report.environment.engineVersion !== ENVIRONMENT_VERSIONS[report.engine] ||
      !["passed", "failed"].includes(entry.status) ||
      (entry.status === "failed" && !/^[0-9a-f]{64}$/.test(entry.failureSignature ?? "")) ||
      (entry.status === "passed" && entry.failureSignature !== null) ||
      (Array.isArray(entry.attempts) && entry.attempts.some((attempt) =>
        attempt.rawStatus !== attempt.expectedStatus || attempt.expectedStatus !== "passed"))) {
    return null;
  }
  return Object.freeze({
    suite: report.suite,
    step: report.step,
    test: entry.id,
    failureSignature: entry.status === "failed" ? entry.failureSignature : null,
    environment: Object.freeze({ ...report.environment }),
  });
}

export async function writeEngineEvidenceReport({ outputDirectory, evidence }) {
  const rawEvidence = validateRawEvidence(evidence);
  const rawBytes = Buffer.from(JSON.stringify(rawEvidence));
  if (rawBytes.byteLength > MAX_ENGINE_EVIDENCE_BYTES) {
    throw new TypeError("engine evidence exceeds its byte limit");
  }
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const random = randomUUID();
  const rawName = `engine-${rawEvidence.engine}-${process.pid}-${random}.engine`;
  const reportName = `${rawEvidence.engine}-${process.pid}-${random}.json`;
  const writeExclusive = async (name, data) => {
    const path = resolve(directory, name);
    if (!path.startsWith(`${directory}${sep}`)) throw new TypeError("unsafe report path");
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  };
  await writeExclusive(rawName, rawBytes);
  const report = {
    ...deriveReportFields(rawEvidence),
    rawReport: {
      reference: rawName,
      digest: createHash("sha256").update(rawBytes).digest("hex"),
    },
  };
  verifyTestCaseReportBinding({ report, rawReportBytes: rawBytes });
  const temporaryName = `${reportName}.tmp`;
  await writeExclusive(temporaryName, `${JSON.stringify(report, null, 2)}\n`);
  await rename(resolve(directory, temporaryName), resolve(directory, reportName));
  return resolve(directory, reportName);
}

export async function readCanonicalEngineEvidence(path) {
  return strictJsonBytes(await readFile(path));
}