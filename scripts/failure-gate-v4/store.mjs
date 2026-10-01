import {
  chmodSync, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readSync, realpathSync, readdirSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, digestJson, sha256 } from "./canonical.mjs";
import { assessRetainedEvidence } from "./assessment.mjs";
import { validateStepReport } from "../lib/step-report.mjs";
import { loadPinnedReviewerDecision } from "./git-review.mjs";
import { getRegisteredValidationPolicy } from "./policy.mjs";
import {
  prepareAcceptedProjectTask,
  REPLIT_TASK_POLICY_ID,
  verifyAcceptedProjectTaskBinding,
} from "./replit-task.mjs";
import { assertActiveWriterProof } from "./writer-lock.mjs";
import { validateTestCaseReport } from "./test-case-report.mjs";
import {
  hasExactRegisteredCaseCoverage,
} from "./suite-coverage.mjs";
import {
  verifyTestCaseReportBinding,
} from "./engine-evidence.mjs";
import { FailureGateStoredClassification } from "./stored-classification.mjs";
import { resolveStoredDiagnosticRunRecord } from "./diagnostics.mjs";
import { BOOTSTRAP_APPROVAL_REFERENCE, verifyBootstrapApproval } from "./bootstrap-policy.mjs";
import {
  assertRecordedRunStopped, captureRunProcessIdentity,
} from "./recovery.mjs";

const TASK_ID_PATTERN = /^TASK-\d{6,}$/;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_STORED_RUN_EVIDENCE_BYTES = 52 * 1024 * 1024;
const MAX_TRACKED_PLAN_FILES = 8192;
const MAX_TRACKED_PLAN_BYTES = 2 * 1024 * 1024;
const MAX_TRACKED_PLAN_READ_BYTES = 64 * 1024 * 1024;
const V2_REPORT_ADAPTERS = new Set(["run-tier-report-v2", "test-heavy-report-v2"]);
const LEGACY_REPORT_ADAPTERS = new Set(["run-tier-report-v1", "test-heavy-report-v1"]);

function isV2ReportAdapter(adapterId) {
  return V2_REPORT_ADAPTERS.has(adapterId);
}

function isLegacyReportAdapter(adapterId) {
  return LEGACY_REPORT_ADAPTERS.has(adapterId);
}

function readLinuxProcessIdentity(pid) {
  if (process.platform !== "linux" || !Number.isInteger(pid) || pid < 2) {
    throw new Error("checked run process identity requires a live Linux child PID");
  }
  let stat;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    throw new Error("checked run child disappeared before its process identity was captured");
  }
  const closeParen = stat.lastIndexOf(")");
  const prefix = stat.slice(0, stat.indexOf(" "));
  const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
  const parsedPid = Number(prefix);
  const parentPid = Number(fields[1]);
  const processGroupId = Number(fields[2]);
  const startTicks = fields[19];
  if (parsedPid !== pid || parentPid !== process.pid || !Number.isSafeInteger(processGroupId) ||
      processGroupId !== pid || !/^\d+$/.test(startTicks ?? "")) {
    throw new Error("checked run child process group or start-time identity is invalid");
  }
  return { pid, startTicks, processGroupId };
}

function evidenceFileBytes(reference, { parent, maximumBytes, label }) {
  if (typeof reference !== "string" || resolve(reference) !== reference ||
      dirname(reference) !== parent || basename(reference) === "." || basename(reference) === "..") {
    throw new Error(`${label} reference is outside its registered run artifact directory`);
  }
  const info = lstatSync(reference);
  if (!info.isFile() || info.isSymbolicLink() ||
      realpathSync(reference) !== reference || info.size > maximumBytes) {
    throw new Error(`${label} is unsafe, changed, or oversized`);
  }
  const bytes = readFileSync(reference);
  if (bytes.length !== info.size) throw new Error(`${label} changed while it was being read`);
  return bytes;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  return digest;
}

function isTestCaseStep(stepName) {
  return ["test:unit", "test:e2e", "e2e-palette"].includes(stepName);
}

function hasExactRegisteredReportCoverage(report, requiredSteps, tier) {
  const discovery = report?.discovery;
  if (!discovery || typeof discovery !== "object") return false;
  if (tier === "test-heavy") {
    const validation = discovery.validationSteps;
    const serial = discovery.serialSuites;
    return validation?.available === true &&
      validation.source === "scripts/validation-steps.mjs" &&
      Array.isArray(validation.names) && serial?.available === true &&
      serial.source === "test-heavy-serial.mjs" && Array.isArray(serial.names) &&
      canonicalJson(["PREFLIGHT", ...validation.names, ...serial.names]) === canonicalJson(requiredSteps);
  }
  const registered = discovery.registeredSteps;
  return registered?.available === true &&
    registered.source === "scripts/validation-steps.mjs" &&
    Array.isArray(registered.names) &&
    canonicalJson(registered.names) === canonicalJson(requiredSteps);
}

function validateStoredStepReport(rawStepReport, requiredSteps, complete, authorizedTier, reportAdapterId) {
  if (rawStepReport === null) {
    if (complete) throw new Error("complete evidence is missing its raw versioned step report");
    return null;
  }
  if (!rawStepReport || typeof rawStepReport !== "object" || Array.isArray(rawStepReport) ||
      Object.keys(rawStepReport).some((key) =>
        !["schemaVersion", "reference", "digest", "contentBase64", "validated"].includes(key)) ||
      rawStepReport.schemaVersion !== 1 || typeof rawStepReport.contentBase64 !== "string" ||
      typeof rawStepReport.validated !== "boolean") {
    throw new Error("raw step report evidence is malformed or unsupported");
  }
  const reference = requiredText(rawStepReport.reference, "raw step report reference");
  const digest = requiredDigest(rawStepReport.digest, "raw step report digest");
  const runRoot = resolve(homedir(), ".failure-gate-v4", "runs");
  if (!/^[0-9a-f-]{36}\.json$/.test(basename(reference))) {
    throw new Error("raw step report does not use an isolated checked-run artifact name");
  }
  const reportBytes = evidenceFileBytes(reference, {
    parent: runRoot,
    maximumBytes: 4 * 1024 * 1024,
    label: "raw step report",
  });
  const embeddedBytes = Buffer.from(rawStepReport.contentBase64, "base64");
  if (embeddedBytes.toString("base64") !== rawStepReport.contentBase64 ||
      !embeddedBytes.equals(reportBytes) || sha256(embeddedBytes) !== digest) {
    throw new Error("raw step report content, digest, and checked artifact do not match");
  }
  if (!rawStepReport.validated) {
    if (complete) throw new Error("complete evidence cannot use an invalid or unvalidated raw step report");
    return { report: null, reference, digest };
  }
  const text = embeddedBytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(embeddedBytes)) {
    throw new Error("validated raw step report is not valid UTF-8");
  }
  const report = validateStepReport(JSON.parse(text));
  if (report.schemaVersion !== 1) throw new Error("raw step report version is unsupported");
  const expectedReportTier = {
    "test-fast": "fast",
    "test-standard": "standard",
    "test-standard-plus": "full",
    "test-heavy": "test-heavy",
  }[authorizedTier];
  if (complete) {
    const exactSteps = report.steps.length === requiredSteps.length &&
      report.steps.every((step, index) => step.name === requiredSteps[index]);
    const currentV2 = isV2ReportAdapter(reportAdapterId);
    const resultShape = currentV2
      ? report.steps.every((step) =>
        (step.status === "passed" && step.rawExitStatus === 0) ||
        (step.status === "failed" && Number.isInteger(step.rawExitStatus) &&
          step.rawExitStatus > 0 && step.rawExitStatus <= 255))
      : report.steps.every((step) => step.status === "passed" && step.rawExitStatus === 0) &&
        report.rawExitStatus === 0;
    if (!exactSteps ||
        !resultShape ||
        !Number.isInteger(report.rawExitStatus) || report.rawExitStatus < 0 || report.rawExitStatus > 255 ||
        report.runner !== (authorizedTier === "test-heavy" ? "test-heavy-serial" : "run-tier") ||
        report.tier !== expectedReportTier ||
        !hasExactRegisteredReportCoverage(report, requiredSteps, authorizedTier)) {
      throw new Error(currentV2
        ? "complete step report does not prove exact registered steps were executed with structural results"
        : "complete step report does not prove every exact registered step passed");
    }
  }
  return { report, reference, digest };
}

function validateStoredDiscovery(discovery, rawStepReport, requiredSteps, complete, authorizedTier, reportAdapterId) {
  if (discovery === null) {
    if (complete) throw new Error("complete evidence is missing test discovery and artifact digests");
    return null;
  }
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery) ||
      Object.keys(discovery).some((key) =>
        !["schemaVersion", "reportReference", "summary", "artifactsAvailable", "artifacts", "digest"].includes(key)) ||
      discovery.schemaVersion !== 1 || typeof discovery.artifactsAvailable !== "boolean" ||
      !Array.isArray(discovery.artifacts)) {
    throw new Error("test discovery evidence is malformed or unsupported");
  }
  const summary = discovery.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary) ||
      summary.schemaVersion !== 1 || typeof summary.available !== "boolean" ||
      typeof summary.notApplicable !== "boolean" || !Number.isInteger(summary.caseCount) ||
      summary.caseCount < 0 || typeof summary.allPassed !== "boolean" ||
      !Array.isArray(summary.reports)) {
    throw new Error("test discovery summary is malformed");
  }
  if (discovery.artifacts.length > 4096) {
    throw new Error("test discovery artifact count exceeds the bounded evidence size");
  }
  const artifactDescriptors = discovery.artifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact) ||
        Object.keys(artifact).some((key) => !["reference", "digest", "contentBase64"].includes(key)) ||
        typeof artifact.contentBase64 !== "string") {
      throw new Error("test discovery artifact evidence is malformed");
    }
    return {
      reference: requiredText(artifact.reference, "test discovery artifact reference"),
      digest: requiredDigest(artifact.digest, "test discovery artifact digest"),
      contentBase64: artifact.contentBase64,
    };
  });
  const descriptorDigest = digestJson({
    reportReference: discovery.reportReference,
    summary,
    artifactsAvailable: discovery.artifactsAvailable,
    artifacts: artifactDescriptors.map(({ reference, digest }) => ({ reference, digest })),
  });
  if (requiredDigest(discovery.digest, "test discovery evidence digest") !== descriptorDigest) {
    throw new Error("test discovery evidence digest does not match its summary and artifact references");
  }
  const requiresCases = requiredSteps.some(isTestCaseStep);
  if (!discovery.artifactsAvailable) {
    if (artifactDescriptors.length !== 0 || complete) {
      throw new Error("complete evidence cannot omit checked test discovery artifacts");
    }
    return { summary, artifactDescriptors, available: false };
  }
  const runRoot = resolve(homedir(), ".failure-gate-v4", "runs");
  const discoveryReportReference = requiredText(discovery.reportReference, "discovery report reference");
  if (dirname(discoveryReportReference) !== runRoot ||
      !/^[0-9a-f-]{36}\.json$/.test(basename(discoveryReportReference)) ||
      (rawStepReport && rawStepReport.reference !== discoveryReportReference)) {
    throw new Error("test discovery evidence is not bound to its checked step-report path");
  }
  const caseDirectory = `${discoveryReportReference}.cases`;
  const caseRoot = realpathSync(caseDirectory);
  if (caseRoot !== caseDirectory) throw new Error("test discovery artifact directory resolves through an alias");
  const names = readdirSync(caseRoot).sort();
  if (complete && !requiresCases && names.length > 0) {
    throw new Error("complete evidence has unregistered test-discovery artifacts");
  }
  const artifactByName = new Map();
  for (const artifact of artifactDescriptors) {
    if (dirname(artifact.reference) !== caseRoot ||
        basename(artifact.reference) === "." || basename(artifact.reference) === "..") {
      throw new Error("test discovery artifact reference escapes its registered run directory");
    }
    const name = basename(artifact.reference);
    if (artifactByName.has(name)) throw new Error("duplicate test discovery artifact reference");
    const embedded = Buffer.from(artifact.contentBase64, "base64");
    if (embedded.toString("base64") !== artifact.contentBase64 ||
        embedded.length > 8 * 1024 * 1024 || sha256(embedded) !== artifact.digest) {
      throw new Error("test discovery artifact content or digest is invalid");
    }
    const actual = evidenceFileBytes(artifact.reference, {
      parent: caseRoot,
      maximumBytes: 8 * 1024 * 1024,
      label: "test discovery artifact",
    });
    if (!actual.equals(embedded)) throw new Error("test discovery artifact changed after capture");
    artifactByName.set(name, { ...artifact, bytes: embedded });
  }
  if (discovery.artifactsAvailable &&
      (names.length !== artifactByName.size || names.some((name) => !artifactByName.has(name)))) {
    throw new Error("test discovery artifact set differs from the actual report directory");
  }
  const reportArtifacts = names.filter((name) => name.endsWith(".json"));
  let rawReportsValid = true;
  const reports = reportArtifacts.map((name) => {
    const artifact = artifactByName.get(name);
    try {
      const report = validateTestCaseReport(JSON.parse(artifact.bytes.toString("utf8")));
      if (report.rawReport) {
        const raw = artifactByName.get(report.rawReport.reference);
        if (!raw || raw.digest !== report.rawReport.digest) {
          throw new Error("test-case report raw artifact reference or digest is not in retained evidence");
        }
        if (report.schemaVersion === 2) {
          if (verifyTestCaseReportBinding({ report, rawReportBytes: raw.bytes }) !== true) {
            throw new Error("test-case report raw evidence did not pass the engine binding verifier");
          }
        }
      }
      return {
        reference: relative(dirname(discoveryReportReference), artifact.reference),
        digest: artifact.digest,
        report,
      };
    } catch (error) {
      rawReportsValid = false;
      if (complete) throw error;
      return null;
    }
  }).filter(Boolean);
  if (!rawReportsValid) return { summary, artifactDescriptors, available: false };
  const cases = reports.flatMap(({ report }) => report.cases);
  const available = reports.length > 0 && reports.every(({ report }) => report.complete) && cases.length > 0;
  const currentV2 = isV2ReportAdapter(reportAdapterId);
  const expectedSummary = requiresCases
    ? {
        schemaVersion: 1,
        available,
        notApplicable: false,
        ...(!available ? { reason: cases.length === 0
          ? "no test cases were discovered"
          : "one or more test-case reports are incomplete" } : {}),
        caseCount: cases.length,
        allPassed: cases.length > 0 && available && cases.every((entry) =>
          entry.status === "passed" &&
          (!Array.isArray(entry.attempts) || entry.attempts.every((attempt) =>
            attempt.rawStatus === attempt.expectedStatus ||
            (attempt.rawStatus === "passed" && attempt.expectedStatus === "passed")))),
        reports: reports.map(({ reference, digest, report }) => ({
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
        })),
      }
    : {
        schemaVersion: 1,
        available: false,
        notApplicable: true,
        reason: "this tier has no registered test-case suite",
        caseCount: 0,
        allPassed: false,
        reports: [],
      };
  if (complete && canonicalJson(summary) !== canonicalJson(expectedSummary)) {
    throw new Error("stored test discovery summary does not match the retained raw report artifacts");
  }
  if (complete && currentV2) {
    if (reports.some(({ report }) => report.schemaVersion !== 2) ||
        !hasExactRegisteredCaseCoverage(reports, requiredSteps, authorizedTier)) {
      throw new Error("complete v2 evidence requires bound reports for every exact registered suite");
    }
    if (reports.some(({ report }) =>
      report.cases.some((entry) => ["skipped", "unknown", "not_run"].includes(entry.status)))) {
      throw new Error("complete v2 evidence cannot contain skipped, unknown, or not-run cases");
    }
    if (!requiresCases &&
        (reports.length !== 0 || summary.notApplicable !== true || summary.caseCount !== 0)) {
      throw new Error("v2 evidence for this tier cannot contain unregistered test-case suites");
    }
  } else if (complete && requiresCases &&
      (!summary.available || summary.caseCount === 0 || !summary.allPassed ||
       cases.length === 0 || cases.some((entry) => entry.status !== "passed"))) {
    throw new Error("complete legacy evidence requires nonempty discovery with every case passed");
  }
  return { summary, artifactDescriptors, available: true };
}

