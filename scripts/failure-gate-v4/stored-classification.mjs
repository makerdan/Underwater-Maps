import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  canonicalJson,
  digestJson,
  sha256,
} from "./canonical.mjs";
import {
  classifyFailure,
  FAILURE_CLASSIFICATION,
} from "./classification.mjs";
import { validateStepReport } from "../lib/step-report.mjs";
import { validateTestCaseReport } from "./test-case-report.mjs";
import { getRegisteredValidationPolicy } from "./policy.mjs";

let engineEvidence;
try {
  engineEvidence = await import("./engine-evidence.mjs");
} catch {
  engineEvidence = null;
}

const CATALOG_REFERENCE = "docs/validation/failure-baseline.json";
const BASELINE_ID = /^BASE-[A-Z0-9-]+$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SELECTOR_KEYS = new Set([
  "taskId", "attemptId", "reportReference", "reportDigest", "caseId",
]);
const CLASSIFICATION_KEYS = new Set([
  "taskId", "attemptId", "reportReference", "reportDigest", "caseId",
  "retryReferences", "preTaskReference", "corroborationReference", "repairReference",
]);
const REPAIR_ASSESSMENT_KEYS = new Set(["taskId", "recordReferences"]);
const MAX_REFERENCE_LENGTH = 4096;
const REQUIRED_ATTEMPT_PURPOSE = "required_tier_validation";
const DIAGNOSTIC_RETRY_PURPOSE = "diagnostic-isolation";
const NODE_TEST_REPORTER_REFERENCE = "scripts/failure-gate-v4/node-test-reporter.mjs";
const HAS_V2_ENGINE_EVIDENCE = typeof engineEvidence?.verifyTestCaseReportBinding === "function" &&
  typeof engineEvidence?.resolveCaseObservation === "function";

