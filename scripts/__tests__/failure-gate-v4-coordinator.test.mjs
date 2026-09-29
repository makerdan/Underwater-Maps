import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { canonicalJson, digestJson } from "../failure-gate-v4/canonical.mjs";
import { FailureGateCoordinator, FailureGateStore } from "../failure-gate-v4/coordinator.mjs";
import {
  getRegisteredTierPolicy, getRegisteredValidationPolicy, TIER_POLICY_FILES,
} from "../failure-gate-v4/policy.mjs";
import { FailureGateCheckedRunner, verifyApprovedPlanProjection } from "../failure-gate-v4/runner.mjs";
import { defaultDatabasePath } from "../failure-gate-v4/store.mjs";

const scratch = mkdtempSync(join(tmpdir(), "failure-gate-v4-coordinator-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function initReviewRepo(path) {
  mkdirSync(path, { recursive: true });
  git(path, "init", "--quiet");
  git(path, "config", "user.name", "Failure Gate test fixture");
  git(path, "config", "user.email", "failure-gate-test@example.invalid");
  writeJson(join(path, ".agents/failure-gate-v4/reviewers.json"), {
    reviewers: [
      { id: "admin", active: true },
      { id: "Dan", active: true },
    ],
  });
  git(path, "add", ".");
  git(path, "commit", "--quiet", "-m", "reviewer roster fixture");
}

function createTask(store) {
  const tierPolicy = getRegisteredTierPolicy(store.projectRoot, "test-standard");
  return store.reserveTask({
    plan: {
      title: "Prove the coordinator's reserved task contract",
      validation: { rationale: "Focused coordinator unit coverage", requirements: ["one registered tier"] },
    },
    planReference: "coordinator-record",
    tier: "test-standard",
    tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
    parameters: { mode: "required-tier-validation" },
  });
}

function decisionFor(task, projectRoot, overrides = {}) {
  const policy = getRegisteredValidationPolicy(projectRoot);
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
    decision: "approved",
    reviewerId: "admin",
    reference: "conversation:reviewed-exact-plan",
    ...overrides,
  };
}

function commitDecision(repo, task, overrides = {}) {
  writeJson(join(repo, `.agents/failure-gate-v4/decisions/${task.taskId}.json`), decisionFor(task, repo, overrides));
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", `review ${task.taskId}`);
  return git(repo, "rev-parse", "HEAD");
}

function createContext(name) {
  const root = join(scratch, name);
  const databasePath = join(scratch, `${name}-runtime.sqlite`);
  initReviewRepo(root);
  installPolicyFixture(root);
  const store = new FailureGateStore({
    projectNamespace: `test:${name}`,
    databasePath,
    projectRoot: root,
  });
  const coordinator = new FailureGateCoordinator({ store });
  return { root, databasePath, store, coordinator };
}

function installPolicyFixture(root) {
  const projectRoot = join(import.meta.dirname, "../..");
  for (const file of TIER_POLICY_FILES) {
    const target = join(root, file);
    mkdirSync(join(target, ".."), { recursive: true });
    copyFileSync(join(projectRoot, file), target);
  }
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "validation policy fixture");
}

function createApprovedRunnerTask(context, { planReference = "plans/task.json", title = "Runner evidence fixture" } = {}) {
  const { root, store, coordinator } = context;
  const tierPolicy = getRegisteredTierPolicy(root, "test-fast");
  const task = store.reserveTask({
    plan: { title, validation: { tier: "test-fast", obligations: ["all registered fast steps"] } },
    planReference,
    tier: "test-fast",
    tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
    parameters: {},
  });
  const projectionPath = join(root, planReference);
  mkdirSync(join(projectionPath, ".."), { recursive: true });
  writeFileSync(projectionPath, `${canonicalJson(task.plan)}\n`);
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", `project ${task.taskId} plan`);
  const revision = commitDecision(root, task);
  const activated = coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "validation-task-agent",
  });
  return { task, activated, tierPolicy };
}

test("canonical JSON digests ignore object insertion order and reject non-JSON plan values", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.equal(digestJson({ a: 1, b: [2, 3] }), digestJson({ b: [2, 3], a: 1 }));
  assert.throws(() => canonicalJson({ invalid: Number.NaN }), /non-finite/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /circular/);
});

test("the default durable database path is project-local but outside the project and .local", () => {
  const projectRoot = join(import.meta.dirname, "../..");
  const databasePath = defaultDatabasePath({ projectRoot, projectNamespace: "scope-test" });
  assert.equal(databasePath.startsWith(`${projectRoot}/`), false);
  assert.equal(databasePath.includes("/.local/"), false);
  assert.match(databasePath, /\.failure-gate-v4\/[0-9a-f]{64}\.sqlite$/);
});

