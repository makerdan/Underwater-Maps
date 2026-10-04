import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson, digestJson, sha256 } from "../failure-gate-v4/canonical.mjs";
import { TIER_POLICY_FILES, getRegisteredValidationPolicy } from "../failure-gate-v4/policy.mjs";
import { FailureGateStoredClassification } from "../failure-gate-v4/stored-classification.mjs";
import * as engineEvidence from "../failure-gate-v4/engine-evidence.mjs";
import { validateTestCaseReport } from "../failure-gate-v4/test-case-report.mjs";

// These temporary Git-tracked catalogs and mock canonical store records are
// algorithm fixtures only; they are never live proof or persisted diagnostics.
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_SUITE = "fixture-suite";
const FIXTURE_SOURCE = "fixture.spec.mjs";
const FIXTURE_TITLE = "reports a stable stored failure";
const FAILURE_ERRORS = Object.freeze([
  Object.freeze({ name: "TypeError", message: "fixture assertion failed" }),
]);
const FAILURE_SIGNATURE = sha256(JSON.stringify([
  "failure-gate-error-signature-v1",
  FAILURE_ERRORS,
]));
const ENGINE_ENVIRONMENT = Object.freeze({ nodeMajor: 24, engineVersion: "3.2.7" });
const NODE_ENGINE_ENVIRONMENT = Object.freeze({ nodeMajor: 24, engineVersion: "24" });
const ENVIRONMENT = Object.freeze({ ...ENGINE_ENVIRONMENT, tier: "test-standard" });
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const NOW = Date.now();
const ISOLATED_MODULE_CLOSURE = Object.freeze([
  "scripts/failure-gate-v4/canonical.mjs",
  "scripts/failure-gate-v4/classification.mjs",
  "scripts/failure-gate-v4/engine-evidence.mjs",
  "scripts/failure-gate-v4/policy.mjs",
  "scripts/failure-gate-v4/stored-classification.mjs",
  "scripts/failure-gate-v4/test-case-report.mjs",
  "scripts/lib/step-report.mjs",
  "scripts/register-validation-commands.mjs",
  "scripts/validation-steps.mjs",
  "scripts/codegen-freshness.mjs",
  "lib/api-spec/scripts/validate-openapi.mjs",
]);

function git(root, args) {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}

function makeCatalog({ expiredIgnore = false } = {}) {
  const deadline = expiredIgnore ? "2000-01-01" : "2099-12-31";
  const base = {
    suite: FIXTURE_SUITE,
    test: `${FIXTURE_SOURCE} — ${FIXTURE_TITLE}`,
    failureSignature: FAILURE_SIGNATURE,
    classification: "test",
    evidence: { authoritative: true },
    ownership: { owner: "Failure Gate fixture owner" },
    affectedTiers: ["test-standard"],
    reviewDeadline: deadline,
    statusHistory: [],
  };
  return {
    catalogVersion: 1,
    catalogDate: "2026-01-01",
    entries: [
      { ...base, id: "BASE-FIXTURE-IGNORE", status: "active" },
      { ...base, id: "BASE-FIXTURE-OWNED", status: "resolved" },
    ],
  };
}

function makeProject({ expiredIgnore = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "failure-gate-stored-classification-"));
  for (const reference of new Set(TIER_POLICY_FILES)) {
    if (reference === "docs/validation/failure-baseline.json") continue;
    const source = resolve(PROJECT_ROOT, reference);
    const target = resolve(root, reference);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  const catalogPath = resolve(root, "docs/validation/failure-baseline.json");
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, `${JSON.stringify(makeCatalog({ expiredIgnore }), null, 2)}\n`);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "classifier-fixture@example.invalid"]);
  git(root, ["config", "user.name", "Stored classifier fixture"]);
  git(root, ["add", "--", "docs/validation/failure-baseline.json"]);
  git(root, ["commit", "-q", "-m", "fixture baseline catalog"]);
  return root;
}

function makeTask(policy, taskId, {
  baselineKind = null,
  createdAt,
  approvalSourceKind,
  verifiedSourceCreatedAt,
} = {}) {
  const baselines = baselineKind === "ignore"
    ? { ignore: [{ id: "BASE-FIXTURE-IGNORE", owner: "Failure Gate fixture owner" }], owned: [] }
    : baselineKind === "owned"
      ? { ignore: [], owned: [{ id: "BASE-FIXTURE-OWNED", owner: "Failure Gate fixture owner" }] }
      : { ignore: [], owned: [] };
  const plan = {
    taskId,
    projectNamespace: "failure-gate-fixture",
    planVersion: 1,
    baselines,
  };
  const tierPolicy = policy.tiers["test-standard"];
  const task = {
    taskId,
    projectNamespace: "failure-gate-fixture",
    status: "active",
    planReference: `plans/${taskId}.json`,
    planVersion: 1,
    plan,
    planDigest: digestJson(plan),
    requestedTier: "test-standard",
    tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
    registryDigest: policy.registryDigest,
    wrapperDigest: policy.wrapperDigest,
    policySnapshotDigest: policy.snapshotDigest,
    createdAt: createdAt ?? new Date(NOW - 10_000).toISOString(),
  };
  if (approvalSourceKind) {
    task.approvalSourceKind = approvalSourceKind;
    if (verifiedSourceCreatedAt) task.verifiedSourceCreatedAt = verifiedSourceCreatedAt;
    task.approval = {
      sourceKind: approvalSourceKind,
      sourceSnapshot: {
        ...(verifiedSourceCreatedAt ? { createdAt: verifiedSourceCreatedAt } : {}),
        state: "accepted",
        updatedAt: new Date(NOW).toISOString(),
      },
    };
  }
  return task;
}

