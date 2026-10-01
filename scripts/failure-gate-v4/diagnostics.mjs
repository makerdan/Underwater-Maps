import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalJson, digestJson, sha256 } from "./canonical.mjs";
import {
  resolveCaseObservation,
  verifyTestCaseReportBinding,
  writeEngineEvidenceReport,
} from "./engine-evidence.mjs";
import { loadTrackedBaselineCatalog, validatePlanningGuards } from "./planning.mjs";
import { getRegisteredValidationPolicy } from "./policy.mjs";
import { parseNodeTap } from "./node-tap-report.mjs";
import { captureWorkspaceSnapshot } from "./snapshot.mjs";
import { validateTestCaseReport } from "./test-case-report.mjs";
import { FailureGateStoredClassification } from "./stored-classification.mjs";

const TABLE = "failure_gate_v4_diagnostic_requests";
const RESERVATION_TABLE = "failure_gate_v4_isolation_reservations";
const ISOLATION_TABLE = "failure_gate_v4_isolation_attempts";
const MAX_RECORDS = 256;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_ISOLATION_RECORDS = 64;
const MAX_ISOLATION_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;
const MAX_TAP_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_SUBPROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const ISOLATION_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 500;
const ALLOWED_REQUEST_KEYS = new Set(["taskId", "observed"]);
const IDENTITY_KEYS = new Set(["suite", "test", "failureSignature", "environment"]);
const ISOLATION_REQUEST_KEYS = new Set(["taskId", "observed", "testFile", "testName"]);
const STORED_SELECTOR_KEYS = new Set([
  "taskId", "attemptId", "reportReference", "reportDigest", "caseId",
]);
const STORED_REQUEST_KEYS = new Set([
  ...STORED_SELECTOR_KEYS,
  "retryReferences", "preTaskReference", "corroborationReference", "repairReference",
]);
const V2_NODE_REPORTER = "scripts/failure-gate-v4/node-test-reporter.mjs";

