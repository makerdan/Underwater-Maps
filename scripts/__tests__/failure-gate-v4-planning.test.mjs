import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { digestJson, sha256 } from "../failure-gate-v4/canonical.mjs";
import { FailureGateCoordinator, FailureGateStore } from "../failure-gate-v4/coordinator.mjs";
import {
  capturePlanningBaseline,
  loadTrackedBaselineCatalog,
  validatePlanningGuards,
} from "../failure-gate-v4/planning.mjs";

const tier = "test-standard";
const tierDigest = "a".repeat(64);
const owner = "Database maintenance";

function entry(overrides = {}) {
  return {
    id: "BASE-KNOWN",
    suite: "Unit suite",
    test: "sample.test.mjs",
    failureSignature: "Expected 2 but received 3.",
    evidence: { authoritative: true },
    ownership: { owner, rationale: "Repair this documented failure." },
    status: "active",
    reviewDeadline: "2026-12-31",
    affectedTiers: [tier],
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    taskId: "TASK-000001",
    projectNamespace: "local-test",
    planVersion: 1,
    validation: {
      tier,
      why: "The standard tier covers the changed service and its focused integration contract.",
      noEscalation: true,
      maximumTier: tier,
      doNotEscalate: `Run only ${tier}; do not escalate to a heavier tier.`,
    },
    baselines: {
      ignore: [{ id: "BASE-KNOWN", owner }],
      owned: [{ id: "BASE-REPAIR", owner: "Repair team" }],
    },
    regressionGuard: {
      covers: "The changed database-maintenance behavior.",
      testLocation: "tests/database-maintenance.test.mjs",
      whatItChecks: "The updated behavior remains correct for existing records.",
    },
    ...overrides,
  };
}

async function projectFixture({ catalogEntries = [entry(), entry({
  id: "BASE-REPAIR",
  status: "resolved",
  evidence: { authoritative: false },
  reviewDeadline: "2025-01-01",
  ownership: { owner: "Repair team", rationale: "Keep the repair obligation." },
})], markdown = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), "failure-gate-planning-"));
  await mkdir(join(root, "docs/validation"), { recursive: true });
  const catalog = { catalogVersion: 1, entries: catalogEntries };
  await writeFile(join(root, "docs/validation/failure-baseline.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  if (markdown !== null) {
    await mkdir(join(root, "plans"), { recursive: true });
    await writeFile(join(root, "plans/task.md"), markdown);
  }
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "planning-test@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Planning Test"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "fixture"]);
  return { root, catalog };
}

function reservedTask(planValue = plan()) {
  return {
    taskId: "TASK-000001",
    projectNamespace: "local-test",
    status: "draft",
    planVersion: 1,
    requestedTier: tier,
    tierDefinitionDigest: tierDigest,
    plan: planValue,
    planDigest: digestJson(planValue),
  };
}

async function planningStore(root) {
  const stateRoot = await mkdtemp(join(tmpdir(), "failure-gate-planning-state-"));
  const databasePath = join(stateRoot, "failure-gate.sqlite");
  const store = new FailureGateStore({
    projectNamespace: "local-test",
    databasePath,
    projectRoot: root,
  });
  return { store, stateRoot, databasePath };
}

function cleanupPlanningStore(t, root, context) {
  t.after(async () => {
    context.store?.close();
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(context.stateRoot, { recursive: true, force: true }),
    ]);
  });
}

function planningTaskInput() {
  return {
    plan: { title: "Planning baseline persistence fixture" },
    tier,
    tierDefinitionDigest: tierDigest,
  };
}

async function evaluate({ root, task = reservedTask(), catalogEntries } = {}) {
  const loaded = await loadTrackedBaselineCatalog({
    projectRoot: root,
    ...(catalogEntries ? { reference: catalogEntries } : {}),
  });
  return validatePlanningGuards({
    task,
    tierPolicy: { tierName: tier, tierDefinitionDigest: tierDigest },
    registeredTiers: ["test-fast", tier, "test-heavy"],
    baselineCatalog: loaded,
    projectRoot: root,
    asOf: "2026-10-01",
  });
}

