import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { canonicalJson } from "../failure-gate-v4/canonical.mjs";
import { FailureGateStore } from "../failure-gate-v4/store.mjs";
import { TIER_POLICY_FILES } from "../failure-gate-v4/policy.mjs";

const scratch = mkdtempSync(join(tmpdir(), "failure-gate-v4-allocator-loss-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function createWorkspace(name, { installPolicy = false } = {}) {
  const root = join(scratch, name);
  const databasePath = join(scratch, `${name}.sqlite`);
  const projectNamespace = `allocator-loss:${name}`;
  mkdirSync(root, { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Allocator loss fixture");
  git(root, "config", "user.email", "allocator-loss@example.invalid");
  if (installPolicy) {
    const sourceRoot = join(import.meta.dirname, "../..");
    for (const file of TIER_POLICY_FILES) {
      const target = join(root, file);
      mkdirSync(join(target, ".."), { recursive: true });
      copyFileSync(join(sourceRoot, file), target);
    }
    const baselineTarget = join(root, "docs/validation/failure-baseline.json");
    mkdirSync(join(baselineTarget, ".."), { recursive: true });
    copyFileSync(join(sourceRoot, "docs/validation/failure-baseline.json"), baselineTarget);
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "install policy fixture");
  }
  const store = new FailureGateStore({ projectNamespace, databasePath, projectRoot: root });
  return { root, databasePath, projectNamespace, store };
}

function reopen(context) {
  return new FailureGateStore({
    projectNamespace: context.projectNamespace,
    databasePath: context.databasePath,
    projectRoot: context.root,
  });
}

function reserve(store, label = "allocator fixture") {
  return store.reserveTask({
    plan: {
      title: label,
      validation: { rationale: "Focused allocator persistence fixture", requirements: ["preserve allocations"] },
    },
    planReference: `plans/${label.toLowerCase().replaceAll(" ", "-")}.json`,
    tier: "test-standard",
    tierDefinitionDigest: "a".repeat(64),
    parameters: {},
  });
}

function writeProjection(root, task, reference = `plans/${task.taskId}.json`) {
  const path = join(root, reference);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${canonicalJson(task.plan)}\n`);
  return reference;
}

function track(root, ...references) {
  git(root, "add", "--", ...references);
}

function removeDatabase(databasePath) {
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
}

function fakeProjectedTask(projectNamespace, taskId, title = "tracked allocation") {
  return {
    projectNamespace,
    taskId,
    planVersion: 1,
    title,
    validation: { rationale: "tracked projection evidence" },
  };
}

function acceptedProjectTask(taskRef = "#71881") {
  return {
    taskRef,
    title: "Allocator loss idempotence fixture",
    state: "IN_PROGRESS",
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:15:00.000Z",
    description: [
      "## Validation",
      "**Command:** `test-heavy`",
      "**Why:** The heavy tier validates the reviewed project task.",
      "**Do not escalate:** Run only the authorized tier.",
      "",
      "## Regression Guard",
      "**Covers:** durable task allocation.",
      "**Test location:** `scripts/__tests__/failure-gate-v4-allocator-loss.test.mjs`",
      "**What it checks:** task IDs are not reused after local ledger loss.",
      "",
    ].join("\n"),
  };
}

function runConcurrentReservation({ root, databasePath, projectNamespace, storeModuleUrl }) {
  const source = `
    import { FailureGateStore } from ${JSON.stringify(storeModuleUrl)};
    const store = new FailureGateStore({
      projectNamespace: ${JSON.stringify(projectNamespace)},
      databasePath: ${JSON.stringify(databasePath)},
      projectRoot: ${JSON.stringify(root)},
    });
    const task = store.reserveTask({
      plan: { title: "parallel reservation", validation: { rationale: "allocator race" } },
      planReference: "parallel-reservation.json",
      tier: "test-standard",
      tierDefinitionDigest: "${"b".repeat(64)}",
    });
    console.log(task.taskId);
    store.close();
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(`concurrent reservation failed: ${stderr}`));
      else resolve(stdout.trim());
    });
  });
}

test("an empty new workspace starts at TASK-000001", () => {
  const context = createWorkspace("brand-new");
  const task = reserve(context.store);
  assert.equal(task.taskId, "TASK-000001");
  context.store.close();
});

test("a missing database cannot be recreated when tracked namespace plans prove prior allocations", () => {
  const context = createWorkspace("missing-ledger");
  const first = reserve(context.store, "first allocation");
  const second = reserve(context.store, "second allocation");
  const references = [
    writeProjection(context.root, first),
    writeProjection(context.root, second),
  ];
  track(context.root, ...references);
  git(context.root, "commit", "--quiet", "-m", "track task allocations");
  context.store.close();
  removeDatabase(context.databasePath);

  assert.throws(
    () => reopen(context),
    /tracked task allocations but no retained coordinator ledger/,
  );
});

test("a cancelled retained ID does not authorize a missing next projected allocation", () => {
  const context = createWorkspace("cancelled-and-lost");
  const first = reserve(context.store, "retained allocation");
  context.store.database.prepare("UPDATE tasks SET status = 'cancelled' WHERE task_id = ?").run(first.taskId);
  const firstReference = writeProjection(context.root, first);
  const secondReference = "plans/TASK-000002.json";
  const secondPath = join(context.root, secondReference);
  mkdirSync(join(secondPath, ".."), { recursive: true });
  writeFileSync(secondPath, `${canonicalJson(fakeProjectedTask(context.projectNamespace, "TASK-000002"))}\n`);
  track(context.root, firstReference, secondReference);

  assert.throws(
    () => reserve(context.store, "must not reuse TASK-000002"),
    /tracked TASK-000002 projection without matching ledger history/,
  );
  assert.equal(context.store.database.prepare("SELECT COUNT(*) AS count FROM tasks").get().count, 1);
  assert.equal(
    Number(context.store.database.prepare("SELECT next_sequence FROM allocator").get().next_sequence),
    2,
  );
  context.store.close();
});