export const FAILURE_GATE_DIAGNOSTICS_CAPABILITIES = Object.freeze({
  persistentFailClosedRequests: true,
  internallyDerivedPlanOwnership: true,
  boundedNodeTestIsolation: true,
  trustedStoredSourceIsolation: true,
  v2BoundDiagnosticRetryEvidence: true,
  trustedRetryClassificationAvailable: false,
  diagnosticRetriesAreRequiredTierEvidence: false,
  trustedIsolationExecution: true,
  callerObservedIsolationTrusted: false,
  actualIsolationRawStatus: true,
  immutableIsolationReportsAndDiscovery: true,
  trustedEarlierSnapshotFailureProvenance: false,
  independentStoredCorroboration: false,
  maxIsolationRetries: 3,
  unavailableReasons: Object.freeze([
    "Vitest and Playwright isolation are unsupported; trusted isolation supports only the fixed Node --test v2 reporter.",
    "Diagnostic isolation references are not projected into stored classification retries or required-tier completion records.",
    "Trusted source resolution requires synchronous getStoredRunRecord and complete v2 retained reports with verified snapshots and writer coordination.",
    "The planning baseline is a workspace snapshot, not a verified earlier test-failure record.",
    "No independent stored corroboration record type is available through coordinator public APIs.",
  ]),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed, label) {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.has(key)) ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} contains unsupported fields`);
  }
}

function normalizedObserved(value) {
  exactKeys(value, IDENTITY_KEYS, "observed identity");
  const observed = JSON.parse(canonicalJson(value));
  if (["suite", "test", "failureSignature"].some((key) =>
    typeof observed[key] !== "string" || observed[key].length === 0 || observed[key].length > 4096,
  ) || !isRecord(observed.environment)) {
    throw new TypeError("observed identity requires bounded suite, test, signature, and environment fields");
  }
  if (Buffer.byteLength(canonicalJson(observed), "utf8") > MAX_REQUEST_BYTES) {
    throw new RangeError("observed identity exceeds the bounded diagnostic request size");
  }
  return observed;
}

function normalizedRequest(input) {
  exactKeys(input, ALLOWED_REQUEST_KEYS, "diagnostic request");
  // Canonicalization rejects accessors, non-JSON values, and cyclic structures
  // before any request property is consumed.
  const normalized = JSON.parse(canonicalJson(input));
  if (typeof normalized.taskId !== "string" || !/^TASK-\d{6,}$/.test(normalized.taskId)) {
    throw new TypeError("diagnostic request taskId must be a local Failure Gate task ID");
  }
  return { taskId: normalized.taskId, observed: normalizedObserved(normalized.observed) };
}

function normalizedIsolationRequest(input) {
  exactKeys(input, ISOLATION_REQUEST_KEYS, "isolation request");
  const normalized = JSON.parse(canonicalJson(input));
  if (typeof normalized.taskId !== "string" || !/^TASK-\d{6,}$/.test(normalized.taskId)) {
    throw new TypeError("isolation request taskId must be a local Failure Gate task ID");
  }
  const observed = normalizedObserved(normalized.observed);
  const { testFile, testName } = normalized;
  if (typeof testFile !== "string" ||
      !/^scripts\/__tests__\/[^/]+\.test\.mjs$/.test(testFile) ||
      testFile.includes("\\") || /[\u0000-\u001f\u007f]/.test(testFile)) {
    throw new TypeError("isolation testFile must be a direct scripts/__tests__/*.test.mjs path");
  }
  if (typeof testName !== "string" || testName.length === 0 || testName.length > 4096 ||
      /[\u0000-\u001f\u007f]/.test(testName)) {
    throw new TypeError("isolation testName must be a bounded literal test title");
  }
  if (testName !== observed.test) {
    throw new Error("isolation testName must exactly match the observed identity test field");
  }
  return { taskId: normalized.taskId, observed, testFile, testName };
}

function normalizedStoredRequest(input, label = "stored diagnosis request") {
  exactKeys(input, STORED_REQUEST_KEYS, label);
  const canonical = canonicalJson(input);
  if (Buffer.byteLength(canonical, "utf8") > MAX_REQUEST_BYTES) {
    throw new RangeError(`${label} exceeds the bounded selector request size`);
  }
  const normalized = JSON.parse(canonical);
  if (typeof normalized.taskId !== "string" || !/^TASK-\d{6,}$/.test(normalized.taskId) ||
      typeof normalized.attemptId !== "string" || !normalized.attemptId ||
      normalized.attemptId.length > 4096 ||
      typeof normalized.reportReference !== "string" || !normalized.reportReference ||
      normalized.reportReference.length > 4096 ||
      !/^[0-9a-f]{64}$/.test(normalized.reportDigest ?? "") ||
      !/^[0-9a-f]{64}$/.test(normalized.caseId ?? "")) {
    throw new TypeError(`${label} requires an exact stored task/attempt/report-digest/case selector`);
  }
  return normalized;
}

function exactTestNamePattern(testName) {
  return `^${testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

function snapshotRecord(snapshot) {
  const bytes = Buffer.byteLength(snapshot.manifestContent, "utf8") +
    Buffer.byteLength(snapshot.environmentContent, "utf8");
  if (bytes > MAX_SNAPSHOT_BYTES) {
    throw new RangeError("workspace snapshot exceeds the bounded isolation record size");
  }
  return {
    manifestContent: snapshot.manifestContent,
    manifestDigest: snapshot.manifestDigest,
    environmentContent: snapshot.environmentContent,
    environmentDigest: snapshot.environmentDigest,
  };
}

function verifySnapshotRecord(snapshot) {
  if (!isRecord(snapshot) || typeof snapshot.manifestContent !== "string" ||
      typeof snapshot.environmentContent !== "string" ||
      sha256(snapshot.manifestContent) !== snapshot.manifestDigest ||
      sha256(snapshot.environmentContent) !== snapshot.environmentDigest) {
    throw new Error("stored isolation snapshot content or digest is invalid");
  }
  const manifest = JSON.parse(snapshot.manifestContent);
  const environment = JSON.parse(snapshot.environmentContent);
  if (canonicalJson(manifest) !== snapshot.manifestContent ||
      digestJson(manifest) !== snapshot.manifestDigest ||
      canonicalJson(environment) !== snapshot.environmentContent ||
      digestJson(environment) !== snapshot.environmentDigest) {
    throw new Error("stored isolation snapshot failed canonical hash verification");
  }
}

function artifactBytes(artifact, label) {
  if (!isRecord(artifact) ||
      Object.keys(artifact).length !== 3 ||
      Object.keys(artifact).some((key) => !["reference", "digest", "contentBase64"].includes(key)) ||
      typeof artifact.reference !== "string" ||
      !/^[0-9a-f]{64}$/.test(artifact.digest ?? "") ||
      typeof artifact.contentBase64 !== "string") {
    throw new Error(`${label} descriptor is malformed`);
  }
  const bytes = Buffer.from(artifact.contentBase64, "base64");
  if (bytes.toString("base64") !== artifact.contentBase64 || sha256(bytes) !== artifact.digest) {
    throw new Error(`${label} bytes do not match their stored digest`);
  }
  return bytes;
}

function sourceMatchesSelector(source, selector) {
  return source?.taskId === selector.taskId &&
    source?.attemptId === selector.attemptId &&
    source?.reportReference === selector.reportReference &&
    source?.reportDigest === selector.reportDigest &&
    source?.caseId === selector.caseId &&
    source?.rawStatus === "failed";
}

function equalJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameStoredIdentity(left, right) {
  return isRecord(left) && isRecord(right) &&
    left.suite === right.suite &&
    left.test === right.test &&
    left.failureSignature === right.failureSignature &&
    equalJson(left.environment, right.environment);
}

function decodeV2RetryEvidence(attempt) {
  const stored = attempt.v2CaseReport;
  if (!isRecord(stored) ||
      typeof stored.reportText !== "string" ||
      sha256(stored.reportText) !== stored.reportDigest ||
      typeof stored.rawReportBase64 !== "string" ||
      !/^[0-9a-f]{64}$/.test(stored.rawReportDigest ?? "")) {
    throw new Error("stored diagnostic v2 report or raw evidence is missing or has an invalid digest");
  }
  const rawReportBytes = Buffer.from(stored.rawReportBase64, "base64");
  if (rawReportBytes.toString("base64") !== stored.rawReportBase64 ||
      sha256(rawReportBytes) !== stored.rawReportDigest) {
    throw new Error("stored diagnostic raw engine evidence failed hash verification");
  }
  const report = validateTestCaseReport(JSON.parse(stored.reportText));
  if (report.schemaVersion !== 2 ||
      verifyTestCaseReportBinding({ report, rawReportBytes }) !== true) {
    throw new Error("stored diagnostic test-case report is not bound to its v2 raw evidence");
  }
  return { report, rawReportBytes };
}

function verifyDiagnosticRetryBinding(attempt, projectRoot) {
  if (attempt.purpose !== "diagnostic-isolation") return false;
  if (!attempt.v2CaseReport) return false;
  const { report } = decodeV2RetryEvidence(attempt);
  const rawReporterBytes = Buffer.from(attempt.report.text ?? "", "utf8");
  if (!attempt.report.text ||
      !rawReporterBytes.equals(Buffer.from(attempt.v2CaseReport.rawReportBase64, "base64")) ||
      attempt.v2CaseReport.rawReportReference !== report.rawReport.reference ||
      attempt.v2CaseReport.rawReportDigest !== report.rawReport.digest ||
      attempt.v2CaseReport.reference !==
        `failure-gate-v4-isolation/${attempt.attemptId}/case-report.json` ||
      !/^[0-9a-f]{64}$/.test(attempt.identityDigest ?? "") ||
      !/^[0-9a-f]{64}$/.test(attempt.reservationIdentityDigest ?? "")) {
    throw new Error("stored diagnostic retry report or identity digest is malformed");
  }
  const expectedIsolationEnvironment = {
    PATH: "/usr/bin:/bin",
    HOME: "<private-isolation-sandbox>",
    TMPDIR: "<private-isolation-sandbox>",
    TMP: "<private-isolation-sandbox>",
    TEMP: "<private-isolation-sandbox>",
    CI: "1",
    NODE_ENV: "test",
    LANG: "C",
    TZ: "UTC",
    FAILURE_GATE_V4_ISOLATION: "1",
    FAILURE_GATE_TEST_CASE_SUITE: report.suite,
    FAILURE_GATE_TEST_STEP: attempt.selection.step,
  };
  const expectedEnvironmentDigest = digestJson(expectedIsolationEnvironment);
  const expectedArgv = [
    "--test",
    `--test-reporter=${resolve(projectRoot, V2_NODE_REPORTER)}`,
    `--test-name-pattern=${exactTestNamePattern(attempt.selection.testName)}`,
    attempt.selection.testFile,
  ];
  const expectedInputDigest = digestJson({
    selector: attempt.selector,
    testFile: attempt.selection.testFile,
    testName: attempt.selection.testName,
    step: attempt.selection.step,
    tier: attempt.selection.tier,
  });
  const sourceSelectorMatches = attempt.selector?.taskId === attempt.taskId &&
    attempt.selector?.reportReference === attempt.sourceBinding?.reportReference &&
    attempt.selector?.reportDigest === attempt.sourceBinding?.reportDigest &&
    attempt.selector?.caseId === attempt.sourceBinding?.caseId &&
    /^[0-9a-f]{64}$/.test(attempt.sourceBinding?.sourceDigest ?? "") &&
    attempt.selection.caseId === attempt.selector.caseId &&
    attempt.selection.step === attempt.sourceBinding.step;
  if (attempt.environmentDigest !== expectedEnvironmentDigest ||
      !equalJson(attempt.isolationEnvironment, expectedIsolationEnvironment) ||
      !sourceSelectorMatches ||
      attempt.inputDigest !== expectedInputDigest ||
      attempt.retryAuthorization?.authorized !== true ||
      attempt.retryAuthorization?.safeIsolation !== true ||
      attempt.retryAuthorization?.identityDigest !== attempt.identityDigest ||
      attempt.retryAuthorization?.sourceDigest !== attempt.sourceBinding.sourceDigest ||
      !equalJson(Object.keys(attempt.retryAuthorization ?? {}).sort(), [
        "authorizationDigest", "authorized", "identityDigest", "safeIsolation",
        "schemaVersion", "sourceDigest",
      ]) ||
      attempt.retryAuthorization?.authorizationDigest !== attempt.authorizationDigest ||
      !equalJson(attempt.argv, expectedArgv) ||
      attempt.lifecycleState !== "released" ||
      !Number.isFinite(Date.parse(attempt.finishedAt)) ||
      attempt.authorizationDigest !== digestJson({
        schemaVersion: 1,
        purpose: "diagnostic-isolation",
        taskId: attempt.taskId,
        attemptId: attempt.attemptId,
        identityDigest: attempt.identityDigest,
        sourceBinding: attempt.sourceBinding,
        selection: attempt.selection,
        executable: attempt.executable,
        argv: attempt.argv,
        environmentDigest: attempt.environmentDigest,
        inputDigest: attempt.inputDigest,
      })) {
    throw new Error("stored diagnostic isolation authorization or environment digest is invalid");
  }
  const matches = report.cases.filter((entry) => entry.id === attempt.selection.caseId);
  if (!report.complete || report.engine !== "node-test" ||
      report.environment?.nodeMajor !== 24 || report.environment?.engineVersion !== "24" ||
      report.step !== attempt.selection.step ||
      attempt.selection.step !== "test:unit" ||
      matches.length !== 1 || report.cases.length !== 1) {
    throw new Error("stored diagnostic report did not discover exactly its selected Node test case");
  }
  const [entry] = matches;
  if (entry.source !== attempt.selection.testFile ||
      entry.title !== attempt.selection.testName ||
      !/^scripts\/__tests__\/[^/]+\.test\.mjs$/.test(entry.source) ||
      entry.title.length === 0 || entry.title.length > 4096 ||
      /[\u0000-\u001f\u007f]/.test(entry.title)) {
    throw new Error("stored diagnostic case does not match its exact file and full-title selection");
  }
  const observation = resolveCaseObservation({ report, entry });
  if (!observation ||
      !["passed", "failed"].includes(entry.status) ||
      attempt.execution.rawExitStatus !== (entry.status === "passed" ? 0 : 1) ||
      attempt.rawExitStatus !== attempt.execution.rawExitStatus ||
      attempt.environment?.nodeMajor !== 24 ||
      attempt.environment?.engineVersion !== "24" ||
      attempt.environment?.tier !== attempt.selection.tier) {
    throw new Error("stored diagnostic retry raw status, report environment, or selected case is invalid");
  }
  return true;
}

function loadStoredIsolationAttempt(store, reference) {
  const match = typeof reference === "string"
    ? reference.match(/^failure-gate-v4-isolation:([0-9a-f-]{36})$/)
    : null;
  if (!match || !store?.database) {
    if (!match) throw new TypeError("isolation reference is malformed");
    throw new TypeError("isolation record loading requires the Failure Gate store database");
  }
  const row = store.database.prepare(`
    SELECT attempt_id, task_id, identity_digest, retry_number, attempt_content, attempt_digest
    FROM ${ISOLATION_TABLE} WHERE attempt_id = ?
  `).get(match[1]);
  if (!row) return null;
  if (sha256(row.attempt_content) !== row.attempt_digest) {
    throw new Error("stored isolation attempt hash does not match its immutable content");
  }
  const reservation = store.database.prepare(`
    SELECT task_id, identity_digest, retry_number
    FROM ${RESERVATION_TABLE} WHERE attempt_id = ?
  `).get(match[1]);
  if (!reservation ||
      reservation.task_id !== row.task_id ||
      reservation.identity_digest !== row.identity_digest ||
      Number(reservation.retry_number) !== Number(row.retry_number)) {
    throw new Error("stored isolation attempt does not match its immutable retry reservation");
  }
  const attempt = JSON.parse(row.attempt_content);
  const reservationIdentityDigest = attempt.purpose === "diagnostic-isolation"
    ? attempt.reservationIdentityDigest
    : attempt.identityDigest;
  if (canonicalJson(attempt) !== row.attempt_content ||
      attempt.attemptId !== row.attempt_id ||
      attempt.taskId !== row.task_id ||
      attempt.retryNumber !== Number(row.retry_number) ||
      reservationIdentityDigest !== row.identity_digest ||
      (attempt.purpose !== "diagnostic-isolation" &&
        digestJson(attempt.observedIdentity) !== row.identity_digest)) {
    throw new Error("stored isolation attempt content is malformed or incorrectly bound");
  }
  if (attempt.report.text !== null) {
    if (sha256(attempt.report.text) !== attempt.report.digest ||
        Buffer.byteLength(attempt.report.text, "utf8") !== attempt.report.byteLength ||
        attempt.report.byteLength > MAX_TAP_REPORT_BYTES) {
      throw new Error("stored isolation report failed bounded hash verification");
    }
  } else if (attempt.report.digest !== null || attempt.report.byteLength !== 0) {
    throw new Error("stored isolation report has an incomplete digest binding");
  }
  if (digestJson(attempt.discovery) !== attempt.discoveryDigest) {
    throw new Error("stored isolation discovery failed hash verification");
  }
  if (attempt.beforeSnapshot) verifySnapshotRecord(attempt.beforeSnapshot);
  if (attempt.afterSnapshot) verifySnapshotRecord(attempt.afterSnapshot);
  const projectRoot = realpathSync(resolve(store.projectRoot));
  const retryEvidenceVerified = verifyDiagnosticRetryBinding(attempt, projectRoot);
  if (attempt.purpose === "diagnostic-isolation") {
    const snapshotsCaptured = attempt.beforeSnapshot !== null && attempt.afterSnapshot !== null;
    const snapshotsIdentical = snapshotsCaptured &&
      equalJson(attempt.beforeSnapshot, attempt.afterSnapshot);
    if (attempt.snapshot?.integrity !== "unknown" ||
        attempt.snapshot?.inputsUnchangedObserved !== snapshotsIdentical ||
        attempt.snapshot?.beforeSnapshotDigest !== (attempt.beforeSnapshot?.manifestDigest ?? null) ||
        attempt.snapshot?.afterSnapshotDigest !== (attempt.afterSnapshot?.manifestDigest ?? null) ||
        attempt.snapshot?.writerCoordination?.status !== "unknown" ||
        attempt.snapshotDigest !== (snapshotsCaptured
          ? digestJson({
            beforeSnapshot: attempt.beforeSnapshot,
            afterSnapshot: attempt.afterSnapshot,
          })
          : null)) {
      throw new Error("diagnostic retry snapshot state or all-writer status is malformed");
    }
  }
  return Object.freeze({
    reference,
    digest: row.attempt_digest,
    attempt: Object.freeze(attempt),
    retryEvidenceVerified,
  });
}

function executeNodeTest({ executable, argv, cwd, env }) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(executable, argv, {
        cwd,
        env,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolveResult({
        started: false,
        rawExitStatus: null,
        signal: null,
        timedOut: false,
        outputLimitExceeded: false,
        rawOutputDigest: null,
        outputBytes: 0,
        stdout: null,
      });
      return;
    }

    const streamHash = createHash("sha256");
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let outputBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let spawnError = false;
    let escalationTimer = null;
    let closed = false;

    const signalProcess = (signal) => {
      if (child.pid === undefined) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try { child.kill(signal); } catch { /* The child may already have exited. */ }
      }
    };
    const stop = () => {
      if (closed || child.exitCode !== null || child.signalCode !== null) return;
      signalProcess("SIGTERM");
      escalationTimer = setTimeout(() => signalProcess("SIGKILL"), STOP_GRACE_MS);
      escalationTimer.unref?.();
    };
    const addOutput = (streamName, chunk) => {
      const bytes = Buffer.from(chunk);
      outputBytes += bytes.length;
      streamHash.update(streamName);
      streamHash.update(bytes);
      if (streamName === "stdout") {
        stdoutBytes += bytes.length;
        if (stdoutBytes <= MAX_TAP_REPORT_BYTES) stdoutChunks.push(bytes);
      }
      if (outputBytes > MAX_SUBPROCESS_OUTPUT_BYTES && !outputLimitExceeded) {
        outputLimitExceeded = true;
        stop();
      }
    };
    child.stdout.on("data", (chunk) => addOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => addOutput("stderr", chunk));
    child.once("error", () => { spawnError = true; });
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, ISOLATION_TIMEOUT_MS);
    child.once("close", (code, signal) => {
      closed = true;
      clearTimeout(timeout);
      if (escalationTimer) clearTimeout(escalationTimer);
      resolveResult({
        started: !spawnError,
        rawExitStatus: spawnError ? null : code,
        signal,
        timedOut,
        outputLimitExceeded,
        rawOutputDigest: streamHash.digest("hex"),
        outputBytes,
        stdout: stdoutBytes <= MAX_TAP_REPORT_BYTES
          ? Buffer.concat(stdoutChunks).toString("utf8")
          : null,
      });
    });
  });
}