test("planning guards accept an exact tier, live ignore, and persistent owned repair", async (t) => {
  const { root } = await projectFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await evaluate({ root });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.purpose, "planning_guards");
  assert.equal(result.satisfiesRequiredValidation, false);
  assert.deepEqual(result.ignoredBaselineIds, ["BASE-KNOWN"]);
  assert.deepEqual(result.ownedBaselineIds, ["BASE-REPAIR"]);
});

test("ignore declarations fail closed for ownership, authority, expiry, applicability, and unknown IDs", async (t) => {
  for (const catalogEntry of [
    entry({ ownership: { owner: "Different owner" } }),
    entry({ evidence: { authoritative: false } }),
    entry({ reviewDeadline: "2026-09-30" }),
    entry({ affectedTiers: ["test-fast"] }),
  ]) {
    const { root } = await projectFixture({ catalogEntries: [catalogEntry] });
    t.after(() => rm(root, { recursive: true, force: true }));
    const result = await evaluate({ root, task: reservedTask(plan({
      baselines: { ignore: [{ id: "BASE-KNOWN", owner }], owned: [] },
    })) });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /baseline/);
  }

  const { root } = await projectFixture({ catalogEntries: [] });
  t.after(() => rm(root, { recursive: true, force: true }));
  const missing = await evaluate({ root, task: reservedTask(plan({
    baselines: { ignore: [{ id: "BASE-MISSING", owner }], owned: [] },
  })) });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(" "), /absent from the tracked catalog/);
});

test("tier escalation and malformed or absent gate Regression Guards are rejected", async (t) => {
  const { root } = await projectFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const altered of [
    plan({ validation: { ...plan().validation, tier: "test-heavy" } }),
    plan({ validation: { ...plan().validation, maximumTier: "test-heavy" } }),
    plan({ validation: { ...plan().validation, noEscalation: false } }),
    plan({ regressionGuard: { covers: "change" } }),
    plan({ regressionGuard: { selfSatisfying: " " } }),
  ]) {
    const result = await evaluate({ root, task: reservedTask(altered) });
    assert.equal(result.ok, false);
  }

  const selfSatisfying = await evaluate({
    root,
    task: reservedTask(plan({ regressionGuard: { selfSatisfying: "The deliverable is the test itself." } })),
  });
  assert.equal(selfSatisfying.ok, true, selfSatisfying.errors.join("; "));
});

test("the phrase 'this authorized tier' binds to the plan's single declared registered tier", async (t) => {
  const { root } = await projectFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bound = await evaluate({
    root,
    task: reservedTask(plan({
      validation: {
        ...plan().validation,
        doNotEscalate: "Run only this authorized tier under the checked route.",
      },
    })),
  });
  assert.equal(bound.ok, true, bound.errors.join("; "));

  const mismatched = await evaluate({
    root,
    task: {
      ...reservedTask(plan({
        validation: {
          ...plan().validation,
          doNotEscalate: "Run only this authorized tier under the checked route.",
        },
      })),
      requestedTier: "test-heavy",
    },
  });
  assert.equal(mismatched.ok, false);
  assert.match(mismatched.errors.join(" "), /reserved requested tier|maximum tier/);
});

test("baseline catalog must be a tracked regular project file and markdown projection is digest-bound", async (t) => {
  const markdown = [
    "## Validation",
    `**Command:** \`${tier}\``,
    `**Why:** ${plan().validation.why}`,
    `**Do not escalate:** ${plan().validation.doNotEscalate}`,
    "",
  ].join("\n");
  const withMarkdown = plan({
    legacyPlan: { reference: "plans/task.md", sha256: sha256(markdown) },
  });
  const { root } = await projectFixture({ markdown });
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await evaluate({ root, task: reservedTask(withMarkdown) });
  assert.equal(result.ok, true, result.errors.join("; "));

  const alteredMarkdownPlan = plan({
    legacyPlan: { reference: "plans/task.md", sha256: sha256(`${markdown}changed`) },
  });
  const bad = await evaluate({ root, task: reservedTask(alteredMarkdownPlan) });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /digest differs/);

  await writeFile(join(root, "docs/validation/untracked.json"), "{}");
  await assert.rejects(
    loadTrackedBaselineCatalog({ projectRoot: root, reference: "docs/validation/untracked.json" }),
    /not tracked/,
  );
});

