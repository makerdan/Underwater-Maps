import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { canonicalJson, digestJson, sha256 } from "../failure-gate-v4/canonical.mjs";
import { FailureGateCoordinator, FailureGateStore } from "../failure-gate-v4/coordinator.mjs";
import { captureWorkspaceSnapshot } from "../failure-gate-v4/snapshot.mjs";
import { withRunEnvironment } from "../failure-gate-v4/run-context.mjs";
import {
  getRegisteredTierPolicy, getRegisteredValidationPolicy, TIER_POLICY_FILES,
} from "../failure-gate-v4/policy.mjs";
import { assertRecordedRunStopped, captureRunProcessIdentity } from "../failure-gate-v4/recovery.mjs";

const scratch = mkdtempSync(join(tmpdir(), "failure-gate-v4-lifecycle-"));
const retainedArtifactRoots = new Set();
const activeTestChildren = new Set();
after(async () => {
  for (const { child, identity } of activeTestChildren) {
    try { process.kill(-(identity?.processGroupId ?? child.pid), "SIGKILL"); } catch { /* Already stopped. */ }
    if (child.exitCode === null && child.signalCode === null) {
      try { await once(child, "close"); } catch { /* Preserve teardown progress. */ }
    }
  }
  for (const path of retainedArtifactRoots) rmSync(path, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createContext(name) {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Failure Gate lifecycle test");
  git(root, "config", "user.email", "failure-gate-test@example.invalid");
  writeJson(join(root, ".agents/failure-gate-v4/reviewers.json"), {
    reviewers: [{ id: "admin", active: true }, { id: "Dan", active: true }],
  });
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "review roster");
  const sourceRoot = join(import.meta.dirname, "../..");
  for (const file of TIER_POLICY_FILES) {
    const target = join(root, file);
    mkdirSync(join(target, ".."), { recursive: true });
    copyFileSync(join(sourceRoot, file), target);
  }
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "validation policy");
  const store = new FailureGateStore({
    projectNamespace: `test:${name}`,
    databasePath: join(scratch, `${name}.sqlite`),
    projectRoot: root,
  });
  return { root, store, coordinator: new FailureGateCoordinator({ store }) };
}

function approvedTask(context, title, baselines = undefined) {
  const { root, store, coordinator } = context;
  const tierPolicy = getRegisteredTierPolicy(root, "test-fast");
  const task = store.reserveTask({
    plan: {
      title, validation: { obligations: ["all registered fast steps"] },
      ...(baselines ? { baselines } : {}),
    },
    tier: "test-fast",
    tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
  });
  const policy = getRegisteredValidationPolicy(root);
  const decision = {
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
    decision: "approved",
    activationScope: "installation-demonstration",
    reviewerId: "admin",
    reference: "test:reviewed-exact-plan",
  };
  writeJson(join(root, `.agents/failure-gate-v4/decisions/${task.taskId}.json`), decision);
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", `approve ${task.taskId}`);
  const revision = git(root, "rev-parse", "HEAD");
  const active = coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "test-agent",
  });
  return { task: active, tierPolicy };
}

function fixtureRunSnapshot(runContext, writerCoordination = true) {
  const manifest = {
    integrity: "verified",
    ...(writerCoordination ? {
      writerCoordination: {
        status: "verified",
        adapterId: "fixture-run-evidence-only-v1",
        evidenceDigest: "e".repeat(64),
      },
    } : {}),
    files: [{ path: "src/input.mjs", digest: "a".repeat(64) }],
  };
  return {
    ...runContext,
    manifest,
    manifestContent: canonicalJson(manifest),
    manifestDigest: digestJson(manifest),
  };
}

async function startAttempt(context, task, { writerCoordination = true } = {}) {
  const captured = await captureWorkspaceSnapshot(context.root);
  const runContext = withRunEnvironment(captured);
  return context.coordinator.beginRunAttempt({
    taskId: task.taskId,
    expectedAuthorizationVersion: task.authorizationVersion,
    inputDigest: digestJson({ inputs: "captured-for-this-run" }),
    snapshot: fixtureRunSnapshot(runContext, writerCoordination),
  });
}

async function launchStoppedChildGroup(context, attempt, { stop = true } = {}) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  const childRecord = { child, identity: null };
  activeTestChildren.add(childRecord);
  child.once("close", () => activeTestChildren.delete(childRecord));
  await once(child, "spawn");
  const identity = captureRunProcessIdentity(child.pid);
  childRecord.identity = identity;
  context.store.recordRunProcessIdentity({ attemptId: attempt.attemptId, identity });
  if (stop) await stopChildGroup(child, identity);
  return { child, identity };
}