test("reservations are durable and monotonic; only activation gives one registered tier", () => {
  const { root, databasePath, store, coordinator } = createContext("allocator");
  const first = createTask(store);
  assert.equal(first.taskId, "TASK-000001");
  assert.equal(first.status, "draft");
  assert.equal(first.plan.taskId, first.taskId);
  assert.equal(first.plan.projectNamespace, "test:allocator");
  assert.deepEqual(store.tierStatuses(first.taskId), {
    "test-fast": "NOT ALLOWED",
    "test-standard": "NOT ALLOWED",
    "test-standard-plus": "NOT ALLOWED",
    "test-heavy": "NOT ALLOWED",
  });
  coordinator.close();
  store.close();

  const reopened = new FailureGateStore({
    projectNamespace: "test:allocator",
    databasePath,
    projectRoot: root,
  });
  const second = createTask(reopened);
  assert.equal(second.taskId, "TASK-000002");
  assert.equal(reopened.getTask(first.taskId).status, "draft");
  assert.throws(() => new FailureGateStore({
    projectNamespace: "other-project",
    databasePath,
    projectRoot: root,
  }), /namespace mismatch/);
  reopened.close();
});

test("activation reads roster and decision from one pinned Git commit and audits derived status", () => {
  const { root, store, coordinator } = createContext("pinned-review");
  const task = createTask(store);
  const originalRevision = commitDecision(root, task);

  // Move the branch after the approved snapshot: activation still reads both
  // reviewer authority and decision from the supplied immutable commit.
  writeJson(join(root, ".agents/failure-gate-v4/reviewers.json"), {
    reviewers: [{ id: "Dan", active: true }],
  });
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "move current roster after reviewed snapshot");
  assert.notEqual(git(root, "rev-parse", "HEAD"), originalRevision);

  assert.throws(() => coordinator.activateTask({
    taskId: task.taskId,
    revision: originalRevision,
    taskAgent: "admin",
  }), /task agent cannot review/);
  assert.equal(store.getTask(task.taskId).status, "draft");

  const activated = coordinator.activateTask({
    taskId: task.taskId,
    revision: originalRevision,
    taskAgent: "task-agent-17",
  });
  assert.equal(activated.status, "active");
  assert.equal(activated.authorizedTier, "test-standard");
  assert.equal(activated.authorizationVersion, 1);
  assert.equal(activated.approvalSourceRevision, originalRevision);
  assert.equal(activated.approval.reviewerId, "admin");
  assert.equal(activated.approval.identityAttestation, undefined);
  assert.deepEqual(store.tierStatuses(task.taskId), {
    "test-fast": "NOT ALLOWED",
    "test-standard": "ALLOWED",
    "test-standard-plus": "NOT ALLOWED",
    "test-heavy": "NOT ALLOWED",
  });

  const activationEvent = store.auditEvents(task.taskId).find((event) => event.action === "activated");
  assert.ok(activationEvent);
  assert.equal(activationEvent.details.approvalSourceRevision, originalRevision);
  assert.deepEqual(activationEvent.details.tierStatuses, {
    "test-fast": "NOT ALLOWED",
    "test-standard": "ALLOWED",
    "test-standard-plus": "NOT ALLOWED",
    "test-heavy": "NOT ALLOWED",
  });
  coordinator.close();
  store.close();
});

test("activation rejects caller-selected alternate reviewer paths even when their blobs are valid", () => {
  const { root, store, coordinator } = createContext("alternate-review-paths");
  const task = createTask(store);
  const alternateRoster = "alternate-review/reviewers.json";
  const alternateDecision = `alternate-review/decisions/${task.taskId}.json`;
  writeJson(join(root, alternateRoster), {
    reviewers: [{ id: "admin", active: true }, { id: "Dan", active: true }],
  });
  writeJson(join(root, alternateDecision), decisionFor(task, root));
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "commit alternate but valid reviewer blobs");
  const revision = git(root, "rev-parse", "HEAD");
  assert.equal(git(root, "ls-tree", "-r", "--name-only", revision, "--", alternateRoster), alternateRoster);
  assert.equal(git(root, "ls-tree", "-r", "--name-only", revision, "--", alternateDecision), alternateDecision);

  assert.throws(() => coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "worker",
    rosterPath: alternateRoster,
    decisionPath: alternateDecision,
  }), /caller overrides are not permitted/);
  assert.equal(store.getTask(task.taskId).status, "draft");
  coordinator.close();
  store.close();
});

