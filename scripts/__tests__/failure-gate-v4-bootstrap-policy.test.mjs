import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { digestJson, sha256 } from "../failure-gate-v4/canonical.mjs";
import {
  BOOTSTRAP_APPROVAL_REFERENCE,
  verifyBootstrapApproval,
} from "../failure-gate-v4/bootstrap-policy.mjs";
import { getRegisteredValidationPolicy, TIER_POLICY_FILES } from "../failure-gate-v4/policy.mjs";

const scratch = mkdtempSync(join(tmpdir(), "failure-gate-v4-bootstrap-policy-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let commitSequence = 0;

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function acceptedTask(overrides = {}) {
  return {
    taskRef: "#91001",
    title: "Accepted installation bootstrap plan",
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
      "**Covers:** The bootstrap installation behavior and its saved configuration.",
      "**Test location:** `scripts/__tests__/failure-gate-v4-bootstrap-policy.test.mjs`",
      "**What it checks:** Pinned installation approval cannot authorize another task or policy.",
      "",
    ].join("\n"),
    ...overrides,
  };
}

function createContext(name) {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Failure Gate bootstrap test");
  git(root, "config", "user.email", "failure-gate-bootstrap@example.invalid");

  const sourceRoot = join(import.meta.dirname, "../..");
  for (const file of TIER_POLICY_FILES) {
    const target = join(root, file);
    mkdirSync(join(target, ".."), { recursive: true });
    copyFileSync(join(sourceRoot, file), target);
  }
  const baselineSource = join(sourceRoot, "docs/validation/failure-baseline.json");
  const baselineTarget = join(root, "docs/validation/failure-baseline.json");
  mkdirSync(join(baselineTarget, ".."), { recursive: true });
  copyFileSync(baselineSource, baselineTarget);

  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "install governing validation policy fixture");
  return {
    root,
    projectNamespace: `test:bootstrap:${name}`,
    projectTask: acceptedTask(),
  };
}

function approvalFor(context, overrides = {}) {
  const task = context.projectTask;
  return {
    format: "failure-gate-v4-bootstrap-approval-v1",
    decision: "approved-installation-bootstrap",
    source: "explicit-conversation-approval",
    approvedAt: "2026-09-30T12:30:00.000Z",
    projectNamespace: context.projectNamespace,
    taskRef: task.taskRef,
    title: task.title,
    descriptionDigest: sha256(Buffer.from(task.description, "utf8")),
    tier: "test-heavy",
    parameters: {},
    policySnapshotDigest: getRegisteredValidationPolicy(context.root).snapshotDigest,
    ordinaryActivation: false,
    ...overrides,
  };
}

function writeApproval(context, overrides = {}, { commit = true } = {}) {
  const approval = approvalFor(context, overrides);
  writeJson(join(context.root, BOOTSTRAP_APPROVAL_REFERENCE), approval);
  if (commit) {
    git(context.root, "add", BOOTSTRAP_APPROVAL_REFERENCE);
    git(context.root, "commit", "--quiet", "-m", `pin bootstrap approval ${++commitSequence}`);
  }
  return approval;
}

function verify(context) {
  return verifyBootstrapApproval({
    projectRoot: context.root,
    projectTask: context.projectTask,
    projectNamespace: context.projectNamespace,
  });
}

test("a pinned committed approval is bound to the exact policy, task, namespace, tier, and empty parameters", (t) => {
  const context = createContext("valid");
  t.after(() => rmSync(context.root, { recursive: true, force: true }));
  const decision = writeApproval(context);

  const verified = verify(context);
  assert.equal(verified.reference, BOOTSTRAP_APPROVAL_REFERENCE);
  assert.equal(verified.revision, git(context.root, "rev-parse", "HEAD"));
  assert.equal(verified.sourceDigest, digestJson(decision));
  assert.equal(verified.taskRef, context.projectTask.taskRef);
  assert.equal(verified.policySnapshotDigest, decision.policySnapshotDigest);
  assert.equal(verified.ordinaryActivation, false);
  assert.deepEqual(decision.parameters, {});
  assert.equal(decision.projectNamespace, context.projectNamespace);
  assert.equal(decision.tier, "test-heavy");
});

test("missing and uncommitted bootstrap approvals are unavailable", (t) => {
  const context = createContext("missing-uncommitted");
  t.after(() => rmSync(context.root, { recursive: true, force: true }));

  assert.throws(
    () => verify(context),
    /ordinary v4 activation is blocked; current pinned bootstrap approval unavailable/,
  );
  writeApproval(context, {}, { commit: false });
  assert.throws(
    () => verify(context),
    /ordinary v4 activation is blocked; current pinned bootstrap approval unavailable/,
  );
});

test("a pinned bootstrap decision rejects another task, namespace, tier, parameters, and actor assertion", (t) => {
  const context = createContext("mismatches");
  t.after(() => rmSync(context.root, { recursive: true, force: true }));

  for (const [label, overrides] of [
    ["another task", { taskRef: "#91002" }],
    ["another namespace", { projectNamespace: "test:someone-else" }],
    ["another tier", { tier: "test-standard" }],
    ["nonempty parameters", { parameters: { mode: "ordinary" } }],
    ["caller-supplied actor", { approvedBy: "admin" }],
  ]) {
    writeApproval(context, overrides);
    assert.throws(
      () => verify(context),
      /pinned bootstrap decision does not approve this exact installation plan and tier/,
      label,
    );
  }
});

test("a changed governing policy invalidates the previously pinned bootstrap approval", (t) => {
  const context = createContext("policy-drift");
  t.after(() => rmSync(context.root, { recursive: true, force: true }));
  const approval = writeApproval(context);

  appendFileSync(join(context.root, ".gitignore"), "\n# changed governing bootstrap policy\n");
  git(context.root, "add", ".gitignore");
  git(context.root, "commit", "--quiet", "-m", "change governing bootstrap policy");

  assert.notEqual(getRegisteredValidationPolicy(context.root).snapshotDigest, approval.policySnapshotDigest);
  assert.throws(
    () => verify(context),
    /governing policy changed; a renewed separate bootstrap approval is required/,
  );
});