test("tracked high-water evidence fails closed when its ledger row is absent", () => {
  const context = createWorkspace("projection-without-row");
  const first = reserve(context.store, "first allocation");
  const second = reserve(context.store, "second allocation");
  const firstReference = writeProjection(context.root, first);
  const secondReference = writeProjection(context.root, second);
  track(context.root, firstReference, secondReference);

  context.store.database.exec("PRAGMA foreign_keys = OFF");
  context.store.database.prepare("DELETE FROM tasks WHERE task_id = ?").run(second.taskId);
  context.store.database.prepare("UPDATE allocator SET next_sequence = 2 WHERE singleton = 1").run();
  context.store.close();

  assert.throws(
    () => reopen(context),
    /tracked TASK-000002 projection without matching ledger history/,
  );
});

test("an allocator high-water mark beyond complete retained rows is not silently accepted", () => {
  const context = createWorkspace("allocator-gap");
  reserve(context.store, "first allocation");
  context.store.database.prepare("UPDATE allocator SET next_sequence = 3 WHERE singleton = 1").run();
  context.store.close();

  assert.throws(
    () => reopen(context),
    /allocator high-water mark inconsistent with retained task history/,
  );
});

test("complete retained history permits reservations above the tracked projection high-water mark", () => {
  const context = createWorkspace("retained-ledger");
  const first = reserve(context.store, "first allocation");
  reserve(context.store, "second allocation");
  const third = reserve(context.store, "third allocation");
  context.store.database.prepare("UPDATE tasks SET status = 'cancelled' WHERE task_id = ?").run(first.taskId);
  const reference = writeProjection(context.root, first);
  track(context.root, reference);
  context.store.close();

  const reopened = reopen(context);
  const fourth = reserve(reopened, "fourth allocation");
  assert.equal(third.taskId, "TASK-000003");
  assert.equal(fourth.taskId, "TASK-000004");
  reopened.close();
});

test("an intact accepted-source reservation remains idempotent, but source projections cannot replace the ledger", async () => {
  const context = createWorkspace("source-idempotence", { installPolicy: true });
  const source = acceptedProjectTask();
  const first = context.store.reserveAcceptedProjectTask(source);
  const projectionReference = writeProjection(context.root, first, first.planReference);
  track(context.root, projectionReference);

  const repeated = context.store.reserveAcceptedProjectTask(source);
  assert.equal(repeated.taskId, first.taskId);
  assert.equal(repeated.planDigest, first.planDigest);
  context.store.close();
  removeDatabase(context.databasePath);

  assert.throws(
    () => reopen(context),
    /tracked task allocations but no retained coordinator ledger/,
  );
});

test("malformed, conflicting, and symlinked tracked task projections fail closed", () => {
  const malformed = createWorkspace("malformed-projection");
  reserve(malformed.store, "projection source");
  const malformedReference = "plans/TASK-000001.json";
  const malformedPath = join(malformed.root, malformedReference);
  mkdirSync(join(malformedPath, ".."), { recursive: true });
  writeFileSync(malformedPath, "{");
  track(malformed.root, malformedReference);
  assert.throws(
    () => reserve(malformed.store, "malformed must block"),
    /malformed tracked task-plan projection/,
  );
  malformed.store.close();

  const conflicting = createWorkspace("conflicting-projection");
  const original = reserve(conflicting.store, "projection source");
  const originalReference = writeProjection(conflicting.root, original);
  const conflictingReference = "other/TASK-000001.json";
  const altered = { ...original.plan, title: "conflicting allocation projection" };
  const conflictingPath = join(conflicting.root, conflictingReference);
  mkdirSync(join(conflictingPath, ".."), { recursive: true });
  writeFileSync(conflictingPath, `${canonicalJson(altered)}\n`);
  track(conflicting.root, originalReference, conflictingReference);
  assert.throws(
    () => reserve(conflicting.store, "conflict must block"),
    /conflicting tracked projections for TASK-000001/,
  );
  conflicting.store.close();

  const symlinked = createWorkspace("symlinked-projection");
  reserve(symlinked.store, "projection source");
  const target = join(symlinked.root, "outside.json");
  writeFileSync(target, "{}\n");
  const symlinkReference = "plans/TASK-000001.json";
  mkdirSync(join(symlinked.root, "plans"), { recursive: true });
  symlinkSync(target, join(symlinked.root, symlinkReference));
  track(symlinked.root, symlinkReference);
  assert.throws(
    () => reserve(symlinked.store, "symlink must block"),
    /unsafe tracked plan source/,
  );
  symlinked.store.close();
});

test("concurrent writers allocate distinct monotonic task IDs", async () => {
  const context = createWorkspace("concurrent");
  context.store.close();
  removeDatabase(context.databasePath);
  const storeModuleUrl = new URL("../failure-gate-v4/store.mjs", import.meta.url).href;
  const taskIds = await Promise.all(Array.from({ length: 6 }, () => runConcurrentReservation({
    ...context,
    storeModuleUrl,
  })));
  assert.equal(new Set(taskIds).size, 6);
  assert.deepEqual(taskIds.sort(), [
    "TASK-000001",
    "TASK-000002",
    "TASK-000003",
    "TASK-000004",
    "TASK-000005",
    "TASK-000006",
  ]);
});