test("activation rejects caller-supplied tier registry digests and unregistered definitions", () => {
  const { root, store, coordinator } = createContext("activation-policy-binding");
  const task = createTask(store);
  const revision = commitDecision(root, task);

  assert.throws(() => coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "worker",
    registeredTiers: ["test-standard"],
    registryVersion: "caller-selected-registry",
    tierDefinitionDigest: task.tierDefinitionDigest,
  }), /caller overrides are not permitted/);
  assert.equal(store.getTask(task.taskId).status, "draft");

  store.database.prepare("UPDATE tasks SET tier_definition_digest = ? WHERE task_id = ?").run(
    "0".repeat(64),
    task.taskId,
  );
  assert.throws(() => coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "worker",
  }), /reserved tier-definition digest differs from installed validation policy/);
  assert.equal(store.getTask(task.taskId).status, "draft");
  assert.throws(() => store.tierStatuses(task.taskId, ["test-fast"]), /derived from the installed validation policy/);
  coordinator.close();
  store.close();
});

test("Dan can activate a task when named in the pinned reviewer roster", () => {
  const { root, store, coordinator } = createContext("dan-review");
  const task = createTask(store);
  const revision = commitDecision(root, task, { reviewerId: "Dan" });
  const activated = coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "task-agent",
  });
  assert.equal(activated.approval.reviewerId, "Dan");
  assert.equal(activated.status, "active");
  coordinator.close();
  store.close();
});

test("missing, mismatched, and non-designated committed reviewer decisions fail closed", () => {
  const { root, store, coordinator } = createContext("fail-closed");
  const missing = createTask(store);
  const rosterOnlyCommit = git(root, "rev-parse", "HEAD");
  assert.throws(() => coordinator.activateTask({
    taskId: missing.taskId,
    revision: rosterOnlyCommit,
    taskAgent: "worker",
  }), /missing a regular reviewer decision blob/);
  assert.equal(store.getTask(missing.taskId).status, "draft");

  const mismatch = createTask(store);
  const mismatchedRevision = commitDecision(root, mismatch, { planDigest: "0".repeat(64) });
  assert.throws(() => coordinator.activateTask({
    taskId: mismatch.taskId,
    revision: mismatchedRevision,
    taskAgent: "worker",
  }), /does not match planDigest/);
  assert.equal(store.getTask(mismatch.taskId).status, "draft");

  const unauthorized = createTask(store);
  const unauthorizedRevision = commitDecision(root, unauthorized, { reviewerId: "task-agent-9" });
  assert.throws(() => coordinator.activateTask({
    taskId: unauthorized.taskId,
    revision: unauthorizedRevision,
    taskAgent: "worker",
  }), /reviewer must be admin or Dan/);
  assert.equal(store.getTask(unauthorized.taskId).status, "draft");
  coordinator.close();
  store.close();
});

test("corrupt plan contents are rejected rather than trusted through a stale digest", () => {
  const { store, coordinator } = createContext("corrupt-plan");
  const task = createTask(store);
  store.database.prepare("UPDATE tasks SET plan_content = ? WHERE task_id = ?").run(
    JSON.stringify({ ...task.plan, title: "unapproved replacement" }),
    task.taskId,
  );
  assert.throws(() => store.getTask(task.taskId), /malformed or stale canonical plan/);
  coordinator.close();
  store.close();
});

test("checked runner denies missing, escaping, and substituted plan projections before launch", async () => {
  const context = createContext("runner-plan-denials");

  const missing = createApprovedRunnerTask(context, { planReference: "plans/missing.json" });
  rmSync(join(context.root, "plans/missing.json"), { force: true });
  const runner = new FailureGateCheckedRunner({ store: context.store });
  await assert.rejects(
    runner.requestRequiredValidation({ taskId: missing.task.taskId }),
    /ENOENT|no such file/i,
  );
  await assert.rejects(
    verifyApprovedPlanProjection({
      projectRoot: context.root,
      task: missing.activated,
      suppliedPlanReference: "../outside.json",
    }),
    /does not match the task's exact approved plan reference/,
  );
  await assert.rejects(
    verifyApprovedPlanProjection({
      projectRoot: context.root,
      task: { ...missing.activated, planReference: "../outside.json" },
    }),
    /safe project-relative path/,
  );
  await assert.rejects(
    runner.requestRequiredValidation({
      taskId: missing.task.taskId,
      planReference: "plans/another-task.json",
    }),
    /does not match the task's exact approved plan reference/,
  );
  const other = createApprovedRunnerTask(context, { planReference: "plans/another-task.json" });
  await assert.rejects(
    runner.requestRequiredValidation({
      taskId: other.task.taskId,
      planReference: missing.task.planReference,
    }),
    /does not match the task's exact approved plan reference/,
  );
  assert.deepEqual(context.store.validationAttempts(missing.task.taskId), []);
  assert.deepEqual(context.store.validationAttempts(other.task.taskId), []);
  context.coordinator.close();
  context.store.close();
});

