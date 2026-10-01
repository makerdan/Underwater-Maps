import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { canonicalJson, digestJson, sha256 } from "../failure-gate-v4/canonical.mjs";
import { FailureGateCoordinator, FailureGateStore } from "../failure-gate-v4/coordinator.mjs";
import {
  getRegisteredTierPolicy, getRegisteredValidationPolicy, TIER_POLICY_FILES,
} from "../failure-gate-v4/policy.mjs";
import { FailureGateCheckedRunner, verifyApprovedPlanProjection } from "../failure-gate-v4/runner.mjs";
import { REPLIT_TASK_POLICY_ID } from "../failure-gate-v4/replit-task.mjs";
import { BOOTSTRAP_APPROVAL_REFERENCE } from "../failure-gate-v4/bootstrap-policy.mjs";
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
    activationScope: "installation-demonstration",
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
  const baselineTarget = join(root, "docs/validation/failure-baseline.json");
  mkdirSync(join(baselineTarget, ".."), { recursive: true });
  copyFileSync(join(projectRoot, "docs/validation/failure-baseline.json"), baselineTarget);
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "validation policy fixture");
}

function acceptedProjectTask(overrides = {}) {
  return {
    taskRef: "#91001",
    title: "Accepted platform plan",
    state: "IN_PROGRESS",
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:15:00.000Z",
    description: [
      "## Validation",
      "**Command:** `test-heavy`",
      "**Why:** The heavy tier runs the exact approved installation bootstrap validation.",
      "**Do not escalate:** Run only this authorized tier; focused checks are diagnostics.",
      "",
      "## Regression Guard",
      "**Covers:** The API behavior and saved dataset integration.",
      "**Test location:** `scripts/__tests__/failure-gate-v4-coordinator.test.mjs`",
      "**What it checks:** Wrong-task plans, tier drift, missing reports, and writer races remain blocked.",
      "",
    ].join("\n"),
    ...overrides,
  };
}

function commitBootstrapApproval(context, projectTask, overrides = {}) {
  const approval = {
    format: "failure-gate-v4-bootstrap-approval-v1",
    decision: "approved-installation-bootstrap",
    source: "explicit-conversation-approval",
    approvedAt: "2026-09-30T12:30:00.000Z",
    projectNamespace: context.store.projectNamespace,
    taskRef: projectTask.taskRef,
    title: projectTask.title,
    descriptionDigest: sha256(Buffer.from(projectTask.description, "utf8")),
    tier: "test-heavy",
    parameters: {},
    policySnapshotDigest: getRegisteredValidationPolicy(context.root).snapshotDigest,
    ordinaryActivation: false,
    ...overrides,
  };
  writeJson(join(context.root, BOOTSTRAP_APPROVAL_REFERENCE), approval);
  git(context.root, "add", BOOTSTRAP_APPROVAL_REFERENCE);
  git(context.root, "commit", "--quiet", "-m", "pin synthetic bootstrap approval fixture");
  return approval;
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

test("tier policy pins every case-report adapter and the invoking scripts package", () => {
  for (const file of [
    "scripts/package.json",
    "docs/validation/failure-baseline.json",
    "scripts/failure-gate-v4/engine-evidence.mjs",
    "scripts/failure-gate-v4/node-test-reporter.mjs",
    "scripts/failure-gate-v4/node-tap-report.mjs",
    "scripts/failure-gate-v4/playwright-reporter.mjs",
    "scripts/failure-gate-v4/run-node-test-suite.mjs",
    "scripts/failure-gate-v4/run-writer.mjs",
    "scripts/failure-gate-v4/stored-classification.mjs",
    "scripts/failure-gate-v4/suite-coverage.mjs",
    "scripts/failure-gate-v4/test-case-report.mjs",
    "scripts/failure-gate-v4/vitest-reporter.mjs",
    "scripts/failure-gate-v4/writer-routes.mjs",
  ]) {
    assert.ok(TIER_POLICY_FILES.includes(file), `tier policy must bind ${file}`);
  }
});

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

test("ordinary activation stays blocked for a pinned decision without installation-demonstration scope", () => {
  const { root, store, coordinator } = createContext("activation-scope");
  const task = createTask(store);
  const revision = commitDecision(root, task, { activationScope: "ordinary" });
  assert.throws(() => coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "task-agent",
  }), /ordinary v4 activation is blocked.*installation-demonstration/);
  assert.equal(store.getTask(task.taskId).status, "draft");
  coordinator.close();
  store.close();
});