function makeStepReport(policy, attemptId, finishedAt, rawExitStatus) {
  const steps = policy.tiers["test-standard"].selectedStepNames.map((name) => {
    const failed = name === "test:unit" && rawExitStatus !== 0;
    return {
      name,
      phase: "fixture",
      status: failed ? "failed" : "passed",
      rawExitStatus: failed ? rawExitStatus : 0,
      signal: null,
      startedAt: new Date(NOW - 20_000).toISOString(),
      finishedAt,
      durationMs: 1,
      discovery: null,
      reason: null,
    };
  });
  const report = {
    schemaVersion: 1,
    runner: "fixture",
    tier: "standard",
    startedAt: new Date(NOW - 20_000).toISOString(),
    finishedAt,
    durationMs: 20_000,
    rawExitStatus,
    discovery: { testCases: { available: true } },
    steps,
  };
  const bytes = Buffer.from(`${JSON.stringify(report)}\n`);
  return {
    reference: `runs/${attemptId}-steps.json`,
    digest: sha256(bytes),
    contentBase64: bytes.toString("base64"),
  };
}

function makeCaseReport({
  caseId,
  status,
  reportReference,
  rawReportReference,
  rawBytes,
  evidence,
  engine,
  title = FIXTURE_TITLE,
  source = FIXTURE_SOURCE,
  schemaVersion = 2,
  signatureOverride,
}) {
  const errorList = evidence.cases[0].errors;
  const failureSignature = status === "failed"
    ? signatureOverride ??
      sha256(JSON.stringify(["failure-gate-error-signature-v1", errorList]))
    : null;
  const entry = {
    id: caseId,
    source,
    title,
    line: 1,
    column: 1,
    status,
    reportedStatus: status,
    errorCount: status === "failed" ? 1 : 0,
    failureSignature,
    attempts: [],
  };
  const rawName = rawReportReference.split("/").at(-1);
  const report = {
    schemaVersion,
    engine,
    suite: FIXTURE_SUITE,
    step: evidence.step,
    outcome: evidence.outcome,
    complete: true,
    environment: evidence.environment,
    cases: [entry],
    rawReport: { reference: rawName, digest: sha256(rawBytes) },
  };
  validateTestCaseReport(report);
  const bytes = Buffer.from(`${JSON.stringify(report)}\n`);
  return {
    entry,
    report,
    artifact: {
      reference: reportReference,
      digest: sha256(bytes),
      contentBase64: bytes.toString("base64"),
    },
  };
}

function makeRawEngineReport({
  engine = "vitest",
  status,
  environment = ENGINE_ENVIRONMENT,
  title = FIXTURE_TITLE,
  source = FIXTURE_SOURCE,
}) {
  const errors = status === "failed" ? FAILURE_ERRORS : [];
  const evidence = engineEvidence.createEngineEvidence({
    engine,
    suite: FIXTURE_SUITE,
    step: "test:unit",
    outcome: status === "failed" ? "failed" : engine === "node-test" ? "completed" : "passed",
    complete: true,
    environment,
    reportedCaseCount: 1,
    globalErrors: [],
    cases: [{
      source,
      title,
      line: 1,
      column: 1,
      status,
      rawStatus: status,
      expectedStatus: "",
      errorCount: errors.length,
      errors,
      attempts: [],
    }],
  });
  const testCase = evidence.cases[0];
  const caseId = engineEvidence.engineCaseId({
    engine: evidence.engine,
    suite: evidence.suite,
    source: testCase.source,
    title: testCase.title,
  });
  return {
    evidence,
    caseId,
    bytes: Buffer.from(JSON.stringify(evidence)),
  };
}

function makeStoredRecord({
  policy,
  task,
  attemptId,
  caseStatus = "failed",
  createdAt,
  finishedAt,
  caseId,
  signature = FAILURE_SIGNATURE,
  environment = ENVIRONMENT,
  engine = "vitest",
  retryAuthorization,
  rawTitle = FIXTURE_TITLE,
  rawSource = FIXTURE_SOURCE,
  caseTitle = FIXTURE_TITLE,
  caseSource = FIXTURE_SOURCE,
  signatureOverride,
  reportSchemaVersion = 2,
}) {
  const finishTime = finishedAt ?? new Date(NOW).toISOString();
  const rawReport = makeRawEngineReport({
    engine,
    status: caseStatus,
    environment,
    title: rawTitle,
    source: rawSource,
  });
  const stableCaseId = caseId ?? rawReport.caseId;
  const rawName = `runs/${attemptId}-engine.engine`;
  const rawBytes = rawReport.bytes;
  const reportReference = `runs/${attemptId}-cases.json`;
  const caseReport = makeCaseReport({
    caseId: stableCaseId,
    status: caseStatus,
    reportReference,
    rawReportReference: rawName,
    rawBytes,
    evidence: rawReport.evidence,
    engine,
    title: caseTitle,
    source: caseSource,
    signatureOverride: signatureOverride ?? (
      signature !== FAILURE_SIGNATURE && caseStatus === "failed" ? signature : undefined
    ),
    schemaVersion: reportSchemaVersion,
  });
  const stepArtifact = makeStepReport(
    policy,
    attemptId,
    finishTime,
    caseStatus === "failed" ? 1 : 0,
  );
  const artifacts = [
    caseReport.artifact,
    {
      reference: rawName,
      digest: sha256(rawBytes),
      contentBase64: rawBytes.toString("base64"),
    },
  ];
  const summary = {
    schemaVersion: 1,
    available: true,
    notApplicable: false,
    caseCount: 1,
    allPassed: caseStatus === "passed",
    reports: [{
      reference: relative(dirname(stepArtifact.reference), reportReference),
      digest: caseReport.artifact.digest,
      engine,
      suite: FIXTURE_SUITE,
      outcome: caseReport.report.outcome,
      complete: true,
      caseCount: 1,
      counts: { [caseStatus]: 1 },
    }],
  };
  const discovery = {
    schemaVersion: 1,
    reportReference: stepArtifact.reference,
    summary,
    artifactsAvailable: true,
    artifacts,
  };
  discovery.digest = digestJson({
    reportReference: discovery.reportReference,
    summary,
    artifactsAvailable: true,
    artifacts: artifacts.map(({ reference, digest }) => ({ reference, digest })),
  });
  const evidence = {
    schemaVersion: 1,
    complete: true,
    authorizationDigest: DIGEST_A,
    inputDigest: DIGEST_B,
    rawExitStatus: caseStatus === "failed" ? 1 : 0,
    rawOutputDigest: DIGEST_A,
    stepResults: JSON.parse(Buffer.from(stepArtifact.contentBase64, "base64").toString("utf8"))
      .steps.map((step) => ({
        stepName: step.name,
        rawExitStatus: step.rawExitStatus,
        reportReference: stepArtifact.reference,
        reportDigest: stepArtifact.digest,
      })),
    rawStepReport: {
      schemaVersion: 1,
      ...stepArtifact,
      validated: true,
    },
    discovery,
  };
  const attempt = {
    taskId: task.taskId,
    attemptId,
    purpose: "required_tier_validation",
    status: caseStatus === "failed" ? "FAIL" : "PASS",
    lifecycleState: "released",
    planReference: task.planReference,
    planVersion: task.planVersion,
    planDigest: task.planDigest,
    tier: task.requestedTier,
    tierDefinitionDigest: task.tierDefinitionDigest,
    registryDigest: task.registryDigest,
    wrapperDigest: task.wrapperDigest,
    reportAdapterId: policy.tiers["test-standard"].reportAdapterId,
    authorizationDigest: DIGEST_A,
    inputDigest: DIGEST_B,
    rawExitStatus: evidence.rawExitStatus,
    startedAt: new Date(NOW - 20_000).toISOString(),
    finishedAt: finishTime,
    snapshotDigest: DIGEST_A,
    snapshot: {
      integrity: "verified",
      writerCoordination: {
        status: "verified",
        adapterId: "fixture-writer-adapter",
        evidenceDigest: DIGEST_B,
      },
    },
    environment: { tier: "standard" },
    stepResults: evidence.stepResults,
    evidence,
    evidenceDigest: digestJson(evidence),
    ...(createdAt ? { createdAt } : {}),
    ...(retryAuthorization ? { retryAuthorization } : {}),
  };
  return {
    task,
    attempt,
    evidence,
    selector: {
      taskId: task.taskId,
      attemptId,
      reportReference,
      reportDigest: caseReport.artifact.digest,
      caseId: stableCaseId,
    },
  };
}