function blocked(reason, diagnosticReference = null) {
  return {
    outcome: "blocked",
    accepted: false,
    intermittent: false,
    baselineId: null,
    reason,
    diagnosticReference,
  };
}

/**
 * Persistent diagnostics for Failure Gate v4 classification.
 *
 * The original caller-observed API remains explicitly untrusted and blocked.
 * The separate stored-source route accepts selectors only and delegates
 * classification to the canonical v2 retained-run classifier; its isolation
 * records remain diagnostic-only and are never required-tier evidence.
 */
export class FailureGateDiagnostics {
  constructor({ store, coordinator } = {}) {
    this.store = store ?? coordinator?.store;
    if (!this.store || !this.store.database ||
        typeof this.store.getTask !== "function" ||
        typeof this.store.projectRoot !== "string") {
      throw new TypeError("diagnostics require a Failure Gate store with its public SQLite handle");
    }
    this.projectRoot = realpathSync(resolve(this.store.projectRoot));
    this.#initializeTables();
  }

  #initializeTables() {
    this.store.database.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        diagnostic_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        diagnostic_content TEXT NOT NULL,
        diagnostic_digest TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS ${TABLE}_immutable_update
      BEFORE UPDATE ON ${TABLE}
      BEGIN SELECT RAISE(ABORT, 'diagnostic records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS ${TABLE}_immutable_delete
      BEFORE DELETE ON ${TABLE}
      BEGIN SELECT RAISE(ABORT, 'diagnostic records are immutable'); END;
      CREATE TABLE IF NOT EXISTS ${RESERVATION_TABLE} (
        attempt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        identity_digest TEXT NOT NULL,
        retry_number INTEGER NOT NULL CHECK (retry_number BETWEEN 1 AND 3),
        reserved_at TEXT NOT NULL,
        UNIQUE(task_id, identity_digest, retry_number)
      );
      CREATE TRIGGER IF NOT EXISTS ${RESERVATION_TABLE}_immutable_update
      BEFORE UPDATE ON ${RESERVATION_TABLE}
      BEGIN SELECT RAISE(ABORT, 'isolation reservations are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS ${RESERVATION_TABLE}_immutable_delete
      BEFORE DELETE ON ${RESERVATION_TABLE}
      BEGIN SELECT RAISE(ABORT, 'isolation reservations are immutable'); END;
      CREATE TABLE IF NOT EXISTS ${ISOLATION_TABLE} (
        attempt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        identity_digest TEXT NOT NULL,
        retry_number INTEGER NOT NULL CHECK (retry_number BETWEEN 1 AND 3),
        created_at TEXT NOT NULL,
        attempt_content TEXT NOT NULL,
        attempt_digest TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ${ISOLATION_TABLE}_task_identity_idx
      ON ${ISOLATION_TABLE}(task_id, identity_digest, retry_number);
      CREATE TRIGGER IF NOT EXISTS ${ISOLATION_TABLE}_immutable_update
      BEFORE UPDATE ON ${ISOLATION_TABLE}
      BEGIN SELECT RAISE(ABORT, 'isolation attempts are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS ${ISOLATION_TABLE}_immutable_delete
      BEFORE DELETE ON ${ISOLATION_TABLE}
      BEGIN SELECT RAISE(ABORT, 'isolation attempts are immutable'); END;
    `);
  }

  async #deriveOwnership(taskId) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error("task is unavailable");
    if (!isRecord(task.plan) || task.planDigest !== digestJson(task.plan) ||
        task.plan.taskId !== task.taskId ||
        task.plan.projectNamespace !== task.projectNamespace ||
        task.plan.planVersion !== task.planVersion) {
      throw new Error("reserved plan binding is invalid");
    }
    const policy = getRegisteredValidationPolicy(this.projectRoot);
    const baselineCatalog = await loadTrackedBaselineCatalog({ projectRoot: this.projectRoot });
    const guard = await validatePlanningGuards({
      task,
      tierPolicy: policy.tiers[task.requestedTier],
      registeredTiers: policy.registeredTiers,
      baselineCatalog,
      projectRoot: this.projectRoot,
      asOf: new Date().toISOString().slice(0, 10),
    });
    if (!guard.ok) {
      throw new Error(`reserved plan or tracked catalog failed planning guards: ${guard.errors.join("; ")}`);
    }
    return {
      task,
      planDigest: task.planDigest,
      catalogReference: baselineCatalog.reference,
      catalogDigest: baselineCatalog.sha256,
      tierDefinitionDigest: policy.tiers[task.requestedTier].tierDefinitionDigest,
      policySnapshotDigest: policy.snapshotDigest,
      ignoredBaselineIds: [...guard.ignoredBaselineIds],
      ownedBaselineIds: [...guard.ownedBaselineIds],
    };
  }

  /**
   * Return baseline ownership only after deriving it from the reserved task's
   * canonical plan and the current tracked catalog. No caller-provided IDs are
   * accepted.
   */
  async derivePlanOwnership(input = {}) {
    exactKeys(input, new Set(["taskId"]), "ownership request");
    const { taskId } = input;
    if (typeof taskId !== "string") throw new TypeError("taskId is required");
    const derived = await this.#deriveOwnership(taskId);
    return Object.freeze({
      taskId: derived.task.taskId,
      planDigest: derived.planDigest,
      catalogReference: derived.catalogReference,
      catalogDigest: derived.catalogDigest,
      tierDefinitionDigest: derived.tierDefinitionDigest,
      policySnapshotDigest: derived.policySnapshotDigest,
      ignoredBaselineIds: Object.freeze(derived.ignoredBaselineIds),
      ownedBaselineIds: Object.freeze(derived.ownedBaselineIds),
    });
  }

  /**
   * Persist a bounded, hash-bound classification request. Caller identity is
   * retained exactly but is not an authenticated observation, so the result
   * remains blocked regardless of its apparent baseline match.
   */
  async classify(input = {}) {
    const request = normalizedRequest(input);
    let ownership = null;
    let derivationAvailable = false;
    try {
      ownership = await this.#deriveOwnership(request.taskId);
      derivationAvailable = true;
    } catch {
      // The persisted record contains only a fail-closed status, not an
      // exception string that could disclose local paths or environment data.
    }

    const diagnostic = {
      schemaVersion: 1,
      purpose: "failure_classification_request",
      taskId: request.taskId,
      createdAt: new Date().toISOString(),
      observed: request.observed,
      observationTrust: "caller-supplied-untrusted",
      ...(derivationAvailable ? {
        planDigest: ownership.planDigest,
        baselineCatalogReference: ownership.catalogReference,
        baselineCatalogDigest: ownership.catalogDigest,
        ignoredBaselineIds: ownership.ignoredBaselineIds,
        ownedBaselineIds: ownership.ownedBaselineIds,
      } : {}),
      outcome: "blocked",
      accepted: false,
      reason: derivationAvailable
        ? "exact failure identity is not bound to trusted stored tier evidence or provenance"
        : "task ownership or authoritative tracked catalog could not be derived and validated",
      unavailableCapabilities: [
        "trusted binding from the caller signature to a stored tier-report case",
        "trusted direct earlier-snapshot failure provenance",
        "independent corroboration resolved from stored verified records",
      ],
    };
    const reference = this.#persist(diagnostic);
    return {
      ...blocked(diagnostic.reason, reference),
      planOwnershipDerived: derivationAvailable,
    };
  }

  async #validateTrackedTest(testFile) {
    const absolute = resolve(this.projectRoot, testFile);
    if (!absolute.startsWith(`${this.projectRoot}${sep}`)) {
      throw new Error("isolation test path escapes the project root");
    }
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(absolute) !== absolute) {
      throw new Error("isolation target must be a regular non-symlink file");
    }
    let trackedPath;
    try {
      trackedPath = execFileSync("git", [
        "-C", this.projectRoot, "ls-files", "--error-unmatch", "--", testFile,
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
    } catch {
      throw new Error("isolation target is not tracked by Git");
    }
    if (trackedPath !== testFile) throw new Error("tracked isolation target did not resolve exactly");
  }

  #reserveIsolationAttempt(taskId, identityDigest) {
    const database = this.store.database;
    database.exec("BEGIN IMMEDIATE");
    try {
      const previous = Number(database.prepare(`
        SELECT COUNT(*) AS count FROM ${RESERVATION_TABLE}
        WHERE task_id = ? AND identity_digest = ?
      `).get(taskId, identityDigest).count);
      if (previous >= 3) {
        throw new Error("isolation retry limit reached: at most three attempts are permitted per task and exact failure identity");
      }
      const total = Number(database.prepare(
        `SELECT COUNT(*) AS count FROM ${RESERVATION_TABLE}`,
      ).get().count);
      if (total >= MAX_ISOLATION_RECORDS) {
        throw new Error(`isolation store reached its ${MAX_ISOLATION_RECORDS}-attempt bound`);
      }
      const attemptId = randomUUID();
      const retryNumber = previous + 1;
      const reservedAt = new Date().toISOString();
      database.prepare(`
        INSERT INTO ${RESERVATION_TABLE}(attempt_id, task_id, identity_digest, retry_number, reserved_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(attemptId, taskId, identityDigest, retryNumber, reservedAt);
      database.exec("COMMIT");
      return { attemptId, retryNumber, reservedAt };
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* Keep the original error. */ }
      throw error;
    }
  }

  #assertIsolationAttemptAvailable(taskId, identityDigest) {
    const existing = Number(this.store.database.prepare(`
      SELECT COUNT(*) AS count FROM ${RESERVATION_TABLE}
      WHERE task_id = ? AND identity_digest = ?
    `).get(taskId, identityDigest).count);
    if (existing >= 3) {
      throw new Error("isolation retry limit reached: at most three attempts are permitted per task and exact failure identity");
    }
  }

  /**
   * Execute one fixed-argv Node TAP test selection. The test title is matched
   * literally and must equal observed.test. No command, argv, environment, or
   * timeout is caller-selectable. Every result stays blocked for classification.
   */
  async runIsolationRetry(input = {}) {
    const request = normalizedIsolationRequest(input);
    const identityDigest = digestJson(request.observed);
    this.#assertIsolationAttemptAvailable(request.taskId, identityDigest);
    const ownershipBefore = await this.#deriveOwnership(request.taskId);
    await this.#validateTrackedTest(request.testFile);
    const reservation = this.#reserveIsolationAttempt(request.taskId, identityDigest);
    const startedAt = new Date().toISOString();
    let beforeSnapshot = null;
    let afterSnapshot = null;
    let ownershipAfter = null;
    let ownershipStable = false;
    let sandbox = null;
    let failureReason = null;
    let execution = {
      started: false,
      rawExitStatus: null,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      rawOutputDigest: null,
      outputBytes: 0,
      stdout: null,
    };
    const testNamePattern = exactTestNamePattern(request.testName);
    const argv = [
      "--test",
      "--test-reporter=tap",
      `--test-name-pattern=${testNamePattern}`,
      request.testFile,
    ];

    try {
      beforeSnapshot = snapshotRecord(await captureWorkspaceSnapshot(this.projectRoot));
      sandbox = await mkdtemp(join(tmpdir(), "failure-gate-v4-isolation-"));
      execution = await executeNodeTest({
        executable: process.execPath,
        argv,
        cwd: this.projectRoot,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: sandbox,
          TMPDIR: sandbox,
          TMP: sandbox,
          TEMP: sandbox,
          CI: "1",
          NODE_ENV: "test",
          LANG: "C",
          TZ: "UTC",
          FAILURE_GATE_V4_ISOLATION: "1",
        },
      });
    } catch (error) {
      failureReason = error.message;
    } finally {
      try {
        afterSnapshot = snapshotRecord(await captureWorkspaceSnapshot(this.projectRoot));
      } catch {
        afterSnapshot = null;
        failureReason ??= "after snapshot could not be captured";
      }
      try {
        ownershipAfter = await this.#deriveOwnership(request.taskId);
        ownershipStable = canonicalJson({
          planDigest: ownershipBefore.planDigest,
          catalogDigest: ownershipBefore.catalogDigest,
          tierDefinitionDigest: ownershipBefore.tierDefinitionDigest,
          policySnapshotDigest: ownershipBefore.policySnapshotDigest,
          ignoredBaselineIds: ownershipBefore.ignoredBaselineIds,
          ownedBaselineIds: ownershipBefore.ownedBaselineIds,
        }) === canonicalJson({
          planDigest: ownershipAfter.planDigest,
          catalogDigest: ownershipAfter.catalogDigest,
          tierDefinitionDigest: ownershipAfter.tierDefinitionDigest,
          policySnapshotDigest: ownershipAfter.policySnapshotDigest,
          ignoredBaselineIds: ownershipAfter.ignoredBaselineIds,
          ownedBaselineIds: ownershipAfter.ownedBaselineIds,
        });
        if (!ownershipStable) failureReason ??= "task plan, tier policy, or baseline catalog changed during isolation";
      } catch {
        ownershipAfter = null;
        failureReason ??= "task plan ownership or tracked catalog could not be revalidated after isolation";
      }
      if (sandbox) {
        await rm(sandbox, { recursive: true, force: true }).catch(() => {});
      }
    }

    const reportText = execution.stdout;
    const reportBytes = reportText === null ? 0 : Buffer.byteLength(reportText, "utf8");
    const reportDigest = reportText === null ? null : sha256(reportText);
    let discovery = {
      adapter: "node-tap-parser-v1",
      available: false,
      reason: "isolation subprocess did not produce a bounded TAP report",
      cases: [],
      complete: false,
    };
    if (reportText !== null) {
      try {
        const parsed = parseNodeTap(reportText);
        const selectedCases = parsed.cases.filter((entry) => entry.title === request.testName);
        discovery = {
          adapter: "node-tap-parser-v1",
          available: parsed.complete && selectedCases.length > 0,
          tests: parsed.tests,
          cases: parsed.cases,
          selectedCaseCount: selectedCases.length,
          selectedCases,
          complete: parsed.complete && selectedCases.length > 0,
          ...(!parsed.complete || selectedCases.length === 0
            ? { reason: selectedCases.length === 0
              ? "TAP reporter discovered no exact selected test title"
              : "TAP discovery is incomplete" }
            : {}),
        };
      } catch {
        discovery = {
          adapter: "node-tap-parser-v1",
          available: false,
          reason: "TAP report is malformed",
          cases: [],
          complete: false,
        };
      }
    }
    const selectedCaseTitleMatched = discovery.selectedCaseCount === 1;
    const selectedCaseStatus = selectedCaseTitleMatched
      ? discovery.selectedCases[0].status
      : null;
    const createdAt = new Date().toISOString();
    const attempt = {
      schemaVersion: 1,
      purpose: "bounded_node_test_isolation",
      taskId: request.taskId,
      createdAt,
      startedAt,
      attemptId: reservation.attemptId,
      retryNumber: reservation.retryNumber,
      identityDigest,
      observedIdentity: request.observed,
      observationTrust: "caller-supplied-untrusted",
      ownershipBefore: {
        planDigest: ownershipBefore.planDigest,
        catalogReference: ownershipBefore.catalogReference,
        catalogDigest: ownershipBefore.catalogDigest,
        tierDefinitionDigest: ownershipBefore.tierDefinitionDigest,
        policySnapshotDigest: ownershipBefore.policySnapshotDigest,
        ignoredBaselineIds: ownershipBefore.ignoredBaselineIds,
        ownedBaselineIds: ownershipBefore.ownedBaselineIds,
      },
      ownershipAfter: ownershipAfter ? {
        planDigest: ownershipAfter.planDigest,
        catalogReference: ownershipAfter.catalogReference,
        catalogDigest: ownershipAfter.catalogDigest,
        tierDefinitionDigest: ownershipAfter.tierDefinitionDigest,
        policySnapshotDigest: ownershipAfter.policySnapshotDigest,
        ignoredBaselineIds: ownershipAfter.ignoredBaselineIds,
        ownedBaselineIds: ownershipAfter.ownedBaselineIds,
      } : null,
      ownershipStable,
      selection: {
        testFile: request.testFile,
        testName: request.testName,
        testNamePattern,
      },
      executable: process.execPath,
      argv,
      environmentDigest: digestJson({
        PATH: "/usr/bin:/bin",
        HOME: "<private-isolation-sandbox>",
        TMPDIR: "<private-isolation-sandbox>",
        TMP: "<private-isolation-sandbox>",
        TEMP: "<private-isolation-sandbox>",
        CI: "1",
        NODE_ENV: "test",
        LANG: "C",
        TZ: "UTC",
        FAILURE_GATE_V4_ISOLATION: "1",
      }),
      beforeSnapshot,
      afterSnapshot,
      execution: {
        started: execution.started,
        rawExitStatus: execution.rawExitStatus,
        signal: execution.signal,
        timedOut: execution.timedOut,
        outputLimitExceeded: execution.outputLimitExceeded,
        rawOutputDigest: execution.rawOutputDigest,
        outputBytes: execution.outputBytes,
      },
      report: {
        adapter: "node-tap-parser-v1",
        text: reportText,
        byteLength: reportBytes,
        digest: reportDigest,
      },
      discovery,
      discoveryDigest: digestJson(discovery),
      identityBinding: {
        selectedCaseTitleMatched,
        selectedCaseStatus,
        storedTierReportCaseBound: false,
        failureSignatureBound: false,
        verified: false,
        reason: "Node TAP confirms only the selected retry case title/status; it does not bind the caller's signature or an actual stored tier-report case",
      },
      outcome: "blocked",
      accepted: false,
      reason: failureReason ??
        "isolation result cannot establish a trusted tier-report identity, earlier-snapshot provenance, or independent corroboration",
      retryPassingIsNotProvenance: true,
    };
    const reference = this.#persistIsolationAttempt(attempt, identityDigest, reservation);
    return {
      reference,
      attemptId: reservation.attemptId,
      retryNumber: reservation.retryNumber,
      rawExitStatus: execution.rawExitStatus,
      signal: execution.signal,
      timedOut: execution.timedOut,
      outputLimitExceeded: execution.outputLimitExceeded,
      discovery,
      outcome: "blocked",
      accepted: false,
      reason: attempt.reason,
    };
  }