test("checked runner rejects a changed wrapper before launch against the approved digests", async () => {
  const context = createContext("runner-policy-drift");
  const { task } = createApprovedRunnerTask(context);
  const runTierPath = join(context.root, "scripts/run-tier.mjs");
  writeFileSync(runTierPath, "\n// unapproved test-only wrapper mutation\n", { flag: "a" });
  const runner = new FailureGateCheckedRunner({ store: context.store });
  await assert.rejects(
    runner.requestRequiredValidation({ taskId: task.taskId }),
    /tier-definition digest/,
  );
  assert.deepEqual(context.store.validationAttempts(task.taskId), []);
  context.coordinator.close();
  context.store.close();
});

test("runner records a blocked required-tier attempt rather than launching an unparseable legacy command", async () => {
  const context = createContext("runner-no-report-adapter");
  const { task, tierPolicy } = createApprovedRunnerTask(context);
  const runner = new FailureGateCheckedRunner({ store: context.store });
  const result = await runner.requestRequiredValidation({ taskId: task.taskId });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.commandLaunched, false);
  assert.equal(result.leaseAcquired, false);
  assert.equal(result.rawExitStatus, null);
  assert.equal(result.reportAdapterId, null);
  assert.ok(result.reasons.includes("required_report_adapter_missing"));
  assert.ok(result.reasons.includes("writer_coordination_adapter_unavailable"));
  assert.equal(result.snapshotIntegrity, "unknown");
  assert.ok(result.stepResults.length > 0);
  assert.ok(result.stepResults.every((step) =>
    step.status === "NOT_STARTED" && step.rawExitStatus === null && step.rawReportReference === null,
  ));

  const [persisted] = context.store.validationAttempts(task.taskId);
  assert.ok(persisted);
  assert.equal(persisted.purpose, "required_tier_validation");
  assert.equal(persisted.status, "blocked");
  assert.equal(persisted.leaseAcquired, false);
  assert.equal(persisted.reportAdapterId, null);
  assert.equal(persisted.tierDefinitionDigest, tierPolicy.tierDefinitionDigest);
  assert.equal(persisted.registryDigest, tierPolicy.registryDigest);
  assert.equal(persisted.wrapperDigest, tierPolicy.wrapperDigest);
  assert.equal(persisted.snapshotDigest, digestJson(persisted.snapshot));
  assert.equal(persisted.environmentDigest, digestJson(persisted.environment));
  assert.ok(persisted.snapshot.files.some((file) => file.path === task.planReference));
  assert.ok(persisted.snapshot.files.some((file) => file.path === "pnpm-lock.yaml"));
  assert.ok(persisted.snapshot.integrityReasons.includes("shared_worktree_writer_coordination_unavailable"));
  assert.equal(persisted.startedAt, null);
  assert.equal(persisted.rawExitStatus, null);
  assert.ok(context.store.auditEvents(task.taskId).some((event) =>
    event.action === "required_run_blocked" &&
    event.details.reasonCodes.includes("required_report_adapter_missing"),
  ));
  context.coordinator.close();
  context.store.close();
});

test("activation and its audit event roll back together; stale or duplicate activation is rejected", () => {
  const { root, store, coordinator } = createContext("atomic-activation");
  const task = createTask(store);
  const revision = commitDecision(root, task);
  store.database.exec(`
    CREATE TRIGGER fail_activation_audit BEFORE INSERT ON audit
    WHEN NEW.action = 'activated'
    BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END;
  `);
  assert.throws(() => coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "worker",
  }), /injected audit failure/);
  assert.equal(store.getTask(task.taskId).status, "draft");
  assert.equal(store.getTask(task.taskId).authorizationVersion, 0);
  assert.equal(store.auditEvents(task.taskId).some((event) => event.action === "activated"), false);

  store.database.exec("DROP TRIGGER fail_activation_audit");
  coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "worker",
  });
  assert.throws(() => coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "worker",
  }), /not a draft/);
  assert.throws(() => store.activateTask({
    taskId: "TASK-999999",
    expectedAuthorizationVersion: 0,
  }), /unknown local task/);
  coordinator.close();
  store.close();
});