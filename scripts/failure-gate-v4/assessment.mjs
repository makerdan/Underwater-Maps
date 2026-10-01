import { dirname, relative } from "node:path";
import { canonicalJson, digestJson, sha256 } from "./canonical.mjs";
import { classifyFailure } from "./classification.mjs";
import { validateStepReport } from "../lib/step-report.mjs";
import { validateTestCaseReport } from "./test-case-report.mjs";
import { hasExactRegisteredCaseCoverage, requiredCaseSuitesForTier } from "./suite-coverage.mjs";
import { verifyTestCaseReportBinding } from "./engine-evidence.mjs";

const DIGEST = /^[0-9a-f]{64}$/;
const UNAVAILABLE_CAPABILITIES = Object.freeze([
  "retained reports do not provide trusted failure signatures",
  "retained reports do not provide exact failure provenance or environment identity",
  "no trusted pre-task failure proof is available from the run snapshot",
  "no trusted isolation-retry proof is available",
  "no trusted exact repair-proof source is available",
  "baseline catalog entries are not part of this assessment input",
  "the final writer check is a separate terminal-write responsibility",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDigest(value) {
  return typeof value === "string" && DIGEST.test(value);
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function decodeArtifact(artifact, label, allowedKeys = ["reference", "digest", "contentBase64"]) {
  if (!isRecord(artifact) ||
      Object.keys(artifact).some((key) => !allowedKeys.includes(key)) ||
      typeof artifact.contentBase64 !== "string") {
    throw new TypeError(`${label} descriptor is malformed`);
  }
  const reference = requiredText(artifact.reference, `${label} reference`);
  if (!validDigest(artifact.digest)) throw new TypeError(`${label} digest is malformed`);
  const bytes = Buffer.from(artifact.contentBase64, "base64");
  if (bytes.toString("base64") !== artifact.contentBase64 || sha256(bytes) !== artifact.digest) {
    throw new TypeError(`${label} content does not match its digest`);
  }
  return { reference, digest: artifact.digest, bytes };
}

function taskBaselines(task) {
  if (!isRecord(task) || !isRecord(task.plan) || !validDigest(task.planDigest) ||
      digestJson(task.plan) !== task.planDigest) {
    throw new TypeError("task plan is missing or is not bound to its canonical plan digest");
  }
  const baselines = task.plan.baselines ?? {};
  if (!isRecord(baselines)) throw new TypeError("task plan baselines must be an object");
  const readReferences = (name) => {
    const references = baselines[name] ?? [];
    if (!Array.isArray(references)) throw new TypeError(`task plan baselines.${name} must be an array`);
    const ids = new Set();
    return references.map((reference) => {
      if (!isRecord(reference) ||
          typeof reference.id !== "string" || reference.id.length === 0 ||
          typeof reference.owner !== "string" || reference.owner.trim().length === 0 ||
          ids.has(reference.id)) {
        throw new TypeError(`task plan baselines.${name} contains an invalid or duplicate reference`);
      }
      ids.add(reference.id);
      return { id: reference.id, owner: reference.owner };
    });
  };
  const ignored = readReferences("ignore");
  const owned = readReferences("owned");
  const ignoredIds = new Set(ignored.map(({ id }) => id));
  if (owned.some(({ id }) => ignoredIds.has(id))) {
    throw new TypeError("a task baseline cannot be both ignored and owned");
  }
  return { ignored, owned };
}

function classifyUnresolvedFailure(detail, ignored, owned, attempt) {
  const date = typeof attempt?.finishedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}/.test(attempt.finishedAt)
    ? attempt.finishedAt.slice(0, 10)
    : "1970-01-01";
  const result = classifyFailure({
    observed: {
      suite: detail.suite,
      test: detail.test,
      failureSignature: null,
      environment: null,
    },
    catalogEntries: [],
    ignoredBaselineIds: ignored.map(({ id }) => id),
    ownedBaselineIds: owned.map(({ id }) => id),
    now: date,
  });
  // There is intentionally no data path that supplies a real signature, catalog,
  // retry, pre-task, corroboration, or repair proof to this call.
  return { outcome: result.outcome, accepted: false, reason: result.reason };
}

function caseAttemptIsUnexpected(attempt) {
  return attempt.rawStatus !== attempt.expectedStatus &&
    !(attempt.rawStatus === "passed" && attempt.expectedStatus === "passed");
}

function caseIsUnresolved(entry) {
  return ["failed", "skipped", "unknown", "not_run"].includes(entry.status) ||
    (Array.isArray(entry.attempts) && entry.attempts.some(caseAttemptIsUnexpected));
}

function summaryResult({
  status,
  eligible = false,
  source,
  unresolvedFailures = [],
  ownedObligations = [],
  reasons = [],
}) {
  return {
    schemaVersion: 1,
    status,
    eligible,
    source,
    unresolvedFailures,
    ownedObligations,
    unavailableCapabilities: [...UNAVAILABLE_CAPABILITIES],
    reasons,
  };
}

/**
 * Derive a narrow assessment from retained evidence.
 *
 * The caller must first bind the task/attempt to canonical store records and
 * revalidate report/artifact bytes through parseAttemptEvidence. This helper
 * checks the retained structures again, but cannot authenticate storage or
 * manufacture failure signatures, pre-task proof, or repair proof.
 */
export function assessRetainedEvidence({
  task,
  attempt,
  evidence,
  storedClassifications = [],
  ownedRepairAssessment = null,
} = {}) {
  const v2 = evidence?.schemaVersion === 2;
  let evidenceDigest = null;
  try {
    if (evidence !== undefined && evidence !== null) evidenceDigest = digestJson(evidence);
  } catch {
    // Malformed non-JSON input is reported below as incomplete evidence.
  }
  const source = {
    evidenceDigest,
    attemptEvidenceDigest: validDigest(attempt?.evidenceDigest) ? attempt.evidenceDigest : null,
    rawStepReport: null,
    discovery: null,
  };
  const reasons = [];
  let baselines;
  let retained;

  try {
    baselines = taskBaselines(task);
  } catch (error) {
    return summaryResult({
      status: "INCOMPLETE",
      source,
      reasons: [error.message],
    });
  }
  const ownedObligations = baselines.owned.map(({ id, owner }) => ({
    baselineId: id,
    owner,
    status: ownedRepairAssessment?.accepted === true ? "proven" : "unresolved",
    reason: ownedRepairAssessment?.accepted === true
      ? "owned repair obligation has a re-resolvable stored passing reference"
      : "owned repair declarations remain blocking until trusted exact repair proof exists",
    ...(ownedRepairAssessment?.reference ? { reference: ownedRepairAssessment.reference } : {}),
  }));

  try {
    if (!isRecord(evidence) || ![1, 2].includes(evidence.schemaVersion) ||
        typeof evidence.complete !== "boolean" ||
        Object.keys(evidence).some((key) => ![
          "schemaVersion", "complete", "authorizationDigest", "inputDigest", "rawExitStatus",
          "rawOutputDigest", "stepResults", "rawStepReport", "discovery",
          "executionEnvironment", "streams",
        ].includes(key))) {
      throw new TypeError("retained evidence is missing or malformed");
    }
    if (attempt?.evidenceDigest !== undefined &&
        (!validDigest(attempt.evidenceDigest) || attempt.evidenceDigest !== evidenceDigest)) {
      throw new TypeError("attempt evidence digest does not match retained evidence");
    }
    if (attempt?.authorizationDigest !== undefined &&
        evidence.authorizationDigest !== attempt.authorizationDigest) {
      throw new TypeError("retained authorization digest does not match its attempt");
    }
    if (attempt?.inputDigest !== undefined && evidence.inputDigest !== attempt.inputDigest) {
      throw new TypeError("retained input digest does not match its attempt");
    }
    if (!validDigest(evidence.authorizationDigest) || !validDigest(evidence.inputDigest)) {
      throw new TypeError("retained authorization or input digest is malformed");
    }
    if (evidence.rawExitStatus !== null &&
        (!Number.isInteger(evidence.rawExitStatus) ||
         evidence.rawExitStatus < 0 || evidence.rawExitStatus > 255)) {
      throw new TypeError("retained raw exit status is malformed");
    }

    const rawStepReport = evidence.rawStepReport;
    if (!isRecord(rawStepReport) || rawStepReport.schemaVersion !== 1 ||
        rawStepReport.validated !== true ||
        Object.keys(rawStepReport).some((key) =>
          !["schemaVersion", "reference", "digest", "contentBase64", "validated"].includes(key))) {
      throw new TypeError("retained raw step report is missing, unvalidated, or malformed");
    }
    const stepArtifact = decodeArtifact(rawStepReport, "raw step report", [
      "schemaVersion", "reference", "digest", "contentBase64", "validated",
    ]);
    source.rawStepReport = { reference: stepArtifact.reference, digest: stepArtifact.digest };
    const stepText = stepArtifact.bytes.toString("utf8");
    if (!Buffer.from(stepText, "utf8").equals(stepArtifact.bytes)) {
      throw new TypeError("retained raw step report is not valid UTF-8");
    }
    const stepReport = validateStepReport(JSON.parse(stepText));
    if (stepReport.schemaVersion !== 1) throw new TypeError("retained step report version is unsupported");
    if (stepReport.steps.length === 0 ||
        new Set(stepReport.steps.map((step) => step.name)).size !== stepReport.steps.length) {
      throw new TypeError("retained step report has no steps or duplicate step names");
    }

    const discovery = evidence.discovery;
    if (!isRecord(discovery) || discovery.schemaVersion !== 1 ||
        typeof discovery.artifactsAvailable !== "boolean" ||
        !Array.isArray(discovery.artifacts) || !isRecord(discovery.summary) ||
        Object.keys(discovery).some((key) => ![
          "schemaVersion", "reportReference", "summary", "artifactsAvailable", "artifacts", "digest",
        ].includes(key))) {
      throw new TypeError("retained discovery evidence is missing or malformed");
    }
    const summary = discovery.summary;
    if (summary.schemaVersion !== 1 || typeof summary.available !== "boolean" ||
        typeof summary.notApplicable !== "boolean" ||
        !Number.isInteger(summary.caseCount) || summary.caseCount < 0 ||
        typeof summary.allPassed !== "boolean" || !Array.isArray(summary.reports)) {
      throw new TypeError("retained discovery summary is malformed");
    }
    const artifactDescriptors = discovery.artifacts.map((artifact) =>
      decodeArtifact(artifact, "test discovery artifact"));
    const descriptorDigest = digestJson({
      reportReference: discovery.reportReference,
      summary,
      artifactsAvailable: discovery.artifactsAvailable,
      artifacts: artifactDescriptors.map(({ reference, digest }) => ({ reference, digest })),
    });
    if (!validDigest(discovery.digest) || discovery.digest !== descriptorDigest) {
      throw new TypeError("discovery digest does not match its summary and artifact references");
    }
    if (discovery.artifactsAvailable !== true) {
      throw new TypeError("retained discovery artifacts are unavailable");
    }
    const discoveryReference = requiredText(discovery.reportReference, "discovery report reference");
    if (discoveryReference !== stepArtifact.reference) {
      throw new TypeError("discovery report reference is not bound to the retained step report");
    }
    source.discovery = {
      reference: discoveryReference,
      digest: discovery.digest,
      artifacts: artifactDescriptors.map(({ reference, digest }) => ({ reference, digest })),
    };

    const artifactByName = new Map();
    for (const artifact of artifactDescriptors) {
      const name = artifact.reference.split(/[\\/]/).at(-1);
      if (!name || artifactByName.has(name)) throw new TypeError("discovery has duplicate artifact references");
      artifactByName.set(name, artifact);
    }
    const reportArtifacts = artifactDescriptors
      .filter(({ reference }) => reference.endsWith(".json"))
      .sort((left, right) =>
        left.reference.split(/[\\/]/).at(-1).localeCompare(right.reference.split(/[\\/]/).at(-1)));
    const parsedReports = reportArtifacts.map((artifact) => {
      const text = artifact.bytes.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(artifact.bytes)) {
        throw new TypeError("test-case artifact is not valid UTF-8");
      }
      const report = validateTestCaseReport(JSON.parse(text));
      if (report.rawReport) {
        const raw = artifactByName.get(report.rawReport.reference);
        if (!raw || raw.digest !== report.rawReport.digest) {
          throw new TypeError("test-case report raw artifact reference or digest is not retained");
        }
        if (report.schemaVersion === 2) {
          verifyTestCaseReportBinding({ report, rawReportBytes: raw.bytes });
        }
      }
      return {
        reference: relative(dirname(discoveryReference), artifact.reference),
        artifactReference: artifact.reference,
        digest: artifact.digest,
        report,
      };
    });
    const cases = parsedReports.flatMap(({ report }) => report.cases);
    const reportsAvailable = parsedReports.length > 0 &&
      parsedReports.every(({ report }) => report.complete) && cases.length > 0;
    const actualSummaryReports = parsedReports.map(({ reference, digest, report }) => ({
      reference,
      digest,
      engine: report.engine,
      suite: report.suite,
      ...(report.schemaVersion === 2 ? { step: report.step } : {}),
      outcome: report.outcome,
      complete: report.complete,
      caseCount: report.cases.length,
      counts: report.cases.reduce((counts, entry) => {
        counts[entry.status] = (counts[entry.status] ?? 0) + 1;
        return counts;
      }, {}),
    }));
    const noCasesApplicable = parsedReports.length === 0 &&
      artifactDescriptors.length === 0 &&
      summary.notApplicable === true && summary.caseCount === 0 &&
      summary.available === false && summary.allPassed === false &&
      summary.reports.length === 0;
    const expectedAllPassed = cases.length > 0 && reportsAvailable && cases.every((entry) =>
      entry.status === "passed" &&
      (!Array.isArray(entry.attempts) || entry.attempts.every((item) =>
        item.rawStatus === item.expectedStatus ||
        (item.rawStatus === "passed" && item.expectedStatus === "passed"))));
    const caseSummaryMatches = noCasesApplicable ||
      (summary.notApplicable === false &&
       summary.caseCount === cases.length &&
       summary.available === reportsAvailable &&
       summary.allPassed === expectedAllPassed &&
       canonicalJson(summary.reports) === canonicalJson(actualSummaryReports));
    if (!caseSummaryMatches) {
      throw new TypeError("retained discovery summary differs from the raw test-case artifacts");
    }
    if (stepReport.discovery?.testCases !== undefined &&
        canonicalJson(stepReport.discovery.testCases) !== canonicalJson(summary)) {
      throw new TypeError("step report discovery summary differs from retained discovery evidence");
    }
    if (v2) {
      const tier = attempt?.tier ?? task?.requestedTier;
      const requiredSuites = requiredCaseSuitesForTier(tier);
      const requiredSteps = stepReport.steps.map((step) => step.name);
      if (parsedReports.some(({ report }) => report.schemaVersion !== 2)) {
        throw new TypeError("current v2 report adapters cannot use legacy v1 test-case fixtures");
      }
      if (requiredSuites.length > 0 &&
          !hasExactRegisteredCaseCoverage(parsedReports, requiredSteps, tier)) {
        throw new TypeError("retained v2 test reports do not provide exact registered suite coverage");
      }
      if (requiredSuites.length === 0 && parsedReports.length !== 0) {
        throw new TypeError("retained v2 test reports are not applicable to the authorized tier");
      }
    }

    const failures = [];
    for (const { reference, artifactReference, digest, report } of parsedReports) {
      for (const entry of report.cases) {
        if (!caseIsUnresolved(entry)) continue;
        const status = ["failed", "skipped", "unknown", "not_run"].includes(entry.status)
          ? entry.status
          : "failed";
        const detail = {
          kind: "test-case",
          status,
          suite: report.suite,
          ...(v2 ? { step: report.step } : {}),
          test: entry.id,
          caseId: entry.id,
          title: entry.title,
          source: entry.source,
          reportReference: reference,
          reportDigest: digest,
          artifactReference: discoveryReference,
        };
        if (v2) {
          const selector = {
            taskId: task.taskId,
            attemptId: attempt.attemptId,
            reportReference: artifactReference,
            reportDigest: digest,
            caseId: entry.id,
          };
          detail.selector = selector;
          const stored = storedClassifications.find((item) =>
            item?.selector && canonicalJson(item.selector) === canonicalJson(selector));
          detail.classification = stored?.result ?? {
            outcome: "blocked",
            accepted: false,
            reason: "no persisted reference-only classification record matches this stored failure",
          };
          if (stored?.reference) detail.classificationReference = stored.reference;
        } else {
          detail.classification = classifyUnresolvedFailure(
            detail, baselines.ignored, baselines.owned, attempt,
          );
        }
        failures.push(detail);
      }
    }
    for (const step of stepReport.steps) {
      if (step.status === "passed" && step.rawExitStatus === 0) continue;
      if (v2) {
        const matchingFailures = failures.filter((failure) =>
          failure.kind === "test-case" && failure.step === step.name);
        const explainedByCases = step.status === "failed" &&
          step.rawExitStatus !== 0 &&
          matchingFailures.length > 0 &&
          matchingFailures.every((failure) => failure.status === "failed" &&
            failure.classification?.accepted === true);
        if (explainedByCases) continue;
      }
      const status = step.status === "passed" ? "unknown" : step.status;
      const detail = {
        kind: "validation-step",
        status,
        suite: "registered-validation-steps",
        test: step.name,
        stepName: step.name,
        rawExitStatus: step.rawExitStatus,
        reportReference: stepArtifact.reference,
        reportDigest: stepArtifact.digest,
      };
      detail.classification = v2
        ? {
            outcome: "blocked",
            accepted: false,
            reason: "validation-step failures require exact stored case evidence or a trusted step adapter",
          }
        : classifyUnresolvedFailure(detail, baselines.ignored, baselines.owned, attempt);
      failures.push(detail);
    }

    const evidenceStepResultsMatch = Array.isArray(evidence.stepResults) &&
      evidence.stepResults.length === stepReport.steps.length &&
      evidence.stepResults.every((result, index) => {
        const reportStep = stepReport.steps[index];
        return isRecord(result) &&
          Object.keys(result).every((key) =>
            ["stepName", "rawExitStatus", "reportReference", "reportDigest"].includes(key)) &&
          result.stepName === reportStep.name &&
          result.rawExitStatus === reportStep.rawExitStatus &&
          result.reportReference === stepArtifact.reference &&
          result.reportDigest === stepArtifact.digest;
      });
    const attemptStepResults = attempt?.stepResults;
    const attemptStepResultsMatch = Array.isArray(attemptStepResults) &&
      attemptStepResults.length === stepReport.steps.length &&
      attemptStepResults.every((result, index) => {
        const reportStep = stepReport.steps[index];
        const evidenceStep = evidence.stepResults?.[index];
        const expectedStatus = reportStep.rawExitStatus === null
          ? "NOT_STARTED"
          : reportStep.rawExitStatus === 0 ? "FINISHED" : "FAILED";
        return isRecord(result) &&
          result.stepName === reportStep.name &&
          result.status === expectedStatus &&
          result.rawExitStatus === reportStep.rawExitStatus &&
          result.rawReportReference === evidenceStep?.reportReference &&
          result.reportDigest === evidenceStep?.reportDigest;
      });
    const stepResultsMatch = evidenceStepResultsMatch && attemptStepResultsMatch;
    if (!stepResultsMatch) reasons.push("retained step results do not exactly match the raw step report");
    const failedCases = failures.filter((failure) =>
      failure.kind === "test-case" && failure.status === "failed");
    const failedCaseStepsMatch = !v2 || failedCases.every((failure) => {
      const step = stepReport.steps.find((item) => item.name === failure.step);
      return step?.status === "failed" && Number.isInteger(step.rawExitStatus) &&
        step.rawExitStatus > 0;
    });
    if (!failedCaseStepsMatch) {
      reasons.push("retained v2 test failures do not map to matching nonzero registered step results");
    }

    retained = {
      evidence,
      stepReport,
      summary,
      cases,
      failures,
      reportsAvailable,
      noCasesApplicable,
      stepResultsMatch,
      failedCaseStepsMatch,
    };
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "retained evidence is malformed");
  }

  if (!retained) {
    if (ownedObligations.length > 0) {
      reasons.push("one or more owned repair declarations remain unresolved");
    }
    return summaryResult({
      status: ownedObligations.length > 0 ? "BLOCKED" : "INCOMPLETE",
      source,
      ownedObligations,
      reasons,
    });
  }

  const snapshot = attempt?.snapshot;
  const coordination = snapshot?.writerCoordination;
  const snapshotVerified = isRecord(snapshot) && snapshot.integrity === "verified";
  const coordinationVerified = isRecord(coordination) &&
    coordination.status === "verified" &&
    typeof coordination.adapterId === "string" && coordination.adapterId.length > 0 &&
    validDigest(coordination.evidenceDigest);
  if (!snapshotVerified || !coordinationVerified) {
    reasons.push(!snapshotVerified
      ? "run snapshot integrity is not verified"
      : "run writer coordination is not verified");
  }

  const hasRawFailures = retained.failures.length > 0;
  const rawAllPass = retained.evidence.schemaVersion === 1 &&
    retained.evidence.complete === true &&
    retained.evidence.rawExitStatus === 0 &&
    validDigest(retained.evidence.rawOutputDigest) &&
    retained.reportsAvailable
      ? retained.summary.allPassed === true
      : retained.evidence.complete === true &&
        retained.evidence.rawExitStatus === 0 &&
        validDigest(retained.evidence.rawOutputDigest) &&
        retained.noCasesApplicable;
  const completeRawSteps = v2
    ? retained.stepReport.steps.every((step) =>
      ["passed", "failed"].includes(step.status) && Number.isInteger(step.rawExitStatus))
    : retained.stepReport.rawExitStatus === 0 &&
      retained.stepReport.steps.every((step) => step.status === "passed" && step.rawExitStatus === 0);
  const allClassifiedFailuresAccepted = retained.failures
    .filter((failure) => failure.kind === "test-case")
    .every((failure) => failure.classification?.accepted === true);
  const unexplainedStepFailures = retained.failures.some((failure) =>
    failure.kind === "validation-step");
  const processFailureExplained = retained.evidence.rawExitStatus === 0 ||
    (v2 && retained.failures.some((failure) =>
      failure.kind === "test-case" && failure.status === "failed") &&
      allClassifiedFailuresAccepted && !unexplainedStepFailures);
  const hasNonzeroStepResult = retained.stepReport.steps.some((step) =>
    Number.isInteger(step.rawExitStatus) && step.rawExitStatus > 0);
  const v2ProcessStatusMatchesSteps = !v2 ||
    (retained.evidence.rawExitStatus === 0
      ? !hasNonzeroStepResult
      : hasNonzeroStepResult);
  if (!v2ProcessStatusMatchesSteps) {
    reasons.push("retained v2 process exit status does not agree with exact raw step outcomes");
  }
  const v2EvidenceComplete = v2 &&
    retained.evidence.complete === true &&
    retained.evidence.rawExitStatus !== null &&
    validDigest(retained.evidence.rawOutputDigest) &&
    retained.stepResultsMatch &&
    retained.failedCaseStepsMatch &&
    v2ProcessStatusMatchesSteps;
  const v2FailuresResolved = allClassifiedFailuresAccepted &&
    !unexplainedStepFailures && processFailureExplained;

  let status;
  if (ownedObligations.length > 0) {
    status = "BLOCKED";
    reasons.push("one or more owned repair declarations remain unresolved");
  } else if (!snapshotVerified || !coordinationVerified) {
    status = "BLOCKED";
  } else if (v2) {
    if (!v2EvidenceComplete) {
      status = "INCOMPLETE";
      reasons.push("v2 evidence is not structurally complete, exactly registered, and bound to every executed step");
    } else if (!completeRawSteps) {
      status = "INCOMPLETE";
      reasons.push("v2 evidence omits a registered step result");
    } else if (!v2FailuresResolved) {
      status = "FAIL";
      reasons.push("one or more raw failures, process exits, or step errors remain unexplained");
    } else {
      status = "PASS";
    }
  } else if (hasRawFailures || !completeRawSteps) {
    status = "FAIL";
  } else if (!retained.evidence.complete || !rawAllPass || !retained.stepResultsMatch) {
    status = "INCOMPLETE";
    reasons.push("evidence does not prove already-complete exact all-pass results");
  } else {
    status = "PASS";
  }

  return summaryResult({
    status,
    eligible: status === "PASS",
    source,
    unresolvedFailures: retained.failures,
    ownedObligations,
    reasons,
  });
}