  #storedClassifier() {
    if (typeof this.store.getStoredRunRecord !== "function") {
      throw new Error("trusted stored-source diagnosis is unavailable without synchronous getStoredRunRecord({taskId, attemptId})");
    }
    this.storedFailureClassifier ??= new FailureGateStoredClassification({
      store: this.store,
      projectRoot: this.projectRoot,
    });
    return this.storedFailureClassifier;
  }

  #classifyStoredRequest(request) {
    return this.#storedClassifier().classifyStoredFailure(request);
  }

  /**
   * Classify only selectors for an existing retained v2 case report. Unlike
   * classify(), this path never accepts caller-observed identity fields.
   * The immutable diagnostic is separate from required-tier completion data.
   */
  classifyStoredFailure(input = {}) {
    const request = normalizedStoredRequest(input);
    const classification = this.#classifyStoredRequest(request);
    const diagnostic = {
      schemaVersion: 1,
      purpose: "stored_source_failure_diagnosis",
      taskId: request.taskId,
      createdAt: new Date().toISOString(),
      selector: {
        taskId: request.taskId,
        attemptId: request.attemptId,
        reportReference: request.reportReference,
        reportDigest: request.reportDigest,
        caseId: request.caseId,
      },
      classification,
      requiredTierEvidence: false,
    };
    const reference = this.#persist(diagnostic);
    return { ...classification, diagnosticReference: reference };
  }

  #resolveStoredFailureSource(request, classification) {
    const selector = {
      taskId: request.taskId,
      attemptId: request.attemptId,
      reportReference: request.reportReference,
      reportDigest: request.reportDigest,
      caseId: request.caseId,
    };
    const primarySource = classification.sourceDigests?.find((source) =>
      sourceMatchesSelector(source, selector));
    if (!primarySource) {
      throw new Error(
        classification.reason ??
          "stored classifier could not verify this exact v2 retained failure report and case",
      );
    }
    const stored = this.store.getStoredRunRecord({
      taskId: selector.taskId,
      attemptId: selector.attemptId,
    });
    if (stored && typeof stored.then === "function") {
      throw new TypeError("trusted diagnostics require synchronous getStoredRunRecord resolution");
    }
    if (!isRecord(stored) || !isRecord(stored.task) || !isRecord(stored.attempt) ||
        !isRecord(stored.evidence) ||
        stored.task.taskId !== selector.taskId ||
        stored.attempt.taskId !== selector.taskId ||
        stored.attempt.attemptId !== selector.attemptId ||
        stored.attempt.lifecycleState !== "released" ||
        stored.attempt.evidenceDigest !== digestJson(stored.evidence) ||
        stored.evidence.complete !== true ||
        stored.evidence.discovery?.artifactsAvailable !== true ||
        !Array.isArray(stored.evidence.discovery.artifacts)) {
      throw new Error("stored task/attempt/evidence binding is unavailable or incomplete");
    }
    const artifacts = stored.evidence.discovery.artifacts.map((artifact) => ({
      artifact,
      bytes: artifactBytes(artifact, "retained discovery artifact"),
    }));
    const reports = artifacts.filter(({ artifact }) =>
      artifact.reference === selector.reportReference &&
      artifact.digest === selector.reportDigest);
    if (reports.length !== 1) {
      throw new Error("selected report reference and digest are not a unique retained artifact");
    }
    let report;
    try {
      const text = reports[0].bytes.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(reports[0].bytes)) throw new Error("invalid UTF-8");
      report = validateTestCaseReport(JSON.parse(text));
    } catch {
      throw new Error("selected retained v2 case report is malformed");
    }
    if (report.schemaVersion !== 2 || !report.complete || report.engine !== "node-test" ||
        report.step !== "test:unit" ||
        report.environment?.nodeMajor !== 24 || report.environment?.engineVersion !== "24") {
      throw new Error(
        "safe isolation supports only complete Node --test test:unit reports from the verified Node 24 environment",
      );
    }
    const entries = report.cases.filter((entry) => entry.id === selector.caseId);
    if (entries.length !== 1 || entries[0].status !== "failed") {
      throw new Error("selected v2 case must be one uniquely retained raw failure");
    }
    const [entry] = entries;
    if (!report.rawReport ||
        !/^[0-9a-f]{64}$/.test(report.rawReport.digest ?? "")) {
      throw new Error("selected v2 case report has no verified raw engine report binding");
    }
    const rawMatches = artifacts.filter(({ artifact }) =>
      artifact.reference.split(/[\\/]/).at(-1) === report.rawReport.reference &&
      artifact.digest === report.rawReport.digest);
    if (rawMatches.length !== 1 ||
        verifyTestCaseReportBinding({
          report,
          rawReportBytes: rawMatches[0].bytes,
        }) !== true) {
      throw new Error("selected v2 case report is not bound to one retained raw engine report");
    }
    const observation = resolveCaseObservation({ report, entry });
    if (!isRecord(observation) || observation.step !== report.step ||
        !/^[0-9a-f]{64}$/.test(observation.failureSignature ?? "") ||
        observation.failureSignature !== entry.failureSignature) {
      throw new Error("selected v2 case did not resolve to its actual trusted failure signature");
    }
    const testFile = entry.source;
    if (typeof testFile !== "string" ||
        !/^scripts\/__tests__\/[^/]+\.test\.mjs$/.test(testFile) ||
        testFile.includes("\\") || /[\u0000-\u001f\u007f]/.test(testFile) ||
        typeof entry.title !== "string" || entry.title.length === 0 ||
        entry.title.length > 4096 || /[\u0000-\u001f\u007f]/.test(entry.title)) {
      throw new Error("selected v2 case is outside the fixed tracked Node-test isolation adapter");
    }
    const identity = {
      suite: observation.suite,
      test: `${entry.source} — ${entry.title}`,
      failureSignature: observation.failureSignature,
      environment: { ...observation.environment, tier: stored.task.requestedTier },
    };
    if (primarySource.rawStatus !== "failed" ||
        typeof stored.task.requestedTier !== "string" ||
        !stored.attempt.snapshot?.writerCoordination ||
        stored.attempt.snapshot.writerCoordination.status !== "verified") {
      throw new Error("stored failure or writer-coordination source binding is not trusted");
    }
    return {
      selector,
      task: stored.task,
      attempt: stored.attempt,
      report,
      entry,
      observation,
      identity,
      step: report.step,
      testFile,
      testName: entry.title,
      classification,
    };
  }

  /**
   * Run one bounded Node --test retry from a verified retained v2 source case.
   * Each reference is diagnostic-only; it is not required-tier completion
   * evidence, and it cannot independently accept a failure classification.
   */
  async runStoredIsolationRetry(input = {}) {
    const request = normalizedStoredRequest(input, "stored isolation request");
    const classification = this.#classifyStoredRequest(request);
    const source = this.#resolveStoredFailureSource(request, classification);
    if (process.versions.node.split(".")[0] !== "24") {
      throw new Error("trusted Node isolation is unavailable outside the verified Node 24 runtime");
    }
    await this.#validateTrackedTest(source.testFile);
    await this.#validateTrackedTest(V2_NODE_REPORTER);
    const identityDigest = digestJson(source.identity);
    const reservationIdentityDigest = digestJson({
      purpose: "diagnostic-isolation",
      identity: source.identity,
    });
    this.#assertIsolationAttemptAvailable(request.taskId, reservationIdentityDigest);
    const ownershipBefore = await this.#deriveOwnership(request.taskId);
    const reservation = this.#reserveIsolationAttempt(request.taskId, reservationIdentityDigest);
    const startedAt = new Date().toISOString();
    const testNamePattern = exactTestNamePattern(source.testName);
    const reporterPath = resolve(this.projectRoot, V2_NODE_REPORTER);
    const argv = [
      "--test",
      `--test-reporter=${reporterPath}`,
      `--test-name-pattern=${testNamePattern}`,
      source.testFile,
    ];
    const safeEnvironment = {
      PATH: "/usr/bin:/bin",
      HOME: null,
      TMPDIR: null,
      TMP: null,
      TEMP: null,
      CI: "1",
      NODE_ENV: "test",
      LANG: "C",
      TZ: "UTC",
      FAILURE_GATE_V4_ISOLATION: "1",
      FAILURE_GATE_TEST_CASE_SUITE: source.report.suite,
      FAILURE_GATE_TEST_STEP: source.step,
    };
    let sandbox = null;
    let beforeSnapshot = null;
    let afterSnapshot = null;
    let ownershipAfter = null;
    let ownershipStable = false;
    let failureReason = null;
    let execution = {
      started: false,
      rawExitStatus: null,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      rawOutputDigest: null,
      outputBytes: 0,
      stdout: null,
    };
    try {
      beforeSnapshot = snapshotRecord(await captureWorkspaceSnapshot(this.projectRoot));
      sandbox = await mkdtemp(join(tmpdir(), "failure-gate-v4-stored-isolation-"));
      for (const key of ["HOME", "TMPDIR", "TMP", "TEMP"]) safeEnvironment[key] = sandbox;
      execution = await executeNodeTest({
        executable: process.execPath,
        argv,
        cwd: this.projectRoot,
        env: safeEnvironment,
      });
    } catch (error) {
      failureReason = error instanceof Error ? error.message : "trusted Node isolation failed";
    } finally {
      try {
        afterSnapshot = snapshotRecord(await captureWorkspaceSnapshot(this.projectRoot));
      } catch {
        afterSnapshot = null;
        failureReason ??= "after-isolation workspace snapshot could not be captured";
      }
      try {
        ownershipAfter = await this.#deriveOwnership(request.taskId);
        ownershipStable = equalJson({
          planDigest: ownershipBefore.planDigest,
          catalogDigest: ownershipBefore.catalogDigest,
          tierDefinitionDigest: ownershipBefore.tierDefinitionDigest,
          policySnapshotDigest: ownershipBefore.policySnapshotDigest,
          ignoredBaselineIds: ownershipBefore.ignoredBaselineIds,
          ownedBaselineIds: ownershipBefore.ownedBaselineIds,
        }, {
          planDigest: ownershipAfter.planDigest,
          catalogDigest: ownershipAfter.catalogDigest,
          tierDefinitionDigest: ownershipAfter.tierDefinitionDigest,
          policySnapshotDigest: ownershipAfter.policySnapshotDigest,
          ignoredBaselineIds: ownershipAfter.ignoredBaselineIds,
          ownedBaselineIds: ownershipAfter.ownedBaselineIds,
        });
        if (!ownershipStable) failureReason ??= "task plan, tier policy, or baseline catalog changed during isolation";
      } catch {
        ownershipAfter = null;
        failureReason ??= "task plan ownership could not be revalidated after isolation";
      }
      if (sandbox) await rm(sandbox, { recursive: true, force: true }).catch(() => {});
    }

    let v2CaseReport = null;
    let retryObservation = null;
    let selectedCaseCount = 0;
    let discoveryReason = "isolation subprocess did not produce a bounded v2 engine report";
    const reportText = execution.stdout;
    // Materialize the reporter output into a private directory so the v2
    // envelope and raw engine bytes can both be independently verified.
    if (reportText !== null && execution.started && !execution.timedOut &&
        !execution.outputLimitExceeded) {
      try {
        const rawEvidence = JSON.parse(reportText);
        if (JSON.stringify(rawEvidence) !== reportText) {
          throw new Error("Node v2 reporter output is not one canonical raw evidence object");
        }
        const reportDirectory = await mkdtemp(join(tmpdir(), "failure-gate-v4-v2-report-"));
        try {
          const reportPath = await writeEngineEvidenceReport({
            outputDirectory: reportDirectory,
            evidence: rawEvidence,
          });
          const materializedReportBytes = await readFile(reportPath);
          const materializedReportText = materializedReportBytes.toString("utf8");
          const report = validateTestCaseReport(JSON.parse(materializedReportText));
          const rawReportBytes = Buffer.from(reportText, "utf8");
          if (verifyTestCaseReportBinding({ report, rawReportBytes }) !== true) {
            throw new Error("retry v2 report does not bind the exact raw engine report");
          }
          const matches = report.cases.filter((entry) => entry.id === source.selector.caseId);
          selectedCaseCount = matches.length;
          if (!report.complete || report.engine !== "node-test" ||
              report.step !== source.step || report.cases.length !== 1 ||
              matches.length !== 1) {
            throw new Error("retry did not discover exactly the selected v2 Node test case");
          }
          const [entry] = matches;
          const observation = resolveCaseObservation({ report, entry });
          retryObservation = {
            suite: observation.suite,
            test: `${entry.source} — ${entry.title}`,
            failureSignature: observation.failureSignature,
            environment: { ...observation.environment, tier: source.task.requestedTier },
          };
          const identityMatches =
            retryObservation.suite === source.identity.suite &&
            retryObservation.test === source.identity.test &&
            equalJson(retryObservation.environment, source.identity.environment) &&
            (entry.status !== "failed" ||
              retryObservation.failureSignature === source.identity.failureSignature);
          if (!identityMatches || !["passed", "failed"].includes(entry.status) ||
              execution.rawExitStatus !== (entry.status === "passed" ? 0 : 1)) {
            throw new Error("retry result or v2 report identity does not match the exact stored failure");
          }
          const rawReportPath = join(reportDirectory, report.rawReport.reference);
          const rawReportBytesFromDisk = await readFile(rawReportPath);
          if (!rawReportBytesFromDisk.equals(rawReportBytes)) {
            throw new Error("materialized retry report does not retain the exact v2 reporter bytes");
          }
          v2CaseReport = {
            reference:
              `failure-gate-v4-isolation/${reservation.attemptId}/case-report.json`,
            reportText: materializedReportText,
            reportDigest: sha256(materializedReportText),
            rawReportReference: report.rawReport.reference,
            rawReportDigest: sha256(rawReportBytesFromDisk),
            rawReportBase64: rawReportBytesFromDisk.toString("base64"),
          };
          discoveryReason = null;
        } finally {
          await rm(reportDirectory, { recursive: true, force: true }).catch(() => {});
        }
      } catch (error) {
        discoveryReason = error instanceof Error ? error.message : "v2 retry report binding failed";
        v2CaseReport = null;
        retryObservation = null;
      }
    }
    const v2ReportBound = Boolean(v2CaseReport && retryObservation && discoveryReason === null);
    const trustedRetry = false;
    const selectedCaseStatus = v2ReportBound
      ? JSON.parse(v2CaseReport.reportText).cases[0].status
      : null;
    const createdAt = new Date().toISOString();
    const environmentDigest = digestJson(Object.fromEntries(
      Object.entries(safeEnvironment).map(([key, value]) => [
        key, ["HOME", "TMPDIR", "TMP", "TEMP"].includes(key)
          ? "<private-isolation-sandbox>"
          : value,
      ]),
    ));
    const sourceBinding = {
      reportReference: source.selector.reportReference,
      reportDigest: source.selector.reportDigest,
      caseId: source.selector.caseId,
      rawReportReference: source.report.rawReport.reference,
      rawReportDigest: source.report.rawReport.digest,
      step: source.step,
      sourceDigest: source.classification.sourceDigests.find((record) =>
        sourceMatchesSelector(record, source.selector)).sourceDigest,
    };
    const inputDigest = digestJson({
      selector: source.selector,
      testFile: source.testFile,
      testName: source.testName,
      step: source.step,
      tier: source.task.requestedTier,
    });
    const selection = {
      testFile: source.testFile,
      testName: source.testName,
      testNamePattern,
      caseId: source.selector.caseId,
      step: source.step,
      tier: source.task.requestedTier,
    };
    const authorizationDigest = digestJson({
      schemaVersion: 1,
      purpose: "diagnostic-isolation",
      taskId: request.taskId,
      attemptId: reservation.attemptId,
      identityDigest,
      sourceBinding,
      selection,
      executable: process.execPath,
      argv,
      environmentDigest,
      inputDigest,
    });
    const snapshotsCaptured = beforeSnapshot !== null && afterSnapshot !== null;
    const snapshotsIdentical = snapshotsCaptured && equalJson(beforeSnapshot, afterSnapshot);
    const snapshotDigest = snapshotsCaptured
      ? digestJson({ beforeSnapshot, afterSnapshot })
      : null;
    const isolationEnvironment = Object.fromEntries(
      Object.entries(safeEnvironment).map(([key, value]) => [
        key, ["HOME", "TMPDIR", "TMP", "TEMP"].includes(key)
          ? "<private-isolation-sandbox>"
          : value,
      ]),
    );
    const attempt = {
      schemaVersion: 1,
      purpose: "diagnostic-isolation",
      taskId: request.taskId,
      createdAt,
      startedAt,
      finishedAt: createdAt,
      attemptId: reservation.attemptId,
      retryNumber: reservation.retryNumber,
      identityDigest,
      reservationIdentityDigest,
      authorizationDigest,
      inputDigest,
      status: execution.rawExitStatus === 0 ? "PASS"
        : execution.rawExitStatus === null ? "UNKNOWN" : "FAIL",
      lifecycleState: "released",
      planReference: source.task.planReference,
      planVersion: source.task.planVersion,
      planDigest: source.task.planDigest,
      tier: source.task.requestedTier,
      tierDefinitionDigest: source.task.tierDefinitionDigest,
      registryDigest: source.task.registryDigest,
      wrapperDigest: source.task.wrapperDigest,
      reportAdapterId: getRegisteredValidationPolicy(this.projectRoot)
        .tiers[source.task.requestedTier]?.reportAdapterId ?? null,
      rawExitStatus: execution.rawExitStatus,
      rawOutputDigest: execution.rawOutputDigest,
      environmentDigest,
      isolationEnvironment,
      environment: {
        nodeMajor: 24,
        engineVersion: "24",
        tier: source.task.requestedTier,
      },
      snapshotDigest,
      snapshot: {
        integrity: "unknown",
        beforeSnapshotDigest: beforeSnapshot?.manifestDigest ?? null,
        afterSnapshotDigest: afterSnapshot?.manifestDigest ?? null,
        inputsUnchangedObserved: snapshotsIdentical,
        writerCoordination: {
          status: "unknown",
          adapterId: null,
          evidenceDigest: null,
        },
      },
      selector: source.selector,
      sourceBinding,
      retryAuthorization: {
        schemaVersion: 1,
        authorized: true,
        safeIsolation: true,
        identityDigest,
        authorizationDigest,
        sourceDigest: sourceBinding.sourceDigest,
      },
      ownershipBefore: {
        planDigest: ownershipBefore.planDigest,
        catalogReference: ownershipBefore.catalogReference,
        catalogDigest: ownershipBefore.catalogDigest,
        tierDefinitionDigest: ownershipBefore.tierDefinitionDigest,
        policySnapshotDigest: ownershipBefore.policySnapshotDigest,
        ignoredBaselineIds: ownershipBefore.ignoredBaselineIds,
        ownedBaselineIds: ownershipBefore.ownedBaselineIds,
      },
      ownershipAfter: ownershipAfter ? {
        planDigest: ownershipAfter.planDigest,
        catalogReference: ownershipAfter.catalogReference,
        catalogDigest: ownershipAfter.catalogDigest,
        tierDefinitionDigest: ownershipAfter.tierDefinitionDigest,
        policySnapshotDigest: ownershipAfter.policySnapshotDigest,
        ignoredBaselineIds: ownershipAfter.ignoredBaselineIds,
        ownedBaselineIds: ownershipAfter.ownedBaselineIds,
      } : null,
      ownershipStable,
      selection,
      executable: process.execPath,
      argv,
      beforeSnapshot,
      afterSnapshot,
      execution: {
        started: execution.started,
        rawExitStatus: execution.rawExitStatus,
        signal: execution.signal,
        timedOut: execution.timedOut,
        outputLimitExceeded: execution.outputLimitExceeded,
        rawOutputDigest: execution.rawOutputDigest,
        outputBytes: execution.outputBytes,
      },
      report: {
        adapter: "node-engine-evidence-v1",
        text: reportText,
        byteLength: reportText === null ? 0 : Buffer.byteLength(reportText, "utf8"),
        digest: reportText === null ? null : sha256(reportText),
      },
      v2CaseReport,
      discovery: {
        adapter: "node-test-v2-case-report",
        available: v2ReportBound,
        selectedCaseCount,
        selectedCaseStatus,
        complete: v2ReportBound,
        ...(v2ReportBound ? {} : { reason: discoveryReason }),
      },
      discoveryDigest: null,
      identityBinding: {
        selectedCaseTitleMatched: selectedCaseCount === 1,
        selectedCaseStatus,
        storedTierReportCaseBound: false,
        reason: v2ReportBound
          ? "retry v2 raw report is retained; unknown writer coordination prevents trusted classification"
          : discoveryReason,
      },
      outcome: "blocked",
      accepted: false,
      reason: failureReason ??
        "diagnostic isolation is not required-tier completion or independently corroborated failure classification evidence",
      retryPassingIsNotProvenance: true,
      requiredTierEvidence: false,
      classificationEvidence: false,
    };
    attempt.discoveryDigest = digestJson(attempt.discovery);
    const reference = this.#persistIsolationAttempt(attempt, reservationIdentityDigest, reservation);
    return {
      reference,
      attemptId: reservation.attemptId,
      retryNumber: reservation.retryNumber,
      rawExitStatus: execution.rawExitStatus,
      signal: execution.signal,
      timedOut: execution.timedOut,
      outputLimitExceeded: execution.outputLimitExceeded,
      discovery: attempt.discovery,
      retryStatus: selectedCaseStatus,
      trustedRetry,
      v2ReportBound,
      ...(v2ReportBound ? {
        retrySelector: {
          taskId: request.taskId,
          attemptId: reservation.attemptId,
          reportReference: v2CaseReport.reference,
          reportDigest: v2CaseReport.reportDigest,
          caseId: source.selector.caseId,
        },
      } : {}),
      outcome: "blocked",
      accepted: false,
      classification,
      reason: attempt.reason,
    };
  }

  #persistIsolationAttempt(attempt, identityDigest, reservation) {
    const content = canonicalJson(attempt);
    if (Buffer.byteLength(content, "utf8") > MAX_ISOLATION_RECORD_BYTES) {
      throw new RangeError("isolation result exceeds the bounded immutable record size");
    }
    if (attempt.report.byteLength > MAX_TAP_REPORT_BYTES) {
      throw new RangeError("TAP report exceeds the bounded immutable report size");
    }
    const database = this.store.database;
    const rows = Number(database.prepare(
      `SELECT COUNT(*) AS count FROM ${ISOLATION_TABLE}`,
    ).get().count);
    if (rows >= MAX_ISOLATION_RECORDS) {
      throw new Error(`isolation results reached their ${MAX_ISOLATION_RECORDS}-record bound`);
    }
    const digest = sha256(content);
    database.prepare(`
      INSERT INTO ${ISOLATION_TABLE}(
        attempt_id, task_id, identity_digest, retry_number, created_at, attempt_content, attempt_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      reservation.attemptId,
      attempt.taskId,
      identityDigest,
      reservation.retryNumber,
      attempt.createdAt,
      content,
      digest,
    );
    return `failure-gate-v4-isolation:${reservation.attemptId}`;
  }

  getIsolationAttempt(reference) {
    const stored = loadStoredIsolationAttempt(this.store, reference);
    if (!stored) return null;
    return Object.freeze({
      reference: stored.reference,
      digest: stored.digest,
      attempt: stored.attempt,
    });
  }

  listIsolationAttempts({ taskId, limit = 50 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ISOLATION_RECORDS) {
      throw new RangeError(`limit must be between 1 and ${MAX_ISOLATION_RECORDS}`);
    }
    const rows = typeof taskId === "string"
      ? this.store.database.prepare(`
          SELECT attempt_id FROM ${ISOLATION_TABLE} WHERE task_id = ?
          ORDER BY retry_number, created_at, attempt_id LIMIT ?
        `).all(taskId, limit)
      : this.store.database.prepare(`
          SELECT attempt_id FROM ${ISOLATION_TABLE}
          ORDER BY created_at DESC, attempt_id DESC LIMIT ?
        `).all(limit);
    return rows.map((row) => this.getIsolationAttempt(`failure-gate-v4-isolation:${row.attempt_id}`));
  }

  #persist(diagnostic) {
    const content = canonicalJson(diagnostic);
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_RECORD_BYTES) throw new RangeError("diagnostic record exceeds the bounded storage size");
    const database = this.store.database;
    database.exec("BEGIN IMMEDIATE");
    try {
      const count = Number(database.prepare(`SELECT COUNT(*) AS count FROM ${TABLE}`).get().count);
      if (count >= MAX_RECORDS) {
        throw new Error(`diagnostic store reached its ${MAX_RECORDS}-record bound`);
      }
      const id = randomUUID();
      const digest = sha256(content);
      database.prepare(`
        INSERT INTO ${TABLE}(diagnostic_id, task_id, created_at, diagnostic_content, diagnostic_digest)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, diagnostic.taskId, diagnostic.createdAt, content, digest);
      database.exec("COMMIT");
      return `failure-gate-v4-diagnostic:${id}`;
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* Keep the original error. */ }
      throw error;
    }
  }

  getDiagnostic(reference) {
    const match = typeof reference === "string"
      ? reference.match(/^failure-gate-v4-diagnostic:([0-9a-f-]{36})$/)
      : null;
    if (!match) throw new TypeError("diagnostic reference is malformed");
    const row = this.store.database.prepare(`
      SELECT diagnostic_id, diagnostic_content, diagnostic_digest
      FROM ${TABLE} WHERE diagnostic_id = ?
    `).get(match[1]);
    if (!row) return null;
    if (sha256(row.diagnostic_content) !== row.diagnostic_digest) {
      throw new Error("stored diagnostic hash does not match its immutable content");
    }
    const diagnostic = JSON.parse(row.diagnostic_content);
    if (canonicalJson(diagnostic) !== row.diagnostic_content ||
        diagnostic.taskId === undefined) {
      throw new Error("stored diagnostic content is malformed");
    }
    return Object.freeze({
      reference,
      digest: row.diagnostic_digest,
      diagnostic: Object.freeze(diagnostic),
    });
  }

  listDiagnostics({ taskId, limit = 50 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORDS) {
      throw new RangeError(`limit must be between 1 and ${MAX_RECORDS}`);
    }
    const rows = typeof taskId === "string"
      ? this.store.database.prepare(`
          SELECT diagnostic_id FROM ${TABLE} WHERE task_id = ?
          ORDER BY created_at DESC, diagnostic_id DESC LIMIT ?
        `).all(taskId, limit)
      : this.store.database.prepare(`
          SELECT diagnostic_id FROM ${TABLE}
          ORDER BY created_at DESC, diagnostic_id DESC LIMIT ?
        `).all(limit);
    return rows.map((row) => this.getDiagnostic(`failure-gate-v4-diagnostic:${row.diagnostic_id}`));
  }
}