test("a fresh accepted project-task callback activates one exact locally bound plan without reviewer identity", async () => {
  const { root, store, coordinator } = createContext("accepted-project-task");
  const snapshot = acceptedProjectTask({ approvedBy: "ignored-unverified-actor" });
  const reserved = await coordinator.reserveAcceptedProjectTask(snapshot);
  const bootstrap = commitBootstrapApproval({ root, store }, snapshot);
  assert.equal(reserved.taskId, "TASK-000001");
  assert.equal(reserved.requestedTier, "test-heavy");
  assert.equal(reserved.plan.validation.tier, "test-heavy");
  assert.equal(bootstrap.tier, reserved.requestedTier);
  assert.equal(reserved.policyVersion, REPLIT_TASK_POLICY_ID);
  assert.deepEqual(reserved.parameters, {});
  assert.deepEqual(reserved.plan.projectTaskSource, {
    provider: "replit-project-tasks",
    taskRef: snapshot.taskRef,
    title: snapshot.title,
    descriptionDigest: sha256(Buffer.from(snapshot.description, "utf8")),
    policyId: REPLIT_TASK_POLICY_ID,
  });
  assert.equal(
    git(root, "ls-files", "--error-unmatch", "--", reserved.planReference),
    reserved.planReference,
  );

  const changedTimestamp = {
    ...snapshot,
    updatedAt: "2026-09-30T12:30:00.000Z",
    approvedBy: "another-ignored-actor",
  };
  const activated = await coordinator.activateAcceptedProjectTask({
    taskId: reserved.taskId,
    projectTask: changedTimestamp,
  });
  assert.equal(activated.status, "active");
  assert.equal(activated.authorizedTier, "test-heavy");
  assert.equal(activated.approval.sourceKind, "replit-project-task");
  assert.equal(activated.approval.decision, "platform_accepted");
  assert.equal(activated.approval.identityAttestation, false);
  assert.equal(Object.hasOwn(activated.approval, "reviewerId"), false);
  assert.equal(Object.hasOwn(activated.approval, "approvedBy"), false);
  assert.deepEqual(activated.approval.sourceSnapshot, {
    taskRef: changedTimestamp.taskRef,
    title: changedTimestamp.title,
    description: changedTimestamp.description,
    state: changedTimestamp.state,
    createdAt: changedTimestamp.createdAt,
    updatedAt: changedTimestamp.updatedAt,
  });
  assert.equal(activated.approvalSourceKind, "replit-project-task");
  assert.equal(activated.approvalSourceDigest, digestJson(activated.approval.sourceSnapshot));
  assert.equal(activated.approvalSourceRevision, null);
  assert.equal(activated.approval.bootstrapApproval.sourceDigest, digestJson(bootstrap));
  assert.match(activated.approval.bootstrapApproval.revision, /^[0-9a-f]{40}$/);
  const checkedRunner = new FailureGateCheckedRunner({ store });
  await assert.rejects(
    checkedRunner.runRequiredValidation({ taskId: reserved.taskId }),
    /requires a fresh Agent-side project-task snapshot/,
  );
  await assert.rejects(
    coordinator.completeTask({ taskId: reserved.taskId }),
    /requires a fresh Agent-side project-task snapshot/,
  );
  assert.deepEqual(store.tierStatuses(reserved.taskId), {
    "test-fast": "NOT ALLOWED",
    "test-standard": "NOT ALLOWED",
    "test-standard-plus": "NOT ALLOWED",
    "test-heavy": "ALLOWED",
  });
  const activationEvent = store.auditEvents(reserved.taskId).find((event) => event.action === "activated");
  assert.equal(activationEvent.details.approvalSourceKind, "replit-project-task");
  assert.equal(activationEvent.details.approvalSourceDigest, activated.approvalSourceDigest);
  assert.equal(activationEvent.details.projectTaskRef, snapshot.taskRef);
  assert.equal(activationEvent.details.identityAttestation, false);
  assert.equal(activationEvent.details.bootstrapApprovalSourceRevision, activated.approval.bootstrapApproval.revision);
  assert.equal(activationEvent.details.bootstrapApprovalSourceDigest, activated.approval.bootstrapApproval.sourceDigest);
  assert.equal(Object.hasOwn(activationEvent.details, "bootstrapApprovalActor"), false);
  coordinator.close();
  store.close();
});

test("accepted project-task activation is blocked without a separate pinned bootstrap approval or for another subject", async () => {
  const context = createContext("accepted-project-task-bootstrap-subject");
  const source = acceptedProjectTask({ taskRef: "#91006" });
  const task = await context.coordinator.reserveAcceptedProjectTask(source);
  await assert.rejects(
    context.coordinator.activateAcceptedProjectTask({ taskId: task.taskId, projectTask: source }),
    /ordinary v4 activation is blocked; current pinned bootstrap approval unavailable/,
  );

  commitBootstrapApproval(context, acceptedProjectTask({ taskRef: "#91007" }));
  await assert.rejects(
    context.coordinator.activateAcceptedProjectTask({ taskId: task.taskId, projectTask: source }),
    /pinned bootstrap decision does not approve this exact installation plan and tier/,
  );
  assert.equal(context.store.getTask(task.taskId).status, "draft");
  context.coordinator.close();
  context.store.close();
});