function parseAttemptEvidence(evidence, row) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) ||
      ![1, 2].includes(evidence.schemaVersion) || typeof evidence.complete !== "boolean") {
    throw new Error("run finalization requires explicit structured raw evidence");
  }
  const currentV2 = isV2ReportAdapter(row.report_adapter_id);
  const legacyAdapter = isLegacyReportAdapter(row.report_adapter_id);
  if ((currentV2 && evidence.schemaVersion !== 2) ||
      (legacyAdapter && evidence.schemaVersion !== 1) ||
      (!currentV2 && !legacyAdapter)) {
    throw new Error("run evidence version does not match the exact registered report adapter");
  }
  const allowedKeys = new Set([
    "schemaVersion", "complete", "authorizationDigest", "inputDigest", "rawExitStatus",
    "rawOutputDigest", "stepResults", "rawStepReport", "discovery", "executionEnvironment", "streams",
  ]);
  if (Object.keys(evidence).some((key) => !allowedKeys.has(key))) {
    throw new Error("completion evidence contains unsupported fields; caller result labels are not evidence");
  }
  const authorizationDigest = requiredDigest(evidence.authorizationDigest, "evidence authorizationDigest");
  const inputDigest = requiredDigest(evidence.inputDigest, "evidence inputDigest");
  if (authorizationDigest !== row.authorization_digest || inputDigest !== row.input_digest) {
    throw new Error("run evidence does not match the trusted authorization and input digests");
  }
  if (evidence.rawExitStatus !== null &&
      (!Number.isInteger(evidence.rawExitStatus) || evidence.rawExitStatus < 0 || evidence.rawExitStatus > 255)) {
    throw new Error("run evidence rawExitStatus must be an exit code or null");
  }
  const rawOutputDigest = evidence.rawOutputDigest === null
    ? null
    : requiredDigest(evidence.rawOutputDigest, "evidence rawOutputDigest");
  const requiredSteps = JSON.parse(row.step_results_content).map((step) => step.stepName);
  const rawStepReport = validateStoredStepReport(
    evidence.rawStepReport, requiredSteps, evidence.complete, row.tier, row.report_adapter_id,
  );
  const discovery = validateStoredDiscovery(
    evidence.discovery, rawStepReport, requiredSteps, evidence.complete, row.tier, row.report_adapter_id,
  );
  if (evidence.complete) {
    if (!evidence.executionEnvironment || evidence.executionEnvironment.schemaVersion !== 1 ||
        !evidence.executionEnvironment.ci || !evidence.executionEnvironment.e2e ||
        Object.keys(evidence.executionEnvironment).some((key) =>
          !["schemaVersion", "ci", "e2e", "nodeOptionsConfigured"].includes(key)) ||
        evidence.executionEnvironment.nodeOptionsConfigured !== false) {
      throw new Error("complete evidence is missing a safe checked-run environment identity");
    }
    if (!evidence.streams || typeof evidence.streams !== "object" ||
        Object.keys(evidence.streams).length !== 2 ||
        !["stdout", "stderr"].every((streamName) => {
          const stream = evidence.streams[streamName];
          return stream && typeof stream === "object" &&
            Number.isSafeInteger(stream.bytes) && stream.bytes >= 0 &&
            /^[0-9a-f]{64}$/.test(stream.digest ?? "") &&
            typeof stream.safeText === "string" && Buffer.byteLength(stream.safeText, "utf8") <= 64 * 1024 &&
            typeof stream.truncated === "boolean";
        })) {
      throw new Error("complete evidence is missing bounded per-stream output evidence");
    }
  }
  if (!Array.isArray(evidence.stepResults) || evidence.stepResults.length !== requiredSteps.length) {
    throw new Error("completion evidence must contain one result for every required step");
  }
  const seen = new Set();
  const stepResults = evidence.stepResults.map((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step) ||
      Object.keys(step).some((key) => !["stepName", "rawExitStatus", "reportReference", "reportDigest"].includes(key))) {
      throw new Error("completion step evidence is malformed; caller result labels are not evidence");
    }
    const stepName = requiredText(step.stepName, "evidence stepName");
    if (stepName !== requiredSteps[seen.size] || seen.has(stepName)) {
      throw new Error("completion evidence does not match the exact registered step order");
    }
    seen.add(stepName);
    if (step.rawExitStatus !== null &&
        (!Number.isInteger(step.rawExitStatus) || step.rawExitStatus < 0 || step.rawExitStatus > 255)) {
      throw new Error(`required step '${stepName}' must record an exit code or null`);
    }
    const reportReference = step.reportReference === null
      ? null
      : requiredText(step.reportReference, "evidence reportReference");
    const reportDigest = step.reportDigest === null
      ? null
      : requiredDigest(step.reportDigest, "evidence reportDigest");
    if ((reportReference === null) !== (reportDigest === null)) {
      throw new Error(`required step '${stepName}' has incomplete report reference/digest evidence`);
    }
    const reportStep = rawStepReport?.report?.steps.find((item) => item.name === stepName);
    if (rawStepReport?.report) {
      if ((reportStep?.rawExitStatus ?? null) !== step.rawExitStatus ||
          (reportStep && (reportReference !== rawStepReport.reference ||
            reportDigest !== rawStepReport.digest)) ||
          (!reportStep && (reportReference !== null || reportDigest !== null))) {
        throw new Error(`required step '${stepName}' evidence differs from its raw versioned report`);
      }
    } else if (reportReference !== null || reportDigest !== null) {
      throw new Error(`required step '${stepName}' cites a report that was not retained`);
    }
    if (evidence.complete &&
        ((currentV2 ? step.rawExitStatus === null : step.rawExitStatus !== 0) ||
         reportReference === null ||
         reportReference !== rawStepReport?.reference || reportDigest !== rawStepReport?.digest)) {
      throw new Error(`complete evidence is missing an executed raw result or report for '${stepName}'`);
    }
    return {
      stepName,
      status: step.rawExitStatus === null ? "NOT_STARTED" : step.rawExitStatus === 0 ? "FINISHED" : "FAILED",
      rawExitStatus: step.rawExitStatus,
      rawReportReference: reportReference,
      reportDigest,
    };
  });
  if (seen.size !== requiredSteps.length) throw new Error("completion evidence omits a required step");
  if (evidence.complete && ((!currentV2 && evidence.rawExitStatus !== 0) ||
      evidence.rawExitStatus === null || rawOutputDigest === null)) {
    throw new Error("complete evidence must record a structural raw process result and output evidence");
  }
  if (evidence.complete && (rawStepReport === null || discovery === null ||
      evidence.discovery?.artifactsAvailable !== true)) {
    throw new Error("complete evidence requires retained versioned report and discovery artifacts");
  }
  const reportedDiscovery = rawStepReport?.report?.discovery?.testCases;
  if (evidence.complete && rawStepReport &&
      (reportedDiscovery === undefined ||
       canonicalJson(reportedDiscovery) !== canonicalJson(evidence.discovery.summary))) {
    throw new Error("step report discovery summary differs from retained discovery evidence");
  }
  if (evidence.complete && currentV2 &&
      rawStepReport.report.rawExitStatus !== evidence.rawExitStatus) {
    throw new Error("complete v2 evidence raw process status differs from the bound step report");
  }
  const snapshot = JSON.parse(row.snapshot_content);
  if (evidence.complete && snapshot.integrity !== "verified") {
    throw new Error("complete evidence is blocked because the run snapshot integrity is not verified");
  }
  if (evidence.complete && (!snapshot.writerCoordination || snapshot.writerCoordination.status !== "verified" ||
      !snapshot.writerCoordination.adapterId)) {
    throw new Error("complete evidence is blocked because writer coordination is not verified");
  }
  if (evidence.complete) requiredDigest(snapshot.writerCoordination.evidenceDigest, "writer coordination evidenceDigest");
  return {
    evidence: {
      schemaVersion: evidence.schemaVersion,
      complete: evidence.complete,
      authorizationDigest,
      inputDigest,
      rawExitStatus: evidence.rawExitStatus,
      rawOutputDigest,
      streams: evidence.streams ?? null,
      rawStepReport: evidence.rawStepReport ?? null,
      discovery: evidence.discovery ?? null,
      executionEnvironment: evidence.executionEnvironment ?? null,
      stepResults: stepResults.map((step) => ({
        stepName: step.stepName,
        rawExitStatus: step.rawExitStatus,
        reportReference: step.rawReportReference,
        reportDigest: step.reportDigest,
      })),
    },
    stepResults,
    rawOutputDigest,
  };
}

function deriveTierStatuses(task, registeredTiers) {
  const authorized = task.status === "active" && !task.suspended ? task.authorizedTier : null;
  return Object.fromEntries(registeredTiers.map((tier) => [
    tier,
    authorized === tier ? "ALLOWED" : "NOT ALLOWED",
  ]));
}

function gitOutput(projectRoot, args, { allowMissingRepository = false } = {}) {
  try {
    return execFileSync("git", ["-C", projectRoot, ...args], {
      encoding: null,
      maxBuffer: MAX_TRACKED_PLAN_READ_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const message = Buffer.from(error.stderr ?? "").toString("utf8");
    if (allowMissingRepository && error.status === 128 && /not a git repository/i.test(message)) {
      return null;
    }
    throw new Error(`allocator loss protection could not inspect tracked plan sources: ${message.trim() || error.message}`);
  }
}

function safeTrackedPath(projectRoot, reference) {
  if (typeof reference !== "string" || reference === "" || reference.startsWith("/") ||
      reference.includes("\\") || reference.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("allocator loss protection found an unsafe tracked plan path");
  }
  const absolutePath = resolve(projectRoot, reference);
  const localPath = relative(projectRoot, absolutePath);
  if (localPath === "" || localPath === ".." || localPath.startsWith(`..${sep}`) || resolve(projectRoot, localPath) !== absolutePath) {
    throw new Error("allocator loss protection found a tracked plan path outside the project root");
  }
  return absolutePath;
}

function readBoundedTrackedFile(projectRoot, reference) {
  const absolutePath = safeTrackedPath(projectRoot, reference);
  const components = reference.split("/");
  let current = projectRoot;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]);
    let info;
    try {
      info = lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (info.isSymbolicLink() || (index < components.length - 1 && !info.isDirectory())) {
      throw new Error(`allocator loss protection found an unsafe tracked plan source: ${reference}`);
    }
    if (index === components.length - 1 && !info.isFile()) {
      throw new Error(`allocator loss protection found a non-regular tracked plan source: ${reference}`);
    }
  }

  const initialInfo = lstatSync(absolutePath);
  if (initialInfo.size > MAX_TRACKED_PLAN_BYTES || realpathSync(absolutePath) !== absolutePath) {
    throw new Error(`allocator loss protection found an oversized or unsafe tracked plan source: ${reference}`);
  }
  const descriptor = openSync(absolutePath, "r");
  try {
    const openedInfo = fstatSync(descriptor);
    if (!openedInfo.isFile() || openedInfo.dev !== initialInfo.dev || openedInfo.ino !== initialInfo.ino ||
        openedInfo.size > MAX_TRACKED_PLAN_BYTES) {
      throw new Error(`allocator loss protection found a changed tracked plan source: ${reference}`);
    }
    const buffer = Buffer.alloc(MAX_TRACKED_PLAN_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const finalInfo = fstatSync(descriptor);
    if (total > MAX_TRACKED_PLAN_BYTES || finalInfo.size !== openedInfo.size ||
        finalInfo.dev !== openedInfo.dev || finalInfo.ino !== openedInfo.ino ||
        realpathSync(absolutePath) !== absolutePath) {
      throw new Error(`allocator loss protection found a changed or oversized tracked plan source: ${reference}`);
    }
    return buffer.subarray(0, total);
  } finally {
    closeSync(descriptor);
  }
}

function isTaskPlanProjectionPath(reference) {
  if (reference.includes("/failure-gate-v4/decisions/") || reference.includes("/decisions/")) return false;
  return reference.includes("/failure-gate-v4/task-plans/") ||
    /(?:^|\/)plans\/.+\.json$/.test(reference) ||
    /(?:^|\/)[^/]*TASK-\d{6,}\.json$/.test(reference);
}

function collectTrackedPlanAllocations(projectRoot, projectNamespace) {
  let topLevelBytes;
  try {
    topLevelBytes = gitOutput(projectRoot, ["rev-parse", "--show-toplevel"], { allowMissingRepository: true });
  } catch (error) {
    throw error;
  }
  if (topLevelBytes === null) return [];

  const prefixBytes = gitOutput(projectRoot, ["rev-parse", "--show-prefix"]);
  const prefix = prefixBytes.toString("utf8").replace(/[\r\n]+$/, "");
  const localReference = (repositoryPath) => {
    if (prefix !== "" && !repositoryPath.startsWith(prefix)) return null;
    const reference = prefix === "" ? repositoryPath : repositoryPath.slice(prefix.length);
    if (!reference.endsWith(".json") || reference.startsWith("artifacts/")) return null;
    safeTrackedPath(projectRoot, reference);
    return reference;
  };
  const sourcesByPath = new Map();
  const addSource = (reference, mode, objectId) => {
    const local = localReference(reference);
    if (local === null) return;
    if (!sourcesByPath.has(local)) sourcesByPath.set(local, []);
    if (objectId) sourcesByPath.get(local).push({ mode, objectId });
  };

  const indexBytes = gitOutput(projectRoot, ["ls-files", "--stage", "-z"]);
  for (const record of indexBytes.toString("utf8").split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("allocator loss protection found malformed Git index metadata");
    const [mode, objectId, stage] = record.slice(0, tab).split(" ");
    if (!mode || !objectId || !/^[0-3]$/.test(stage ?? "")) {
      throw new Error("allocator loss protection found malformed Git index metadata");
    }
    addSource(record.slice(tab + 1), mode, objectId);
  }

  let headExists = true;
  try {
    gitOutput(projectRoot, ["rev-parse", "--verify", "HEAD"]);
  } catch (error) {
    if (/needed a single revision|unknown revision|ambiguous argument/i.test(error.message)) {
      headExists = false;
    } else {
      throw error;
    }
  }
  if (headExists) {
    const treeBytes = gitOutput(projectRoot, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]);
    for (const record of treeBytes.toString("utf8").split("\0")) {
      if (record === "") continue;
      const tab = record.indexOf("\t");
      if (tab < 0) throw new Error("allocator loss protection found malformed committed plan metadata");
      const [mode, type, objectId] = record.slice(0, tab).split(" ");
      if (!mode || !type || !objectId) {
        throw new Error("allocator loss protection found malformed committed plan metadata");
      }
      if (type === "blob") addSource(record.slice(tab + 1), mode, objectId);
    }
  }

  if (sourcesByPath.size > MAX_TRACKED_PLAN_FILES) {
    throw new Error("allocator loss protection exceeded the bounded tracked plan file limit");
  }

  let totalReadBytes = 0;
  const allocations = new Map();
  const processProjectionBytes = (reference, bytes) => {
    if (bytes.length > MAX_TRACKED_PLAN_BYTES) {
      throw new Error(`allocator loss protection found an oversized tracked plan source: ${reference}`);
    }
    totalReadBytes += bytes.length;
    if (totalReadBytes > MAX_TRACKED_PLAN_READ_BYTES) {
      throw new Error("allocator loss protection exceeded the bounded tracked plan read limit");
    }
    let projection;
    try {
      projection = JSON.parse(bytes.toString("utf8"));
    } catch {
      if (isTaskPlanProjectionPath(reference)) {
        throw new Error(`allocator loss protection found a malformed tracked task-plan projection: ${reference}`);
      }
      return;
    }
    if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
      if (isTaskPlanProjectionPath(reference)) {
        throw new Error(`allocator loss protection found a malformed tracked task-plan projection: ${reference}`);
      }
      return;
    }
    const decisionShaped = Object.hasOwn(projection, "decision") &&
      (Object.hasOwn(projection, "reviewerId") || Object.hasOwn(projection, "reference"));
    const planShaped = !decisionShaped && Object.hasOwn(projection, "projectNamespace") &&
      Object.hasOwn(projection, "taskId") &&
      (Object.hasOwn(projection, "planVersion") ||
        Object.hasOwn(projection, "title") || Object.hasOwn(projection, "validation"));
    if (!planShaped) {
      if (isTaskPlanProjectionPath(reference)) {
        throw new Error(`allocator loss protection found a malformed tracked task-plan projection: ${reference}`);
      }
      return;
    }
    if (projection.projectNamespace !== projectNamespace) return;
    const taskId = projection.taskId;
    const match = typeof taskId === "string" ? /^TASK-(\d{6,})$/.exec(taskId) : null;
    const sequence = match ? Number(match[1]) : NaN;
    if (!match || !Number.isSafeInteger(sequence) || sequence < 1 ||
        `TASK-${String(sequence).padStart(6, "0")}` !== taskId ||
        !Number.isSafeInteger(projection.planVersion) || projection.planVersion < 1) {
      throw new Error(`allocator loss protection found a malformed conflicting task-plan projection: ${reference}`);
    }
    const planContent = canonicalJson(projection);
    const existing = allocations.get(taskId);
    if (existing && existing.planContent !== planContent) {
      throw new Error(`allocator loss protection found conflicting tracked projections for ${taskId}`);
    }
    allocations.set(taskId, { taskId, sequence, planContent });
  };

  for (const [reference, sources] of sourcesByPath) {
    const seenObjects = new Set();
    for (const source of sources) {
      if (source.mode !== "100644" && source.mode !== "100755") {
        throw new Error(`allocator loss protection found an unsafe tracked plan source: ${reference}`);
      }
      if (!/^[0-9a-f]{40,64}$/.test(source.objectId)) {
        throw new Error("allocator loss protection found malformed Git object metadata");
      }
      if (seenObjects.has(source.objectId)) continue;
      seenObjects.add(source.objectId);
      let bytes;
      try {
        bytes = gitOutput(projectRoot, ["cat-file", "blob", source.objectId]);
      } catch (error) {
        throw new Error(`allocator loss protection could not read tracked plan source ${reference}: ${error.message}`);
      }
      processProjectionBytes(reference, bytes);
    }
    const workingBytes = readBoundedTrackedFile(projectRoot, reference);
    if (workingBytes !== null) processProjectionBytes(reference, workingBytes);
  }
  return [...allocations.values()].sort((left, right) => left.sequence - right.sequence);
}

