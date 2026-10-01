import { chmod, lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJson, digestJson, sha256 } from "./canonical.mjs";
import { getRegisteredValidationPolicy } from "./policy.mjs";
import { captureWorkspaceSnapshot } from "./snapshot.mjs";
import { validateStepReport } from "../lib/step-report.mjs";
import { FailureGateCoordinator } from "./coordinator.mjs";
import { withWriterLock } from "./writer-lock.mjs";
import { runTierLockDryRun } from "../lib/tier-lock-check.mjs";
import { loadTrackedBaselineCatalog, validatePlanningGuards } from "./planning.mjs";
import { collectTestCaseDiscovery, loadTestCaseReports } from "./test-case-report.mjs";
import { hasExactRegisteredCaseCoverage } from "./suite-coverage.mjs";
import { verifyAcceptedProjectTaskBinding } from "./replit-task.mjs";
import { assertRecordedRunStopped, captureRunProcessIdentity } from "./recovery.mjs";
import { verifyBootstrapApproval } from "./bootstrap-policy.mjs";
import {
  checkedEnvironmentIdentity, withRunEnvironment, withAcceptedTaskSource,
} from "./run-context.mjs";

const MAX_STEP_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_CASE_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_CASE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_CASE_ARTIFACT_COUNT = 4096;
const MAX_RETAINED_STREAM_BYTES = 64 * 1024;

function checkedEnvironmentControls() {
  const prohibited = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (name === "NODE_OPTIONS" && value.trim() !== "") prohibited.push(name);
    if (name === "E2E_REAL_CLERK" && value === "1") prohibited.push(name);
    if (["E2E_AUTH_BYPASS", "VITE_DEV_AUTH_BYPASS"].includes(name) &&
        /^(?:1|true|yes)$/i.test(value)) prohibited.push(name);
    if (/^(?:VITEST_|VITE_TEST_|PW_TEST_|PLAYWRIGHT_TEST_|JEST_|MOCHA_|PYTEST_)/i.test(name) ||
        name === "PW_E2E_PORT_SWEEP_DONE" ||
        /^(?:E2E_|VITE_.*E2E_).*(?:BYPASS|MOCK|FAKE|STUB|SKIP|ONLY|FILTER)/i.test(name) &&
          /^(?:1|true|yes)$/i.test(value) ||
        /(?:^|_)(?:ONLY|SKIP|FILTER|GREP|EXCLUDE|SHARD|COVERAGE|FILE_PATTERN|NAME_PATTERN)(?:_|$)/i.test(name) ||
        /(?:^|_)(?:E2E_)?TEST_(?:FILE|FILES|FILTER|PATTERN|SUITE|NAME|GREP|ONLY|SKIP|EXCLUDE|SHARD|COVERAGE)(?:_|$)/i.test(name)) {
      prohibited.push(name);
    }
  }
  if (prohibited.length > 0) {
    throw new Error(`checked validation rejects coverage-reducing environment controls: ${[...new Set(prohibited)].sort().join(", ")}`);
  }
}

function redactSecrets(text, secrets) {
  let safe = text;
  for (const secret of secrets) safe = safe.split(secret).join("[REDACTED]");
  return safe;
}

