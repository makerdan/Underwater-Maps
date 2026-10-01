import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { digestJson } from "../failure-gate-v4/canonical.mjs";
import { loadPinnedReviewerDecision } from "../failure-gate-v4/git-review.mjs";

// Synthetic committed decisions exercise the source boundary only. They are
// not live review, ordinary activation, or final-write evidence.
async function fixture(t, activationScope) {
  const root = await mkdtemp(join(tmpdir(), "v4-activation-scope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "--quiet");
  const digest = digestJson({ fixture: "activation-scope" });
  const policy = {
    tiers: { "test-fast": {} }, registeredTiers: ["test-fast"],
    registryDigest: digest, wrapperDigest: digest, snapshotDigest: digest,
  };
  const task = {
    taskId: "TASK-000001", projectNamespace: "scope-fixture", planVersion: 1,
    planDigest: digest, requestedTier: "test-fast", tierDefinitionDigest: digest,
    parametersDigest: digest, policyVersion: 1, authorizationVersion: 0,
  };
  const decision = {
    decision: "approved", reviewerId: "admin", reference: "synthetic-source-test",
    taskId: task.taskId, projectNamespace: task.projectNamespace,
    planVersion: 1, planDigest: digest, tier: "test-fast",
    tierDefinitionDigest: digest, registeredTiers: policy.registeredTiers,
    registeredTiersDigest: digestJson(policy.registeredTiers),
    registryDigest: digest, wrapperDigest: digest, policySnapshotDigest: digest,
    parametersDigest: digest, policyVersion: 1, authorizationVersion: 1,
    ...(activationScope === undefined ? {} : { activationScope }),
  };
  await mkdir(join(root, ".agents/failure-gate-v4/decisions"), { recursive: true });
  await writeFile(join(root, ".agents/failure-gate-v4/reviewers.json"),
    JSON.stringify({ reviewers: [{ id: "admin", active: true }] }));
  await writeFile(join(root, ".agents/failure-gate-v4/decisions/TASK-000001.json"), JSON.stringify(decision));
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "-m", "synthetic scoped review");
  return {
    projectRoot: root, revision: git("rev-parse", "HEAD"), task,
    taskAgent: "fixture-task-agent", validationPolicy: policy,
  };
}

test("a pinned installation decision preserves its restricted scope", async (t) => {
  const source = loadPinnedReviewerDecision(await fixture(t, "installation-demonstration"));
  assert.equal(source.approval.activationScope, "installation-demonstration");
  assert.equal(source.identityAttestation, false);
});

for (const scope of [undefined, "ordinary", "unknown"]) {
  test(`a pinned ${scope ?? "unscoped"} decision cannot activate ordinary v4`, async (t) => {
    const input = await fixture(t, scope);
    assert.throws(() => loadPinnedReviewerDecision({
      ...input, activationScope: "installation-demonstration",
    }), /ordinary v4 activation is blocked/);
  });
}