function assertAllocatorLedgerConsistency(database, projectNamespace, projectionAllocations) {
  const allocator = database.prepare(
    "SELECT next_sequence FROM allocator WHERE singleton = 1",
  ).get();
  if (!allocator || !Number.isSafeInteger(Number(allocator.next_sequence)) ||
      Number(allocator.next_sequence) < 1) {
    throw new Error("allocator loss protection found a missing or malformed allocator high-water mark");
  }
  const nextSequence = Number(allocator.next_sequence);
  const rows = database.prepare(
    "SELECT task_id, sequence, project_namespace, plan_content FROM tasks ORDER BY sequence",
  ).all();
  const byTaskId = new Map();
  let expectedSequence = 1;
  for (const row of rows) {
    const sequence = Number(row.sequence);
    const expectedTaskId = Number.isSafeInteger(sequence) && sequence > 0
      ? `TASK-${String(sequence).padStart(6, "0")}`
      : null;
    if (sequence !== expectedSequence || row.task_id !== expectedTaskId ||
        row.project_namespace !== projectNamespace || typeof row.plan_content !== "string") {
      throw new Error("allocator loss protection found missing, malformed, or conflicting ledger history");
    }
    byTaskId.set(row.task_id, row);
    expectedSequence += 1;
  }
  if (nextSequence !== expectedSequence) {
    throw new Error("allocator loss protection found an allocator high-water mark inconsistent with retained task history");
  }
  for (const allocation of projectionAllocations) {
    const row = byTaskId.get(allocation.taskId);
    if (!row || Number(row.sequence) !== allocation.sequence ||
        row.plan_content !== allocation.planContent) {
      throw new Error(`allocator loss protection found tracked ${allocation.taskId} projection without matching ledger history`);
    }
  }
}

export function defaultDatabasePath({ projectRoot, projectNamespace }) {
  const root = realpathSync(resolve(projectRoot));
  const namespace = requiredText(projectNamespace, "projectNamespace");
  const identity = createHash("sha256").update(`${root}\0${namespace}`).digest("hex");
  return join(homedir(), ".failure-gate-v4", `${identity}.sqlite`);
}

export class FailureGateStore {
  constructor({ projectNamespace, databasePath = null, projectRoot = process.cwd() }) {
    this.projectNamespace = requiredText(projectNamespace, "projectNamespace");
    this.projectRoot = realpathSync(resolve(projectRoot));
    const filePath = resolve(databasePath ?? defaultDatabasePath({
      projectRoot: this.projectRoot,
      projectNamespace,
    }));
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    try { chmodSync(dirname(filePath), 0o700); } catch { /* Existing parent permissions are controlled by its owner. */ }
    this.database = new DatabaseSync(filePath);
    try { chmodSync(filePath, 0o600); } catch { /* SQLite may defer file creation until the first write. */ }
    this.database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    try {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.#inspectAllocatorBeforeInitialization();
        this.#initialize();
        this.#assertAllocatorLedgerConsistency();
        this.database.exec("COMMIT");
      } catch (error) {
        try { this.database.exec("ROLLBACK"); } catch { /* Preserve the initialization failure. */ }
        throw error;
      }
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  #inspectAllocatorBeforeInitialization() {
    const tables = new Set(this.database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all().map((row) => row.name));
    if (tables.size === 0) {
      if (collectTrackedPlanAllocations(this.projectRoot, this.projectNamespace).length > 0) {
        throw new Error("allocator loss protection found tracked task allocations but no retained coordinator ledger");
      }
      this.initializeFreshDatabase = true;
      return;
    }
    if (!tables.has("gate_meta") || !tables.has("allocator") || !tables.has("tasks")) {
      throw new Error("allocator loss protection found an incomplete coordinator ledger; refusing to initialize it");
    }
    const namespace = this.database.prepare(
      "SELECT value FROM gate_meta WHERE key = 'project_namespace'",
    ).get();
    if (namespace && namespace.value !== this.projectNamespace) {
      throw new Error("database project namespace mismatch; refusing to open coordinator state");
    }
    assertAllocatorLedgerConsistency(
      this.database,
      this.projectNamespace,
      collectTrackedPlanAllocations(this.projectRoot, this.projectNamespace),
    );
    this.initializeFreshDatabase = false;
  }