export const FAILURE_GATE_STORED_CLASSIFICATION_CAPABILITIES = Object.freeze({
  synchronousCanonicalRunResolution: true,
  trackedCatalogOwnership: true,
  v2StoredCaseBinding: HAS_V2_ENGINE_EVIDENCE,
  exactStoredRetryClassification: true,
  trustedRetryRunRecordsAvailable: false,
  earlierStoredFailureProvenance: true,
  trustedOriginalFailureHistoryAvailable: false,
  independentStoredRecordCorroboration: true,
  independentSnapshotInputCorroboration: false,
  callerSuppliedIdentityOrProof: false,
  unavailableReasons: Object.freeze([
    ...(!HAS_V2_ENGINE_EVIDENCE ? [
      "engine-evidence v2 report binding and case observation resolver are not installed",
    ] : []),
    "no original live namespace-ledger or trusted retry/pre-task/corroboration records are available here; fixture records are algorithm tests only",
    "independent unchanged transitive/configuration/fixture/dependency snapshot verification is unavailable; unlisted failures require a separate stored failure record",
  ]),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, allowed) {
  return isRecord(value) &&
    Object.keys(value).every((key) => allowed.has(key)) &&
    Object.getOwnPropertySymbols(value).length === 0;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validDate(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function blocked(reason, sources = []) {
  return {
    schemaVersion: 1,
    purpose: "stored_failure_classification",
    outcome: FAILURE_CLASSIFICATION.BLOCKED,
    accepted: false,
    intermittent: false,
    baselineId: null,
    reason,
    sourceDigests: sources,
  };
}

function exactSelector(value, label) {
  if (!hasExactKeys(value, SELECTOR_KEYS) ||
      Object.keys(value).length !== SELECTOR_KEYS.size ||
      typeof value.taskId !== "string" || !/^TASK-\d{6,}$/.test(value.taskId) ||
      !nonEmpty(value.attemptId) || value.attemptId.length > MAX_REFERENCE_LENGTH ||
      !nonEmpty(value.reportReference) || value.reportReference.length > MAX_REFERENCE_LENGTH ||
      !DIGEST.test(value.reportDigest ?? "") ||
      !/^[0-9a-f]{64}$/.test(value.caseId ?? "")) {
    throw new TypeError(`${label} must be an exact stored task/attempt/report-digest/case selector`);
  }
  return {
    taskId: value.taskId,
    attemptId: value.attemptId,
    reportReference: value.reportReference,
    reportDigest: value.reportDigest,
    caseId: value.caseId,
  };
}

function runGit(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function loadTrackedCatalog(projectRoot) {
  const root = realpathSync(resolve(projectRoot));
  const reference = CATALOG_REFERENCE;
  if (isAbsolute(reference) || reference.includes("\\") ||
      reference.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("tracked baseline catalog reference is unsafe");
  }
  const path = resolve(root, reference);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("tracked baseline catalog escapes the project root");
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error("tracked baseline catalog must be a regular non-symlink file");
  }
  if (runGit(root, ["ls-files", "--error-unmatch", "--", reference]) !== reference) {
    throw new Error("tracked baseline catalog is not tracked at its canonical reference");
  }
  try {
    runGit(root, ["diff", "--quiet", "HEAD", "--", reference]);
  } catch {
    throw new Error("tracked baseline catalog has uncommitted changes and is not authoritative");
  }
  const bytes = readFileSync(path);
  let catalog;
  try {
    catalog = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("tracked baseline catalog is not valid JSON");
  }
  if (!isRecord(catalog) || !Array.isArray(catalog.entries) ||
      !Number.isInteger(catalog.catalogVersion) || catalog.catalogVersion < 1) {
    throw new Error("tracked baseline catalog has an invalid catalog shape");
  }
  const ids = catalog.entries.map((entry) => entry?.id);
  if (catalog.entries.some((entry) => !isRecord(entry) || !nonEmpty(entry.id)) ||
      new Set(ids).size !== ids.length) {
    throw new Error("tracked baseline catalog has malformed or duplicate entry IDs");
  }
  return {
    reference,
    digest: sha256(bytes),
    entries: catalog.entries,
  };
}

function taskOwnership(task, catalog, policy, now) {
  if (!isRecord(task) || !isRecord(task.plan) ||
      task.planDigest !== digestJson(task.plan) ||
      task.plan.taskId !== task.taskId ||
      task.plan.projectNamespace !== task.projectNamespace ||
      task.plan.planVersion !== task.planVersion ||
      typeof task.requestedTier !== "string" ||
      !policy.tiers[task.requestedTier]) {
    throw new Error("stored task plan or registered tier binding is invalid");
  }
  const tierPolicy = policy.tiers[task.requestedTier];
  if (task.tierDefinitionDigest !== tierPolicy.tierDefinitionDigest ||
      task.policySnapshotDigest !== policy.snapshotDigest ||
      task.registryDigest !== policy.registryDigest ||
      task.wrapperDigest !== policy.wrapperDigest) {
    throw new Error("stored task tier authorization differs from the installed validation policy");
  }
  const baselines = task.plan.baselines ?? {};
  if (!isRecord(baselines) ||
      Object.keys(baselines).some((key) => !["ignore", "owned"].includes(key))) {
    throw new Error("stored task baseline declarations are malformed");
  }
  const ignored = baselines.ignore ?? [];
  const owned = baselines.owned ?? [];
  const readRefs = (refs, label) => {
    if (!Array.isArray(refs)) throw new Error(`stored task baselines.${label} must be an array`);
    const seen = new Set();
    return refs.map((reference) => {
      if (!hasExactKeys(reference, new Set(["id", "owner"])) ||
          Object.keys(reference).length !== 2 ||
          !BASELINE_ID.test(reference.id ?? "") || !nonEmpty(reference.owner) ||
          seen.has(reference.id)) {
        throw new Error(`stored task baselines.${label} has an invalid or duplicate reference`);
      }
      seen.add(reference.id);
      const entry = catalog.entries.find((item) => item.id === reference.id);
      if (!entry) throw new Error(`baseline '${reference.id}' is absent from the tracked catalog`);
      if (entry.ownership?.owner !== reference.owner) {
        throw new Error(`baseline '${reference.id}' owner differs from the tracked catalog`);
      }
      if (label === "ignore" &&
          (entry.status !== "active" || entry.evidence?.authoritative !== true ||
           !validDate(entry.reviewDeadline) || now > entry.reviewDeadline ||
           !Array.isArray(entry.affectedTiers) ||
           !entry.affectedTiers.includes(task.requestedTier))) {
        throw new Error(`ignored baseline '${reference.id}' is not active, authoritative, unexpired, and tier-applicable`);
      }
      return reference;
    });
  };
  const ignoredRefs = readRefs(ignored, "ignore");
  const ownedRefs = readRefs(owned, "owned");
  if (ownedRefs.some(({ id }) => ignoredRefs.some((ignoredRef) => ignoredRef.id === id))) {
    throw new Error("stored task baseline cannot be both ignored and owned");
  }
  return { ignoredRefs, ownedRefs };
}

function assertStoredTaskAttemptBinding(stored, selector, policy) {
  canonicalJson(stored);
  if (!isRecord(stored) || !isRecord(stored.task) || !isRecord(stored.attempt) ||
      !isRecord(stored.evidence)) {
    throw new Error("stored run record is missing its task, attempt, or evidence");
  }
  const { task, attempt, evidence } = stored;
  if (task.taskId !== selector.taskId ||
      attempt.taskId !== selector.taskId ||
      attempt.attemptId !== selector.attemptId ||
      attempt.purpose !== REQUIRED_ATTEMPT_PURPOSE ||
      attempt.lifecycleState !== "released" ||
      !validTimestamp(attempt.finishedAt)) {
    throw new Error("stored run record has the wrong required-tier purpose or does not exactly bind the selected task and finished attempt");
  }
  if (attempt.evidenceDigest !== digestJson(evidence) ||
      (attempt.evidence !== undefined && digestJson(attempt.evidence) !== digestJson(evidence))) {
    throw new Error("stored evidence digest does not match the selected attempt");
  }
  if (attempt.planDigest !== task.planDigest || attempt.planReference !== task.planReference ||
      attempt.planVersion !== task.planVersion || attempt.tier !== task.requestedTier ||
      attempt.tierDefinitionDigest !== task.tierDefinitionDigest ||
      attempt.registryDigest !== task.registryDigest ||
      attempt.wrapperDigest !== task.wrapperDigest ||
      attempt.reportAdapterId !== policy.tiers[task.requestedTier]?.reportAdapterId) {
    throw new Error("stored attempt is not bound to the selected task plan and tier");
  }
  const snapshot = attempt.snapshot;
  if (!isRecord(snapshot) || snapshot.integrity !== "verified" ||
      !isRecord(snapshot.writerCoordination) ||
      snapshot.writerCoordination.status !== "verified" ||
      !nonEmpty(snapshot.writerCoordination.adapterId) ||
      !DIGEST.test(snapshot.writerCoordination.evidenceDigest ?? "")) {
    throw new Error("stored run lacks a verified captured snapshot and writer-coordination evidence");
  }
  if (evidence.schemaVersion !== 1 || evidence.complete !== true ||
      !isRecord(evidence.discovery) || evidence.discovery.artifactsAvailable !== true ||
      !Array.isArray(evidence.discovery.artifacts)) {
    throw new Error("stored evidence is incomplete or lacks retained discovery artifacts");
  }
  if (evidence.authorizationDigest !== attempt.authorizationDigest ||
      evidence.inputDigest !== attempt.inputDigest ||
      evidence.rawExitStatus !== attempt.rawExitStatus) {
    throw new Error("stored attempt authorization, input, or raw result differs from its evidence");
  }
  return { task, attempt, evidence };
}

function artifactBytes(artifact, label) {
  if (!hasExactKeys(artifact, new Set(["reference", "digest", "contentBase64"])) ||
      Object.keys(artifact).length !== 3 || !nonEmpty(artifact.reference) ||
      !DIGEST.test(artifact.digest ?? "") || typeof artifact.contentBase64 !== "string") {
    throw new Error(`${label} descriptor is malformed`);
  }
  const bytes = Buffer.from(artifact.contentBase64, "base64");
  if (bytes.toString("base64") !== artifact.contentBase64 || sha256(bytes) !== artifact.digest) {
    throw new Error(`${label} bytes do not match their stored digest`);
  }
  return bytes;
}

function verifiedDiagnosticSnapshot(snapshot, label, { projectRoot, attempt }) {
  const keys = new Set([
    "manifestContent", "manifestDigest", "environmentContent", "environmentDigest",
  ]);
  if (!hasExactKeys(snapshot, keys) || Object.keys(snapshot).length !== keys.size ||
      typeof snapshot.manifestContent !== "string" ||
      typeof snapshot.environmentContent !== "string" ||
      !DIGEST.test(snapshot.manifestDigest ?? "") ||
      !DIGEST.test(snapshot.environmentDigest ?? "") ||
      sha256(snapshot.manifestContent) !== snapshot.manifestDigest ||
      sha256(snapshot.environmentContent) !== snapshot.environmentDigest) {
    throw new Error(`${label} is not a digest-bound stored snapshot`);
  }
  let manifest;
  let environment;
  try {
    manifest = JSON.parse(snapshot.manifestContent);
    environment = JSON.parse(snapshot.environmentContent);
  } catch {
    throw new Error(`${label} contains malformed snapshot JSON`);
  }
  if (canonicalJson(manifest) !== snapshot.manifestContent ||
      digestJson(manifest) !== snapshot.manifestDigest ||
      canonicalJson(environment) !== snapshot.environmentContent ||
      digestJson(environment) !== snapshot.environmentDigest) {
    throw new Error(`${label} is not canonically bound to its stored snapshot digests`);
  }
  const integrityReasons = manifest?.integrityReasons;
  const runtime = environment?.runtime;
  const safeEnvironment = environment?.safeEnvironment;
  const secretEnvironment = environment?.secretBearingEnvironment;
  if (!isRecord(manifest) ||
      manifest.format !== "failure-gate-v4-worktree-manifest-v1" ||
      !Array.isArray(manifest.files) || !Array.isArray(manifest.ignoredPaths) ||
      !Array.isArray(manifest.exclusions) || manifest.integrity !== "unknown" ||
      !Array.isArray(integrityReasons) ||
      canonicalJson(integrityReasons) !== canonicalJson([...new Set(integrityReasons)].sort()) ||
      !integrityReasons.includes("shared_worktree_writer_coordination_unavailable") ||
      !isRecord(environment) ||
      environment.projectRootDigest !== sha256(realpathSync(resolve(projectRoot))) ||
      !isRecord(runtime) ||
      runtime.executable !== attempt.executable ||
      !/^v24(?:\.|$)/.test(runtime.node ?? "") ||
      runtime.versions?.node !== runtime.node.slice(1) ||
      runtime.platform !== process.platform ||
      runtime.architecture !== process.arch ||
      !isRecord(safeEnvironment) ||
      Object.entries(safeEnvironment).some(([key, value]) =>
        !["AUDIT_MARKER_BBOX_ENABLED", "CI", "LANG", "LC_ALL", "NODE_ENV", "TZ"].includes(key) ||
        typeof value !== "string") ||
      !hasExactKeys(secretEnvironment, new Set(["databaseUrlConfigured", "valuesRecorded"])) ||
      typeof secretEnvironment.databaseUrlConfigured !== "boolean" ||
      secretEnvironment.valuesRecorded !== false) {
    throw new Error(`${label} manifest or captured runtime environment is not a verified workspace snapshot`);
  }
  return {
    manifest,
    environment,
    manifestDigest: snapshot.manifestDigest,
    environmentDigest: snapshot.environmentDigest,
  };
}

function requiredSteps(attempt, policy) {
  const expected = policy.tiers[attempt.tier]?.selectedStepNames;
  if (!Array.isArray(expected) || expected.length === 0 ||
      new Set(expected).size !== expected.length) {
    throw new Error("registered validation policy has no unambiguous applicable step set");
  }
  const rawReport = attempt.evidence?.rawStepReport;
  if (!isRecord(rawReport) || rawReport.schemaVersion !== 1 ||
      rawReport.validated !== true ||
      !hasExactKeys(rawReport, new Set([
        "schemaVersion", "reference", "digest", "contentBase64", "validated",
      ]))) {
    throw new Error("stored raw step report is missing or unvalidated");
  }
  const bytes = artifactBytes({
    reference: rawReport.reference,
    digest: rawReport.digest,
    contentBase64: rawReport.contentBase64,
  }, "raw step report");
  let report;
  try {
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("invalid UTF-8");
    report = validateStepReport(JSON.parse(text));
  } catch {
    throw new Error("stored raw step report is malformed");
  }
  const names = report.steps.map((step) => step.name);
  if (new Set(names).size !== names.length ||
      names.length !== expected.length || expected.some((name) => !names.includes(name))) {
    throw new Error("raw step report is missing an applicable policy step or contains an unknown step");
  }
  if (attempt.stepResults?.length !== report.steps.length ||
      attempt.stepResults.some((result, index) =>
        !isRecord(result) || result.stepName !== report.steps[index].name ||
        result.rawExitStatus !== report.steps[index].rawExitStatus)) {
    throw new Error("stored attempt step results do not match its raw step report");
  }
  if (report.steps.some((step) => ["unknown", "skipped", "not_reached"].includes(step.status))) {
    throw new Error("raw step report contains an unknown, skipped, or undiscovered policy source");
  }
  if (report.tier !== attempt.tier &&
      report.tier !== policy.tiers[attempt.tier]?.runTierArgument) {
    throw new Error("raw step report tier does not match the stored run environment");
  }
  return report;
}

function engineCaseIdentity(report, entry, rawReportBytes, tier) {
  if (!engineEvidence ||
      typeof engineEvidence.verifyTestCaseReportBinding !== "function" ||
      typeof engineEvidence.resolveCaseObservation !== "function") {
    throw new Error("engine-evidence v2 binding capability is unavailable");
  }
  const binding = engineEvidence.verifyTestCaseReportBinding({ report, rawReportBytes });
  if (report.schemaVersion !== 2 || binding !== true) {
    throw new Error("test-case report is not independently bound by the v2 engine-evidence adapter");
  }
  const resolved = engineEvidence.resolveCaseObservation({ report, entry });
  if (!isRecord(resolved) || !nonEmpty(resolved.suite) ||
      resolved.test !== entry.id || !nonEmpty(entry.source) || !nonEmpty(entry.title) ||
      !isRecord(resolved.environment) || resolved.environment.nodeMajor !== 24 ||
      typeof resolved.environment.engineVersion !== "string" ||
      entry.status === "skipped" || entry.status === "unknown" || entry.status === "not_run") {
    throw new Error("case identity is unavailable, unsafe, skipped, or not a discovered v2 observation");
  }
  if (resolved.suite !== report.suite) {
    throw new Error("v2 case suite does not match the retained report");
  }
  if (entry.status === "failed" &&
      !/^[0-9a-f]{64}$/.test(resolved.failureSignature ?? "")) {
    throw new Error("v2 failed case has no actual redacted error signature");
  }
  if (entry.status === "passed" && resolved.failureSignature !== null) {
    throw new Error("passing case unexpectedly carries a failure signature");
  }
  if (!["passed", "failed"].includes(entry.status) ||
      !Number.isInteger(entry.errorCount) || entry.errorCount < 0 ||
      (entry.status === "passed" && entry.errorCount !== 0) ||
      (entry.status === "failed" && entry.errorCount === 0)) {
    throw new Error("stored case status is not a trustworthy raw pass/failure result");
  }
  const identity = {
    suite: resolved.suite,
    test: `${entry.source} — ${entry.title}`,
    failureSignature: resolved.failureSignature,
    environment: { ...resolved.environment, tier },
  };
  return {
    suite: identity.suite,
    test: identity.test,
    failureSignature: identity.failureSignature,
    environment: identity.environment,
    status: entry.status,
    discovered: true,
    errorCount: entry.errorCount,
  };
}

function exactDiagnosticSourceBinding(binding, primary) {
  const keys = new Set([
    "reportReference", "reportDigest", "caseId", "rawReportReference",
    "rawReportDigest", "step", "sourceDigest",
  ]);
  return hasExactKeys(binding, keys) && Object.keys(binding).length === keys.size &&
    binding.reportReference === primary.selector.reportReference &&
    binding.reportDigest === primary.selector.reportDigest &&
    binding.caseId === primary.selector.caseId &&
    binding.rawReportReference === primary.rawReportReference &&
    binding.rawReportDigest === primary.rawReportDigest &&
    binding.step === primary.step &&
    binding.sourceDigest === primary.sourceDigest;
}

function exactTestNamePattern(testName) {
  return `^${testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

function normalizeDiagnosticRunRecord(stored, selector) {
  const isolation = stored?.isolation;
  const attempt = isolation?.attempt;
  if (!isRecord(stored) || !isRecord(stored.task) ||
      !hasExactKeys(isolation, new Set(["reference", "digest", "attempt"])) ||
      Object.keys(isolation).length !== 3 ||
      !isRecord(attempt) || !nonEmpty(isolation.reference) ||
      isolation.reference !== `failure-gate-v4-isolation:${selector.attemptId}` ||
      !DIGEST.test(isolation.digest ?? "") ||
      attempt.purpose !== DIAGNOSTIC_RETRY_PURPOSE ||
      !isRecord(attempt.v2CaseReport) ||
      typeof attempt.v2CaseReport.reportText !== "string" ||
      typeof attempt.v2CaseReport.rawReportBase64 !== "string") {
    throw new Error("canonical diagnostic-isolation union is missing its immutable v2 attempt record");
  }
  const reportBytes = Buffer.from(attempt.v2CaseReport.reportText, "utf8");
  const rawReportBytes = Buffer.from(attempt.v2CaseReport.rawReportBase64, "base64");
  if (sha256(attempt.v2CaseReport.reportText) !== attempt.v2CaseReport.reportDigest ||
      rawReportBytes.toString("base64") !== attempt.v2CaseReport.rawReportBase64 ||
      sha256(rawReportBytes) !== attempt.v2CaseReport.rawReportDigest) {
    throw new Error("canonical diagnostic v2 report or raw report failed immutable digest verification");
  }
  let report;
  try {
    report = validateTestCaseReport(JSON.parse(attempt.v2CaseReport.reportText));
  } catch {
    throw new Error("canonical diagnostic v2 case report is malformed");
  }
  if (report.schemaVersion !== 2 ||
      engineEvidence?.verifyTestCaseReportBinding?.({ report, rawReportBytes }) !== true ||
      attempt.v2CaseReport.reference !==
        `failure-gate-v4-isolation/${selector.attemptId}/case-report.json` ||
      attempt.v2CaseReport.reportDigest !== selector.reportDigest ||
      report.rawReport?.reference !== attempt.v2CaseReport.rawReportReference ||
      report.rawReport?.digest !== attempt.v2CaseReport.rawReportDigest ||
      !isRecord(attempt.discovery) ||
      !hasExactKeys(attempt.discovery, new Set([
        "adapter", "available", "selectedCaseCount", "selectedCaseStatus", "complete",
      ])) ||
      Object.keys(attempt.discovery).length !== 5 ||
      attempt.discovery.adapter !== "node-test-v2-case-report" ||
      attempt.discovery.available !== true ||
      attempt.discovery.complete !== true ||
      attempt.discovery.selectedCaseCount !== 1 ||
      attempt.discovery.selectedCaseStatus !== report.cases[0]?.status ||
      attempt.discoveryDigest !== digestJson(attempt.discovery)) {
    throw new Error("canonical diagnostic attempt discovery does not bind its actual retained v2 report");
  }
  const statusCounts = {};
  for (const entry of report.cases) {
    statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
  }
  const summary = {
    schemaVersion: 1,
    available: true,
    notApplicable: false,
    caseCount: report.cases.length,
    allPassed: report.cases.every((entry) => entry.status === "passed"),
    reports: [{
      reference: "case-report.json",
      digest: attempt.v2CaseReport.reportDigest,
      engine: report.engine,
      suite: report.suite,
      step: report.step,
      outcome: report.outcome,
      complete: report.complete,
      caseCount: report.cases.length,
      counts: statusCounts,
    }],
  };
  const reportReference = attempt.v2CaseReport.reference;
  const rawReference = `${dirname(reportReference)}/${report.rawReport.reference}`;
  const artifacts = [
    {
      reference: reportReference,
      digest: attempt.v2CaseReport.reportDigest,
      contentBase64: reportBytes.toString("base64"),
    },
    {
      reference: rawReference,
      digest: attempt.v2CaseReport.rawReportDigest,
      contentBase64: attempt.v2CaseReport.rawReportBase64,
    },
  ];
  const discovery = {
    schemaVersion: 1,
    reportReference: `${dirname(reportReference)}/summary.json`,
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
    rawExitStatus: attempt.rawExitStatus,
    rawOutputDigest: attempt.rawOutputDigest,
    environmentDigest: attempt.environmentDigest,
    discovery,
  };
  return {
    task: stored.task,
    attempt,
    evidence,
    isolationReference: isolation.reference,
    isolationDigest: isolation.digest,
  };
}

function assertDiagnosticIsolationRetry({
  stored,
  selector,
  primary,
  projectRoot,
  catalog,
  policy,
  now,
}) {
  if (!isRecord(stored) || !isRecord(stored.task) || !isRecord(stored.attempt) ||
      !isRecord(stored.evidence) || !DIGEST.test(stored.isolationDigest ?? "") ||
      stored.isolationReference !== `failure-gate-v4-isolation:${selector.attemptId}`) {
    throw new Error("canonical diagnostic retry record is missing its immutable purpose union or retained evidence");
  }
  const { task, attempt, evidence } = stored;
  if (task.taskId !== selector.taskId ||
      attempt.taskId !== selector.taskId ||
      attempt.attemptId !== selector.attemptId ||
      attempt.purpose !== DIAGNOSTIC_RETRY_PURPOSE ||
      attempt.lifecycleState !== "released" ||
      !validTimestamp(attempt.finishedAt) ||
      Date.parse(attempt.finishedAt) <= Date.parse(primary.attempt.finishedAt)) {
    throw new Error("diagnostic isolation record is not a distinct, later released retry for this task");
  }
  if (attempt.planReference !== task.planReference ||
      attempt.planVersion !== task.planVersion ||
      attempt.planDigest !== task.planDigest ||
      attempt.tier !== task.requestedTier ||
      attempt.tierDefinitionDigest !== task.tierDefinitionDigest ||
      attempt.registryDigest !== task.registryDigest ||
      attempt.wrapperDigest !== task.wrapperDigest ||
      attempt.reportAdapterId !== policy.tiers[task.requestedTier]?.reportAdapterId) {
    throw new Error("diagnostic isolation record is not bound to the canonical task plan and tier");
  }
  if (!equalJson(attempt.environment, {
    nodeMajor: 24,
    engineVersion: "24",
    tier: task.requestedTier,
  })) {
    throw new Error("diagnostic isolation attempt does not retain the exact Node 24 source environment");
  }
  if ((attempt.evidenceDigest !== undefined &&
       attempt.evidenceDigest !== digestJson(evidence)) ||
      (attempt.evidence !== undefined && digestJson(attempt.evidence) !== digestJson(evidence)) ||
      evidence.schemaVersion !== 1 || evidence.complete !== true ||
      evidence.rawExitStatus !== attempt.rawExitStatus ||
      evidence.rawOutputDigest !== attempt.rawOutputDigest ||
      evidence.environmentDigest !== attempt.environmentDigest ||
      !isRecord(evidence.discovery) ||
      !isRecord(evidence.discovery.summary) ||
      evidence.discovery.summary.available !== true ||
      evidence.discovery.artifactsAvailable !== true ||
      !Array.isArray(evidence.discovery.artifacts) ||
      evidence.discovery.digest !== digestJson({
        reportReference: evidence.discovery.reportReference,
        summary: evidence.discovery.summary,
        artifactsAvailable: true,
        artifacts: evidence.discovery.artifacts.map(({ reference, digest }) => ({ reference, digest })),
      })) {
    throw new Error("diagnostic retry evidence is incomplete or not canonically bound to its retained artifacts");
  }
  if (!equalJson(attempt.selector, primary.selector) ||
      !exactDiagnosticSourceBinding(attempt.sourceBinding, primary)) {
    throw new Error("diagnostic retry is not derived from the exact stored primary failure source");
  }
  if (!isRecord(attempt.selection) ||
      !hasExactKeys(attempt.selection, new Set([
        "testFile", "testName", "testNamePattern", "caseId", "step", "tier",
      ])) ||
      Object.keys(attempt.selection).length !== 6 ||
      attempt.selection.caseId !== primary.selector.caseId ||
      attempt.selection.testFile !== primary.entry.source ||
      attempt.selection.testName !== primary.entry.title ||
      attempt.selection.testNamePattern !== exactTestNamePattern(attempt.selection.testName) ||
      attempt.selection.step !== primary.step ||
      attempt.selection.tier !== task.requestedTier ||
      !/^scripts\/__tests__\/[^/]+\.test\.mjs$/.test(attempt.selection.testFile) ||
      !nonEmpty(attempt.selection.testName) ||
      attempt.selection.testName.length > 4096 ||
      /[\u0000-\u001f\u007f]/.test(attempt.selection.testName)) {
    throw new Error("diagnostic retry selection does not exactly bind the stored source case");
  }
  if (!isRecord(attempt.v2CaseReport) ||
      !hasExactKeys(attempt.v2CaseReport, new Set([
        "reference", "reportText", "reportDigest", "rawReportReference",
        "rawReportDigest", "rawReportBase64",
      ])) ||
      Object.keys(attempt.v2CaseReport).length !== 6 ||
      attempt.v2CaseReport.reference !== selector.reportReference ||
      attempt.v2CaseReport.reportDigest !== selector.reportDigest ||
      attempt.selection.caseId !== selector.caseId) {
    throw new Error("diagnostic retry selector is not the exact retained v2 case-report reference/digest/case");
  }
  const identityDigest = digestJson(primary.identity);
  const reservationIdentityDigest = digestJson({
    purpose: DIAGNOSTIC_RETRY_PURPOSE,
    identity: primary.identity,
  });
  if (attempt.identityDigest !== identityDigest ||
      attempt.reservationIdentityDigest !== reservationIdentityDigest ||
      !isRecord(attempt.retryAuthorization) ||
      attempt.retryAuthorization.schemaVersion !== 1 ||
      attempt.retryAuthorization.authorized !== true ||
      attempt.retryAuthorization.safeIsolation !== true ||
      attempt.retryAuthorization.identityDigest !== identityDigest ||
      attempt.retryAuthorization.sourceDigest !== primary.sourceDigest ||
      attempt.retryAuthorization.authorizationDigest !== attempt.authorizationDigest ||
      !equalJson(Object.keys(attempt.retryAuthorization).sort(), [
        "authorizationDigest", "authorized", "identityDigest", "safeIsolation",
        "schemaVersion", "sourceDigest",
      ]) ||
      !DIGEST.test(attempt.authorizationDigest ?? "")) {
    throw new Error("diagnostic retry authorization is not derived from the exact stored identity and reservation");
  }
  const inputDigest = digestJson({
    selector: primary.selector,
    testFile: attempt.selection.testFile,
    testName: attempt.selection.testName,
    step: attempt.selection.step,
    tier: attempt.selection.tier,
  });
  if (attempt.inputDigest !== inputDigest) {
    throw new Error("diagnostic retry input digest does not bind its source selector and exact test selection");
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
    FAILURE_GATE_TEST_CASE_SUITE: primary.report.suite,
    FAILURE_GATE_TEST_STEP: primary.step,
  };
  const expectedEnvironmentDigest = digestJson(expectedIsolationEnvironment);
  const expectedArgv = [
    "--test",
    `--test-reporter=${resolve(projectRoot, NODE_TEST_REPORTER_REFERENCE)}`,
    `--test-name-pattern=${exactTestNamePattern(attempt.selection.testName)}`,
    attempt.selection.testFile,
  ];
  if (attempt.environmentDigest !== expectedEnvironmentDigest ||
      !equalJson(attempt.isolationEnvironment, expectedIsolationEnvironment) ||
      attempt.executable !== process.execPath ||
      !equalJson(attempt.argv, expectedArgv) ||
      attempt.authorizationDigest !== digestJson({
        schemaVersion: 1,
        purpose: DIAGNOSTIC_RETRY_PURPOSE,
        taskId: task.taskId,
        attemptId: attempt.attemptId,
        identityDigest,
        sourceBinding: attempt.sourceBinding,
        selection: attempt.selection,
        executable: attempt.executable,
        argv: attempt.argv,
        environmentDigest: attempt.environmentDigest,
        inputDigest: attempt.inputDigest,
      })) {
    throw new Error("diagnostic retry command, environment, or source-derived authorization is invalid");
  }
  if (!isRecord(attempt.execution) ||
      !hasExactKeys(attempt.execution, new Set([
        "started", "rawExitStatus", "signal", "timedOut",
        "outputLimitExceeded", "rawOutputDigest", "outputBytes",
      ])) ||
      Object.keys(attempt.execution).length !== 7 ||
      attempt.execution.started !== true ||
      attempt.execution.signal !== null || attempt.execution.timedOut !== false ||
      attempt.execution.outputLimitExceeded !== false ||
      attempt.execution.rawExitStatus !== attempt.rawExitStatus ||
      attempt.execution.rawOutputDigest !== attempt.rawOutputDigest ||
      attempt.status !== (attempt.rawExitStatus === 0 ? "PASS" : "FAIL")) {
    throw new Error("diagnostic retry lacks a completed bounded subprocess result");
  }
  if (!hasExactKeys(attempt.report, new Set(["adapter", "text", "byteLength", "digest"])) ||
      Object.keys(attempt.report).length !== 4 ||
      attempt.report.adapter !== "node-engine-evidence-v1" ||
      typeof attempt.report.text !== "string" ||
      sha256(attempt.report.text) !== attempt.report.digest ||
      Buffer.byteLength(attempt.report.text, "utf8") !== attempt.report.byteLength ||
      attempt.report.text !== Buffer.from(
        attempt.v2CaseReport.rawReportBase64 ?? "",
        "base64",
      ).toString("utf8") ||
      sha256(attempt.report.text) !== attempt.v2CaseReport.rawReportDigest) {
    throw new Error("diagnostic retry raw engine report is not immutably bound to its v2 case report");
  }
  const ownership = taskOwnership(task, catalog, policy, now);
  const expectedOwnership = {
    planDigest: task.planDigest,
    catalogReference: catalog.reference,
    catalogDigest: catalog.digest,
    tierDefinitionDigest: policy.tiers[task.requestedTier].tierDefinitionDigest,
    policySnapshotDigest: policy.snapshotDigest,
    ignoredBaselineIds: ownership.ignoredRefs.map(({ id }) => id),
    ownedBaselineIds: ownership.ownedRefs.map(({ id }) => id),
  };
  if (!equalJson(attempt.ownershipBefore, expectedOwnership) ||
      !equalJson(attempt.ownershipAfter, expectedOwnership) ||
      attempt.ownershipStable !== true) {
    throw new Error("diagnostic retry plan, catalog, or tier ownership changed or is not bound");
  }
  const before = verifiedDiagnosticSnapshot(
    attempt.beforeSnapshot,
    "diagnostic before-snapshot",
    { projectRoot, attempt },
  );
  const after = verifiedDiagnosticSnapshot(
    attempt.afterSnapshot,
    "diagnostic after-snapshot",
    { projectRoot, attempt },
  );
  if (!equalJson(attempt.beforeSnapshot, attempt.afterSnapshot) ||
      !isRecord(attempt.snapshot) ||
      !hasExactKeys(attempt.snapshot, new Set([
        "integrity", "beforeSnapshotDigest", "afterSnapshotDigest",
        "inputsUnchangedObserved", "writerCoordination",
      ])) ||
      Object.keys(attempt.snapshot).length !== 5 ||
      attempt.snapshot.integrity !== "unknown" ||
      attempt.snapshot.inputsUnchangedObserved !== true ||
      attempt.snapshot.beforeSnapshotDigest !== before.manifestDigest ||
      attempt.snapshot.afterSnapshotDigest !== after.manifestDigest ||
      !isRecord(attempt.snapshot.writerCoordination) ||
      attempt.snapshot.writerCoordination.status !== "unknown" ||
      attempt.snapshot.writerCoordination.adapterId !== null ||
      attempt.snapshot.writerCoordination.evidenceDigest !== null ||
      attempt.snapshotDigest !== digestJson({
        beforeSnapshot: attempt.beforeSnapshot,
        afterSnapshot: attempt.afterSnapshot,
      })) {
    throw new Error("diagnostic retry lacks verified identical before/after snapshots and explicit writer state");
  }
  return { task, attempt, evidence };
}

function resolvedSource({
  store,
  selector,
  projectRoot,
  catalog,
  policy,
  now,
  role = "required",
  primary = null,
}) {
  if (!HAS_V2_ENGINE_EVIDENCE) {
    throw new Error("trusted v2 engine-evidence report-binding/case-resolution capability is unavailable; v1 and caller-identity records cannot establish classification");
  }
  const stored = store.getStoredRunRecord({
    taskId: selector.taskId,
    attemptId: selector.attemptId,
  });
  if (stored && typeof stored.then === "function") {
    throw new TypeError("stored classification requires synchronous getStoredRunRecord resolution");
  }
  const diagnosticRetry =
    stored?.isolation?.attempt?.purpose === DIAGNOSTIC_RETRY_PURPOSE;
  if (diagnosticRetry && (role !== "retry" || !primary)) {
    throw new Error("diagnostic-isolation records are allowed only as source-bound safe retry proof");
  }
  const canonicalStored = diagnosticRetry
    ? normalizeDiagnosticRunRecord(stored, selector)
    : stored;
  const { task, attempt, evidence } = diagnosticRetry
    ? assertDiagnosticIsolationRetry({
        stored: canonicalStored,
        selector,
        primary,
        projectRoot,
        catalog,
        policy,
        now,
      })
    : assertStoredTaskAttemptBinding(canonicalStored, selector, policy);
  const storedRecordDigest = diagnosticRetry
    ? canonicalStored.isolationDigest
    : null;
  const ownership = taskOwnership(task, catalog, policy, now);
  if (!diagnosticRetry) requiredSteps(attempt, policy);
  const discovery = evidence.discovery;
  const artifacts = discovery.artifacts.map((artifact) => ({
    artifact,
    bytes: artifactBytes(artifact, "discovery artifact"),
  }));
  const reports = artifacts.filter(({ artifact }) => artifact.reference === selector.reportReference);
  if (reports.length !== 1 || reports[0].artifact.digest !== selector.reportDigest) {
    throw new Error("selected report reference/digest is not a unique member of the retained discovery artifacts");
  }
  const summary = discovery.summary;
  const summaryReference = relative(dirname(discovery.reportReference), selector.reportReference);
  if (!isRecord(summary) || summary.available !== true ||
      !Array.isArray(summary.reports) ||
      summary.reports.filter((item) =>
        item?.reference === summaryReference && item?.digest === selector.reportDigest).length !== 1) {
    throw new Error("selected report is not the exact expected member of the retained discovery summary");
  }
  const reportBytes = reports[0].bytes;
  let report;
  try {
    const text = reportBytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(reportBytes)) throw new Error("invalid UTF-8");
    report = validateTestCaseReport(JSON.parse(text));
  } catch {
    throw new Error("selected test-case report is malformed or unsupported by the retained report schema");
  }
  if (!report.complete) throw new Error("selected test-case report is incomplete");
  if (diagnosticRetry &&
      (report.engine !== "node-test" ||
       report.step !== "test:unit" ||
       report.environment?.nodeMajor !== 24 ||
       report.environment?.engineVersion !== "24" ||
       report.cases.length !== 1)) {
    throw new Error("diagnostic isolation retry must retain exactly one Node 24 test:unit v2 case report");
  }
  const entries = report.cases.filter((entry) => entry.id === selector.caseId);
  if (entries.length !== 1) throw new Error("selected case ID is absent or ambiguous in the retained report");
  const [entry] = entries;
  if (entry.status === "skipped" || entry.status === "unknown" || entry.status === "not_run") {
    throw new Error(`selected case raw status '${entry.status}' is not classification evidence`);
  }
  if (!report.rawReport) throw new Error("selected case report has no bound raw engine report");
  const rawMatches = artifacts.filter(({ artifact }) =>
    artifact.reference.split(/[\\/]/).at(-1) === report.rawReport.reference &&
    artifact.digest === report.rawReport.digest);
  if (rawMatches.length !== 1) {
    throw new Error("selected raw engine report is absent or ambiguous in retained discovery artifacts");
  }
  const observation = engineCaseIdentity(report, entry, rawMatches[0].bytes, attempt.tier);
  if (observation.status !== "failed" && observation.status !== "passed") {
    throw new Error("selected raw case status is unresolved");
  }
  const observationIdentity = {
    suite: observation.suite,
    test: observation.test,
    failureSignature: observation.failureSignature,
    environment: observation.environment,
  };
  if (diagnosticRetry &&
      (!sameStableCaseAndEnvironment(primary, {
        selector, identity: observationIdentity,
      }) ||
       (observation.status === "failed" &&
        !exactIdentity(primary.identity, observationIdentity)))) {
    throw new Error("diagnostic retry v2 observation differs from the exact stored primary identity or environment");
  }
  const writerCoordinationDigest = attempt.snapshot?.writerCoordination?.evidenceDigest ?? null;
  const stepReportDigest = evidence.rawStepReport?.digest ?? null;
  const sourceDigest = digestJson({
    taskId: task.taskId,
    planDigest: task.planDigest,
    attemptId: attempt.attemptId,
    storedRecordDigest,
    evidenceDigest: attempt.evidenceDigest ?? null,
    authorizationDigest: attempt.authorizationDigest,
    inputDigest: attempt.inputDigest,
    environmentDigest: attempt.environmentDigest ?? null,
    writerCoordinationDigest,
    retryAuthorizationDigest: attempt.retryAuthorization
      ? digestJson(attempt.retryAuthorization)
      : null,
    reportReference: selector.reportReference,
    reportDigest: selector.reportDigest,
    caseId: selector.caseId,
    rawReportReference: report.rawReport.reference,
    rawReportDigest: report.rawReport.digest,
    discoveryDigest: discovery.digest ?? null,
    identity: observationIdentity,
    status: observation.status,
    stepReportDigest,
    snapshotDigest: attempt.snapshotDigest ?? null,
  });
  return {
    selector,
    task,
    attempt,
    evidence,
    ownership,
    observation,
    identity: observationIdentity,
    report,
    entry,
    step: report.step,
    sourceId: `${selector.taskId}/${selector.attemptId}/${selector.reportReference}/${selector.caseId}`,
    sourceDigest,
    rawReportReference: report.rawReport.reference,
    rawReportDigest: report.rawReport.digest,
    rawStepReportReference: evidence.rawStepReport?.reference ?? null,
    rawStepReportDigest: stepReportDigest,
    discoveryDigest: discovery.digest ?? null,
    snapshotDigest: attempt.snapshotDigest ?? null,
    authorizationDigest: attempt.authorizationDigest,
    inputDigest: attempt.inputDigest,
    environmentDigest: attempt.environmentDigest ?? null,
    writerCoordinationDigest,
    retryAuthorizationDigest: attempt.retryAuthorization
      ? digestJson(attempt.retryAuthorization)
      : null,
  };
}

function exactIdentity(left, right) {
  return isRecord(left) && isRecord(right) &&
    left.suite === right.suite &&
    left.test === right.test &&
    left.failureSignature === right.failureSignature &&
    canonicalJson(left.environment) === canonicalJson(right.environment);
}

function sameCaseAndEnvironment(left, right) {
  return isRecord(left) && isRecord(right) &&
    left.suite === right.suite &&
    left.test === right.test &&
    canonicalJson(left.environment) === canonicalJson(right.environment);
}

function sameStableCaseAndEnvironment(left, right) {
  return sameCaseAndEnvironment(left.identity, right.identity) &&
    left.selector.caseId === right.selector.caseId;
}

function preWorkBoundary(task) {
  if (task.approvalSourceKind === "replit-project-task") {
    const verifiedSourceCreatedAt = task.verifiedSourceCreatedAt;
    const boundSourceCreatedAt = task.approval?.sourceSnapshot?.createdAt;
    return validTimestamp(verifiedSourceCreatedAt) &&
      verifiedSourceCreatedAt === boundSourceCreatedAt
      ? verifiedSourceCreatedAt
      : null;
  }
  return validTimestamp(task.createdAt) ? task.createdAt : null;
}

function classificationTask(primary, catalog, policy, now) {
  return {
    task: primary.task,
    ownership: taskOwnership(primary.task, catalog, policy, now),
  };
}

function retryProof(primary, retries) {
  if (!Array.isArray(retries) || retries.length !== 3) {
    throw new Error("exactly three distinct stored authorized safe retry results are required");
  }
  const ids = new Set();
  const isolationRetryNumbers = new Set();
  const retryEvidence = retries.map((retry) => {
    const attempt = retry.attempt;
    const authorization = attempt.retryAuthorization;
    if (![REQUIRED_ATTEMPT_PURPOSE, DIAGNOSTIC_RETRY_PURPOSE].includes(attempt.purpose) ||
        attempt.attemptId === primary.attempt.attemptId ||
        attempt.taskId !== primary.attempt.taskId ||
        Date.parse(attempt.finishedAt) <= Date.parse(primary.attempt.finishedAt) ||
        ids.has(attempt.attemptId) ||
        !isRecord(authorization) ||
        authorization.schemaVersion !== 1 ||
        authorization.authorized !== true ||
        authorization.safeIsolation !== true ||
        authorization.identityDigest !== digestJson(primary.identity) ||
        !DIGEST.test(authorization.authorizationDigest ?? "")) {
      throw new Error("each retry must be a distinct stored attempt with matching authorized safe-isolation binding");
    }
    ids.add(attempt.attemptId);
    if (attempt.purpose === DIAGNOSTIC_RETRY_PURPOSE) {
      if (!Number.isInteger(attempt.retryNumber) || attempt.retryNumber < 1 ||
          attempt.retryNumber > 3 || isolationRetryNumbers.has(attempt.retryNumber)) {
        throw new Error("diagnostic retry reservations must be distinct source-bound immutable retry slots");
      }
      isolationRetryNumbers.add(attempt.retryNumber);
    }
    if (!sameStableCaseAndEnvironment(primary, retry) ||
        !["passed", "failed"].includes(retry.observation.status)) {
      throw new Error("each stored retry must have the exact case identity and a raw pass/failure result");
    }
    if (retry.observation.status === "failed" &&
        !exactIdentity(primary.identity, retry.identity)) {
      throw new Error("retry failure signature differs from the stored primary failure");
    }
    return {
      retryId: attempt.attemptId,
      recordReference: retry.sourceId,
      authorized: true,
      safeIsolation: true,
      trustworthyResult: true,
      trustworthyDiscovery: true,
      discovered: retry.observation.discovered,
      ...primary.identity,
      outcome: retry.observation.status === "passed" ? "pass" : "fail",
      sourceDigest: retry.sourceDigest,
    };
  });
  return retryEvidence;
}

function selectorSources(records) {
  return records.map((record) => ({
    taskId: record.selector.taskId,
    attemptId: record.selector.attemptId,
    reportReference: record.selector.reportReference,
    reportDigest: record.selector.reportDigest,
    caseId: record.selector.caseId,
    evidenceDigest: record.attempt.evidenceDigest,
    authorizationDigest: record.authorizationDigest,
    inputDigest: record.inputDigest,
    environmentDigest: record.environmentDigest,
    writerCoordinationDigest: record.writerCoordinationDigest,
    retryAuthorizationDigest: record.retryAuthorizationDigest,
    rawReportReference: record.rawReportReference,
    rawReportDigest: record.rawReportDigest,
    rawStepReportReference: record.rawStepReportReference,
    rawStepReportDigest: record.rawStepReportDigest,
    discoveryDigest: record.discoveryDigest,
    snapshotDigest: record.snapshotDigest,
    rawStatus: record.observation.status,
    sourceDigest: record.sourceDigest,
  }));
}

function exactRequest(input, allowed, label) {
  if (!hasExactKeys(input, allowed) ||
      Object.keys(input).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} contains unsupported fields; identities and verdicts are derived only from stored records`);
  }
}

function canonicalRequest(input) {
  return JSON.parse(canonicalJson(input));
}

function equalJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Synchronous, reference-only trusted classifier. The store boundary is the
 * code-owned canonical resolver; input accepts selectors, never identities,
 * ownership IDs, verdicts, or verification flags.
 *
 * Adapter contract: verifyTestCaseReportBinding returns true only after
 * binding a v2 envelope to canonical raw engine-evidence bytes;
 * resolveCaseObservation returns { suite, test: stableCaseId,
 * failureSignature, environment } or null. This service combines the
 * adapter-authenticated source/full title with the store-bound tier. v1 and
 * caller-identity evidence fail closed.
 */
export class FailureGateStoredClassification {
  constructor({ store, projectRoot } = {}) {
    if (!store || typeof store.getStoredRunRecord !== "function" ||
        typeof projectRoot !== "string" || !projectRoot) {
      throw new TypeError("stored classification requires a synchronous canonical run-record resolver and project root");
    }
    this.store = store;
    this.projectRoot = realpathSync(resolve(projectRoot));
  }

  classifyStoredFailure(input = {}) {
    let sources = [];
    try {
      input = canonicalRequest(input);
      exactRequest(input, CLASSIFICATION_KEYS, "stored classification request");
      if (!HAS_V2_ENGINE_EVIDENCE) {
        throw new Error("trusted v2 engine-evidence report-binding/case-resolution capability is unavailable; v1 and caller-identity records cannot establish classification");
      }
      const selector = exactSelector({
        taskId: input.taskId,
        attemptId: input.attemptId,
        reportReference: input.reportReference,
        reportDigest: input.reportDigest,
        caseId: input.caseId,
      }, "primary selector");
      const catalog = loadTrackedCatalog(this.projectRoot);
      const policy = getRegisteredValidationPolicy(this.projectRoot);
      const now = new Date().toISOString().slice(0, 10);
      const primary = resolvedSource({
        store: this.store,
        selector,
        projectRoot: this.projectRoot,
        catalog,
        policy,
        now,
        role: "primary",
      });
      sources = [primary];
      if (primary.observation.status !== "failed") {
        throw new Error("primary selected record is not an actual raw failure");
      }
      const { ownership } = classificationTask(primary, catalog, policy, now);
      const retrySelectors = input.retryReferences === undefined
        ? []
        : input.retryReferences;
      if (!Array.isArray(retrySelectors)) throw new TypeError("retryReferences must be a selector array");
      const retries = retrySelectors.map((reference, index) => resolvedSource({
        store: this.store,
        selector: exactSelector(reference, `retryReferences[${index}]`),
        projectRoot: this.projectRoot,
        catalog,
        policy,
        now,
        role: "retry",
        primary,
      }));
      sources.push(...retries);
      let preTask = null;
      if (input.preTaskReference !== undefined) {
        preTask = resolvedSource({
          store: this.store,
          selector: exactSelector(input.preTaskReference, "preTaskReference"),
          projectRoot: this.projectRoot,
          catalog,
          policy,
          now,
          role: "pre-task",
        });
        sources.push(preTask);
      }
      let corroboration = null;
      if (input.corroborationReference !== undefined) {
        corroboration = resolvedSource({
          store: this.store,
          selector: exactSelector(input.corroborationReference, "corroborationReference"),
          projectRoot: this.projectRoot,
          catalog,
          policy,
          now,
          role: "corroboration",
        });
        sources.push(corroboration);
      }
      let repair = null;
      if (input.repairReference !== undefined) {
        repair = resolvedSource({
          store: this.store,
          selector: exactSelector(input.repairReference, "repairReference"),
          projectRoot: this.projectRoot,
          catalog,
          policy,
          now,
          role: "repair",
        });
        sources.push(repair);
      }

      const ownedIds = ownership.ownedRefs.map(({ id }) => id);
      const ignoredIds = ownership.ignoredRefs.map(({ id }) => id);
      const sourceBoundary = preWorkBoundary(primary.task);
      if (ownedIds.length === 0 && ignoredIds.length === 0 && !sourceBoundary) {
        throw new Error(primary.task.approvalSourceKind === "replit-project-task"
          ? "accepted project task has no verified source-created-at pre-work boundary; local reservation time cannot establish provenance"
          : "stored task has no verified pre-work creation boundary for earlier-failure provenance");
      }
      let repairProof;
      if (ownedIds.length > 0) {
        if (repair &&
            repair.observation.status === "passed" &&
            sameStableCaseAndEnvironment(primary, repair) &&
            Date.parse(repair.attempt.finishedAt) > Date.parse(primary.attempt.finishedAt)) {
          repairProof = {
            recordReference: repair.sourceId,
            verified: true,
            trustworthyResult: true,
            trustworthyDiscovery: true,
            discovered: true,
            outcome: "pass",
            ...primary.identity,
          };
        }
      }

      let trustedRetries;
      if (retries.length) trustedRetries = retryProof(primary, retries);
      const preTaskEvidence = preTask &&
        preTask.observation.status === "failed" &&
        exactIdentity(primary.identity, preTask.identity) &&
        preTask.task.taskId !== primary.task.taskId &&
        sourceBoundary &&
        Date.parse(preTask.attempt.finishedAt) < Date.parse(sourceBoundary)
        ? {
            recordReference: preTask.sourceId,
            sourceId: preTask.sourceId,
            verified: true,
            trustworthyResult: true,
            trustworthyDiscovery: true,
            discovered: true,
            outcome: "fail",
            ...preTask.identity,
          }
        : undefined;
      const corroborationEvidence = corroboration &&
        corroboration.observation.status === "failed" &&
        sameStableCaseAndEnvironment(primary, corroboration) &&
        exactIdentity(primary.identity, corroboration.identity) &&
        corroboration.task.taskId !== primary.task.taskId &&
        corroboration.sourceId !== preTask?.sourceId &&
        corroboration.sourceId !== primary.sourceId &&
        !retries.some((retry) => retry.sourceId === corroboration.sourceId)
        ? {
            recordReference: corroboration.sourceId,
            sourceId: corroboration.sourceId,
            verified: true,
            trustworthyResult: true,
            trustworthyDiscovery: true,
            discovered: true,
            outcome: "fail",
            ...corroboration.identity,
          }
        : undefined;

      const result = classifyFailure({
        observed: primary.identity,
        catalogEntries: catalog.entries,
        ignoredBaselineIds: ignoredIds,
        ownedBaselineIds: ownedIds,
        now,
        retries: trustedRetries,
        preTaskEvidence,
        corroboration: corroborationEvidence,
        repairProof,
      });
      const sourceRecords = selectorSources(sources);
      return {
        schemaVersion: 1,
        purpose: "stored_failure_classification",
        taskId: primary.task.taskId,
        attemptId: primary.attempt.attemptId,
        planDigest: primary.task.planDigest,
        baselineCatalogReference: catalog.reference,
        baselineCatalogDigest: catalog.digest,
        policySnapshotDigest: policy.snapshotDigest,
        tierDefinitionDigest: policy.tiers[primary.task.requestedTier].tierDefinitionDigest,
        observed: primary.identity,
        outcome: result.outcome,
        accepted: result.accepted,
        intermittent: result.intermittent,
        baselineId: result.baselineId,
        reason: result.reason,
        sourceDigests: sourceRecords,
        recomputeAtCompletion: true,
      };
    } catch (error) {
      return {
        ...blocked(error instanceof Error ? error.message : "stored classification failed closed", selectorSources(sources)),
        recomputeAtCompletion: true,
      };
    }
  }

  assessOwnedRepairs(input = {}) {
    const resolved = [];
    try {
      input = canonicalRequest(input);
      exactRequest(input, REPAIR_ASSESSMENT_KEYS, "owned-repair assessment request");
      if (!HAS_V2_ENGINE_EVIDENCE) {
        throw new Error("trusted v2 engine-evidence report-binding/case-resolution capability is unavailable; owned repairs require v2 stored case proof");
      }
      if (typeof input.taskId !== "string" || !/^TASK-\d{6,}$/.test(input.taskId) ||
          !Array.isArray(input.recordReferences)) {
        throw new TypeError("owned-repair assessment requires a task ID and stored case selectors");
      }
      const catalog = loadTrackedCatalog(this.projectRoot);
      const policy = getRegisteredValidationPolicy(this.projectRoot);
      const now = new Date().toISOString().slice(0, 10);
      if (input.recordReferences.length === 0) {
        throw new Error("owned-repair assessment needs stored case references; planning snapshots are not proof");
      }
      const references = input.recordReferences.map((reference, index) => exactSelector(
        reference, `recordReferences[${index}]`,
      ));
      const taskReference = references.find((reference) => reference.taskId === input.taskId);
      if (!taskReference) {
        throw new Error("owned-repair assessment requires a selected stored record from the target task");
      }
      const taskRecord = this.store.getStoredRunRecord({
        taskId: taskReference.taskId,
        attemptId: taskReference.attemptId,
      });
      if (taskRecord && typeof taskRecord.then === "function") {
        throw new TypeError("stored classification requires synchronous getStoredRunRecord resolution");
      }
      if (!isRecord(taskRecord) || taskRecord.task?.taskId !== input.taskId) {
        throw new Error("owned-repair task is unavailable from the stored resolver");
      }
      const ownership = taskOwnership(taskRecord.task, catalog, policy, now);
      const selectorKeys = references.map((reference) => canonicalJson(reference));
      if (new Set(selectorKeys).size !== selectorKeys.length) {
        throw new Error("owned-repair record selectors must be distinct");
      }
      for (const selector of references) {
        resolved.push(resolvedSource({
          store: this.store, selector, projectRoot: this.projectRoot, catalog, policy, now,
        }));
      }
      const obligations = ownership.ownedRefs.map(({ id, owner }) => {
        const baseline = catalog.entries.find((entry) => entry.id === id);
        const failures = resolved.filter((record) =>
          record.observation.status === "failed" &&
          record.identity.suite === baseline.suite &&
          record.identity.test === baseline.test &&
          record.identity.failureSignature === baseline.failureSignature);
        const proven = failures.some((failure) => resolved.some((repair) =>
          repair !== failure &&
          repair.observation.status === "passed" &&
          sameStableCaseAndEnvironment(failure, repair) &&
          Date.parse(repair.attempt.finishedAt) > Date.parse(failure.attempt.finishedAt)));
        return {
          baselineId: id,
          owner,
          status: proven ? "proven" : "unresolved",
          reason: proven
            ? "owned failure has a separately selected discovered raw pass with the exact stable identity and environment"
            : "owned repair requires a stored prior raw failure and a later exact discovered pass",
          sourceDigests: selectorSources(resolved),
        };
      });
      const unresolved = obligations.some((item) => item.status !== "proven");
      return {
        schemaVersion: 1,
        purpose: "owned_repair_assessment",
        taskId: input.taskId,
        planDigest: taskRecord.task.planDigest,
        baselineCatalogReference: catalog.reference,
        baselineCatalogDigest: catalog.digest,
        policySnapshotDigest: policy.snapshotDigest,
        ownedObligations: obligations,
        outcome: unresolved ? "blocked" : "owned-repair-proven",
        accepted: !unresolved,
        reason: unresolved
          ? "one or more owned repair obligations remain unresolved"
          : "all owned repairs have reference-resolved exact passing evidence",
        sourceDigests: selectorSources(resolved),
        recomputeAtCompletion: true,
      };
    } catch (error) {
      return {
        schemaVersion: 1,
        purpose: "owned_repair_assessment",
        outcome: "blocked",
        accepted: false,
        reason: error instanceof Error ? error.message : "owned-repair assessment failed closed",
        sourceDigests: selectorSources(resolved),
        recomputeAtCompletion: true,
      };
    }
  }
}

export const StoredFailureClassification = FailureGateStoredClassification;