test("bootstrap approval rejects stale policy digests and edited uncommitted decisions", async () => {
  const stale = createContext("accepted-project-task-bootstrap-stale");
  const source = acceptedProjectTask({ taskRef: "#91008" });
  commitBootstrapApproval(stale, source);
  appendFileSync(join(stale.root, ".gitignore"), "\n# bootstrap policy drift fixture\n");
  git(stale.root, "add", ".gitignore");
  git(stale.root, "commit", "--quiet", "-m", "change governing bootstrap policy");
  const staleTask = await stale.coordinator.reserveAcceptedProjectTask(source);
  await assert.rejects(
    stale.coordinator.activateAcceptedProjectTask({ taskId: staleTask.taskId, projectTask: source }),
    /governing policy changed; a renewed separate bootstrap approval is required/,
  );
  stale.coordinator.close();
  stale.store.close();

  const edited = createContext("accepted-project-task-bootstrap-edited");
  const editedSource = acceptedProjectTask({ taskRef: "#91009" });
  const editedTask = await edited.coordinator.reserveAcceptedProjectTask(editedSource);
  commitBootstrapApproval(edited, editedSource);
  writeJson(join(edited.root, BOOTSTRAP_APPROVAL_REFERENCE), {
    ...JSON.parse(readFileSync(join(edited.root, BOOTSTRAP_APPROVAL_REFERENCE), "utf8")),
    approvedAt: "2026-10-01T12:30:00.000Z",
  });
  await assert.rejects(
    edited.coordinator.activateAcceptedProjectTask({ taskId: editedTask.taskId, projectTask: editedSource }),
    /working bootstrap decision differs from the pinned committed source/,
  );
  edited.coordinator.close();
  edited.store.close();
});

test("accepted project-task activation rejects substitution, plan drift, invalid state, and caller policy fields", async () => {
  const { store, coordinator } = createContext("accepted-project-task-denials");
  const firstSource = acceptedProjectTask({ taskRef: "#91002" });
  const secondSource = acceptedProjectTask({ taskRef: "#91003" });
  const first = await coordinator.reserveAcceptedProjectTask(firstSource);
  const second = await coordinator.reserveAcceptedProjectTask(secondSource);

  await assert.rejects(
    coordinator.activateAcceptedProjectTask({
      taskId: first.taskId,
      projectTask: secondSource,
    }),
    /does not match the exact reserved local plan/,
  );
  await assert.rejects(
    coordinator.activateAcceptedProjectTask({
      taskId: first.taskId,
      projectTask: { ...firstSource, description: `${firstSource.description}\nchanged` },
    }),
    /does not match the exact reserved local plan/,
  );
  await assert.rejects(
    coordinator.activateAcceptedProjectTask({
      taskId: first.taskId,
      projectTask: { ...firstSource, title: "Changed title" },
    }),
    /does not match the exact reserved local plan/,
  );
  await assert.rejects(
    coordinator.activateAcceptedProjectTask({
      taskId: first.taskId,
      projectTask: { ...firstSource, state: "PROPOSED" },
    }),
    /not accepted and active/,
  );
  await assert.rejects(
    coordinator.activateAcceptedProjectTask({
      taskId: first.taskId,
      projectTask: firstSource,
      tier: "test-heavy",
    }),
    /does not permit caller-selected authorization fields/,
  );
  assert.equal(store.getTask(first.taskId).status, "draft");
  assert.equal(store.getTask(second.taskId).status, "draft");
  assert.throws(() => store.reserveTask({
    plan: first.plan,
    planReference: first.planReference,
    tier: first.requestedTier,
    tierDefinitionDigest: first.tierDefinitionDigest,
  }), /must be derived through reserveAcceptedProjectTask/);
  coordinator.close();
  store.close();
});

test("project-task source reservation is idempotent but changed plan content gets a new local ID", async () => {
  const { store, coordinator } = createContext("accepted-project-task-reservation-idempotence");
  const original = acceptedProjectTask({ taskRef: "#91004" });
  const first = await coordinator.reserveAcceptedProjectTask(original);
  const repeated = await coordinator.reserveAcceptedProjectTask(original);
  assert.equal(repeated.taskId, first.taskId);
  assert.equal(repeated.planDigest, first.planDigest);

  const updated = await coordinator.reserveAcceptedProjectTask({
    ...original,
    title: "Updated platform plan",
  });
  assert.notEqual(updated.taskId, first.taskId);
  assert.notEqual(updated.planDigest, first.planDigest);
  assert.equal(updated.planVersion, 1);
  assert.equal(store.getTask(first.taskId).status, "draft");
  coordinator.close();
  store.close();
});