test("baseline discovery captures a separately labeled planning-only snapshot", async (t) => {
  const { root } = await projectFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await capturePlanningBaseline({ projectRoot: root, task: reservedTask() });
  assert.equal(result.purpose, "baseline_discovery");
  assert.equal(result.satisfiesRequiredValidation, false);
  assert.match(result.label, /not required-tier evidence/);
  assert.equal(typeof result.snapshot.manifestDigest, "string");
});

test("planning baseline persists after reopening the store and recorded observations are immutable", async (t) => {
  const { root } = await projectFixture();
  const context = await planningStore(root);
  cleanupPlanningStore(t, root, context);

  const task = context.store.reserveTask(planningTaskInput());
  const baseline = await capturePlanningBaseline({ projectRoot: root, task });
  const recorded = context.store.recordPlanningBaseline({ taskId: task.taskId, baseline });
  assert.deepEqual(recorded, baseline);

  context.store.close();
  context.store = new FailureGateStore({
    projectNamespace: "local-test",
    databasePath: context.databasePath,
    projectRoot: root,
  });
  assert.deepEqual(context.store.getPlanningBaseline(task.taskId), baseline);

  assert.throws(
    () => context.store.recordPlanningBaseline({
      taskId: task.taskId,
      baseline: { ...baseline, label: `${baseline.label} revised` },
    }),
    /planning baseline is immutable once recorded/,
  );
});

test("planning baseline storage rejects task and snapshot digest mismatches", async (t) => {
  const { root } = await projectFixture();
  const context = await planningStore(root);
  cleanupPlanningStore(t, root, context);

  const task = context.store.reserveTask(planningTaskInput());
  const baseline = await capturePlanningBaseline({ projectRoot: root, task });

  assert.throws(
    () => context.store.recordPlanningBaseline({
      taskId: task.taskId,
      baseline: { ...baseline, taskId: "TASK-000002" },
    }),
    /explicitly planning-only observation for this task/,
  );
  assert.throws(
    () => context.store.recordPlanningBaseline({
      taskId: task.taskId,
      baseline: {
        ...baseline,
        snapshot: { ...baseline.snapshot, manifestDigest: "f".repeat(64) },
      },
    }),
    /manifest or environment digest is inconsistent/,
  );
});

test("coordinator baseline capture is idempotent and never creates validation evidence", async (t) => {
  const { root } = await projectFixture();
  const context = await planningStore(root);
  cleanupPlanningStore(t, root, context);
  const coordinator = new FailureGateCoordinator({ store: context.store });

  const task = await coordinator.reserveTask(planningTaskInput());
  const initial = context.store.getPlanningBaseline(task.taskId);
  const recaptured = await coordinator.capturePlanningBaseline(task.taskId);

  assert.deepEqual(recaptured, initial);
  assert.equal(initial.purpose, "baseline_discovery");
  assert.equal(initial.satisfiesRequiredValidation, false);
  assert.equal(initial.taskId, task.taskId);
  assert.equal(
    context.store.auditEvents(task.taskId).filter((event) => event.action === "planning_baseline_captured").length,
    1,
  );
  assert.deepEqual(context.store.validationAttempts(task.taskId), []);

  assert.throws(
    () => context.store.recordPlanningBaseline({
      taskId: task.taskId,
      baseline: {
        ...initial,
        purpose: "required_tier_validation",
        satisfiesRequiredValidation: true,
      },
    }),
    /explicitly planning-only observation for this task/,
  );
});