async function stopChildGroup(child, identity) {
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close");
    try {
      process.kill(-identity.processGroupId, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await closed;
  }
  assertRecordedRunStopped(identity);
}

function createRunArtifacts(attempt, { failed = false } = {}) {
  const runRoot = join(homedir(), ".failure-gate-v4", "runs");
  mkdirSync(join(homedir(), ".failure-gate-v4"), { recursive: true, mode: 0o700 });
  chmodSync(join(homedir(), ".failure-gate-v4"), 0o700);
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  chmodSync(runRoot, 0o700);
  const reportPath = join(runRoot, `${randomUUID()}.json`);
  const caseDirectory = `${reportPath}.cases`;
  mkdirSync(caseDirectory, { recursive: true, mode: 0o700 });
  chmodSync(caseDirectory, 0o700);
  retainedArtifactRoots.add(reportPath);
  retainedArtifactRoots.add(caseDirectory);

  const startedAt = "2026-09-30T12:00:00.000Z";
  const summary = {
    schemaVersion: 1,
    available: false,
    notApplicable: true,
    reason: "this tier has no registered test-case suite",
    caseCount: 0,
    allPassed: false,
    reports: [],
  };
  const steps = attempt.stepResults.map(({ stepName }, index) => {
    const failedStep = failed && index === 0;
    return {
      name: stepName,
      phase: "validation",
      status: failedStep ? "failed" : "passed",
      rawExitStatus: failedStep ? 1 : 0,
      signal: null,
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      discovery: null,
      reason: failedStep ? "fixture validation step failed" : null,
    };
  });
  const report = {
    schemaVersion: 1,
    runner: "run-tier",
    tier: "fast",
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    rawExitStatus: failed ? 1 : 0,
    discovery: {
      registeredSteps: {
        available: true,
        source: "scripts/validation-steps.mjs",
        names: attempt.stepResults.map(({ stepName }) => stepName),
      },
      testCases: summary,
    },
    steps,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, reportBytes, { mode: 0o600 });
  const reportDigest = sha256(reportBytes);
  const discovery = {
    schemaVersion: 1,
    reportReference: reportPath,
    summary,
    artifactsAvailable: true,
    artifacts: [],
    digest: digestJson({
      reportReference: reportPath,
      summary,
      artifactsAvailable: true,
      artifacts: [],
    }),
  };
  const emptyDigest = sha256(Buffer.alloc(0));
  return {
    rawExitStatus: failed ? 1 : 0,
    rawOutputDigest: emptyDigest,
    streams: {
      stdout: { bytes: 0, digest: emptyDigest, safeText: "", truncated: false },
      stderr: { bytes: 0, digest: emptyDigest, safeText: "", truncated: false },
    },
    rawStepReport: {
      schemaVersion: 1,
      reference: reportPath,
      digest: reportDigest,
      contentBase64: reportBytes.toString("base64"),
      validated: true,
    },
    discovery,
    executionEnvironment: {
      schemaVersion: 1,
      ci: { present: false },
      e2e: {},
      nodeOptionsConfigured: false,
    },
    stepResults: steps.map((step) => ({
      stepName: step.name,
      rawExitStatus: step.rawExitStatus,
      reportReference: reportPath,
      reportDigest,
    })),
  };
}

function evidenceFor(attempt) {
  return {
    schemaVersion: 2,
    complete: true,
    authorizationDigest: attempt.authorizationDigest,
    inputDigest: attempt.inputDigest,
    ...createRunArtifacts(attempt),
  };
}

function failedEvidenceFor(attempt) {
  return {
    schemaVersion: 2,
    complete: false,
    authorizationDigest: attempt.authorizationDigest,
    inputDigest: attempt.inputDigest,
    ...createRunArtifacts(attempt, { failed: true }),
  };
}

test("run lease start is audited and exclusive; orphan quarantine holds the lease until actual stopped-process recovery", async () => {
  const context = createContext("orphan");
  const { task } = approvedTask(context, "quarantine unresolved run leases");
  const started = await startAttempt(context, task);
  const child = await launchStoppedChildGroup(context, started, { stop: false });
  assert.equal(started.status, "incomplete");
  assert.equal(started.lifecycleState, "running");
  assert.equal(started.leaseAcquired, true);
  assert.ok(context.store.auditEvents(task.taskId).some((event) =>
    event.action === "required_run_started" && event.details.attemptId === started.attemptId,
  ));
  await assert.rejects(startAttempt(context, task), /already has active or quarantined run/);

  const quarantined = context.coordinator.quarantineOrphanedRunAttempt({
    attemptId: started.attemptId,
    reason: "coordinator restarted without process-death proof",
  });
  assert.equal(quarantined.lifecycleState, "orphaned");
  await assert.rejects(startAttempt(context, task), /already has active or quarantined run/);
  await assert.rejects(context.coordinator.reconcileOrphanedRunAttempt({
    attemptId: started.attemptId,
    confirmedStopped: false,
    resolution: "cancelled",
    reason: "not verified",
  }), /caller overrides are not permitted/);
  await assert.rejects(context.coordinator.reconcileOrphanedRunAttempt({
    attemptId: started.attemptId,
    resolution: "cancelled",
    reason: "child is still live",
  }), /checked launcher is still running|process-group member is still running/);
  await stopChildGroup(child.child, child.identity);
  const reconciled = await context.coordinator.reconcileOrphanedRunAttempt({
    attemptId: started.attemptId,
    resolution: "cancelled",
    reason: "the recorded child process group was stopped and verified",
  });
  assert.equal(reconciled.lifecycleState, "released");
  assert.equal(reconciled.releaseTombstone.outcome, "cancelled");
  assert.equal(reconciled.evidence.complete, false);
  assert.ok(reconciled.evidence.stepResults.every((step) => step.rawExitStatus === null));
  assert.ok(context.store.auditEvents(task.taskId).some((event) =>
    event.action === "required_run_finished" && event.details.outcome === "cancelled",
  ));
  context.store.close();
});

test("completion retains full report evidence, rejects caller labels, and blocks unverified final snapshots", async () => {
  const context = createContext("completion");
  const { task } = approvedTask(context, "complete only from explicit run evidence");
  const attempt = await startAttempt(context, task);
  await launchStoppedChildGroup(context, attempt);
  const evidence = evidenceFor(attempt);
  assert.throws(() => context.coordinator.finishRunAttempt({
    attemptId: attempt.attemptId,
    outcome: "completed",
    evidence: { ...evidence, status: "PASS" },
  }), /caller result labels are not evidence/);
  assert.throws(() => context.coordinator.finishRunAttempt({
    attemptId: attempt.attemptId,
    outcome: "completed",
    evidence: { ...evidence, schemaVersion: 1 },
  }), /does not match the exact registered report adapter/);
  assert.throws(() => context.coordinator.finishRunAttempt({
    attemptId: attempt.attemptId,
    outcome: "completed",
    evidence: { ...evidence, inputDigest: "d".repeat(64) },
  }), /does not match the trusted authorization and input digests/);
  assert.throws(() => context.coordinator.finishRunAttempt({
    attemptId: attempt.attemptId,
    outcome: "completed",
    evidence: { ...evidence, discovery: null },
  }), /complete evidence is missing test discovery and artifact digests/);
  assert.equal(context.store.getTask(task.taskId).status, "active");
  assert.equal(context.store.validationAttempts(task.taskId)[0].lifecycleState, "running");

  const finished = context.coordinator.finishRunAttempt({
    attemptId: attempt.attemptId,
    outcome: "completed",
    evidence,
  });
  assert.equal(finished.lifecycleState, "released");
  assert.equal(finished.status, "finished");
  assert.deepEqual(finished.evidence, evidence);
  assert.equal(finished.evidenceDigest, digestJson(evidence));
  assert.equal(finished.releaseTombstone.outcome, "completed");
  assert.equal(context.store.getTask(task.taskId).status, "active");
  assert.equal(context.store.getTask(task.taskId).authorizedTier, task.authorizedTier);
  const stored = context.store.getStoredRunRecord({
    taskId: task.taskId,
    attemptId: attempt.attemptId,
  });
  assert.deepEqual(Object.keys(stored).sort(), ["attempt", "evidence", "task"]);
  assert.equal(stored.task.taskId, task.taskId);
  assert.equal(stored.attempt.attemptId, attempt.attemptId);
  assert.equal(stored.evidence.schemaVersion, 2);
  assert.equal(context.store.getStoredRunRecord({
    taskId: "TASK-999999",
    attemptId: attempt.attemptId,
  }), null);
  assert.throws(() => context.store.getStoredRunRecord({
    taskId: task.taskId,
    attemptId: attempt.attemptId,
    status: "PASS",
  }), /accepts only taskId and attemptId/);
  const assessment = context.store.assessRunAttempt({
    taskId: task.taskId, attemptId: attempt.attemptId,
  });
  assert.equal(assessment.status, "PASS");
  assert.equal(assessment.eligible, true);
  assert.ok(context.store.auditEvents(task.taskId).some((event) =>
    event.action === "stored_run_obligations_assessed" &&
    event.details.assessmentDigest === digestJson(assessment)));
  assert.throws(() => context.store.assessRunAttempt({
    taskId: task.taskId, attemptId: attempt.attemptId, verdict: "PASS",
  }), /not caller verdicts/);
  await assert.rejects(context.coordinator.completeTask({
    taskId: task.taskId,
    attemptId: attempt.attemptId,
    expectedAuthorizationVersion: task.authorizationVersion,
    authorizationDigest: attempt.authorizationDigest,
    inputDigest: attempt.inputDigest,
  }), /final snapshot integrity or effective writer coordination is unverified/);
  assert.equal(context.store.getTask(task.taskId).status, "active");
  assert.ok(context.store.auditEvents(task.taskId).some((event) => event.action === "completion_blocked"));
  writeFileSync(evidence.rawStepReport.reference, `${evidence.rawStepReport.contentBase64}tampered`);
  assert.throws(() => context.store.assessRunAttempt({
    taskId: task.taskId, attemptId: attempt.attemptId,
  }), /raw step report content, digest, and checked artifact do not match/);
  await assert.rejects(context.coordinator.completeTask({
    taskId: task.taskId,
    attemptId: attempt.attemptId,
    expectedAuthorizationVersion: task.authorizationVersion,
    authorizationDigest: attempt.authorizationDigest,
    inputDigest: attempt.inputDigest,
  }), /raw step report content, digest, and checked artifact do not match/);
  context.store.close();
});

test("stored assessment cannot clear an owned repair from all-pass or undiscovered case evidence", async () => {
  const context = createContext("owned-assessment");
  const { task } = approvedTask(context, "retain owned obligations", {
    owned: [{ id: "BASE-OWNED", owner: "fixture-owner" }],
    ignore: [],
  });
  const attempt = await startAttempt(context, task);
  await launchStoppedChildGroup(context, attempt);
  context.coordinator.finishRunAttempt({
    attemptId: attempt.attemptId, outcome: "completed", evidence: evidenceFor(attempt),
  });
  const assessment = context.store.assessRunAttempt({
    taskId: task.taskId, attemptId: attempt.attemptId,
  });
  assert.equal(assessment.status, "BLOCKED");
  assert.equal(assessment.eligible, false);
  assert.equal(assessment.ownedObligations[0].baselineId, "BASE-OWNED");
  await assert.rejects(context.coordinator.completeTask({
    taskId: task.taskId, attemptId: attempt.attemptId,
    expectedAuthorizationVersion: task.authorizationVersion,
    authorizationDigest: attempt.authorizationDigest, inputDigest: attempt.inputDigest,
  }), /completion obligations remain unresolved/);
  assert.equal(context.store.getTask(task.taskId).status, "active");
  assert.ok(context.store.auditEvents(task.taskId).some((event) =>
    event.action === "completion_obligations_assessed" &&
    event.details.assessment.ownedObligations[0].status === "unresolved"));
  context.store.close();
});

test("unverified writer coordination can never complete a task", async () => {
  const context = createContext("writer-coordination");
  const { task } = approvedTask(context, "fail completion without coordinated writers");
  const attempt = await startAttempt(context, task, { writerCoordination: false });
  await launchStoppedChildGroup(context, attempt);
  assert.throws(() => context.coordinator.finishRunAttempt({
    attemptId: attempt.attemptId,
    outcome: "completed",
    evidence: evidenceFor(attempt),
  }), /writer coordination is not verified/);
  assert.equal(context.store.getTask(task.taskId).status, "active");
  const released = context.coordinator.finishRunAttempt({
    attemptId: attempt.attemptId,
    outcome: "failed",
    reason: "completion blocked because writers are not coordinated",
    evidence: failedEvidenceFor(attempt),
  });
  assert.equal(released.lifecycleState, "released");
  context.store.close();
});

test("failure releases the run lease without falsely completing; terminal cancellation leaves an audited tombstone", async () => {
  const context = createContext("failure");
  const { task } = approvedTask(context, "retain failure and cancellation history");
  const attempt = await startAttempt(context, task);
  await launchStoppedChildGroup(context, attempt);
  const failed = context.coordinator.finishRunAttempt({
    attemptId: attempt.attemptId,
    outcome: "failed",
    reason: "raw check failed",
    evidence: failedEvidenceFor(attempt),
  });
  assert.equal(failed.lifecycleState, "released");
  assert.equal(failed.releaseTombstone.outcome, "failed");
  assert.equal(failed.rawExitStatus, 1);
  assert.equal(failed.stepResults[0].rawExitStatus, 1);
  assert.ok(failed.stepResults.every((step) => step.rawReportReference && step.reportDigest));
  assert.equal(context.store.getTask(task.taskId).status, "active");
  assert.throws(() => context.coordinator.terminateTask({
    taskId: task.taskId,
    status: "cancelled",
    expectedAuthorizationVersion: task.authorizationVersion - 1,
    reason: "stale cancellation",
  }), /stale authorization version/);
  const cancelled = context.coordinator.terminateTask({
    taskId: task.taskId,
    status: "cancelled",
    expectedAuthorizationVersion: task.authorizationVersion,
    reason: "operator cancelled task",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.authorizedTier, null);
  assert.ok(context.store.auditEvents(task.taskId).some((event) =>
    event.action === "cancelled_terminal_release" && event.details.reason === "operator cancelled task",
  ));
  context.store.close();
});