function makeStore(records) {
  const byId = new Map(records.map((record) => [
    `${record.task.taskId}/${record.attempt.attemptId}`, record,
  ]));
  return {
    getStoredRunRecord({ taskId, attemptId }) {
      const record = byId.get(`${taskId}/${attemptId}`);
      if (!record) return null;
      if (record.attempt.purpose === "diagnostic-isolation") {
        const attempt = structuredClone(record.attempt);
        delete attempt.evidence;
        delete attempt.evidenceDigest;
        return {
          task: structuredClone(record.task),
          isolation: {
            reference: `failure-gate-v4-isolation:${attemptId}`,
            digest: sha256(canonicalJson(attempt)),
            attempt,
          },
        };
      }
      return structuredClone(record);
    },
    records: byId,
  };
}

function selectorOnly(reference) {
  return {
    taskId: reference.taskId,
    attemptId: reference.attemptId,
    reportReference: reference.reportReference,
    reportDigest: reference.reportDigest,
    caseId: reference.caseId,
  };
}

function makeDiagnosticIsolationRecord({
  root,
  policy,
  task,
  primary,
  primarySourceDigest,
  attemptId,
  retryNumber,
  caseStatus,
  finishedAt,
}) {
  const testFile = "scripts/__tests__/failure-gate-v4-stored-classification.test.mjs";
  const step = "test:unit";
  const raw = makeRawEngineReport({
    engine: "node-test",
    status: caseStatus,
    environment: NODE_ENGINE_ENVIRONMENT,
    source: testFile,
  });
  const reportReference = `failure-gate-v4-isolation/${attemptId}/case-report.json`;
  const rawReportReference = raw.evidence.rawReportReference ??
    `failure-gate-v4-isolation/${attemptId}/${attemptId}-engine.engine`;
  const rawBytes = raw.bytes;
  const caseReport = makeCaseReport({
    caseId: primary.selector.caseId,
    status: caseStatus,
    reportReference,
    rawReportReference,
    rawBytes,
    evidence: raw.evidence,
    engine: "node-test",
    source: testFile,
  });
  const reportText = JSON.stringify(caseReport.report);
  const reportBytes = Buffer.from(reportText, "utf8");
  const reportDigest = sha256(reportBytes);
  const rawName = caseReport.report.rawReport.reference;
  const environment = {
    nodeMajor: 24,
    engineVersion: "24",
    tier: task.requestedTier,
  };
  const identity = {
    suite: FIXTURE_SUITE,
    test: `${testFile} — ${FIXTURE_TITLE}`,
    failureSignature: FAILURE_SIGNATURE,
    environment,
  };
  const isolationEnvironment = {
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
    FAILURE_GATE_TEST_CASE_SUITE: FIXTURE_SUITE,
    FAILURE_GATE_TEST_STEP: step,
  };
  const environmentDigest = digestJson(isolationEnvironment);
  const isolationSelector = {
    taskId: task.taskId,
    attemptId,
    reportReference,
    reportDigest,
    caseId: primary.selector.caseId,
  };
  const primaryReportArtifact = primary.evidence.discovery.artifacts.find((artifact) =>
    artifact.reference === primary.selector.reportReference);
  const primaryReport = JSON.parse(Buffer.from(
    primaryReportArtifact.contentBase64, "base64",
  ).toString("utf8"));
  const sourceBinding = {
    reportReference: primary.selector.reportReference,
    reportDigest: primary.selector.reportDigest,
    caseId: primary.selector.caseId,
    rawReportReference: primaryReport.rawReport.reference,
    rawReportDigest: primaryReport.rawReport.digest,
    step: "test:unit",
    sourceDigest: primarySourceDigest,
  };
  const selection = {
    testFile,
    testName: FIXTURE_TITLE,
    testNamePattern: `^${FIXTURE_TITLE}$`,
    caseId: primary.selector.caseId,
    step,
    tier: task.requestedTier,
  };
  const argv = [
    "--test",
    `--test-reporter=${resolve(root, "scripts/failure-gate-v4/node-test-reporter.mjs")}`,
    `--test-name-pattern=^${FIXTURE_TITLE}$`,
    testFile,
  ];
  const identityDigest = digestJson(identity);
  const reservationIdentityDigest = digestJson({
    purpose: "diagnostic-isolation",
    identity,
  });
  const inputDigest = digestJson({
    selector: primary.selector,
    testFile,
    testName: FIXTURE_TITLE,
    step,
    tier: task.requestedTier,
  });
  const authorizationDigest = digestJson({
    schemaVersion: 1,
    purpose: "diagnostic-isolation",
    taskId: task.taskId,
    attemptId,
    identityDigest,
    sourceBinding,
    selection,
    executable: process.execPath,
    argv,
    environmentDigest,
    inputDigest,
  });
  const manifestContent = canonicalJson({
    format: "failure-gate-v4-worktree-manifest-v1",
    files: [{
      path: testFile,
      kind: "file",
      sizeBytes: 1,
      mode: 0o644,
      sha256: DIGEST_A,
    }],
    ignoredPaths: [],
    exclusions: [
      "Git metadata",
      "ignored dependency/runtime caches and report/log directories listed in ignoredPaths",
      "secret-bearing environment variable values",
    ],
    integrity: "unknown",
    integrityReasons: ["shared_worktree_writer_coordination_unavailable"],
  });
  const snapshotEnvironment = {
    projectRootDigest: sha256(realpathSync(root)),
    runtime: {
      executable: process.execPath,
      node: process.version,
      versions: { ...process.versions },
      platform: process.platform,
      architecture: process.arch,
    },
    safeEnvironment: Object.fromEntries(
      ["AUDIT_MARKER_BBOX_ENABLED", "CI", "LANG", "LC_ALL", "NODE_ENV", "TZ"]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
    secretBearingEnvironment: {
      databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
      valuesRecorded: false,
    },
  };
  const environmentContent = canonicalJson(snapshotEnvironment);
  const snapshotRecord = {
    manifestContent,
    manifestDigest: digestJson(JSON.parse(manifestContent)),
    environmentContent,
    environmentDigest: digestJson(JSON.parse(environmentContent)),
  };
  const beforeSnapshot = { ...snapshotRecord };
  const afterSnapshot = { ...snapshotRecord };
  const ownership = {
    planDigest: task.planDigest,
    catalogReference: "docs/validation/failure-baseline.json",
    catalogDigest: sha256(readFileSync(join(root, "docs/validation/failure-baseline.json"))),
    tierDefinitionDigest: policy.tiers[task.requestedTier].tierDefinitionDigest,
    policySnapshotDigest: policy.snapshotDigest,
    ignoredBaselineIds: [],
    ownedBaselineIds: [],
  };
  const attempt = {
    schemaVersion: 1,
    purpose: "diagnostic-isolation",
    taskId: task.taskId,
    createdAt: finishedAt,
    startedAt: new Date(Date.parse(finishedAt) - 1000).toISOString(),
    finishedAt,
    attemptId,
    retryNumber,
    identityDigest,
    reservationIdentityDigest,
    authorizationDigest,
    inputDigest,
    status: caseStatus === "passed" ? "PASS" : "FAIL",
    lifecycleState: "released",
    planReference: task.planReference,
    planVersion: task.planVersion,
    planDigest: task.planDigest,
    tier: task.requestedTier,
    tierDefinitionDigest: task.tierDefinitionDigest,
    registryDigest: task.registryDigest,
    wrapperDigest: task.wrapperDigest,
    reportAdapterId: policy.tiers[task.requestedTier].reportAdapterId,
    rawExitStatus: caseStatus === "passed" ? 0 : 1,
    rawOutputDigest: sha256(rawBytes),
    environmentDigest,
    isolationEnvironment,
    environment,
    snapshotDigest: digestJson({ beforeSnapshot, afterSnapshot }),
    snapshot: {
      integrity: "unknown",
      beforeSnapshotDigest: snapshotRecord.manifestDigest,
      afterSnapshotDigest: snapshotRecord.manifestDigest,
      inputsUnchangedObserved: true,
      writerCoordination: {
        status: "unknown",
        adapterId: null,
        evidenceDigest: null,
      },
    },
    selector: { ...primary.selector },
    sourceBinding,
    retryAuthorization: {
      schemaVersion: 1,
      authorized: true,
      safeIsolation: true,
      identityDigest,
      authorizationDigest,
      sourceDigest: primarySourceDigest,
    },
    ownershipBefore: ownership,
    ownershipAfter: ownership,
    ownershipStable: true,
    selection,
    executable: process.execPath,
    argv,
    beforeSnapshot,
    afterSnapshot,
    execution: {
      started: true,
      rawExitStatus: caseStatus === "passed" ? 0 : 1,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      rawOutputDigest: sha256(rawBytes),
      outputBytes: rawBytes.byteLength,
    },
    report: {
      adapter: "node-engine-evidence-v1",
      text: rawBytes.toString("utf8"),
      byteLength: rawBytes.byteLength,
      digest: sha256(rawBytes),
    },
    v2CaseReport: {
      reference: reportReference,
      reportText,
      reportDigest,
      rawReportReference: rawName,
      rawReportDigest: sha256(rawBytes),
      rawReportBase64: rawBytes.toString("base64"),
    },
    discovery: {
      adapter: "node-test-v2-case-report",
      available: true,
      selectedCaseCount: 1,
      selectedCaseStatus: caseStatus,
      complete: true,
    },
    identityBinding: { verified: false },
    observedIdentity: { callerSupplied: true },
  };
  attempt.discoveryDigest = digestJson(attempt.discovery);
  return { task, attempt, selector: isolationSelector };
}

function makeService(records, root) {
  return new FailureGateStoredClassification({
    store: makeStore(records),
    projectRoot: root,
  });
}

function needsEngineEvidence(t) {
  assert.equal(typeof engineEvidence.verifyTestCaseReportBinding, "function");
  assert.equal(typeof engineEvidence.resolveCaseObservation, "function");
}

function copyIsolatedModuleClosure(fixtureRoot) {
  for (const reference of ISOLATED_MODULE_CLOSURE) {
    const source = resolve(PROJECT_ROOT, reference);
    const target = resolve(fixtureRoot, reference);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  writeFileSync(
    resolve(fixtureRoot, "scripts/failure-gate-v4/engine-evidence.mjs"),
    [
      'export const ENGINE_EVIDENCE_STEPS = Object.freeze(["test:unit", "e2e-palette", "test:e2e"]);',
      "export function verifyTestCaseReportBinding() { return true; }",
      "",
    ].join("\n"),
  );
  mkdirSync(resolve(fixtureRoot, "docs/validation"), { recursive: true });
  writeFileSync(
    resolve(fixtureRoot, "docs/validation/failure-baseline.json"),
    `${JSON.stringify({ catalogVersion: 1, entries: [] })}\n`,
  );
  const yamlPackage = realpathSync(resolve(PROJECT_ROOT, "lib/api-spec/node_modules/js-yaml"));
  mkdirSync(resolve(fixtureRoot, "node_modules"), { recursive: true });
  cpSync(yamlPackage, resolve(fixtureRoot, "node_modules/js-yaml"), {
    recursive: true,
    dereference: true,
  });
}

test("positive stored fixture covers exact ignore, owned repair, earlier failure, and independent corroboration", async (t) => {
  needsEngineEvidence(t);
  const root = makeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = getRegisteredValidationPolicy(root);

  const ignoredTask = makeTask(policy, "TASK-480301", { baselineKind: "ignore" });
  const ignoredRecord = makeStoredRecord({
    policy, task: ignoredTask, attemptId: "attempt-ignore",
    finishedAt: new Date(NOW - 5000).toISOString(),
  });
  const ignoredResult = makeService([ignoredRecord], root).classifyStoredFailure(
    selectorOnly(ignoredRecord.selector),
  );
  assert.equal(ignoredResult.outcome, "ignored-baseline");
  assert.equal(ignoredResult.accepted, true);

  const ownedTask = makeTask(policy, "TASK-480302", { baselineKind: "owned" });
  const failedOwned = makeStoredRecord({
    policy, task: ownedTask, attemptId: "attempt-owned-fail",
    finishedAt: new Date(NOW - 4000).toISOString(),
  });
  const pendingRepair = makeService([failedOwned], root).classifyStoredFailure(
    selectorOnly(failedOwned.selector),
  );
  assert.equal(pendingRepair.outcome, "owned-repair-required");
  assert.equal(pendingRepair.accepted, false);
  const passingRepair = makeStoredRecord({
    policy, task: ownedTask, attemptId: "attempt-owned-pass",
    caseStatus: "passed",
    finishedAt: new Date(NOW - 3000).toISOString(),
  });
  const repairResult = makeService([failedOwned, passingRepair], root).classifyStoredFailure({
    ...selectorOnly(failedOwned.selector),
    repairReference: selectorOnly(passingRepair.selector),
  });
  assert.equal(repairResult.outcome, "owned-repair-proven");
  assert.equal(repairResult.accepted, true);
  const ownedAssessment = makeService([failedOwned, passingRepair], root).assessOwnedRepairs({
    taskId: ownedTask.taskId,
    recordReferences: [
      selectorOnly(failedOwned.selector),
      selectorOnly(passingRepair.selector),
    ],
  });
  assert.equal(ownedAssessment.outcome, "owned-repair-proven");
  assert.equal(ownedAssessment.accepted, true);
  assert.equal(ownedAssessment.ownedObligations[0].status, "proven");

  const wrongEnvironmentRepair = makeStoredRecord({
    policy,
    task: ownedTask,
    attemptId: "attempt-owned-wrong-env",
    caseStatus: "passed",
    engine: "playwright",
    environment: { nodeMajor: 24, engineVersion: "1.60.0" },
    finishedAt: new Date(NOW - 2000).toISOString(),
  });
  const wrongEnvironmentResult = makeService([failedOwned, wrongEnvironmentRepair], root)
    .classifyStoredFailure({
      ...selectorOnly(failedOwned.selector),
      repairReference: selectorOnly(wrongEnvironmentRepair.selector),
    });
  assert.equal(wrongEnvironmentResult.accepted, false);
  assert.equal(wrongEnvironmentResult.outcome, "owned-repair-required");

  const preTask = makeTask(policy, "TASK-480303", {
    createdAt: new Date(NOW - 180_000).toISOString(),
  });
  const preTaskRecord = makeStoredRecord({
    policy, task: preTask, attemptId: "attempt-pretask",
    finishedAt: new Date(NOW - 120_000).toISOString(),
  });
  const currentTask = makeTask(policy, "TASK-480304", {
    approvalSourceKind: "replit-project-task",
    createdAt: new Date(NOW - 10_000).toISOString(),
    verifiedSourceCreatedAt: new Date(NOW - 40_000).toISOString(),
  });
  const current = makeStoredRecord({
    policy, task: currentTask, attemptId: "attempt-current",
    finishedAt: new Date(NOW - 5000).toISOString(),
  });
  const corroboratingTask = makeTask(policy, "TASK-480305", {
    createdAt: new Date(NOW - 8_000).toISOString(),
  });
  const corroboration = makeStoredRecord({
    policy, task: corroboratingTask, attemptId: "attempt-corrob",
    finishedAt: new Date(NOW - 4_000).toISOString(),
  });
  const retryOutcomes = ["failed", "passed", "failed"];
  const retries = retryOutcomes.map((outcome, index) => {
    const task = makeTask(policy, currentTask.taskId, {
      createdAt: currentTask.createdAt,
    });
    const selectorCase = makeStoredRecord({
      policy,
      task,
      attemptId: `attempt-retry-${index + 1}`,
      caseStatus: outcome,
      finishedAt: new Date(NOW - 3000 + index * 100).toISOString(),
      retryAuthorization: {
        schemaVersion: 1,
        authorized: true,
        safeIsolation: true,
        identityDigest: digestJson({
          suite: FIXTURE_SUITE,
          test: `${FIXTURE_SOURCE} — ${FIXTURE_TITLE}`,
          failureSignature: FAILURE_SIGNATURE,
          environment: ENVIRONMENT,
        }),
        authorizationDigest: DIGEST_B,
      },
    });
    return selectorCase;
  });
  const allRecords = [
    preTaskRecord, current, corroboration, ...retries,
  ];
  const unlistedResult = makeService(allRecords, root).classifyStoredFailure({
    ...selectorOnly(current.selector),
    retryReferences: retries.map((retry) => selectorOnly(retry.selector)),
    preTaskReference: selectorOnly(preTaskRecord.selector),
    corroborationReference: selectorOnly(corroboration.selector),
  });
  assert.equal(unlistedResult.outcome, "pre-existing-unlisted");
  assert.equal(unlistedResult.accepted, true);
  assert.equal(unlistedResult.intermittent, true);
  assert.equal(unlistedResult.sourceDigests.length, 6);
});

test("three immutable diagnostic-isolation v2 retries may prove safe intermittency without tier completion", async (t) => {
  needsEngineEvidence(t);
  const root = makeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = getRegisteredValidationPolicy(root);
  const testFile = "scripts/__tests__/failure-gate-v4-stored-classification.test.mjs";
  const task = makeTask(policy, "TASK-480341", {
    createdAt: new Date(NOW - 10_000).toISOString(),
  });
  const primary = makeStoredRecord({
    policy,
    task,
    attemptId: "attempt-isolation-primary",
    engine: "node-test",
    environment: NODE_ENGINE_ENVIRONMENT,
    rawSource: testFile,
    caseSource: testFile,
    finishedAt: new Date(NOW - 5000).toISOString(),
  });
  const earlierTask = makeTask(policy, "TASK-480342", {
    createdAt: new Date(NOW - 180_000).toISOString(),
  });
  const earlier = makeStoredRecord({
    policy,
    task: earlierTask,
    attemptId: "attempt-isolation-earlier",
    engine: "node-test",
    environment: NODE_ENGINE_ENVIRONMENT,
    rawSource: testFile,
    caseSource: testFile,
    finishedAt: new Date(NOW - 120_000).toISOString(),
  });
  const corroborationTask = makeTask(policy, "TASK-480343", {
    createdAt: new Date(NOW - 10_000).toISOString(),
  });
  const corroboration = makeStoredRecord({
    policy,
    task: corroborationTask,
    attemptId: "attempt-isolation-corroboration",
    engine: "node-test",
    environment: NODE_ENGINE_ENVIRONMENT,
    rawSource: testFile,
    caseSource: testFile,
    finishedAt: new Date(NOW - 4000).toISOString(),
  });
  const preliminary = makeService([primary, earlier, corroboration], root)
    .classifyStoredFailure({
      ...selectorOnly(primary.selector),
      preTaskReference: selectorOnly(earlier.selector),
      corroborationReference: selectorOnly(corroboration.selector),
    });
  const primarySourceDigest = preliminary.sourceDigests.find((source) =>
    source.attemptId === primary.attempt.attemptId)?.sourceDigest;
  assert.match(primarySourceDigest ?? "", /^[0-9a-f]{64}$/);

  const diagnosticRetries = ["failed", "passed", "failed"].map((caseStatus, index) =>
    makeDiagnosticIsolationRecord({
      root,
      policy,
      task,
      primary,
      primarySourceDigest,
      attemptId: `00000000-0000-4000-8000-00000000000${index + 1}`,
      retryNumber: index + 1,
      caseStatus,
      finishedAt: new Date(NOW - 3000 + index * 100).toISOString(),
    }));
  const result = makeService([
    primary,
    earlier,
    corroboration,
    ...diagnosticRetries,
  ], root).classifyStoredFailure({
    ...selectorOnly(primary.selector),
    retryReferences: diagnosticRetries.map((retry) => selectorOnly(retry.selector)),
    preTaskReference: selectorOnly(earlier.selector),
    corroborationReference: selectorOnly(corroboration.selector),
  });
  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.outcome, "pre-existing-unlisted");
  assert.equal(result.intermittent, true);
  assert.equal(
    result.sourceDigests.filter((source) =>
      diagnosticRetries.some((retry) => retry.attempt.attemptId === source.attemptId)).length,
    3,
  );
});

test("required-tier sources reject non-required purpose tags at every evidence boundary", async (t) => {
  needsEngineEvidence(t);
  const root = makeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = getRegisteredValidationPolicy(root);
  const primaryTask = makeTask(policy, "TASK-480351");
  const primary = makeStoredRecord({
    policy,
    task: primaryTask,
    attemptId: "attempt-purpose-primary",
    finishedAt: new Date(NOW - 5000).toISOString(),
  });
  const badPrimary = structuredClone(primary);
  badPrimary.attempt.purpose = "required_validation";
  const primaryResult = makeService([badPrimary], root).classifyStoredFailure(
    selectorOnly(badPrimary.selector),
  );
  assert.equal(primaryResult.accepted, false);

  const earlierTask = makeTask(policy, "TASK-480352", {
    createdAt: new Date(NOW - 180_000).toISOString(),
  });
  const earlier = makeStoredRecord({
    policy,
    task: earlierTask,
    attemptId: "attempt-purpose-earlier",
    finishedAt: new Date(NOW - 120_000).toISOString(),
  });
  const badEarlier = structuredClone(earlier);
  badEarlier.attempt.purpose = "diagnostic-isolation";
  const preTaskResult = makeService([primary, badEarlier], root).classifyStoredFailure({
    ...selectorOnly(primary.selector),
    preTaskReference: selectorOnly(badEarlier.selector),
  });
  assert.equal(preTaskResult.accepted, false);

  const corroborationTask = makeTask(policy, "TASK-480353", {
    createdAt: new Date(NOW - 10_000).toISOString(),
  });
  const corroboration = makeStoredRecord({
    policy,
    task: corroborationTask,
    attemptId: "attempt-purpose-corroboration",
    finishedAt: new Date(NOW - 4000).toISOString(),
  });
  const badCorroboration = structuredClone(corroboration);
  badCorroboration.attempt.purpose = "bounded_node_test_isolation";
  const corroborationResult = makeService([primary, earlier, badCorroboration], root)
    .classifyStoredFailure({
      ...selectorOnly(primary.selector),
      preTaskReference: selectorOnly(earlier.selector),
      corroborationReference: selectorOnly(badCorroboration.selector),
    });
  assert.equal(corroborationResult.accepted, false);

  const ownedTask = makeTask(policy, "TASK-480354", { baselineKind: "owned" });
  const ownedFailure = makeStoredRecord({
    policy,
    task: ownedTask,
    attemptId: "attempt-purpose-owned-failure",
    finishedAt: new Date(NOW - 5000).toISOString(),
  });
  const badRepair = makeStoredRecord({
    policy,
    task: ownedTask,
    attemptId: "attempt-purpose-repair",
    caseStatus: "passed",
    finishedAt: new Date(NOW - 4000).toISOString(),
  });
  badRepair.attempt.purpose = "required_validation";
  const repairResult = makeService([ownedFailure, badRepair], root)
    .classifyStoredFailure({
      ...selectorOnly(ownedFailure.selector),
      repairReference: selectorOnly(badRepair.selector),
    });
  assert.equal(repairResult.accepted, false);
  assert.equal(repairResult.outcome, "blocked");
});

test("caller identity and verdict fields are rejected before record resolution", () => {
  const service = new FailureGateStoredClassification({
    projectRoot: PROJECT_ROOT,
    store: { getStoredRunRecord() { throw new Error("must not be called"); } },
  });
  const result = service.classifyStoredFailure({
    taskId: "TASK-480301",
    attemptId: "attempt",
    reportReference: "case.json",
    reportDigest: DIGEST_A,
    caseId: DIGEST_B,
    observed: {
      suite: FIXTURE_SUITE,
      test: FIXTURE_TITLE,
      failureSignature: FAILURE_SIGNATURE,
      environment: ENVIRONMENT,
    },
    verified: true,
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /unsupported fields/);
});

test("a copied legacy adapter fails with a capability-specific result before store resolution", async (t) => {
  const fixtureRoot = mkdtempSync(join(PROJECT_ROOT, ".failure-gate-stored-classification-fixture-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  copyIsolatedModuleClosure(fixtureRoot);
  const { FailureGateStoredClassification: IsolatedClassification } = await import(
    `${pathToFileURL(resolve(fixtureRoot, "scripts/failure-gate-v4/stored-classification.mjs")).href}?legacy-fixture=1`
  );
  let resolverCalls = 0;
  const service = new IsolatedClassification({
    projectRoot: fixtureRoot,
    store: {
      getStoredRunRecord() {
        resolverCalls++;
        throw new Error("must not be called without the v2 producer");
      },
    },
  });
  const result = service.classifyStoredFailure(selectorOnly({
    taskId: "TASK-480301",
    attemptId: "attempt-v2-unavailable",
    reportReference: "runs/test-cases.json",
    reportDigest: DIGEST_A,
    caseId: DIGEST_B,
  }));
  assert.equal(result.accepted, false);
  assert.match(result.reason, /v2 engine-evidence.*capability is unavailable/);
  assert.equal(resolverCalls, 0);
});

test("owned-repair assessment accepts selectors only and never arbitrary proof objects", () => {
  const service = new FailureGateStoredClassification({
    projectRoot: PROJECT_ROOT,
    store: { getStoredRunRecord() { throw new Error("must not be called"); } },
  });
  const result = service.assessOwnedRepairs({
    taskId: "TASK-480301",
    recordReferences: [],
    proof: { verified: true, outcome: "pass" },
  });
  assert.equal(result.accepted, false);
  assert.match(result.reason, /unsupported fields/);
});

test("wrong task binding, evidence tampering, and deleted/renamed report selectors fail closed", async (t) => {
  needsEngineEvidence(t);
  const root = makeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = getRegisteredValidationPolicy(root);
  const task = makeTask(policy, "TASK-480306");
  const record = makeStoredRecord({
    policy, task, attemptId: "attempt-primary",
    finishedAt: new Date(NOW - 5000).toISOString(),
  });

  const wrongTaskRecord = structuredClone(record);
  wrongTaskRecord.attempt.taskId = "TASK-480399";
  const wrongTask = makeService([wrongTaskRecord], root).classifyStoredFailure(
    selectorOnly(record.selector),
  );
  assert.equal(wrongTask.accepted, false);
  assert.match(wrongTask.reason, /does not exactly bind/);

  const tampered = structuredClone(record);
  tampered.evidence.rawExitStatus = 17;
  const tamperResult = makeService([tampered], root).classifyStoredFailure(
    selectorOnly(record.selector),
  );
  assert.equal(tamperResult.accepted, false);
  assert.match(tamperResult.reason, /evidence digest/);

  const renamed = {
    ...selectorOnly(record.selector),
    reportReference: `${record.selector.reportReference}.renamed`,
  };
  const deleted = makeService([record], root).classifyStoredFailure(renamed);
  assert.equal(deleted.accepted, false);
  assert.match(deleted.reason, /unique member/);
});

test("skipped cases, fake title/signature/environment, and v1 evidence cannot prove identity", async (t) => {
  needsEngineEvidence(t);
  const root = makeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = getRegisteredValidationPolicy(root);
  const task = makeTask(policy, "TASK-480307", { baselineKind: "ignore" });
  const skipped = makeStoredRecord({
    policy, task, attemptId: "attempt-skipped", caseStatus: "skipped",
  });
  const skippedResult = makeService([skipped], root).classifyStoredFailure(
    selectorOnly(skipped.selector),
  );
  assert.equal(skippedResult.accepted, false);
  assert.match(skippedResult.reason, /raw status|skipped|signature/i);

  const wrongSignature = makeStoredRecord({
    policy,
    task,
    attemptId: "attempt-fake-signature",
    signatureOverride: sha256("caller invented failure"),
  });
  const signatureResult = makeService([wrongSignature], root).classifyStoredFailure(
    selectorOnly(wrongSignature.selector),
  );
  assert.equal(signatureResult.accepted, false);
  assert.match(signatureResult.reason, /exactly match|signature|identity|binding|evidence/i);

  const fakeTitle = makeStoredRecord({
    policy,
    task,
    attemptId: "attempt-fake-title",
    rawTitle: "invented title not in the retained case",
  });
  const fakeTitleResult = makeService([fakeTitle], root).classifyStoredFailure(
    selectorOnly(fakeTitle.selector),
  );
  assert.equal(fakeTitleResult.accepted, false);
  assert.match(fakeTitleResult.reason, /title|identity|binding|evidence/i);

  const v1 = makeStoredRecord({
    policy,
    task,
    attemptId: "attempt-v1-evidence",
    reportSchemaVersion: 1,
  });
  const v1Result = makeService([v1], root).classifyStoredFailure(selectorOnly(v1.selector));
  assert.equal(v1Result.accepted, false);
  assert.match(v1Result.reason, /v2|signature|binding/i);
});

test("expired ignored baseline fails closed before case interpretation", async (t) => {
  needsEngineEvidence(t);
  const root = makeProject({ expiredIgnore: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = getRegisteredValidationPolicy(root);
  const task = makeTask(policy, "TASK-480311", { baselineKind: "ignore" });
  const record = makeStoredRecord({
    policy,
    task,
    attemptId: "attempt-expired-policy",
    finishedAt: new Date(NOW - 5000).toISOString(),
  });
  const result = makeService([record], root).classifyStoredFailure(selectorOnly(record.selector));
  assert.equal(result.accepted, false);
  assert.match(result.reason, /unexpired/);
});

test("owned expiry, reused corroboration, missing history, and fewer than three retries remain blocked", async (t) => {
  needsEngineEvidence(t);
  const root = makeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = getRegisteredValidationPolicy(root);
  const currentTask = makeTask(policy, "TASK-480309");
  const current = makeStoredRecord({
    policy, task: currentTask, attemptId: "attempt-current-unlisted",
    finishedAt: new Date(NOW - 5000).toISOString(),
  });
  const earlierTask = makeTask(policy, "TASK-480310", {
    createdAt: new Date(NOW - 180_000).toISOString(),
  });
  const earlier = makeStoredRecord({
    policy, task: earlierTask, attemptId: "attempt-earlier",
    finishedAt: new Date(NOW - 120_000).toISOString(),
  });
  const retries = ["failed", "passed", "failed"].map((status, index) => {
    const retryTask = makeTask(policy, currentTask.taskId);
    return makeStoredRecord({
      policy, task: retryTask, attemptId: `attempt-bound-${index}`,
      caseStatus: status,
      retryAuthorization: {
        schemaVersion: 1, authorized: true, safeIsolation: true,
        identityDigest: digestJson({
          suite: FIXTURE_SUITE, test: `${FIXTURE_SOURCE} — ${FIXTURE_TITLE}`,
          failureSignature: FAILURE_SIGNATURE, environment: ENVIRONMENT,
        }),
        authorizationDigest: DIGEST_B,
      },
    });
  });
  const reusedCorroboration = makeService([current, earlier, ...retries], root)
    .classifyStoredFailure({
      ...selectorOnly(current.selector),
      retryReferences: retries.map((item) => selectorOnly(item.selector)),
      preTaskReference: selectorOnly(earlier.selector),
      corroborationReference: selectorOnly(earlier.selector),
    });
  assert.equal(reusedCorroboration.accepted, false);
  assert.match(reusedCorroboration.reason, /independent|corroboration/);

  const missingHistory = makeService([current, ...retries], root).classifyStoredFailure({
    ...selectorOnly(current.selector),
    retryReferences: retries.map((item) => selectorOnly(item.selector)),
  });
  assert.equal(missingHistory.accepted, false);
  assert.match(missingHistory.reason, /pre-task|snapshot/);

  const acceptedProjectTask = makeTask(policy, "TASK-480312", {
    approvalSourceKind: "replit-project-task",
    createdAt: new Date(NOW - 10_000).toISOString(),
  });
  const acceptedCurrent = makeStoredRecord({
    policy,
    task: acceptedProjectTask,
    attemptId: "attempt-platform-accepted",
    finishedAt: new Date(NOW - 5000).toISOString(),
  });
  const missingVerifiedSourceBoundary = makeService([
    acceptedCurrent, earlier, ...retries,
  ], root).classifyStoredFailure({
    ...selectorOnly(acceptedCurrent.selector),
    preTaskReference: selectorOnly(earlier.selector),
  });
  assert.equal(missingVerifiedSourceBoundary.accepted, false);
  assert.match(missingVerifiedSourceBoundary.reason, /verified source-created-at|local reservation time/);

  const fewerRetries = makeService([current, earlier, ...retries], root).classifyStoredFailure({
    ...selectorOnly(current.selector),
    retryReferences: retries.slice(0, 2).map((item) => selectorOnly(item.selector)),
    preTaskReference: selectorOnly(earlier.selector),
  });
  assert.equal(fewerRetries.accepted, false);
  assert.match(fewerRetries.reason, /three|retry/i);
});