  #assertAllocatorLedgerConsistency() {
    assertAllocatorLedgerConsistency(
      this.database,
      this.projectNamespace,
      collectTrackedPlanAllocations(this.projectRoot, this.projectNamespace),
    );
  }

  #initialize() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS gate_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS allocator (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        next_sequence INTEGER NOT NULL CHECK (next_sequence > 0)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        project_namespace TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'failed', 'cancelled')),
        plan_reference TEXT NOT NULL,
        plan_version INTEGER NOT NULL CHECK (plan_version > 0),
        plan_content TEXT NOT NULL,
        plan_digest TEXT NOT NULL,
        requested_tier TEXT NOT NULL,
        authorized_tier TEXT,
        tier_definition_digest TEXT NOT NULL,
        registered_tiers_content TEXT,
        wrapper_digest TEXT,
        policy_snapshot_digest TEXT,
        parameters_content TEXT NOT NULL,
        parameters_digest TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        authorization_version INTEGER NOT NULL CHECK (authorization_version >= 0),
        suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
        approval_content TEXT,
        approval_digest TEXT,
        approval_source_revision TEXT,
        registry_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT REFERENCES tasks(task_id),
        action TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        details_content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_task_id_idx ON audit(task_id, audit_id);
      CREATE TABLE IF NOT EXISTS planning_baselines (
        task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
        baseline_content TEXT NOT NULL,
        baseline_digest TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS validation_attempts (
        attempt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        purpose TEXT NOT NULL CHECK (purpose = 'required_tier_validation'),
        status TEXT NOT NULL CHECK (status IN ('blocked', 'incomplete', 'finished')),
        lease_acquired INTEGER NOT NULL CHECK (lease_acquired IN (0, 1)),
        blocked_reasons_content TEXT NOT NULL,
        plan_reference TEXT NOT NULL,
        plan_version INTEGER NOT NULL,
        plan_digest TEXT NOT NULL,
        authorization_version INTEGER NOT NULL,
        tier TEXT NOT NULL,
        tier_definition_digest TEXT NOT NULL,
        registry_digest TEXT NOT NULL,
        wrapper_digest TEXT NOT NULL,
        report_adapter_id TEXT,
        snapshot_content TEXT NOT NULL,
        snapshot_digest TEXT NOT NULL,
        environment_content TEXT NOT NULL,
        environment_digest TEXT NOT NULL,
        step_results_content TEXT NOT NULL,
        raw_exit_status INTEGER,
        raw_output_digest TEXT,
        started_at TEXT,
        finished_at TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'released' CHECK (lifecycle_state IN ('running', 'orphaned', 'released')),
        process_identity TEXT,
        heartbeat_at TEXT,
        authorization_digest TEXT,
        input_digest TEXT,
        evidence_content TEXT,
        evidence_digest TEXT,
        child_pid INTEGER,
        child_start_ticks TEXT,
        child_process_group_id INTEGER,
        child_boot_id TEXT,
        release_tombstone_content TEXT
      );
      CREATE INDEX IF NOT EXISTS validation_attempts_task_idx ON validation_attempts(task_id, finished_at);
      CREATE TABLE IF NOT EXISTS classification_records (
        reference TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        attempt_id TEXT,
        purpose TEXT NOT NULL CHECK (purpose IN ('stored_failure_classification', 'owned_repair_assessment')),
        record_content TEXT NOT NULL,
        record_digest TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS classification_records_task_idx
        ON classification_records(task_id, purpose, created_at);
      CREATE INDEX IF NOT EXISTS classification_records_attempt_idx
        ON classification_records(task_id, attempt_id, purpose, created_at);
      CREATE TRIGGER IF NOT EXISTS classification_records_immutable_update
      BEFORE UPDATE ON classification_records
      BEGIN
        SELECT RAISE(ABORT, 'classification records are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS classification_records_immutable_delete
      BEFORE DELETE ON classification_records
      BEGIN
        SELECT RAISE(ABORT, 'classification records are immutable');
      END;
    `);
    if (this.initializeFreshDatabase) {
      this.database.prepare(
        "INSERT INTO allocator(singleton, next_sequence) VALUES (1, 1)",
      ).run();
    }
    const attemptColumns = new Set(this.database.prepare("PRAGMA table_info(validation_attempts)").all().map((column) => column.name));
    const attemptMigrations = [
      ["lifecycle_state", "TEXT NOT NULL DEFAULT 'released'"],
      ["process_identity", "TEXT"],
      ["heartbeat_at", "TEXT"],
      ["authorization_digest", "TEXT"],
      ["input_digest", "TEXT"],
      ["evidence_content", "TEXT"],
      ["evidence_digest", "TEXT"],
      ["child_pid", "INTEGER"],
      ["child_start_ticks", "TEXT"],
      ["child_process_group_id", "INTEGER"],
      ["child_boot_id", "TEXT"],
      ["release_tombstone_content", "TEXT"],
    ];
    for (const [column, definition] of attemptMigrations) {
      if (!attemptColumns.has(column)) {
        this.database.exec(`ALTER TABLE validation_attempts ADD COLUMN ${column} ${definition}`);
      }
    }
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS validation_attempts_one_active_lease_idx
      ON validation_attempts(task_id) WHERE lifecycle_state IN ('running', 'orphaned');
      CREATE TRIGGER IF NOT EXISTS validation_attempt_evidence_immutable
      BEFORE UPDATE OF evidence_content, evidence_digest ON validation_attempts
      WHEN OLD.evidence_content IS NOT NULL AND (
        NEW.evidence_content IS NOT OLD.evidence_content OR
        NEW.evidence_digest IS NOT OLD.evidence_digest
      )
      BEGIN
        SELECT RAISE(ABORT, 'stored run evidence is immutable');
      END;
    `);
    const taskColumns = new Set(this.database.prepare("PRAGMA table_info(tasks)").all().map((column) => column.name));
    if (!taskColumns.has("registered_tiers_content")) {
      this.database.exec("ALTER TABLE tasks ADD COLUMN registered_tiers_content TEXT");
    }
    if (!taskColumns.has("wrapper_digest")) {
      this.database.exec("ALTER TABLE tasks ADD COLUMN wrapper_digest TEXT");
    }
    if (!taskColumns.has("policy_snapshot_digest")) {
      this.database.exec("ALTER TABLE tasks ADD COLUMN policy_snapshot_digest TEXT");
    }
    if (!taskColumns.has("approval_source_kind")) {
      this.database.exec("ALTER TABLE tasks ADD COLUMN approval_source_kind TEXT");
    }
    if (!taskColumns.has("approval_source_digest")) {
      this.database.exec("ALTER TABLE tasks ADD COLUMN approval_source_digest TEXT");
    }
    this.database.exec(`
      UPDATE tasks
      SET approval_source_kind = COALESCE(approval_source_kind, 'git-review'),
          approval_source_digest = COALESCE(approval_source_digest, approval_digest)
      WHERE approval_content IS NOT NULL AND approval_digest IS NOT NULL
    `);
    const existing = this.database.prepare("SELECT value FROM gate_meta WHERE key = 'project_namespace'").get();
    if (existing && existing.value !== this.projectNamespace) {
      throw new Error("database project namespace mismatch; refusing to open coordinator state");
    }
    if (!existing) {
      this.database.prepare("INSERT INTO gate_meta(key, value) VALUES ('project_namespace', ?)").run(this.projectNamespace);
    }
  }

  #transaction(callback, beforeCommit = null) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      if (beforeCommit) beforeCommit();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* Preserve the transaction's original failure. */ }
      throw error;
    }
  }

  #appendAudit(taskId, action, details) {
    this.database.prepare(
      "INSERT INTO audit(task_id, action, occurred_at, details_content) VALUES (?, ?, ?, ?)",
    ).run(taskId, action, new Date().toISOString(), canonicalJson(details));
  }

  reserveTask(input) {
    if (input?.plan?.projectTaskSource) {
      throw new Error("project-task plans must be derived through reserveAcceptedProjectTask");
    }
    return this.#reserveTask(input);
  }

  reserveAcceptedProjectTask(projectTask) {
    const prepared = prepareAcceptedProjectTask(projectTask);
    const installedPolicy = getRegisteredValidationPolicy(this.projectRoot);
    const tierPolicy = installedPolicy.tiers[prepared.tier];
    if (!tierPolicy) {
      throw new Error("accepted project task declares a tier that is not registered by the installed policy");
    }
    return this.#reserveTask({
      plan: prepared.plan,
      planReference: prepared.planReference,
      tier: prepared.tier,
      tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
      parameters: {},
      policyVersion: REPLIT_TASK_POLICY_ID,
    }, {
      taskRef: prepared.snapshot.taskRef,
      title: prepared.snapshot.title,
      descriptionDigest: prepared.descriptionDigest,
      tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
    });
  }

  #reserveTask({
    plan,
    planReference = "coordinator-record",
    tier,
    tierDefinitionDigest,
    parameters = {},
    policyVersion = "4.0",
  }, sourceBinding = null) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new TypeError("plan must be a JSON object");
    const safePlan = JSON.parse(canonicalJson(plan));
    const requestedTier = requiredText(tier, "tier");
    const definitionDigest = requiredText(tierDefinitionDigest, "tierDefinitionDigest");
    const policy = requiredText(policyVersion, "policyVersion");
    const reference = requiredText(planReference, "planReference");
    if (Object.hasOwn(safePlan, "taskId") || Object.hasOwn(safePlan, "planVersion")) {
      throw new TypeError("reserved plans must not provide taskId or planVersion; the coordinator assigns both");
    }
    if (Object.hasOwn(safePlan, "projectNamespace") && safePlan.projectNamespace !== this.projectNamespace) {
      throw new Error("plan project namespace does not match this coordinator");
    }

    return this.#transaction(() => {
      this.#assertAllocatorLedgerConsistency();
      if (sourceBinding) {
        const existingTasks = this.database.prepare(
          "SELECT task_id, plan_content, tier_definition_digest FROM tasks",
        ).all();
        for (const existing of existingTasks) {
          const existingPlan = JSON.parse(existing.plan_content);
          const existingSource = existingPlan.projectTaskSource;
          if (existingSource?.taskRef === sourceBinding.taskRef &&
              existingSource?.title === sourceBinding.title &&
              existingSource?.descriptionDigest === sourceBinding.descriptionDigest &&
              existing.tier_definition_digest === sourceBinding.tierDefinitionDigest) {
            return this.#getTask(existing.task_id);
          }
        }
      }
      const sequence = Number(this.database.prepare(
        "SELECT next_sequence FROM allocator WHERE singleton = 1",
      ).get().next_sequence);
      const taskId = `TASK-${String(sequence).padStart(6, "0")}`;
      const taskPlanReference = sourceBinding
        ? `${reference.slice(0, -".json".length)}-${taskId}.json`
        : reference;
      const canonicalPlan = {
        ...safePlan,
        projectNamespace: this.projectNamespace,
        taskId,
        planVersion: 1,
      };
      const planContent = canonicalJson(canonicalPlan);
      const planDigest = digestJson(canonicalPlan);
      const parametersContent = canonicalJson(parameters);
      const parametersDigest = digestJson(parameters);
      const now = new Date().toISOString();
      this.database.prepare("UPDATE allocator SET next_sequence = ? WHERE singleton = 1").run(sequence + 1);
      this.database.prepare(`
        INSERT INTO tasks (
          task_id, sequence, project_namespace, status, plan_reference, plan_version,
          plan_content, plan_digest, requested_tier, tier_definition_digest,
          parameters_content, parameters_digest, policy_version, authorization_version,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        taskId, sequence, this.projectNamespace, taskPlanReference, planContent, planDigest,
        requestedTier, definitionDigest, parametersContent, parametersDigest, policy, now, now,
      );
      this.#appendAudit(taskId, "reserved", {
        status: "draft",
        planVersion: 1,
        planDigest,
        tier: requestedTier,
        authorizationVersion: 0,
        ...(sourceBinding ? {
          projectTaskRef: sourceBinding.taskRef,
          projectTaskDescriptionDigest: sourceBinding.descriptionDigest,
        } : {}),
      });
      return this.getTask(taskId);
    });
  }

  activateTask(options) {
    return this.#activateTask(options, "git-review");
  }

  activateAcceptedProjectTask(options) {
    return this.#activateTask(options, "replit-project-task");
  }

  #activateTask(options, sourceKind) {
    const forbiddenFields = sourceKind === "git-review"
      ? [
      "rosterPath", "decisionPath", "registeredTiers", "registeredTiersDigest", "registryVersion",
      "registryDigest", "tierDefinitionDigest", "wrapperDigest", "policySnapshotDigest",
      "projectTask",
    ]
      : [
        "revision", "taskAgent", "rosterPath", "decisionPath", "registeredTiers",
        "registeredTiersDigest", "registryVersion", "registryDigest", "tierDefinitionDigest",
        "wrapperDigest", "policySnapshotDigest", "reviewerId", "approvedBy",
      ];
    if (forbiddenFields.some((field) => Object.hasOwn(options ?? {}, field))) {
      throw new Error("activation policy and reviewer sources are derived internally; caller overrides are not permitted");
    }
    const {
      taskId,
      revision,
      taskAgent,
      projectTask,
      expectedAuthorizationVersion = 0,
    } = options ?? {};
    const id = requiredText(taskId, "taskId");
    if (!TASK_ID_PATTERN.test(id)) throw new TypeError("taskId is not a local Failure Gate ID");
    if (!Number.isInteger(expectedAuthorizationVersion) || expectedAuthorizationVersion < 0) {
      throw new TypeError("expectedAuthorizationVersion must be a non-negative integer");
    }
    const initialTask = this.#getTask(id);
    if (!initialTask) throw new Error(`unknown local task '${id}'`);
    if (initialTask.status !== "draft") throw new Error(`task '${id}' is not a draft`);
    if (initialTask.authorizationVersion !== expectedAuthorizationVersion) throw new Error("stale authorization version");

    const initialPolicy = getRegisteredValidationPolicy(this.projectRoot);
    const initialTierPolicy = initialPolicy.tiers[initialTask.requestedTier];
    if (!initialTierPolicy) throw new Error("activation blocked: requested tier is not registered by the installed policy");
    if (initialTask.tierDefinitionDigest !== initialTierPolicy.tierDefinitionDigest) {
      throw new Error("activation blocked: reserved tier-definition digest differs from installed validation policy");
    }

    return this.#transaction(() => {
      const task = this.#getTask(id);
      if (!task) throw new Error(`unknown local task '${id}'`);
      if (task.projectNamespace !== this.projectNamespace) throw new Error("task namespace mismatch");
      if (task.status !== "draft") throw new Error(`task '${id}' is not a draft`);
      if (task.authorizationVersion !== expectedAuthorizationVersion) throw new Error("stale authorization version");
      if (task.planDigest !== initialTask.planDigest ||
          task.tierDefinitionDigest !== initialTask.tierDefinitionDigest ||
          task.requestedTier !== initialTask.requestedTier) {
        throw new Error("task plan or tier authorization changed during activation");
      }
      const transactionPolicy = getRegisteredValidationPolicy(this.projectRoot);
      if (transactionPolicy.snapshotDigest !== initialPolicy.snapshotDigest) {
        throw new Error("activation blocked: installed validation policy changed during activation");
      }
      const tierPolicy = transactionPolicy.tiers[task.requestedTier];
      if (!tierPolicy || tierPolicy.tierDefinitionDigest !== task.tierDefinitionDigest) {
        throw new Error("activation blocked: installed tier definition no longer matches the reserved task");
      }
      let approval = sourceKind === "git-review"
        ? loadPinnedReviewerDecision({
            projectRoot: this.projectRoot,
            revision,
            task,
            taskAgent,
            validationPolicy: transactionPolicy,
          }).approval
        : this.#acceptedProjectTaskApproval(task, projectTask, transactionPolicy);
      if (sourceKind === "replit-project-task") {
        const bootstrap = verifyBootstrapApproval({
          projectRoot: this.projectRoot,
          projectTask,
          projectNamespace: task.projectNamespace,
        });
        approval = { ...approval, bootstrapApproval: bootstrap };
      }
      this.#validateApproval(task, approval, transactionPolicy, sourceKind);

      const newTask = {
        ...task,
        status: "active",
        authorizedTier: task.requestedTier,
        authorizationVersion: task.authorizationVersion + 1,
        suspended: false,
        registeredTiers: transactionPolicy.registeredTiers,
        registryVersion: transactionPolicy.registryDigest,
        wrapperDigest: transactionPolicy.wrapperDigest,
        policySnapshotDigest: transactionPolicy.snapshotDigest,
      };
      const tierStatusSnapshot = deriveTierStatuses(newTask, transactionPolicy.registeredTiers);
      const now = new Date().toISOString();
      const result = this.database.prepare(`
        UPDATE tasks SET status = 'active', authorized_tier = requested_tier,
          authorization_version = ?, approval_content = ?, approval_digest = ?,
          approval_source_revision = ?, approval_source_kind = ?, approval_source_digest = ?,
          registry_version = ?, registered_tiers_content = ?,
          wrapper_digest = ?, policy_snapshot_digest = ?, updated_at = ?
        WHERE task_id = ? AND status = 'draft' AND authorization_version = ?
      `).run(
        newTask.authorizationVersion,
        canonicalJson(approval),
        digestJson(approval),
        approval.sourceRevision ?? null,
        approval.sourceKind,
        approval.sourceDigest,
        transactionPolicy.registryDigest,
        canonicalJson(transactionPolicy.registeredTiers),
        transactionPolicy.wrapperDigest,
        transactionPolicy.snapshotDigest,
        now,
        id,
        expectedAuthorizationVersion,
      );
      if (Number(result.changes) !== 1) throw new Error("activation compare-and-swap failed");
      this.#appendAudit(id, "activated", {
        projectNamespace: task.projectNamespace,
        planVersion: task.planVersion,
        planDigest: task.planDigest,
        tier: task.requestedTier,
        tierDefinitionDigest: task.tierDefinitionDigest,
        parametersDigest: task.parametersDigest,
        policyVersion: task.policyVersion,
        authorizationVersion: newTask.authorizationVersion,
        approvalDigest: digestJson(approval),
        approvalSourceRevision: approval.sourceRevision,
        approvalSourceKind: approval.sourceKind,
        approvalSourceDigest: approval.sourceDigest,
        identityAttestation: approval.identityAttestation === true,
        ...(approval.sourceKind === "replit-project-task" ? {
          projectTaskRef: approval.sourceReference,
          projectTaskState: approval.sourceSnapshot.state,
          projectTaskUpdatedAt: approval.sourceSnapshot.updatedAt,
          bootstrapApprovalReference: approval.bootstrapApproval.reference,
          bootstrapApprovalSourceRevision: approval.bootstrapApproval.revision,
          bootstrapApprovalSourceDigest: approval.bootstrapApproval.sourceDigest,
          bootstrapPolicySnapshotDigest: approval.bootstrapApproval.policySnapshotDigest,
        } : {}),
        registeredTiers: transactionPolicy.registeredTiers,
        registryDigest: transactionPolicy.registryDigest,
        wrapperDigest: transactionPolicy.wrapperDigest,
        policySnapshotDigest: transactionPolicy.snapshotDigest,
        tierStatuses: tierStatusSnapshot,
      });
      return this.#getTask(id);
    }, () => {
      const commitPolicy = getRegisteredValidationPolicy(this.projectRoot);
      if (commitPolicy.snapshotDigest !== initialPolicy.snapshotDigest) {
        throw new Error("activation blocked: installed validation policy changed before commit");
      }
    });
  }

  #acceptedProjectTaskApproval(task, projectTask, policy) {
    if (task.policyVersion !== REPLIT_TASK_POLICY_ID || canonicalJson(task.parameters) !== "{}") {
      throw new Error("activation blocked: accepted project-task policy permits only empty parameters and its fixed policy version");
    }
    const source = verifyAcceptedProjectTaskBinding({
      projectRoot: this.projectRoot,
      task,
      projectTask,
    });
    return {
      taskId: task.taskId,
      projectNamespace: task.projectNamespace,
      planVersion: task.planVersion,
      planDigest: task.planDigest,
      tier: task.requestedTier,
      tierDefinitionDigest: task.tierDefinitionDigest,
      registeredTiers: policy.registeredTiers,
      registeredTiersDigest: digestJson(policy.registeredTiers),
      registryDigest: policy.registryDigest,
      wrapperDigest: policy.wrapperDigest,
      policySnapshotDigest: policy.snapshotDigest,
      parametersDigest: task.parametersDigest,
      policyVersion: task.policyVersion,
      authorizationVersion: task.authorizationVersion + 1,
      decision: "platform_accepted",
      sourceKind: "replit-project-task",
      sourceDigest: source.sourceDigest,
      sourceReference: source.snapshot.taskRef,
      sourceSnapshot: source.snapshot,
      policyId: source.policyId,
      identityAttestation: false,
      sourceRevision: null,
    };
  }

  #validateApproval(task, approval, policy, sourceKind) {
    if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
      throw new Error("activation blocked: a verified review or accepted project-task source is required");
    }
    const expected = {
      taskId: task.taskId,
      projectNamespace: task.projectNamespace,
      planVersion: task.planVersion,
      planDigest: task.planDigest,
      tier: task.requestedTier,
      tierDefinitionDigest: task.tierDefinitionDigest,
      registeredTiers: policy.registeredTiers,
      registeredTiersDigest: digestJson(policy.registeredTiers),
      registryDigest: policy.registryDigest,
      wrapperDigest: policy.wrapperDigest,
      policySnapshotDigest: policy.snapshotDigest,
      parametersDigest: task.parametersDigest,
      policyVersion: task.policyVersion,
      authorizationVersion: task.authorizationVersion + 1,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (Array.isArray(value)
        ? canonicalJson(approval[key]) !== canonicalJson(value)
        : approval[key] !== value) {
        throw new Error(`activation blocked: reviewer decision does not match ${key}`);
      }
    }
    if (sourceKind === "git-review") {
      if (approval.sourceKind !== "git-review" || approval.decision !== "approved") {
        throw new Error("activation blocked: pinned reviewer decision source is malformed");
      }
      if (!["admin", "Dan"].includes(approval.reviewerId)) {
        throw new Error("activation blocked: reviewer must be admin or Dan");
      }
      requiredText(approval.reference, "review decision reference");
      requiredText(approval.sourceRevision, "pinned reviewer source revision");
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(approval.sourceRevision)) {
        throw new Error("activation blocked: reviewer source is not pinned to a full Git commit ID");
      }
      for (const field of ["reviewerRosterDigest", "decisionContentDigest", "sourceDigest"]) {
        if (typeof approval[field] !== "string" || !/^[0-9a-f]{64}$/.test(approval[field])) {
          throw new Error(`activation blocked: verified ${field} is missing`);
        }
      }
      if (approval.sourceDigest !== digestJson({
        sourceRevision: approval.sourceRevision,
        reviewerRosterDigest: approval.reviewerRosterDigest,
        decisionContentDigest: approval.decisionContentDigest,
      })) {
        throw new Error("activation blocked: pinned reviewer source digest is inconsistent");
      }
    } else {
      if (approval.sourceKind !== "replit-project-task" ||
          approval.decision !== "platform_accepted" ||
          approval.policyId !== REPLIT_TASK_POLICY_ID ||
          approval.identityAttestation !== false ||
          approval.sourceRevision !== null ||
          Object.hasOwn(approval, "reviewerId") ||
          Object.hasOwn(approval, "approvedBy")) {
        throw new Error("activation blocked: project-task acceptance must not assert reviewer identity");
      }
      if (task.plan.projectTaskSource?.taskRef !== approval.sourceReference) {
        throw new Error("activation blocked: accepted project-task reference does not match the local plan");
      }
      if (typeof approval.sourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(approval.sourceDigest) ||
          approval.sourceDigest !== digestJson(approval.sourceSnapshot)) {
        throw new Error("activation blocked: accepted project-task snapshot digest is inconsistent");
      }
      const checkedSource = verifyAcceptedProjectTaskBinding({
        projectRoot: this.projectRoot,
        task,
        projectTask: approval.sourceSnapshot,
      });
      if (checkedSource.sourceDigest !== approval.sourceDigest ||
          checkedSource.snapshot.taskRef !== approval.sourceReference ||
          checkedSource.policyId !== approval.policyId ||
          approval.tier !== task.requestedTier) {
        throw new Error("activation blocked: accepted project-task source is not bound to this local task");
      }
      const bootstrap = approval.bootstrapApproval;
      if (!bootstrap || typeof bootstrap !== "object" ||
          Object.keys(bootstrap).some((key) => ![
            "reference", "revision", "sourceDigest", "policySnapshotDigest",
            "taskRef", "approvedAt", "ordinaryActivation",
          ].includes(key)) ||
          bootstrap.reference !== BOOTSTRAP_APPROVAL_REFERENCE ||
          !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(bootstrap.revision ?? "") ||
          !/^[0-9a-f]{64}$/.test(bootstrap.sourceDigest ?? "") ||
          bootstrap.policySnapshotDigest !== policy.snapshotDigest ||
          bootstrap.taskRef !== checkedSource.snapshot.taskRef ||
          bootstrap.ordinaryActivation !== false) {
        throw new Error("activation blocked: separately pinned bootstrap approval is missing or malformed");
      }
    }
  }

  #getTask(taskId) {
    const row = this.database.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
    if (!row) return null;
    const plan = JSON.parse(row.plan_content);
    const parameters = JSON.parse(row.parameters_content);
    if (canonicalJson(plan) !== row.plan_content || digestJson(plan) !== row.plan_digest ||
        plan.taskId !== row.task_id || plan.projectNamespace !== this.projectNamespace ||
        plan.planVersion !== Number(row.plan_version)) {
      throw new Error(`task '${taskId}' has a malformed or stale canonical plan record`);
    }
    if (canonicalJson(parameters) !== row.parameters_content || digestJson(parameters) !== row.parameters_digest) {
      throw new Error(`task '${taskId}' has a malformed or stale permitted-parameters record`);
    }
    if (row.project_namespace !== this.projectNamespace) {
      throw new Error(`task '${taskId}' belongs to a different project namespace`);
    }
    if (row.status === "draft" && (row.authorized_tier !== null || Number(row.authorization_version) !== 0 ||
        row.registered_tiers_content !== null || row.registry_version !== null ||
        row.wrapper_digest !== null || row.policy_snapshot_digest !== null)) {
      throw new Error(`draft task '${taskId}' contains an unauthorized tier assignment`);
    }
    if (row.status === "active" &&
        (row.authorized_tier !== row.requested_tier || Number(row.authorization_version) < 1 ||
         !row.approval_content || !row.approval_digest ||
         !row.approval_source_kind || !row.approval_source_digest ||
         !row.registered_tiers_content || !row.registry_version ||
         !row.wrapper_digest || !row.policy_snapshot_digest)) {
      throw new Error(`active task '${taskId}' has incomplete authorization state`);
    }
    if (TERMINAL_STATUSES.has(row.status) && row.authorized_tier !== null) {
      throw new Error(`terminal task '${taskId}' retains an authorized tier`);
    }
    const approval = row.approval_content ? JSON.parse(row.approval_content) : null;
    if (approval && (canonicalJson(approval) !== row.approval_content ||
        digestJson(approval) !== row.approval_digest)) {
      throw new Error(`task '${taskId}' has a malformed authorization decision record`);
    }
    if (approval) {
      const sourceKind = approval.sourceKind ?? row.approval_source_kind;
      if (sourceKind !== row.approval_source_kind ||
          (approval.sourceDigest !== undefined && approval.sourceDigest !== row.approval_source_digest) ||
          (sourceKind === "git-review" && !row.approval_source_revision) ||
          (sourceKind === "replit-project-task" && row.approval_source_revision !== null)) {
        throw new Error(`task '${taskId}' has inconsistent approval-source provenance`);
      }
      if (sourceKind === "replit-project-task" &&
          (!approval.bootstrapApproval ||
           approval.bootstrapApproval.reference !== BOOTSTRAP_APPROVAL_REFERENCE ||
           approval.bootstrapApproval.policySnapshotDigest !== row.policy_snapshot_digest ||
           !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(approval.bootstrapApproval.revision ?? "") ||
           !/^[0-9a-f]{64}$/.test(approval.bootstrapApproval.sourceDigest ?? ""))) {
        throw new Error(`task '${taskId}' has no valid separate bootstrap-approval provenance`);
      }
    }
    const registeredTiers = row.registered_tiers_content ? JSON.parse(row.registered_tiers_content) : null;
    if (registeredTiers &&
        (canonicalJson(registeredTiers) !== row.registered_tiers_content ||
         !Array.isArray(registeredTiers) ||
         new Set(registeredTiers).size !== registeredTiers.length ||
         approval.registryDigest !== row.registry_version ||
         approval.wrapperDigest !== row.wrapper_digest ||
         approval.policySnapshotDigest !== row.policy_snapshot_digest ||
          approval.tier !== (row.status === "active" ? row.authorized_tier : row.requested_tier) ||
         approval.tierDefinitionDigest !== row.tier_definition_digest ||
         canonicalJson(approval.registeredTiers) !== row.registered_tiers_content ||
         approval.registeredTiersDigest !== digestJson(registeredTiers))) {
      throw new Error(`task '${taskId}' has inconsistent installed validation policy approval state`);
    }
    return {
      taskId: row.task_id,
      projectNamespace: row.project_namespace,
      status: row.status,
      planReference: row.plan_reference,
      planVersion: Number(row.plan_version),
      plan,
      planDigest: row.plan_digest,
      requestedTier: row.requested_tier,
      authorizedTier: row.authorized_tier,
      tierDefinitionDigest: row.tier_definition_digest,
      registeredTiers,
      registryDigest: row.registry_version,
      wrapperDigest: row.wrapper_digest,
      policySnapshotDigest: row.policy_snapshot_digest,
      parameters,
      parametersDigest: row.parameters_digest,
      policyVersion: row.policy_version,
      authorizationVersion: Number(row.authorization_version),
      suspended: Boolean(row.suspended),
      approval,
      approvalDigest: row.approval_digest,
      approvalSourceRevision: row.approval_source_revision,
      approvalSourceKind: row.approval_source_kind,
      approvalSourceDigest: row.approval_source_digest,
      registryVersion: row.registry_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getTask(taskId) {
    const id = requiredText(taskId, "taskId");
    if (!TASK_ID_PATTERN.test(id)) throw new TypeError("taskId is not a local Failure Gate ID");
    return this.#getTask(id);
  }

  tierStatuses(taskId, ...callerSuppliedTiers) {
    if (callerSuppliedTiers.length > 0) {
      throw new Error("tier status registry is derived from the installed validation policy");
    }
    const task = this.getTask(taskId);
    if (!task) throw new Error(`unknown local task '${taskId}'`);
    const policy = getRegisteredValidationPolicy(this.projectRoot);
    if (task.status === "active" &&
        (task.policySnapshotDigest !== policy.snapshotDigest ||
         canonicalJson(task.registeredTiers) !== canonicalJson(policy.registeredTiers) ||
         task.tierDefinitionDigest !== policy.tiers[task.authorizedTier]?.tierDefinitionDigest)) {
      throw new Error("active task authorization differs from the installed validation policy");
    }
    return deriveTierStatuses(task, policy.registeredTiers);
  }

  auditEvents(taskId) {
    const id = requiredText(taskId, "taskId");
    return this.database.prepare(
      "SELECT audit_id AS auditId, task_id AS taskId, action, occurred_at AS occurredAt, details_content AS details FROM audit WHERE task_id = ? ORDER BY audit_id",
    ).all(id).map((event) => ({ ...event, details: JSON.parse(event.details) }));
  }

  recordPlanningBaseline({ taskId, baseline }) {
    const id = requiredText(taskId, "taskId");
    if (!baseline || typeof baseline !== "object" || Array.isArray(baseline) ||
        baseline.purpose !== "baseline_discovery" ||
        baseline.satisfiesRequiredValidation !== false ||
        baseline.taskId !== id ||
        typeof baseline.label !== "string" ||
        typeof baseline.capturedAt !== "string" ||
        Number.isNaN(Date.parse(baseline.capturedAt)) ||
        new Date(baseline.capturedAt).toISOString() !== baseline.capturedAt) {
      throw new Error("planning baseline must be an explicitly planning-only observation for this task");
    }
    const snapshot = baseline.snapshot;
    if (!snapshot?.manifestContent || !snapshot?.environmentContent) {
      throw new TypeError("planning baseline requires a captured manifest and environment");
    }
    const manifest = JSON.parse(snapshot.manifestContent);
    const environment = JSON.parse(snapshot.environmentContent);
    if (canonicalJson(manifest) !== snapshot.manifestContent ||
        digestJson(manifest) !== snapshot.manifestDigest ||
        canonicalJson(environment) !== snapshot.environmentContent ||
        digestJson(environment) !== snapshot.environmentDigest) {
      throw new Error("planning baseline manifest or environment digest is inconsistent");
    }
    const content = canonicalJson(baseline);
    if (Buffer.byteLength(content, "utf8") > 64 * 1024 * 1024) {
      throw new Error("planning baseline exceeds the bounded storage size");
    }
    const digest = digestJson(baseline);
    return this.#transaction(() => {
      const task = this.#getTask(id);
      if (!task) throw new Error(`unknown local task '${id}'`);
      if (task.status !== "draft") {
        throw new Error("planning baseline capture is allowed only while the reserved task is a draft");
      }
      const existing = this.database.prepare(
        "SELECT baseline_content, baseline_digest FROM planning_baselines WHERE task_id = ?",
      ).get(id);
      if (existing) {
        if (existing.baseline_digest !== digest || existing.baseline_content !== content) {
          throw new Error("planning baseline is immutable once recorded");
        }
        return this.getPlanningBaseline(id);
      }
      this.database.prepare(`
        INSERT INTO planning_baselines(task_id, baseline_content, baseline_digest, captured_at)
        VALUES (?, ?, ?, ?)
      `).run(id, content, digest, baseline.capturedAt);
      this.#appendAudit(id, "planning_baseline_captured", {
        purpose: baseline.purpose,
        capturedAt: baseline.capturedAt,
        baselineDigest: digest,
        snapshotDigest: snapshot.manifestDigest,
        environmentDigest: snapshot.environmentDigest,
        snapshotIntegrity: manifest.integrity ?? "unknown",
        satisfiesRequiredValidation: false,
      });
      return this.getPlanningBaseline(id);
    });
  }

  getPlanningBaseline(taskId) {
    const id = requiredText(taskId, "taskId");
    const row = this.database.prepare(
      "SELECT baseline_content, baseline_digest FROM planning_baselines WHERE task_id = ?",
    ).get(id);
    if (!row) return null;
    const baseline = JSON.parse(row.baseline_content);
    if (canonicalJson(baseline) !== row.baseline_content || digestJson(baseline) !== row.baseline_digest) {
      throw new Error(`planning baseline for '${id}' is malformed or has changed`);
    }
    if (baseline.taskId !== id || baseline.satisfiesRequiredValidation !== false ||
        baseline.purpose !== "baseline_discovery") {
      throw new Error(`planning baseline for '${id}' has invalid task or purpose binding`);
    }
    return baseline;
  }

  recordBlockedRunAttempt({
    taskId,
    expectedAuthorizationVersion,
    tier,
    tierDefinitionDigest,
    registryDigest,
    wrapperDigest,
    reportAdapterId = null,
    stepNames,
    snapshot,
    reasons,
  }) {
    const id = requiredText(taskId, "taskId");
    const normalizedReasons = [...new Set((Array.isArray(reasons) ? reasons : [])
      .map((reason) => requiredText(reason, "blocked reason")))].sort();
    if (normalizedReasons.length === 0) throw new TypeError("blocked run attempt requires an explicit reason");
    if (!Array.isArray(stepNames) || stepNames.some((name) => typeof name !== "string" || name.trim() === "")) {
      throw new TypeError("stepNames must contain registered step names");
    }
    if (new Set(stepNames).size !== stepNames.length) {
      throw new TypeError("stepNames must be unique");
    }
    if (!snapshot?.manifestContent || !snapshot?.environmentContent) {
      throw new TypeError("blocked run attempt requires a captured snapshot and environment manifest");
    }
    const manifest = JSON.parse(snapshot.manifestContent);
    const environment = JSON.parse(snapshot.environmentContent);
    if (canonicalJson(manifest) !== snapshot.manifestContent ||
        digestJson(manifest) !== snapshot.manifestDigest ||
        canonicalJson(environment) !== snapshot.environmentContent ||
        digestJson(environment) !== snapshot.environmentDigest) {
      throw new Error("blocked run attempt snapshot or environment digest is inconsistent");
    }
    const runTier = requiredText(tier, "tier");
    const definitionDigest = requiredText(tierDefinitionDigest, "tierDefinitionDigest");
    const registry = requiredText(registryDigest, "registryDigest");
    const wrapper = requiredText(wrapperDigest, "wrapperDigest");

    return this.#transaction(() => {
      const task = this.#getTask(id);
      if (!task) throw new Error(`unknown local task '${id}'`);
      if (task.status !== "active" || task.suspended) {
        throw new Error(`required validation is not authorized for task '${id}'`);
      }
      if (task.authorizationVersion !== expectedAuthorizationVersion) {
        throw new Error("stale authorization version; run attempt rejected");
      }
      if (task.authorizedTier !== runTier || task.tierDefinitionDigest !== definitionDigest) {
        throw new Error("run attempt tier or tier-definition digest differs from task authorization");
      }
      if (task.registryVersion !== registry || task.wrapperDigest !== wrapper) {
        throw new Error("run attempt registry or wrapper digest differs from task authorization");
      }

      const attemptId = randomUUID();
      const finishedAt = new Date().toISOString();
      const stepResults = stepNames.map((stepName) => ({
        stepName,
        status: "NOT_STARTED",
        rawExitStatus: null,
        rawReportReference: null,
      }));
      const row = {
        attemptId,
        taskId: id,
        purpose: "required_tier_validation",
        status: "blocked",
        leaseAcquired: false,
        blockedReasons: normalizedReasons,
        planReference: task.planReference,
        planVersion: task.planVersion,
        planDigest: task.planDigest,
        authorizationVersion: task.authorizationVersion,
        tier: runTier,
        tierDefinitionDigest: definitionDigest,
        registryDigest: registry,
        wrapperDigest: wrapper,
        reportAdapterId,
        snapshot: JSON.parse(snapshot.manifestContent),
        snapshotDigest: snapshot.manifestDigest,
        environment: JSON.parse(snapshot.environmentContent),
        environmentDigest: snapshot.environmentDigest,
        stepResults,
        rawExitStatus: null,
        rawOutputDigest: null,
        startedAt: null,
        finishedAt,
      };
      this.database.prepare(`
        INSERT INTO validation_attempts (
          attempt_id, task_id, purpose, status, lease_acquired, blocked_reasons_content,
          plan_reference, plan_version, plan_digest, authorization_version, tier,
          tier_definition_digest, registry_digest, wrapper_digest, report_adapter_id,
          snapshot_content, snapshot_digest, environment_content, environment_digest,
          step_results_content, raw_exit_status, raw_output_digest, started_at, finished_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
      `).run(
        attemptId,
        id,
        row.purpose,
        row.status,
        canonicalJson(normalizedReasons),
        row.planReference,
        row.planVersion,
        row.planDigest,
        row.authorizationVersion,
        row.tier,
        row.tierDefinitionDigest,
        row.registryDigest,
        row.wrapperDigest,
        row.reportAdapterId,
        snapshot.manifestContent,
        row.snapshotDigest,
        snapshot.environmentContent,
        row.environmentDigest,
        canonicalJson(stepResults),
        finishedAt,
      );
      this.#appendAudit(id, "required_run_blocked", {
        attemptId,
        purpose: row.purpose,
        reasonCodes: normalizedReasons,
        planVersion: row.planVersion,
        planDigest: row.planDigest,
        authorizationVersion: row.authorizationVersion,
        tier: row.tier,
        tierDefinitionDigest: row.tierDefinitionDigest,
        registryDigest: row.registryDigest,
        wrapperDigest: row.wrapperDigest,
        reportAdapterId: row.reportAdapterId,
        snapshotDigest: row.snapshotDigest,
        snapshotIntegrity: row.snapshot.integrity,
        leaseAcquired: false,
        rawExitStatus: null,
      });
      return row;
    });
  }

  beginRunAttempt({
    taskId,
    expectedAuthorizationVersion,
    tier,
    tierDefinitionDigest,
    registryDigest,
    wrapperDigest,
    reportAdapterId = null,
    stepNames,
    snapshot,
    processIdentity,
    authorizationDigest,
    inputDigest,
  }) {
    const id = requiredText(taskId, "taskId");
    if (!Array.isArray(stepNames) || stepNames.length === 0 ||
        stepNames.some((name) => typeof name !== "string" || name.trim() === "")) {
      throw new TypeError("stepNames must contain registered step names");
    }
    if (new Set(stepNames).size !== stepNames.length) throw new TypeError("stepNames must be unique");
    if (!snapshot?.manifestContent || !snapshot?.environmentContent) {
      throw new TypeError("run attempt requires a captured snapshot and environment manifest");
    }
    const manifest = JSON.parse(snapshot.manifestContent);
    const environment = JSON.parse(snapshot.environmentContent);
    if (canonicalJson(manifest) !== snapshot.manifestContent ||
        digestJson(manifest) !== snapshot.manifestDigest ||
        canonicalJson(environment) !== snapshot.environmentContent ||
        digestJson(environment) !== snapshot.environmentDigest) {
      throw new Error("run attempt snapshot or environment digest is inconsistent");
    }
    const runTier = requiredText(tier, "tier");
    const definitionDigest = requiredText(tierDefinitionDigest, "tierDefinitionDigest");
    const registry = requiredText(registryDigest, "registryDigest");
    const wrapper = requiredText(wrapperDigest, "wrapperDigest");
    const identity = requiredText(processIdentity, "processIdentity");
    const authorization = requiredDigest(authorizationDigest, "authorizationDigest");
    const inputs = requiredDigest(inputDigest, "inputDigest");
    if (!Number.isInteger(expectedAuthorizationVersion) || expectedAuthorizationVersion < 1) {
      throw new TypeError("expectedAuthorizationVersion must be a positive integer");
    }

    return this.#transaction(() => {
      const task = this.#getTask(id);
      if (!task) throw new Error(`unknown local task '${id}'`);
      if (task.status !== "active" || task.suspended) {
        throw new Error(`required validation is not authorized for task '${id}'`);
      }
      if (task.authorizationVersion !== expectedAuthorizationVersion) {
        throw new Error("stale authorization version; run attempt rejected");
      }
      if (task.authorizedTier !== runTier || task.tierDefinitionDigest !== definitionDigest) {
        throw new Error("run attempt tier or tier-definition digest differs from task authorization");
      }
      if (task.registryVersion !== registry || task.wrapperDigest !== wrapper) {
        throw new Error("run attempt registry or wrapper digest differs from task authorization");
      }
      const policy = getRegisteredValidationPolicy(this.projectRoot);
      const registeredTier = policy.tiers[task.authorizedTier];
      if (!registeredTier || registeredTier.tierDefinitionDigest !== definitionDigest ||
          registeredTier.registryDigest !== registry || registeredTier.wrapperDigest !== wrapper ||
          registeredTier.reportAdapterId !== reportAdapterId ||
          canonicalJson(registeredTier.selectedStepNames) !== canonicalJson(stepNames)) {
        throw new Error("run attempt obligations or report adapter differ from the installed registered tier");
      }
      const activeRun = this.database.prepare(`
        SELECT attempt_id FROM validation_attempts
        WHERE task_id = ? AND lifecycle_state IN ('running', 'orphaned')
      `).get(id);
      if (activeRun) {
        throw new Error(`task '${id}' already has active or quarantined run '${activeRun.attempt_id}'`);
      }

      const attemptId = randomUUID();
      const startedAt = new Date().toISOString();
      const stepResults = stepNames.map((stepName) => ({
        stepName,
        status: "NOT_STARTED",
        rawExitStatus: null,
        rawReportReference: null,
      }));
      this.database.prepare(`
        INSERT INTO validation_attempts (
          attempt_id, task_id, purpose, status, lease_acquired, blocked_reasons_content,
          plan_reference, plan_version, plan_digest, authorization_version, tier,
          tier_definition_digest, registry_digest, wrapper_digest, report_adapter_id,
          snapshot_content, snapshot_digest, environment_content, environment_digest,
          step_results_content, raw_exit_status, raw_output_digest, started_at, finished_at,
          lifecycle_state, process_identity, heartbeat_at, authorization_digest, input_digest
        ) VALUES (?, ?, 'required_tier_validation', 'incomplete', 1, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'running', ?, ?, ?, ?)
      `).run(
        attemptId, id, task.planReference, task.planVersion, task.planDigest,
        task.authorizationVersion, runTier, definitionDigest, registry, wrapper,
        reportAdapterId, snapshot.manifestContent, snapshot.manifestDigest,
        snapshot.environmentContent, snapshot.environmentDigest, canonicalJson(stepResults),
        startedAt, startedAt, identity, startedAt, authorization, inputs,
      );
      this.#appendAudit(id, "required_run_started", {
        attemptId,
        purpose: "required_tier_validation",
        planVersion: task.planVersion,
        planDigest: task.planDigest,
        authorizationVersion: task.authorizationVersion,
        authorizationDigest: authorization,
        inputDigest: inputs,
        tier: runTier,
        tierDefinitionDigest: definitionDigest,
        registryDigest: registry,
        wrapperDigest: wrapper,
        reportAdapterId,
        snapshotDigest: snapshot.manifestDigest,
        environmentDigest: snapshot.environmentDigest,
        processIdentity: identity,
        startedAt,
        leaseAcquired: true,
      });
      return this.#getValidationAttempt(attemptId);
    });
  }

  recordRunProcessIdentity({ attemptId, identity: suppliedIdentity }) {
    const id = requiredText(attemptId, "attemptId");
    if (!suppliedIdentity || typeof suppliedIdentity !== "object" || Array.isArray(suppliedIdentity)) {
      throw new TypeError("run process identity must come from the checked subprocess launcher");
    }
    const identity = captureRunProcessIdentity(suppliedIdentity.pid);
    const procIdentity = readLinuxProcessIdentity(identity.pid);
    if (procIdentity.pid !== identity.pid ||
        procIdentity.processGroupId !== identity.processGroupId ||
        procIdentity.startTicks !== identity.startTicks ||
        canonicalJson(identity) !== canonicalJson(suppliedIdentity)) {
      throw new Error("checked run process identity differs from the live child process");
    }
    return this.#transaction(() => {
      const row = this.database.prepare("SELECT * FROM validation_attempts WHERE attempt_id = ?").get(id);
      if (!row) throw new Error(`unknown run attempt '${id}'`);
      if (row.lifecycle_state !== "running" || row.status !== "incomplete") {
        throw new Error("child process identity requires a live running attempt");
      }
      if (row.child_pid !== null || row.child_start_ticks !== null ||
          row.child_process_group_id !== null || row.child_boot_id !== null) {
        throw new Error("child process identity is immutable once captured");
      }
      const result = this.database.prepare(`
        UPDATE validation_attempts
        SET child_pid = ?, child_start_ticks = ?, child_process_group_id = ?, child_boot_id = ?
        WHERE attempt_id = ? AND lifecycle_state = 'running'
          AND child_pid IS NULL AND child_start_ticks IS NULL
          AND child_process_group_id IS NULL AND child_boot_id IS NULL
      `).run(identity.pid, identity.startTicks, identity.processGroupId, identity.bootId, id);
      if (Number(result.changes) !== 1) throw new Error("child process identity compare-and-swap failed");
      this.#appendAudit(row.task_id, "required_run_process_registered", {
        attemptId: id,
        pid: identity.pid,
        startTicks: identity.startTicks,
        processGroupId: identity.processGroupId,
        bootId: identity.bootId,
        identitySource: "verified-local-procfs",
      });
      return Object.freeze(identity);
    });
  }

  getRunProcessIdentity(attemptId) {
    const id = requiredText(attemptId, "attemptId");
    const row = this.database.prepare(`
      SELECT child_pid, child_start_ticks, child_process_group_id, child_boot_id
      FROM validation_attempts WHERE attempt_id = ?
    `).get(id);
    if (!row) return null;
    const empty = row.child_pid === null && row.child_start_ticks === null &&
      row.child_process_group_id === null && row.child_boot_id === null;
    if (empty) return null;
    if (!Number.isSafeInteger(Number(row.child_pid)) || Number(row.child_pid) < 2 ||
        !/^\d+$/.test(row.child_start_ticks ?? "") ||
        !Number.isSafeInteger(Number(row.child_process_group_id)) ||
        Number(row.child_process_group_id) !== Number(row.child_pid) ||
        !/^[a-f0-9-]{36}$/.test(row.child_boot_id ?? "")) {
      throw new Error(`run attempt '${id}' has malformed child process identity`);
    }
    return Object.freeze({
      pid: Number(row.child_pid),
      startTicks: row.child_start_ticks,
      processGroupId: Number(row.child_process_group_id),
      bootId: row.child_boot_id,
    });
  }

  heartbeatRunAttempt({ attemptId, processIdentity }) {
    const id = requiredText(attemptId, "attemptId");
    const identity = requiredText(processIdentity, "processIdentity");
    return this.#transaction(() => {
      const row = this.database.prepare("SELECT * FROM validation_attempts WHERE attempt_id = ?").get(id);
      if (!row) throw new Error(`unknown run attempt '${id}'`);
      if (row.lifecycle_state !== "running" || row.process_identity !== identity) {
        throw new Error("run lease heartbeat rejected: lease is not running under this process identity");
      }
      const now = new Date().toISOString();
      this.database.prepare("UPDATE validation_attempts SET heartbeat_at = ? WHERE attempt_id = ?").run(now, id);
      this.#appendAudit(row.task_id, "required_run_heartbeat", { attemptId: id, processIdentity: identity, heartbeatAt: now });
      return this.#getValidationAttempt(id);
    });
  }

  quarantineOrphanedRunAttempt({ attemptId, reason }) {
    const id = requiredText(attemptId, "attemptId");
    const why = requiredText(reason, "reason");
    return this.#transaction(() => {
      const row = this.database.prepare("SELECT * FROM validation_attempts WHERE attempt_id = ?").get(id);
      if (!row) throw new Error(`unknown run attempt '${id}'`);
      if (row.lifecycle_state !== "running") {
        throw new Error("only a running lease can be explicitly quarantined");
      }
      const now = new Date().toISOString();
      this.database.prepare(`
        UPDATE validation_attempts SET lifecycle_state = 'orphaned', heartbeat_at = ? WHERE attempt_id = ?
      `).run(now, id);
      this.#appendAudit(row.task_id, "required_run_quarantined", {
        attemptId: id,
        reason: why,
        processIdentity: row.process_identity,
        startedAt: row.started_at,
        quarantinedAt: now,
        leaseRemainsHeld: true,
      });
      return this.#getValidationAttempt(id);
    });
  }

  reconcileOrphanedRunAttempt({ attemptId, confirmedStopped, resolution, reason }) {
    if (confirmedStopped !== true) throw new Error("orphan reconciliation requires explicit confirmation that the process stopped");
    if (!["failed", "cancelled"].includes(resolution)) {
      throw new Error("orphan reconciliation may only release as failed or cancelled; it cannot complete a run");
    }
    const why = requiredText(reason, "reason");
    const attempt = this.#getValidationAttempt(requiredText(attemptId, "attemptId"));
    if (!attempt) throw new Error(`unknown run attempt '${attemptId}'`);
    if (attempt.lifecycleState !== "orphaned") throw new Error("only a quarantined orphan can be reconciled");
    if (!attempt.childProcessIdentity) {
      throw new Error("orphan reconciliation is blocked because the checked child process identity is unknown");
    }
    return this.finishRunAttempt({
      attemptId: attempt.attemptId,
      outcome: resolution,
      reason: why,
      confirmedStopped: true,
      evidence: {
        schemaVersion: isV2ReportAdapter(attempt.reportAdapterId) ? 2 : 1,
        complete: false,
        authorizationDigest: attempt.authorizationDigest,
        inputDigest: attempt.inputDigest,
        rawExitStatus: null,
        rawOutputDigest: null,
        streams: null,
        rawStepReport: null,
        discovery: null,
        executionEnvironment: null,
        stepResults: attempt.stepResults.map(({ stepName }) => ({
          stepName,
          rawExitStatus: null,
          reportReference: null,
          reportDigest: null,
        })),
      },
    });
  }

  finishRunAttempt({ attemptId, outcome, evidence, reason = null, confirmedStopped = false }) {
    const id = requiredText(attemptId, "attemptId");
    if (!["completed", "failed", "cancelled"].includes(outcome)) {
      throw new TypeError("outcome must be completed, failed, or cancelled");
    }
    if (outcome !== "completed") requiredText(reason, "reason");
    let completionPolicyDigest = null;
    return this.#transaction(() => {
      const row = this.database.prepare("SELECT * FROM validation_attempts WHERE attempt_id = ?").get(id);
      if (!row) throw new Error(`unknown run attempt '${id}'`);
      if (!["running", "orphaned"].includes(row.lifecycle_state)) {
        throw new Error("run attempt has no releasable active lease");
      }
      if (row.lifecycle_state === "orphaned" && confirmedStopped !== true) {
        throw new Error("orphaned run lease requires explicit stopped-process reconciliation");
      }
      const childProcessIdentity = this.getRunProcessIdentity(id);
      if (!childProcessIdentity) {
        throw new Error("run finalization is blocked because the checked child process identity is unknown");
      }
      assertRecordedRunStopped(childProcessIdentity);
      const task = this.#getTask(row.task_id);
      if (!evidence) throw new Error("run finalization requires explicit structured raw evidence");
      const validated = parseAttemptEvidence(evidence, row);
      if (outcome === "completed" && !validated.evidence.complete) {
        throw new Error("a successful run outcome requires complete raw evidence");
      }
      if (outcome !== "completed" && validated.evidence.complete &&
          validated.evidence.schemaVersion !== 2) {
        throw new Error("legacy failed or cancelled outcomes cannot be recorded with complete-success evidence");
      }
      if (outcome === "completed") {
        if (!this.getRunProcessIdentity(id)) {
          throw new Error("successful run finalization requires a stored live-child process identity");
        }
        if (task.status !== "active" || task.suspended ||
            task.authorizationVersion !== Number(row.authorization_version)) {
          throw new Error("successful run finalization is blocked because task authorization changed during the run");
        }
        if (row.lifecycle_state !== "running") throw new Error("quarantined run evidence cannot complete a task");
        const policy = getRegisteredValidationPolicy(this.projectRoot);
        const tierPolicy = policy.tiers[task.authorizedTier];
        if (!tierPolicy || policy.snapshotDigest !== task.policySnapshotDigest ||
            tierPolicy.tierDefinitionDigest !== row.tier_definition_digest ||
            tierPolicy.registryDigest !== row.registry_digest ||
            tierPolicy.wrapperDigest !== row.wrapper_digest ||
            canonicalJson(tierPolicy.selectedStepNames) !== canonicalJson(
              JSON.parse(row.step_results_content).map((step) => step.stepName),
            )) {
          throw new Error("completion is blocked because the registered validation policy changed during the run");
        }
        completionPolicyDigest = policy.snapshotDigest;
      }

      const now = new Date().toISOString();
      const tombstone = {
        attemptId: id,
        outcome,
        reason: outcome === "completed" ? "run_evidence_recorded" : requiredText(reason, "reason"),
        releasedAt: now,
        authorizationVersion: Number(row.authorization_version),
        authorizationDigest: row.authorization_digest,
        inputDigest: row.input_digest,
      };
      const serializedEvidence = canonicalJson(validated.evidence);
      if (Buffer.byteLength(serializedEvidence, "utf8") > MAX_STORED_RUN_EVIDENCE_BYTES) {
        throw new Error("run evidence exceeds the bounded immutable storage size");
      }
      const evidenceDigest = digestJson(validated.evidence);
      this.database.prepare(`
        UPDATE validation_attempts SET status = 'finished', lifecycle_state = 'released',
          step_results_content = ?, raw_exit_status = ?, raw_output_digest = ?,
          evidence_content = ?, evidence_digest = ?, heartbeat_at = ?, finished_at = ?,
          release_tombstone_content = ?
        WHERE attempt_id = ? AND lifecycle_state IN ('running', 'orphaned')
      `).run(
        canonicalJson(validated.stepResults), validated.evidence.rawExitStatus, validated.rawOutputDigest,
        serializedEvidence, evidenceDigest, now, now, canonicalJson(tombstone), id,
      );
      this.#appendAudit(row.task_id, "required_run_finished", {
        ...tombstone,
        evidenceDigest,
        leaseAcquired: true,
        taskStatus: task.status,
        rawExitStatus: validated.evidence.rawExitStatus,
        childProcessIdentity: this.getRunProcessIdentity(id),
      });
      return this.#getValidationAttempt(id);
    }, () => {
      if (completionPolicyDigest) {
        const current = getRegisteredValidationPolicy(this.projectRoot);
        if (current.snapshotDigest !== completionPolicyDigest) {
          throw new Error("completion is blocked because the installed validation policy changed before commit");
        }
      }
    });
  }

  terminateTask({ taskId, status, expectedAuthorizationVersion, reason }) {
    const id = requiredText(taskId, "taskId");
    if (!["failed", "cancelled"].includes(status)) {
      throw new TypeError("terminal status must be failed or cancelled; completion requires accepted run evidence");
    }
    const why = requiredText(reason, "reason");
    return this.#transaction(() => {
      const task = this.#getTask(id);
      if (!task) throw new Error(`unknown local task '${id}'`);
      if (task.status !== "active") throw new Error(`task '${id}' is not active`);
      if (task.authorizationVersion !== expectedAuthorizationVersion) throw new Error("stale authorization version");
      const activeRun = this.database.prepare(`
        SELECT attempt_id FROM validation_attempts
        WHERE task_id = ? AND lifecycle_state IN ('running', 'orphaned')
      `).get(id);
      if (activeRun) throw new Error(`task '${id}' still has active run lease '${activeRun.attempt_id}'`);
      const now = new Date().toISOString();
      const tombstone = {
        taskId: id,
        status,
        reason: why,
        authorizationVersion: task.authorizationVersion,
        releasedAt: now,
      };
      const result = this.database.prepare(`
        UPDATE tasks SET status = ?, authorized_tier = NULL, updated_at = ?
        WHERE task_id = ? AND status = 'active' AND authorization_version = ?
      `).run(status, now, id, expectedAuthorizationVersion);
      if (Number(result.changes) !== 1) throw new Error("terminal transition compare-and-swap failed");
      this.#appendAudit(id, `${status}_terminal_release`, tombstone);
      return this.#getTask(id);
    });
  }

  completeTask({
    taskId,
    attemptId,
    expectedAuthorizationVersion,
    authorizationDigest,
    inputDigest,
    finalSnapshotDigest,
    writerProof,
    projectTask,
  }) {
    const id = requiredText(taskId, "taskId");
    const attempt = requiredText(attemptId, "attemptId");
    const authorization = requiredDigest(authorizationDigest, "authorizationDigest");
    const inputs = requiredDigest(inputDigest, "inputDigest");
    const finalSnapshot = requiredDigest(finalSnapshotDigest, "finalSnapshotDigest");
    if (!Number.isInteger(expectedAuthorizationVersion) || expectedAuthorizationVersion < 1) {
      throw new TypeError("expectedAuthorizationVersion must be a positive integer");
    }
    const expectedLockPath = join(realpathSync(homedir()), ".failure-gate-v4", "writer.lock");
    const proof = assertActiveWriterProof(writerProof, {
      lockPath: expectedLockPath,
      snapshotDigest: finalSnapshot,
    });
    const blocked = this.#transaction(() => {
      const task = this.#getTask(id);
      if (!task) throw new Error(`unknown local task '${id}'`);
      if (task.status !== "active" || task.suspended) {
        throw new Error(`task '${id}' is not eligible for completion`);
      }
      let projectTaskEvidence = null;
      if (task.approvalSourceKind === "replit-project-task") {
        if (!projectTask) {
          throw new Error("local completion for a Replit task requires a fresh Agent-side project-task snapshot");
        }
        projectTaskEvidence = verifyAcceptedProjectTaskBinding({
          projectRoot: this.projectRoot,
          task,
          projectTask,
        });
        const bootstrap = verifyBootstrapApproval({
          projectRoot: this.projectRoot,
          projectTask,
          projectNamespace: task.projectNamespace,
        });
        const approvedBootstrap = task.approval?.bootstrapApproval;
        if (!approvedBootstrap ||
            bootstrap.reference !== approvedBootstrap.reference ||
            bootstrap.sourceDigest !== approvedBootstrap.sourceDigest ||
            bootstrap.policySnapshotDigest !== approvedBootstrap.policySnapshotDigest) {
          throw new Error("completion requires the exact separate bootstrap approval recorded at activation");
        }
      } else if (projectTask !== undefined) {
        throw new Error("a project-task snapshot cannot replace the task's approved source");
      }
      if (task.authorizationVersion !== expectedAuthorizationVersion) {
        throw new Error("stale authorization version; completion rejected");
      }
      const row = this.database.prepare(`
        SELECT * FROM validation_attempts WHERE attempt_id = ? AND task_id = ?
      `).get(attempt, id);
      if (!row || row.lifecycle_state !== "released" || row.status !== "finished") {
        throw new Error("completion requires a finalized run attempt for this task");
      }
      const evidence = row.evidence_content ? JSON.parse(row.evidence_content) : null;
      if (!evidence || canonicalJson(evidence) !== row.evidence_content ||
          digestJson(evidence) !== row.evidence_digest || evidence.complete !== true) {
        throw new Error("completion requires explicitly stored complete run evidence");
      }
      parseAttemptEvidence(evidence, row);
      const assessment = this.#assessRunAttempt(task, row);
      this.#appendAudit(id, "completion_obligations_assessed", {
        attemptId: attempt,
        assessmentDigest: digestJson(assessment),
        assessment,
      });
      if (!assessment.eligible) {
        return { reason: assessment.reasons.join("; "), kind: "unresolved-obligations" };
      }
      const childProcessIdentity = this.getRunProcessIdentity(attempt);
      if (!childProcessIdentity) {
        throw new Error("completion requires the checked subprocess identity recorded by the launcher");
      }
      assertRecordedRunStopped(childProcessIdentity);
      if (Number(row.authorization_version) !== expectedAuthorizationVersion ||
          row.authorization_digest !== authorization || row.input_digest !== inputs ||
          evidence.authorizationDigest !== authorization || evidence.inputDigest !== inputs) {
        throw new Error("stored run evidence does not match completion authorization and input digests");
      }
      const snapshot = JSON.parse(row.snapshot_content);
      if (proof.snapshotIntegrity !== "verified" ||
          snapshot.integrity !== "verified" ||
          snapshot.writerCoordination?.status !== "verified" ||
          !snapshot.writerCoordination?.adapterId) {
        this.#appendAudit(id, "completion_blocked", {
          attemptId: attempt,
          authorizationVersion: expectedAuthorizationVersion,
          authorizationDigest: authorization,
          inputDigest: inputs,
          writerLockPath: proof.lockPath,
          writerAdapterId: proof.adapterId,
          snapshotIntegrity: proof.snapshotIntegrity,
          runSnapshotDigest: row.snapshot_digest,
          finalSnapshotDigest: finalSnapshot,
          ...(projectTaskEvidence ? {
            projectTaskSourceDigest: projectTaskEvidence.sourceDigest,
            projectTaskRef: projectTaskEvidence.snapshot.taskRef,
            projectTaskState: projectTaskEvidence.snapshot.state,
          } : {}),
          reason: "final_snapshot_or_all-writer_coordination_is_unverified",
        });
        return true;
      }
      if (row.snapshot_digest !== finalSnapshot) {
        throw new Error("final snapshot digest differs from the successful run snapshot");
      }
      const currentV2Evidence = isV2ReportAdapter(row.report_adapter_id);
      if (task.authorizedTier !== row.tier ||
          (!currentV2Evidence && evidence.rawExitStatus !== 0) ||
          JSON.parse(row.step_results_content).some((step) =>
            (currentV2Evidence
              ? step.status === "NOT_STARTED" || step.rawExitStatus === null
              : step.status !== "FINISHED" || step.rawExitStatus !== 0) ||
            !step.rawReportReference || !step.reportDigest)) {
        throw new Error("completion requires applicable complete evidence for every authorized step");
      }
      const policy = getRegisteredValidationPolicy(this.projectRoot);
      const tierPolicy = policy.tiers[task.authorizedTier];
      if (!tierPolicy || policy.snapshotDigest !== task.policySnapshotDigest ||
          tierPolicy.tierDefinitionDigest !== row.tier_definition_digest ||
          tierPolicy.registryDigest !== row.registry_digest ||
          tierPolicy.wrapperDigest !== row.wrapper_digest ||
          canonicalJson(tierPolicy.selectedStepNames) !== canonicalJson(
            JSON.parse(row.step_results_content).map((step) => step.stepName),
          )) {
        throw new Error("completion is blocked because the registered validation policy changed");
      }
      const now = new Date().toISOString();
      const update = this.database.prepare(`
        UPDATE tasks SET status = 'completed', authorized_tier = NULL, updated_at = ?
        WHERE task_id = ? AND status = 'active' AND authorization_version = ?
      `).run(now, id, expectedAuthorizationVersion);
      if (Number(update.changes) !== 1) throw new Error("terminal completion compare-and-swap failed");
      this.#appendAudit(id, "completed_terminal", {
        attemptId: attempt,
        authorizationVersion: expectedAuthorizationVersion,
        authorizationDigest: authorization,
        inputDigest: inputs,
        finalSnapshotDigest: finalSnapshot,
        evidenceDigest: row.evidence_digest,
        ...(projectTaskEvidence ? {
          projectTaskSourceDigest: projectTaskEvidence.sourceDigest,
          projectTaskRef: projectTaskEvidence.snapshot.taskRef,
          projectTaskState: projectTaskEvidence.snapshot.state,
        } : {}),
        writerLockPath: proof.lockPath,
        writerAdapterId: proof.adapterId,
        releasedAt: now,
      });
      return false;
    });
    if (blocked) {
      if (blocked.kind === "unresolved-obligations") {
        throw new Error(`completion obligations remain unresolved: ${blocked.reason}`);
      }
      throw new Error("completion is blocked: final snapshot integrity or effective writer coordination is unverified");
    }
    return this.#getTask(id);
  }

  #getValidationAttempt(attemptId) {
    const row = this.database.prepare("SELECT * FROM validation_attempts WHERE attempt_id = ?").get(attemptId);
    if (!row) return null;
    const evidence = row.evidence_content ? JSON.parse(row.evidence_content) : null;
    if (evidence && (canonicalJson(evidence) !== row.evidence_content || digestJson(evidence) !== row.evidence_digest)) {
      throw new Error(`run attempt '${attemptId}' has malformed stored completion evidence`);
    }
    return {
      attemptId: row.attempt_id,
      taskId: row.task_id,
      purpose: row.purpose,
      status: row.status,
      lifecycleState: row.lifecycle_state,
      leaseAcquired: Boolean(row.lease_acquired),
      blockedReasons: JSON.parse(row.blocked_reasons_content),
      planReference: row.plan_reference,
      planVersion: Number(row.plan_version),
      planDigest: row.plan_digest,
      authorizationVersion: Number(row.authorization_version),
      authorizationDigest: row.authorization_digest,
      inputDigest: row.input_digest,
      tier: row.tier,
      tierDefinitionDigest: row.tier_definition_digest,
      registryDigest: row.registry_digest,
      wrapperDigest: row.wrapper_digest,
      reportAdapterId: row.report_adapter_id,
      snapshot: JSON.parse(row.snapshot_content),
      snapshotDigest: row.snapshot_digest,
      environment: JSON.parse(row.environment_content),
      environmentDigest: row.environment_digest,
      stepResults: JSON.parse(row.step_results_content),
      rawExitStatus: row.raw_exit_status,
      rawOutputDigest: row.raw_output_digest,
      startedAt: row.started_at,
      heartbeatAt: row.heartbeat_at,
      finishedAt: row.lifecycle_state === "released" ? row.finished_at : null,
      processIdentity: row.process_identity,
      childProcessIdentity: this.getRunProcessIdentity(attemptId),
      evidence,
      evidenceDigest: row.evidence_digest,
      releaseTombstone: row.release_tombstone_content ? JSON.parse(row.release_tombstone_content) : null,
    };
  }

  getStoredRunRecord(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => !["taskId", "attemptId"].includes(key))) {
      throw new TypeError("stored run resolution accepts only taskId and attemptId");
    }
    const { taskId, attemptId } = input;
    const id = requiredText(taskId, "taskId");
    const runId = requiredText(attemptId, "attemptId");
    const task = this.#getTask(id);
    if (!task) return null;
    const row = this.database.prepare(`
      SELECT * FROM validation_attempts WHERE attempt_id = ? AND task_id = ?
    `).get(runId, id);
    if (!row) {
      return resolveStoredDiagnosticRunRecord({
        store: this,
        taskId: id,
        attemptId: runId,
      });
    }
    if (row.lifecycle_state !== "released" || row.status !== "finished") return null;
    const attempt = this.#getValidationAttempt(runId);
    if (!attempt || attempt.taskId !== task.taskId ||
        !Number.isFinite(Date.parse(attempt.finishedAt)) ||
        attempt.planReference !== task.planReference ||
        attempt.planVersion !== task.planVersion ||
        attempt.planDigest !== task.planDigest ||
        attempt.tier !== task.requestedTier ||
        attempt.tierDefinitionDigest !== task.tierDefinitionDigest ||
        attempt.registryDigest !== task.registryDigest ||
        attempt.wrapperDigest !== task.wrapperDigest ||
        attempt.reportAdapterId !== getRegisteredValidationPolicy(this.projectRoot)
          .tiers[task.requestedTier]?.reportAdapterId) {
      throw new Error("stored run record is not bound to the canonical task plan and installed report adapter");
    }
    if (!attempt.evidence ||
        attempt.evidenceDigest !== digestJson(attempt.evidence) ||
        row.evidence_digest !== attempt.evidenceDigest ||
        row.evidence_content !== canonicalJson(attempt.evidence) ||
        row.raw_exit_status !== attempt.evidence.rawExitStatus ||
        row.raw_output_digest !== attempt.evidence.rawOutputDigest ||
        attempt.snapshotDigest !== row.snapshot_digest) {
      throw new Error("stored run evidence is not canonically bound to its retained attempt");
    }
    for (const [content, digest, label] of [
      [row.snapshot_content, row.snapshot_digest, "snapshot"],
      [row.environment_content, row.environment_digest, "environment"],
      [row.step_results_content, digestJson(JSON.parse(row.step_results_content)), "step results"],
    ]) {
      const value = JSON.parse(content);
      if (canonicalJson(value) !== content ||
          (label !== "step results" && digestJson(value) !== digest)) {
        throw new Error(`stored ${label} record is not canonical or digest-bound`);
      }
    }
    const validated = parseAttemptEvidence(attempt.evidence, row);
    if (canonicalJson(validated.stepResults) !== canonicalJson(attempt.stepResults)) {
      throw new Error("stored step results differ from their retained raw report");
    }
    if (!attempt.childProcessIdentity) {
      throw new Error("stored run record has no checked child-process identity");
    }
    assertRecordedRunStopped(attempt.childProcessIdentity);

    let resolvedTask = task;
    if (task.approvalSourceKind === "replit-project-task") {
      const approvalContent = row.approval_content;
      const approval = JSON.parse(approvalContent);
      if (canonicalJson(approval) !== approvalContent ||
          digestJson(approval) !== row.approval_digest ||
          approval.sourceDigest !== row.approval_source_digest ||
          !approval.sourceSnapshot) {
        throw new Error("accepted project-task source is not canonically bound to its task approval");
      }
      const source = verifyAcceptedProjectTaskBinding({
        projectRoot: this.projectRoot,
        task,
        projectTask: approval.sourceSnapshot,
      });
      if (source.sourceDigest !== row.approval_source_digest) {
        throw new Error("accepted project-task source digest differs from its canonical approval row");
      }
      resolvedTask = {
        ...task,
        verifiedSourceCreatedAt: source.snapshot.createdAt,
      };
    }
    return { task: resolvedTask, attempt, evidence: attempt.evidence };
  }

  #readClassificationRecord(row) {
    let record;
    try {
      record = JSON.parse(row.record_content);
    } catch {
      throw new Error("stored classification record is malformed JSON");
    }
    if (canonicalJson(record) !== row.record_content ||
        digestJson(record) !== row.record_digest ||
        record.reference !== row.reference ||
        record.taskId !== row.task_id ||
        record.attemptId !== row.attempt_id ||
        record.purpose !== row.purpose ||
        record.createdAt !== row.created_at) {
      throw new Error("stored classification record is not canonical or digest-bound");
    }
    return record;
  }

  #persistClassificationRecord({ taskId, attemptId = null, purpose, request, selector = null, result }) {
    const reference = `failure-gate-v4-classification:${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const record = {
      schemaVersion: 1,
      purpose,
      reference,
      taskId,
      attemptId,
      selector,
      request: JSON.parse(canonicalJson(request)),
      result: JSON.parse(canonicalJson(result)),
      resultDigest: digestJson(result),
      createdAt,
    };
    const content = canonicalJson(record);
    if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) {
      throw new Error("stored classification record exceeds its bounded canonical size");
    }
    const recordDigest = digestJson(record);
    this.database.prepare(`
      INSERT INTO classification_records(
        reference, task_id, attempt_id, purpose, record_content, record_digest, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(reference, taskId, attemptId, purpose, content, recordDigest, createdAt);
    this.#appendAudit(taskId, `${purpose}_recorded`, {
      reference,
      attemptId,
      recordDigest,
      resultDigest: record.resultDigest,
      accepted: result.accepted === true,
    });
    return { reference, digest: recordDigest, result };
  }

  classifyStoredFailure(input = {}) {
    const service = new FailureGateStoredClassification({
      store: this,
      projectRoot: this.projectRoot,
    });
    const result = service.classifyStoredFailure(input);
    if (result.purpose !== "stored_failure_classification" ||
        typeof result.taskId !== "string" || typeof result.attemptId !== "string") {
      return { reference: null, digest: null, result };
    }
    const request = JSON.parse(canonicalJson(input));
    const selector = {
      taskId: request.taskId,
      attemptId: request.attemptId,
      reportReference: request.reportReference,
      reportDigest: request.reportDigest,
      caseId: request.caseId,
    };
    if (result.taskId !== selector.taskId || result.attemptId !== selector.attemptId) {
      throw new Error("stored classifier result does not bind the submitted reference-only selector");
    }
    return this.#transaction(() => {
      const canonical = this.getStoredRunRecord({
        taskId: selector.taskId,
        attemptId: selector.attemptId,
      });
      if (!canonical) throw new Error("classification primary selector did not resolve to a released canonical run");
      return this.#persistClassificationRecord({
        taskId: selector.taskId,
        attemptId: selector.attemptId,
        purpose: "stored_failure_classification",
        request,
        selector,
        result,
      });
    });
  }

  assessOwnedRepairs(input = {}) {
    const service = new FailureGateStoredClassification({
      store: this,
      projectRoot: this.projectRoot,
    });
    const result = service.assessOwnedRepairs(input);
    if (result.purpose !== "owned_repair_assessment" ||
        typeof result.taskId !== "string") {
      return { reference: null, digest: null, result };
    }
    const request = JSON.parse(canonicalJson(input));
    return this.#transaction(() => {
      const task = this.#getTask(result.taskId);
      if (!task) throw new Error("owned repair assessment task is not canonical in the store");
      return this.#persistClassificationRecord({
        taskId: result.taskId,
        purpose: "owned_repair_assessment",
        request,
        result,
      });
    });
  }

  #reResolveClassificationRecords(task, attempt) {
    const service = new FailureGateStoredClassification({
      store: this,
      projectRoot: this.projectRoot,
    });
    const rows = this.database.prepare(`
      SELECT * FROM classification_records
      WHERE task_id = ? AND attempt_id = ? AND purpose = 'stored_failure_classification'
      ORDER BY created_at, reference
    `).all(task.taskId, attempt.attemptId);
    const latest = new Map();
    for (const row of rows) {
      const record = this.#readClassificationRecord(row);
      const selector = record.selector;
      if (!selector || selector.taskId !== task.taskId ||
          selector.attemptId !== attempt.attemptId ||
          record.resultDigest !== digestJson(record.result)) {
        throw new Error("stored classification selector or result digest is malformed");
      }
      const resolved = service.classifyStoredFailure(record.request);
      const same = canonicalJson(resolved) === canonicalJson(record.result);
      latest.set(canonicalJson(selector), {
        selector,
        reference: record.reference,
        result: same
          ? resolved
          : {
              outcome: "blocked",
              accepted: false,
              reason: "persisted classification no longer re-resolves to the exact stored catalog, policy, and evidence sources",
            },
      });
    }
    return [...latest.values()];
  }

  #reResolveOwnedRepairAssessment(task) {
    const rows = this.database.prepare(`
      SELECT * FROM classification_records
      WHERE task_id = ? AND purpose = 'owned_repair_assessment'
      ORDER BY created_at, reference
    `).all(task.taskId);
    if (rows.length === 0) return null;
    const row = rows.at(-1);
    const record = this.#readClassificationRecord(row);
    if (record.resultDigest !== digestJson(record.result) ||
        record.request?.taskId !== task.taskId ||
        record.result?.planDigest !== task.planDigest) {
      throw new Error("stored owned-repair record is malformed or belongs to another task");
    }
    const service = new FailureGateStoredClassification({
      store: this,
      projectRoot: this.projectRoot,
    });
    const resolved = service.assessOwnedRepairs(record.request);
    if (canonicalJson(resolved) !== canonicalJson(record.result)) {
      return {
        accepted: false,
        reference: record.reference,
        reason: "persisted owned-repair assessment no longer re-resolves to its exact stored sources",
      };
    }
    return { ...resolved, reference: record.reference };
  }

  #assessRunAttempt(task, row) {
    for (const [content, digest] of [
      [row.snapshot_content, row.snapshot_digest],
      [row.environment_content, row.environment_digest],
    ]) {
      const value = JSON.parse(content);
      if (canonicalJson(value) !== content || digestJson(value) !== digest) {
        throw new Error("assessment requires canonical hash-bound retained inputs");
      }
    }
    const evidence = row.evidence_content ? JSON.parse(row.evidence_content) : null;
    if (!evidence || canonicalJson(evidence) !== row.evidence_content ||
        digestJson(evidence) !== row.evidence_digest) {
      throw new Error("assessment requires immutable canonical stored run evidence");
    }
    parseAttemptEvidence(evidence, row);
    const storedClassifications = evidence.schemaVersion === 2
      ? this.#reResolveClassificationRecords(task, this.#getValidationAttempt(row.attempt_id))
      : [];
    const explicitOwnedRepair = this.#reResolveOwnedRepairAssessment(task);
    const ownedIds = (task.plan.baselines?.owned ?? []).map(({ id }) => id);
    const classifiedOwnedIds = new Set(storedClassifications
      .filter(({ result }) => result.accepted === true &&
        result.outcome === "owned-repair-proven" &&
        typeof result.baselineId === "string")
      .map(({ result }) => result.baselineId));
    const allOwnedRepairsResolved = ownedIds.length > 0 &&
      ownedIds.every((id) => classifiedOwnedIds.has(id));
    const ownedRepairAssessment = explicitOwnedRepair?.accepted === true ||
      allOwnedRepairsResolved
      ? {
          accepted: true,
          reference: explicitOwnedRepair?.accepted === true
            ? explicitOwnedRepair.reference
            : storedClassifications.find(({ result }) =>
              result.accepted === true && result.outcome === "owned-repair-proven")?.reference,
        }
      : null;
    const assessment = assessRetainedEvidence({
      task,
      attempt: this.#getValidationAttempt(row.attempt_id),
      evidence,
      storedClassifications,
      ownedRepairAssessment,
    });
    const policy = getRegisteredValidationPolicy(this.projectRoot);
    if (task.status !== "active" || task.suspended ||
        task.planVersion !== Number(row.plan_version) ||
        task.planDigest !== row.plan_digest || task.planReference !== row.plan_reference ||
        task.authorizationVersion !== Number(row.authorization_version) ||
        task.authorizedTier !== row.tier ||
        task.policySnapshotDigest !== policy.snapshotDigest ||
        policy.tiers[row.tier]?.tierDefinitionDigest !== row.tier_definition_digest) {
      assessment.eligible = false;
      assessment.status = "BLOCKED";
      assessment.reasons.push("stored evidence is not applicable to current task authorization and policy");
    }
    if (Buffer.byteLength(canonicalJson(assessment), "utf8") > MAX_STORED_RUN_EVIDENCE_BYTES) {
      throw new Error("assessment exceeds bounded retained evidence size");
    }
    return assessment;
  }

  assessRunAttempt(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => !["taskId", "attemptId"].includes(key))) {
      throw new Error("assessment accepts only stored task and attempt identities, not caller verdicts");
    }
    const id = requiredText(input.taskId, "taskId");
    const attemptId = requiredText(input.attemptId, "attemptId");
    return this.#transaction(() => {
      const task = this.#getTask(id);
      if (!task) throw new Error(`unknown local task '${id}'`);
      const row = this.database.prepare(`
        SELECT * FROM validation_attempts WHERE attempt_id = ? AND task_id = ?
      `).get(attemptId, id);
      if (!row || row.lifecycle_state !== "released" || row.status !== "finished") {
        throw new Error("assessment requires a finalized retained run belonging to this task");
      }
      const assessment = this.#assessRunAttempt(task, row);
      this.#appendAudit(id, "stored_run_obligations_assessed", {
        attemptId,
        assessmentDigest: digestJson(assessment),
        assessment,
      });
      return assessment;
    });
  }

  getValidationAttempt(attemptId) {
    return this.#getValidationAttempt(requiredText(attemptId, "attemptId"));
  }

  validationAttempts(taskId) {
    const id = requiredText(taskId, "taskId");
    return this.database.prepare(
      "SELECT attempt_id FROM validation_attempts WHERE task_id = ? ORDER BY finished_at, attempt_id",
    ).all(id).map((row) => this.#getValidationAttempt(row.attempt_id));
  }

  close() {
    this.database.close();
  }
}

export { TERMINAL_STATUSES };