function signalRunProcessGroup(identity, signal) {
  if (!identity) return;
  try {
    process.kill(-identity.processGroupId, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function ensureRunProcessGroupStopped(identity) {
  if (!identity) return false;
  try {
    assertRecordedRunStopped(identity);
    return true;
  } catch {
    signalRunProcessGroup(identity, "SIGTERM");
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    try {
      assertRecordedRunStopped(identity);
      return true;
    } catch { /* Continue checking the recorded process group. */ }
  }
  signalRunProcessGroup(identity, "SIGKILL");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    try {
      assertRecordedRunStopped(identity);
      return true;
    } catch { /* Keep the lease quarantined if the group remains live. */ }
  }
  return false;
}

function makeStreamCapture(name, secrets) {
  const hash = createHash("sha256");
  const orderedSecrets = [...new Set(secrets.filter((value) => value.length > 0))]
    .sort((a, b) => b.length - a.length);
  const maxSecretLength = orderedSecrets.reduce((length, secret) => Math.max(length, secret.length), 0);
  let pending = "";
  let byteCount = 0;
  let safeText = "";
  let safeTextBytes = 0;
  let truncated = false;

  const retain = (safe) => {
    for (const character of safe) {
      const characterBytes = Buffer.byteLength(character);
      if (safeTextBytes + characterBytes > MAX_RETAINED_STREAM_BYTES) {
        truncated = true;
        break;
      }
      safeText += character;
      safeTextBytes += characterBytes;
    }
    if (safe) {
      const visible = safe.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "�");
      process.stdout.write(`[checked-run ${name}] ${visible}`);
    }
  };

  const flush = (final = false) => {
    let cutoff = final ? pending.length : Math.max(0, pending.length - Math.max(0, maxSecretLength - 1));
    if (!final && cutoff > 0) {
      for (const secret of orderedSecrets) {
        let start = pending.indexOf(secret);
        while (start !== -1) {
          if (start < cutoff && start + secret.length > cutoff) cutoff = start;
          start = pending.indexOf(secret, start + 1);
        }
      }
    }
    if (cutoff <= 0) return;
    const safe = redactSecrets(pending.slice(0, cutoff), orderedSecrets);
    pending = pending.slice(cutoff);
    retain(safe);
  };

  return {
    get bytes() {
      return byteCount;
    },
    update(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      byteCount += bytes.length;
      pending += bytes.toString("utf8");
      flush();
    },
    finish() {
      flush(true);
      return {
        bytes: byteCount,
        digest: hash.digest("hex"),
        safeText,
        truncated,
      };
    },
  };
}

async function captureCaseArtifacts(directory) {
  const root = await realpath(directory);
  const names = (await readdir(root)).sort();
  if (names.length > MAX_CASE_ARTIFACT_COUNT) {
    throw new Error("case-report artifact count exceeds the bounded evidence size");
  }
  const artifacts = [];
  let totalBytes = 0;
  for (const name of names) {
    if (name === "." || name === ".." || name.includes("/") || name.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error("case-report artifact has an unsafe name");
    }
    const path = resolve(root, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path ||
        info.size > MAX_CASE_ARTIFACT_BYTES) {
      throw new Error("case-report artifact is unsafe or oversized");
    }
    totalBytes += info.size;
    if (totalBytes > MAX_TOTAL_CASE_ARTIFACT_BYTES) {
      throw new Error("case-report artifacts exceed the bounded evidence size");
    }
    const bytes = await readFile(path);
    artifacts.push({
      reference: path,
      digest: sha256(bytes),
      contentBase64: bytes.toString("base64"),
    });
  }
  return artifacts;
}

function hasExactRegisteredReportCoverage(report, requiredSteps, tier) {
  if (!report?.discovery || typeof report.discovery !== "object") return false;
  if (tier === "test-heavy") {
    const validation = report.discovery.validationSteps;
    const serial = report.discovery.serialSuites;
    return validation?.available === true &&
      validation.source === "scripts/validation-steps.mjs" &&
      Array.isArray(validation.names) && serial?.available === true &&
      serial.source === "test-heavy-serial.mjs" && Array.isArray(serial.names) &&
      canonicalJson(["PREFLIGHT", ...validation.names, ...serial.names]) === canonicalJson(requiredSteps);
  }
  const registered = report.discovery.registeredSteps;
  return registered?.available === true &&
    registered.source === "scripts/validation-steps.mjs" &&
    Array.isArray(registered.names) &&
    canonicalJson(registered.names) === canonicalJson(requiredSteps);
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function resolvePlanPath(projectRoot, reference) {
  if (typeof reference !== "string" || reference.trim() === "" || isAbsolute(reference) ||
      reference.includes("\\") || reference.split("/").some((part) => part === "" || part === "." || part === "..") ||
      /[\u0000-\u001f\u007f]/.test(reference)) {
    throw new Error("approved plan reference must be a safe project-relative path");
  }
  const root = resolve(projectRoot);
  const planPath = resolve(root, reference);
  if (!planPath.startsWith(`${root}${sep}`)) throw new Error("approved plan reference escapes the project root");
  return planPath;
}

export async function verifyApprovedPlanProjection({ projectRoot, task, suppliedPlanReference }) {
  if (suppliedPlanReference !== undefined && suppliedPlanReference !== task.planReference) {
    throw new Error("supplied plan reference does not match the task's exact approved plan reference");
  }
  const root = await realpath(resolve(projectRoot));
  const planPath = resolvePlanPath(root, task.planReference);
  const info = await lstat(planPath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("approved plan projection must be a regular tracked file");
  }
  const actualPath = await realpath(planPath);
  if (actualPath !== planPath || !actualPath.startsWith(`${root}${sep}`)) {
    throw new Error("approved plan projection resolves outside its project root");
  }

  let trackedPath;
  try {
    trackedPath = git(root, ["ls-files", "--error-unmatch", "--", task.planReference]);
  } catch {
    throw new Error("approved plan projection is not a tracked project-root file");
  }
  if (trackedPath !== task.planReference) throw new Error("tracked plan path did not resolve exactly");
  const content = await readFile(planPath, "utf8");
  const canonicalPlan = canonicalJson(task.plan);
  if (content !== canonicalPlan && content !== `${canonicalPlan}\n`) {
    throw new Error("tracked plan projection content differs from the exact approved canonical plan");
  }
  const projection = JSON.parse(content);
  if (projection.taskId !== task.taskId || projection.projectNamespace !== task.projectNamespace ||
      projection.planVersion !== task.planVersion || digestJson(projection) !== task.planDigest) {
    throw new Error("tracked plan identity, version, namespace, or digest does not match this local task");
  }
  return Object.freeze({
    reference: task.planReference,
    absolutePath: planPath,
    planVersion: task.planVersion,
    planDigest: task.planDigest,
  });
}

export class FailureGateCheckedRunner {
  constructor({ store }) {
    if (!store || typeof store.getTask !== "function" ||
        typeof store.recordBlockedRunAttempt !== "function") {
      throw new TypeError("FailureGateCheckedRunner requires a FailureGateStore");
    }
    this.store = store;
    this.projectRoot = resolve(store.projectRoot);
  }

  async requestRequiredValidation(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => !["taskId", "planReference"].includes(key))) {
      throw new Error("checked preflight rejects caller tier, parameters, and unsupported request fields");
    }
    const { taskId, planReference } = input;
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`unknown local Failure Gate task '${taskId}'`);
    if (task.status !== "active" || task.suspended || !task.authorizedTier) {
      throw new Error("required-tier execution requires an active, unsuspended local task");
    }
    const authorizationVersion = task.authorizationVersion;
    const projection = await verifyApprovedPlanProjection({
      projectRoot: this.projectRoot,
      task,
      suppliedPlanReference: planReference,
    });

    let tierPolicy;
    let validationPolicy;
    try {
      validationPolicy = getRegisteredValidationPolicy(this.projectRoot);
      tierPolicy = validationPolicy.tiers[task.authorizedTier];
      if (!tierPolicy) throw new Error("authorized tier is absent from the installed validation policy");
    } catch (error) {
      throw new Error(`required-tier policy is unavailable; execution denied: ${error.message}`);
    }
    if (tierPolicy.tierDefinitionDigest !== task.tierDefinitionDigest) {
      throw new Error("current registered tier, command, steps, or wrappers differ from the approved tier-definition digest");
    }
    if (task.registryVersion !== tierPolicy.registryDigest) {
      throw new Error("current validation registry digest differs from the activation registry version");
    }
    if (task.registryDigest !== tierPolicy.registryDigest ||
        task.wrapperDigest !== tierPolicy.wrapperDigest ||
        task.policySnapshotDigest !== validationPolicy.snapshotDigest ||
        canonicalJson(task.registeredTiers) !== canonicalJson(validationPolicy.registeredTiers)) {
      throw new Error("current registered tier list, registry, wrapper, or policy snapshot differs from activation");
    }

    const snapshot = await captureWorkspaceSnapshot(this.projectRoot);
    const reasons = [];
    if (!tierPolicy.reportAdapterKnown || !tierPolicy.reportAdapterId) {
      reasons.push("required_report_adapter_missing");
    } else {
      reasons.push("no_checked_executor_is_registered_for_the_report_adapter");
    }
    if (snapshot.manifest.integrity !== "observed-only") {
      reasons.push("snapshot_integrity_unknown");
    }
    reasons.push("writer_coordination_adapter_unavailable");

    // The existing tier commands stream human-oriented logs and do not expose
    // a complete machine report contract. No tier is launched until a versioned
    // parser can account for every step, raw result, and report artifact.
    const attempt = this.store.recordBlockedRunAttempt({
      taskId: task.taskId,
      expectedAuthorizationVersion: authorizationVersion,
      tier: task.authorizedTier,
      tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
      registryDigest: tierPolicy.registryDigest,
      wrapperDigest: tierPolicy.wrapperDigest,
      reportAdapterId: tierPolicy.reportAdapterId,
      stepNames: tierPolicy.selectedStepNames,
      snapshot,
      reasons,
    });
    return Object.freeze({
      taskId: task.taskId,
      attemptId: attempt.attemptId,
      purpose: attempt.purpose,
      status: "BLOCKED",
      commandLaunched: false,
      leaseAcquired: false,
      plan: projection,
      tier: task.authorizedTier,
      rawExitStatus: null,
      reportAdapterId: tierPolicy.reportAdapterId,
      snapshotDigest: attempt.snapshotDigest,
      snapshotIntegrity: attempt.snapshot.integrity,
      reasons: attempt.blockedReasons,
      stepResults: attempt.stepResults,
    });
  }

  /**
   * Experimental checked dispatch. The separate approved Markdown projection
   * preserves the existing plan guards and tier ceiling; the JSON projection
   * remains the v4 authorization identity. Neither a parsed console log nor
   * a passing exit code can establish test discovery or writer coverage.
   */
  async runRequiredValidation(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) => !["taskId", "planReference", "projectTask"].includes(key))) {
      throw new Error("checked execution rejects caller tier, parameters, and unsupported request fields");
    }
    const { taskId, planReference, projectTask } = input;
    const task = this.store.getTask(taskId);
    if (!task || task.status !== "active" || task.suspended) {
      throw new Error("checked execution requires an active local task");
    }
    checkedEnvironmentControls();
    let acceptedTaskSource = null;
    if (task.approvalSourceKind === "replit-project-task") {
      if (!projectTask) {
        throw new Error("checked execution for a Replit task requires a fresh Agent-side project-task snapshot");
      }
      acceptedTaskSource = verifyAcceptedProjectTaskBinding({
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
        throw new Error("checked execution requires the exact separate bootstrap approval recorded at activation");
      }
    } else if (projectTask !== undefined) {
      throw new Error("a project-task snapshot cannot replace the task's approved source");
    }
    await verifyApprovedPlanProjection({ projectRoot: this.projectRoot, task, suppliedPlanReference: planReference });
    const policy = getRegisteredValidationPolicy(this.projectRoot);
    const tier = policy.tiers[task.authorizedTier];
    if (!tier || !tier.reportAdapterKnown || tier.tierDefinitionDigest !== task.tierDefinitionDigest ||
        policy.snapshotDigest !== task.policySnapshotDigest) {
      throw new Error("approved tier, report adapter, or policy is unavailable or stale");
    }
    const planning = await validatePlanningGuards({
      task, tierPolicy: tier, registeredTiers: policy.registeredTiers,
      baselineCatalog: await loadTrackedBaselineCatalog({ projectRoot: this.projectRoot }),
      projectRoot: this.projectRoot,
    });
    if (!planning.ok) throw new Error(`checked execution requires passing plan guards: ${planning.errors.join("; ")}`);
    const markdown = task.plan.legacyPlan;
    if (!markdown || typeof markdown !== "object" ||
        typeof markdown.reference !== "string" || !/^[0-9a-f]{64}$/.test(markdown.sha256 ?? "")) {
      throw new Error("checked execution needs an approved, digest-bound legacy Markdown plan projection");
    }
    const markdownPath = resolvePlanPath(this.projectRoot, markdown.reference);
    const info = await lstat(markdownPath);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(markdownPath) !== markdownPath ||
        git(this.projectRoot, ["ls-files", "--error-unmatch", "--", markdown.reference]) !== markdown.reference) {
      throw new Error("approved legacy plan projection is not a regular tracked project file");
    }
    const markdownBytes = await readFile(markdownPath);
    if (sha256(markdownBytes) !== markdown.sha256) throw new Error("approved legacy plan projection has changed");
    const lockResult = runTierLockDryRun(markdownPath);
    if (lockResult.kind !== "ok" || lockResult.tierName !== task.authorizedTier) {
      throw new Error("approved Markdown plan does not authorize the exact local tier");
    }
    const commands = {
      "test-fast": ["tierFast", "fast"],
      "test-standard": ["tierStandard", "standard"],
      "test-standard-plus": ["tierStandardPlus", "full"],
      "test-heavy": ["aggregate", null],
    };
    const command = commands[task.authorizedTier];
    if (!command) throw new Error("no checked argv mapping for the authorized tier");
    const reportsDir = resolve(homedir(), ".failure-gate-v4", "runs");
    await mkdir(reportsDir, { recursive: true, mode: 0o700 });
    await chmod(reportsDir, 0o700);
    const reportPath = resolve(reportsDir, `${randomUUID()}.json`);
    const caseReportDirectory = `${reportPath}.cases`;
    await mkdir(caseReportDirectory, { recursive: true, mode: 0o700 });
    await chmod(caseReportDirectory, 0o700);
    const args = [
      "scripts/run-with-timeout.mjs", command[0], "--", process.execPath,
      command[1] === null ? "scripts/test-heavy-serial.mjs" : "scripts/run-tier.mjs",
      ...(command[1] === null ? [] : [command[1]]),
      "--report", reportPath,
    ];
    const coordinator = new FailureGateCoordinator({ store: this.store });
    const lockPath = resolve(homedir(), ".failure-gate-v4", "writer.lock");
    return withWriterLock(lockPath, async ({ fd }) => {
      // A writer lock is useful only for participating writers. Existing editor
      // and codegen routes do not all participate, so this snapshot stays unknown.
      const capturedBefore = await captureWorkspaceSnapshot(this.projectRoot);
      const withEnvironment = this.#withRunEnvironment(capturedBefore, checkedEnvironmentIdentity());
      const before = acceptedTaskSource
        ? this.#withAcceptedTaskSource(withEnvironment, acceptedTaskSource)
        : withEnvironment;
      const attempt = coordinator.beginRunAttempt({
        taskId, expectedAuthorizationVersion: task.authorizationVersion,
        snapshot: before, inputDigest: before.manifestDigest,
      });
      let code = null;
      let signal = null;
      const output = createHash("sha256");
      const secretValues = Object.entries(process.env)
        .filter(([name, value]) =>
          /SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE|KEY|DATABASE|AUTH|COOKIE|DSN|CONNECTION|ACCESS|SESSION|API|URL/i.test(name) &&
          typeof value === "string" && value.length > 0)
        .map(([, value]) => value);
      secretValues.push("e2e-playwright-secret");
      const stdout = makeStreamCapture("stdout", secretValues);
      const stderr = makeStreamCapture("stderr", secretValues);
      let child = null;
      let childProcessIdentity = null;
      let heartbeatTimer = null;
      let heartbeatPromise = null;
      let heartbeatError = null;
      let heartbeatForceKillTimer = null;
      try {
        ({ code, signal } = await new Promise((accept, reject) => {
          child = spawn(process.execPath, args, {
            cwd: this.projectRoot,
            env: {
              ...process.env,
              TASK_PLAN_FILE: markdownPath,
              FAILURE_GATE_TEST_CASE_REPORT_DIR: caseReportDirectory,
              FAILURE_GATE_VALIDATION_TIER: task.authorizedTier,
            },
            stdio: ["ignore", "pipe", "pipe", fd],
            detached: process.platform === "linux",
          });
          child.stdout.on("data", (chunk) => {
            output.update(chunk);
            stdout.update(chunk);
          });
          child.stderr.on("data", (chunk) => {
            output.update(chunk);
            stderr.update(chunk);
          });
          child.once("error", reject);
          child.once("close", (exitCode, exitSignal) => {
            accept({ code: exitCode, signal: exitSignal });
          });
          childProcessIdentity = captureRunProcessIdentity(child.pid);
          this.store.recordRunProcessIdentity({
            attemptId: attempt.attemptId,
            identity: childProcessIdentity,
          });
          heartbeatTimer = setInterval(() => {
            if (heartbeatPromise || heartbeatError) return;
            heartbeatPromise = coordinator.heartbeatRunAttempt({ attemptId: attempt.attemptId })
              .catch((error) => {
                heartbeatError = error;
                signalRunProcessGroup(childProcessIdentity, "SIGTERM");
                heartbeatForceKillTimer = setTimeout(
                  () => signalRunProcessGroup(childProcessIdentity, "SIGKILL"),
                  2_000,
                );
                heartbeatForceKillTimer.unref?.();
              })
              .finally(() => { heartbeatPromise = null; });
            process.stdout.write(
              `[checked-run progress] stdoutBytes=${stdout.bytes} stderrBytes=${stderr.bytes}\n`,
            );
          }, 5_000);
        }));
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (heartbeatPromise) await heartbeatPromise;
        if (heartbeatError) throw new Error("run lease heartbeat failed; subprocess was stopped and the attempt requires reconciliation");
        if (!await ensureRunProcessGroupStopped(childProcessIdentity)) {
          throw new Error("checked subprocess group remained live after its launcher exited");
        }
        if (heartbeatForceKillTimer) clearTimeout(heartbeatForceKillTimer);

        const stdoutEvidence = stdout.finish();
        const stderrEvidence = stderr.finish();
        let report = null;
        let rawStepReport = null;
        try {
          const reportInfo = await lstat(reportPath);
          if (!reportInfo.isFile() || reportInfo.isSymbolicLink() ||
              reportInfo.size > MAX_STEP_REPORT_BYTES || await realpath(reportPath) !== reportPath) {
            throw new Error("step report is unsafe or exceeds the bounded size");
          }
          const bytes = await readFile(reportPath);
          const content = bytes.toString("utf8");
          rawStepReport = {
            schemaVersion: 1,
            reference: reportPath,
            digest: sha256(bytes),
            contentBase64: bytes.toString("base64"),
            validated: false,
          };
          if (!Buffer.from(content, "utf8").equals(bytes)) throw new Error("step report is not valid UTF-8");
          report = validateStepReport(JSON.parse(bytes.toString("utf8")));
          rawStepReport.validated = true;
        } catch { /* Missing or malformed reports are incomplete, never synthesized. */ }
        const names = tier.selectedStepNames;
        const expectsTestCases = names.some((name) =>
          ["test:unit", "test:e2e", "e2e-palette"].includes(name));
        const testCaseDiscovery = await collectTestCaseDiscovery(
          caseReportDirectory,
          { required: expectsTestCases },
        );
        let boundCaseReports = [];
        let boundCaseReportsAvailable = false;
        try {
          const loaded = await loadTestCaseReports(caseReportDirectory);
          boundCaseReports = loaded.reports;
          boundCaseReportsAvailable = true;
        } catch { /* Missing or malformed bound reports are incomplete. */ }
        let discoveryArtifacts = [];
        let discoveryArtifactsAvailable = true;
        try {
          discoveryArtifacts = await captureCaseArtifacts(caseReportDirectory);
        } catch {
          discoveryArtifactsAvailable = false;
        }
        const discovery = {
          schemaVersion: 1,
          reportReference: reportPath,
          summary: testCaseDiscovery,
          artifactsAvailable: discoveryArtifactsAvailable,
          artifacts: discoveryArtifacts,
          digest: digestJson({
            reportReference: reportPath,
            summary: testCaseDiscovery,
            artifactsAvailable: discoveryArtifactsAvailable,
            artifacts: discoveryArtifacts.map(({ reference, digest }) => ({ reference, digest })),
          }),
        };
        const capturedAfter = await captureWorkspaceSnapshot(this.projectRoot);
        const withAfterEnvironment = this.#withRunEnvironment(capturedAfter, checkedEnvironmentIdentity());
        const after = acceptedTaskSource
          ? this.#withAcceptedTaskSource(withAfterEnvironment, acceptedTaskSource)
          : withAfterEnvironment;
        const testCaseEvidenceMatches = report?.discovery?.testCases &&
          canonicalJson(report.discovery.testCases) === canonicalJson(testCaseDiscovery);
        const completeStructure = report && report.runner === (command[1] === null ? "test-heavy-serial" : "run-tier") &&
          report.tier === (command[1] ?? task.authorizedTier) &&
          report.steps.length === names.length &&
          report.steps.every((step, index) => step.name === names[index]) &&
          report.steps.every((step) =>
            ["passed", "failed"].includes(step.status) &&
            (Number.isInteger(step.rawExitStatus) || typeof step.signal === "string")) &&
          hasExactRegisteredReportCoverage(report, names, task.authorizedTier) &&
          testCaseEvidenceMatches &&
          (expectsTestCases
            ? testCaseDiscovery.available && testCaseDiscovery.caseCount > 0 &&
              boundCaseReportsAvailable &&
              hasExactRegisteredCaseCoverage(boundCaseReports, names, task.authorizedTier)
            : testCaseDiscovery.notApplicable === true) &&
          rawStepReport && discoveryArtifactsAvailable &&
          Number.isInteger(report.rawExitStatus) && report.rawExitStatus === code && signal === null &&
          before.manifestDigest === after.manifestDigest &&
          before.manifest.integrity !== "unknown" && after.manifest.integrity !== "unknown";
        const evidence = {
          schemaVersion: 2,
          complete: Boolean(completeStructure),
          authorizationDigest: attempt.authorizationDigest,
          inputDigest: attempt.inputDigest,
          rawExitStatus: code,
          rawOutputDigest: output.digest("hex"),
          streams: {
            stdout: stdoutEvidence,
            stderr: stderrEvidence,
          },
          rawStepReport,
          discovery,
          executionEnvironment: checkedEnvironmentIdentity(),
          stepResults: names.map((stepName) => {
            const step = report?.steps.find((item) => item.name === stepName);
            return {
              stepName,
              rawExitStatus: step?.rawExitStatus ?? null,
              reportReference: step && rawStepReport ? reportPath : null,
              reportDigest: step && rawStepReport ? rawStepReport.digest : null,
            };
          }),
        };
        const finished = coordinator.finishRunAttempt({
          attemptId: attempt.attemptId,
          outcome: completeStructure ? "completed" : "failed",
          evidence,
          ...(!completeStructure ? {
            reason: code !== 0 || signal !== null
              ? "required validation subprocess failed"
              : "reports, discovery, environment, or registered coverage were incomplete",
          } : {}),
        });
        const assessment = this.store.assessRunAttempt({
          taskId: task.taskId,
          attemptId: attempt.attemptId,
        });
        return {
          taskId, attemptId: attempt.attemptId, tier: task.authorizedTier,
          status: assessment.status,
          structurallyComplete: Boolean(completeStructure),
          assessment,
          rawExitStatus: code, signal, reportReference: rawStepReport?.reference ?? null,
          snapshotDigest: before.manifestDigest, stepResults: finished.stepResults,
        };
      } catch (error) {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          if (childProcessIdentity) {
            await ensureRunProcessGroupStopped(childProcessIdentity);
          } else if (child?.pid && process.platform === "linux") {
            signalRunProcessGroup({ processGroupId: child.pid }, "SIGTERM");
            const forceKill = setTimeout(() => {
              try { signalRunProcessGroup({ processGroupId: child.pid }, "SIGKILL"); } catch { /* Leave the lease quarantined. */ }
            }, 2_000);
            forceKill.unref?.();
          }
        } catch { /* Keep the lease quarantined whenever stop confirmation is uncertain. */ }
        if (heartbeatForceKillTimer) clearTimeout(heartbeatForceKillTimer);
        // A child that may still be alive must not have its lease blindly
        // released. Explicit quarantine and stopped-process reconciliation are
        // required before another launch.
        coordinator.quarantineOrphanedRunAttempt({
          attemptId: attempt.attemptId,
          reason: "checked runner interrupted; process state requires explicit reconciliation",
        });
        throw error;
      }
    });
  }

  #withAcceptedTaskSource(snapshot, source) {
    return withAcceptedTaskSource(snapshot, source);
  }

  #withRunEnvironment(snapshot) {
    return withRunEnvironment(snapshot);
  }
}