/**
 * Synchronous store-delegation hook for the diagnostic-isolation table.
 * The canonical store can call this after its required-tier record lookup;
 * this function reads immutable rows directly and never constructs a store or
 * diagnostics service. It returns the same purpose-tagged union member that
 * the canonical run resolver exposes for isolation retries.
 */
export function resolveStoredDiagnosticRunRecord({ store, taskId, attemptId } = {}) {
  if (typeof taskId !== "string" || !/^TASK-\d{6,}$/.test(taskId) ||
      typeof attemptId !== "string" || !/^[0-9a-f-]{36}$/.test(attemptId)) {
    throw new TypeError("diagnostic run resolver requires an exact task and attempt ID");
  }
  if (!store?.database || typeof store.getTask !== "function" ||
      typeof store.projectRoot !== "string") {
    throw new TypeError("diagnostic run resolver requires the public Failure Gate store API");
  }
  const attemptsTable = store.database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(ISOLATION_TABLE);
  if (!attemptsTable) return null;
  const reference = `failure-gate-v4-isolation:${attemptId}`;
  const stored = loadStoredIsolationAttempt(store, reference);
  if (!stored || stored.attempt.taskId !== taskId ||
      stored.attempt.purpose !== "diagnostic-isolation") return null;
  const task = store.getTask(taskId);
  if (task && typeof task.then === "function") {
    throw new TypeError("diagnostic run resolution requires synchronous getTask");
  }
  if (!isRecord(task) || task.taskId !== taskId) {
    throw new Error("diagnostic attempt task is unavailable from the canonical store");
  }
  const isolationAttempt = stored.attempt;
  if (isolationAttempt.planDigest !== task.planDigest ||
      isolationAttempt.planReference !== task.planReference ||
      isolationAttempt.planVersion !== task.planVersion ||
      isolationAttempt.tier !== task.requestedTier ||
      isolationAttempt.tierDefinitionDigest !== task.tierDefinitionDigest ||
      isolationAttempt.registryDigest !== task.registryDigest ||
      isolationAttempt.wrapperDigest !== task.wrapperDigest) {
    throw new Error("diagnostic attempt no longer matches its canonical task plan and tier");
  }
  return Object.freeze({
    task: Object.freeze(task),
    isolation: Object.freeze({
      reference: stored.reference,
      digest: stored.digest,
      attempt: isolationAttempt,
    }),
  });
}

export function createFailureGateDiagnostics(options) {
  return new FailureGateDiagnostics(options);
}