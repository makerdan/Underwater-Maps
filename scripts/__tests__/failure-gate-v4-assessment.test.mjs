import assert from "node:assert/strict";
import { test } from "node:test";
import { assessRetainedEvidence } from "../failure-gate-v4/assessment.mjs";
import { digestJson, sha256 } from "../failure-gate-v4/canonical.mjs";

const ZERO_DIGEST = "0".repeat(64);
const ONE_DIGEST = "1".repeat(64);
const RUN_REFERENCE = "/retained/run-1.json";

function task({ ignore = [], owned = [] } = {}) {
  const plan = {
    taskId: "TASK-000001",
    baselines: {
      ignore: ignore.map((id) => ({ id, owner: "validation-team" })),
      owned: owned.map((id) => ({ id, owner: "repair-team" })),
    },
  };
  return { taskId: plan.taskId, plan, planDigest: digestJson(plan) };
}

function snapshot(overrides = {}) {
  return {
    integrity: "verified",
    writerCoordination: {
      status: "verified",
      adapterId: "checked-adapter-v1",
      evidenceDigest: ONE_DIGEST,
    },
    ...overrides,
  };
}

function makeEvidence({
  cases = [],
  noCasesApplicable = false,
  stepStatus = "passed",
  stepExitStatus = stepStatus === "passed" ? 0 : 1,
  complete = true,
  extraCaseFields = {},
} = {}) {
  const report = {
    schemaVersion: 1,
    engine: "node",
    suite: "unit-suite",
    outcome: "passed",
    complete: !cases.some((status) => status === "unknown" || status === "not_run"),
    cases: cases.map((status, index) => ({
      id: sha256(`case-${index}`),
      source: `src/case-${index}.test.mjs`,
      title: `case ${index}`,
      line: null,
      status,
      ...extraCaseFields,
    })),
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  const reportDigest = sha256(reportBytes);
  const reportArtifact = {
    reference: `${RUN_REFERENCE}.cases/node-report.json`,
    digest: reportDigest,
    contentBase64: reportBytes.toString("base64"),
  };
  const summary = noCasesApplicable
    ? {
        schemaVersion: 1,
        available: false,
        notApplicable: true,
        reason: "this tier has no registered test-case suite",
        caseCount: 0,
        allPassed: false,
        reports: [],
      }
    : {
        schemaVersion: 1,
        available: report.complete && report.cases.length > 0,
        notApplicable: false,
        caseCount: report.cases.length,
        allPassed: report.complete && report.cases.length > 0 &&
          report.cases.every((entry) => entry.status === "passed"),
        reports: [{
          reference: "run-1.json.cases/node-report.json",
          digest: reportDigest,
          engine: report.engine,
          suite: report.suite,
          outcome: report.outcome,
          complete: report.complete,
          caseCount: report.cases.length,
          counts: report.cases.reduce((counts, entry) => {
            counts[entry.status] = (counts[entry.status] ?? 0) + 1;
            return counts;
          }, {}),
        }],
      };
  const artifacts = noCasesApplicable ? [] : [reportArtifact];
  const discovery = {
    schemaVersion: 1,
    reportReference: RUN_REFERENCE,
    summary,
    artifactsAvailable: true,
    artifacts,
  };
  discovery.digest = digestJson({
    reportReference: discovery.reportReference,
    summary,
    artifactsAvailable: discovery.artifactsAvailable,
    artifacts: artifacts.map(({ reference, digest }) => ({ reference, digest })),
  });

  const stepReport = {
    schemaVersion: 1,
    runner: "run-tier",
    tier: "fast",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    rawExitStatus: stepExitStatus,
    discovery: { testCases: summary },
    steps: [{
      name: "test:unit",
      phase: "test",
      status: stepStatus,
      rawExitStatus: stepExitStatus,
      signal: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000,
      discovery: null,
      ...(stepStatus === "unknown" ? { reason: "fixture unknown result" } : {}),
    }],
  };
  const stepBytes = Buffer.from(JSON.stringify(stepReport));
  const stepDigest = sha256(stepBytes);
  const stepEvidence = {
    schemaVersion: 1,
    reference: RUN_REFERENCE,
    digest: stepDigest,
    contentBase64: stepBytes.toString("base64"),
    validated: true,
  };
  const evidence = {
    schemaVersion: 1,
    complete,
    authorizationDigest: ZERO_DIGEST,
    inputDigest: ONE_DIGEST,
    rawExitStatus: complete ? 0 : stepExitStatus,
    rawOutputDigest: ZERO_DIGEST,
    rawStepReport: stepEvidence,
    discovery,
    stepResults: [{
      stepName: "test:unit",
      rawExitStatus: stepExitStatus,
      reportReference: RUN_REFERENCE,
      reportDigest: stepDigest,
    }],
  };
  return { evidence, stepReport, reportArtifact };
}

function attempt(evidence, overrides = {}) {
  return {
    attemptId: "attempt-1",
    authorizationDigest: evidence.authorizationDigest,
    inputDigest: evidence.inputDigest,
    evidenceDigest: digestJson(evidence),
    finishedAt: "2026-01-01T00:00:02.000Z",
    stepResults: evidence.stepResults.map((step) => ({
      stepName: step.stepName,
      status: step.rawExitStatus === null
        ? "NOT_STARTED"
        : step.rawExitStatus === 0 ? "FINISHED" : "FAILED",
      rawExitStatus: step.rawExitStatus,
      rawReportReference: step.reportReference,
      reportDigest: step.reportDigest,
    })),
    snapshot: snapshot(),
    ...overrides,
  };
}

test("complete all-pass evidence with no applicable cases can be eligible", () => {
  const { evidence } = makeEvidence({ noCasesApplicable: true });
  const result = assessRetainedEvidence({
    task: task(),
    attempt: attempt(evidence),
    evidence,
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.eligible, true);
  assert.equal(result.unresolvedFailures.length, 0);
  assert.equal(result.source.evidenceDigest, digestJson(evidence));
  assert.equal(result.source.rawStepReport.reference, RUN_REFERENCE);
  assert.equal(result.source.discovery.artifacts.length, 0);
});

test("each failed, skipped, unknown, and not-run discovered case is enumerated", () => {
  const { evidence } = makeEvidence({
    cases: ["failed", "skipped", "unknown", "not_run", "passed"],
    complete: false,
  });
  const result = assessRetainedEvidence({
    task: task(),
    attempt: attempt(evidence),
    evidence,
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.eligible, false);
  assert.deepEqual(
    result.unresolvedFailures.filter((failure) => failure.kind === "test-case")
      .map((failure) => failure.status),
    ["failed", "skipped", "unknown", "not_run"],
  );
  assert.ok(result.unresolvedFailures.every((failure) =>
    failure.classification.outcome === "blocked" &&
    failure.classification.accepted === false));
});

test("ignored baseline declarations do not classify raw failures or unlisted failures as accepted", () => {
  const { evidence } = makeEvidence({ cases: ["failed", "skipped"], complete: false });
  const result = assessRetainedEvidence({
    task: task({ ignore: ["BASE-IGNORED"] }),
    attempt: attempt(evidence),
    evidence,
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.unresolvedFailures.length, 2);
  assert.ok(result.unresolvedFailures.every((failure) =>
    failure.classification.accepted === false &&
    failure.classification.outcome === "blocked"));
});

test("owned repair declarations stay blocking for all-pass, absent, and skipped cases", () => {
  const allPass = makeEvidence({ noCasesApplicable: true });
  const allPassResult = assessRetainedEvidence({
    task: task({ owned: ["BASE-OWNED"] }),
    attempt: attempt(allPass.evidence),
    evidence: allPass.evidence,
  });
  assert.equal(allPassResult.status, "BLOCKED");
  assert.equal(allPassResult.eligible, false);
  assert.deepEqual(allPassResult.ownedObligations.map(({ baselineId, status }) =>
    [baselineId, status]), [["BASE-OWNED", "unresolved"]]);

  const skipped = makeEvidence({ cases: ["skipped"], complete: false });
  const skippedResult = assessRetainedEvidence({
    task: task({ owned: ["BASE-OWNED"] }),
    attempt: attempt(skipped.evidence),
    evidence: skipped.evidence,
  });
  assert.equal(skippedResult.status, "BLOCKED");
  assert.equal(skippedResult.eligible, false);
  assert.equal(skippedResult.ownedObligations[0].status, "unresolved");

  const missingEvidence = assessRetainedEvidence({
    task: task({ owned: ["BASE-OWNED"] }),
    attempt: attempt(allPass.evidence),
    evidence: null,
  });
  assert.equal(missingEvidence.status, "BLOCKED");
  assert.equal(missingEvidence.ownedObligations[0].status, "unresolved");
});

test("caller-supplied signatures and verified proof claims never resolve classification", () => {
  const { evidence } = makeEvidence({
    cases: ["failed"],
    complete: false,
    extraCaseFields: {
      failureSignature: "caller-fabricated-signature",
      verified: true,
      preTaskEvidence: { verified: true, outcome: "fail" },
      repairProof: { verified: true, outcome: "pass" },
    },
  });
  const unsafeAttempt = attempt(evidence, {
    verified: true,
    preTaskEvidence: { verified: true },
    repairProof: { verified: true },
  });
  const result = assessRetainedEvidence({
    task: task(),
    attempt: unsafeAttempt,
    evidence,
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.unresolvedFailures.length, 1);
  assert.equal(result.unresolvedFailures[0].classification.accepted, false);
  assert.equal("failureSignature" in result.unresolvedFailures[0], false);
  assert.ok(result.unavailableCapabilities.some((item) => item.includes("failure signatures")));
});

test("missing or malformed retained artifacts produce an incomplete assessment", () => {
  const { evidence } = makeEvidence({ cases: ["passed"] });
  const missing = structuredClone(evidence);
  missing.discovery.artifacts = [];
  const missingAttempt = attempt(missing);
  missing.discovery.digest = digestJson({
    reportReference: missing.discovery.reportReference,
    summary: missing.discovery.summary,
    artifactsAvailable: missing.discovery.artifactsAvailable,
    artifacts: [],
  });
  missingAttempt.evidenceDigest = digestJson(missing);
  const missingResult = assessRetainedEvidence({
    task: task(),
    attempt: missingAttempt,
    evidence: missing,
  });
  assert.equal(missingResult.status, "INCOMPLETE");
  assert.equal(missingResult.eligible, false);

  const malformed = structuredClone(evidence);
  malformed.rawStepReport.contentBase64 = "not-base64!";
  const malformedAttempt = attempt(malformed);
  malformedAttempt.evidenceDigest = digestJson(malformed);
  const malformedResult = assessRetainedEvidence({
    task: task(),
    attempt: malformedAttempt,
    evidence: malformed,
  });
  assert.equal(malformedResult.status, "INCOMPLETE");
  assert.equal(malformedResult.eligible, false);
});

test("unverified run snapshot or writer coordination blocks otherwise complete evidence", () => {
  const { evidence } = makeEvidence({ noCasesApplicable: true });
  const result = assessRetainedEvidence({
    task: task(),
    attempt: attempt(evidence, { snapshot: snapshot({ integrity: "unknown" }) }),
    evidence,
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.eligible, false);
});