test("project-task reservation creates a new local ID when its authorized tier policy changes", async () => {
  const { root, store, coordinator } = createContext("accepted-project-task-policy-renewal");
  const source = acceptedProjectTask({ taskRef: "#91005" });
  commitBootstrapApproval({ root, store }, source);
  const first = await coordinator.reserveAcceptedProjectTask(source);

  appendFileSync(join(root, "scripts/package.json"), "\n");
  git(root, "add", "scripts/package.json");
  git(root, "commit", "--quiet", "-m", "change fixture policy input");

  const renewed = await coordinator.reserveAcceptedProjectTask(source);
  assert.notEqual(renewed.taskId, first.taskId);
  assert.notEqual(renewed.tierDefinitionDigest, first.tierDefinitionDigest);
  assert.notEqual(renewed.planReference, first.planReference);
  assert.equal(renewed.status, "draft");
  await assert.rejects(
    coordinator.activateAcceptedProjectTask({ taskId: renewed.taskId, projectTask: source }),
    /governing policy changed; a renewed separate bootstrap approval is required/,
  );
  commitBootstrapApproval({ root, store }, source);
  const renewedActivation = await coordinator.activateAcceptedProjectTask({
    taskId: renewed.taskId,
    projectTask: source,
  });
  assert.equal(renewedActivation.authorizedTier, "test-heavy");
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

test("preflight-only requests remain blocked despite a registered report adapter", async () => {
  const context = createContext("runner-no-report-adapter");
  const { task, tierPolicy } = createApprovedRunnerTask(context);
  const runner = new FailureGateCheckedRunner({ store: context.store });
  const result = await runner.requestRequiredValidation({ taskId: task.taskId });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.commandLaunched, false);
  assert.equal(result.leaseAcquired, false);
  assert.equal(result.rawExitStatus, null);
  assert.equal(result.reportAdapterId, "run-tier-report-v2");
  assert.ok(result.reasons.includes("no_checked_executor_is_registered_for_the_report_adapter"));
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
  assert.equal(persisted.reportAdapterId, "run-tier-report-v2");
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
    event.details.reasonCodes.includes("no_checked_executor_is_registered_for_the_report_adapter"),
  ));
  context.coordinator.close();
  context.store.close();
});

test("checked dispatch cannot launch without a digest-bound legacy plan and passing draft guards", async () => {
  const context = createContext("checked-dispatch-denies-unguarded-plan");
  const { task } = createApprovedRunnerTask(context);
  const runner = new FailureGateCheckedRunner({ store: context.store });
  await assert.rejects(
    runner.runRequiredValidation({ taskId: task.taskId }),
    /ENOENT|catalog|checked execution requires passing plan guards/,
  );
  assert.deepEqual(context.store.validationAttempts(task.taskId), []);
  await assert.rejects(
    runner.runRequiredValidation({ taskId: task.taskId, planReference: "plans/other.json" }),
    /does not match the task's exact approved plan reference/,
  );
  assert.deepEqual(context.store.validationAttempts(task.taskId), []);
  context.coordinator.close();
  context.store.close();
});

test("checked dispatch rejects Clerk substitution and selector or Node runtime controls before creating a lease", async () => {
  const context = createContext("checked-dispatch-environment-controls");
  const { task } = createApprovedRunnerTask(context);
  const runner = new FailureGateCheckedRunner({ store: context.store });
  const priorClerk = process.env.E2E_REAL_CLERK;
  const priorNodeOptions = process.env.NODE_OPTIONS;
  try {
    process.env.E2E_REAL_CLERK = "1";
    await assert.rejects(
      runner.runRequiredValidation({ taskId: task.taskId }),
      /coverage-reducing environment controls: E2E_REAL_CLERK/,
    );
    delete process.env.E2E_REAL_CLERK;
    process.env.NODE_OPTIONS = "--require=unapproved-runtime-hook";
    await assert.rejects(
      runner.runRequiredValidation({ taskId: task.taskId }),
      /coverage-reducing environment controls: NODE_OPTIONS/,
    );
  } finally {
    if (priorClerk === undefined) delete process.env.E2E_REAL_CLERK;
    else process.env.E2E_REAL_CLERK = priorClerk;
    if (priorNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = priorNodeOptions;
  }
  assert.deepEqual(context.store.validationAttempts(task.taskId), []);
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