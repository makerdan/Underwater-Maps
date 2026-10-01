import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path, { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, digestJson, sha256 } from "../failure-gate-v4/canonical.mjs";
import { FailureGateCoordinator, FailureGateStore } from "../failure-gate-v4/coordinator.mjs";
import {
  getRegisteredTierPolicy,
  getRegisteredValidationPolicy,
  TIER_POLICY_FILES,
} from "../failure-gate-v4/policy.mjs";
import { assertRecordedRunStopped, captureRunProcessIdentity } from "../failure-gate-v4/recovery.mjs";
import { withRunEnvironment } from "../failure-gate-v4/run-context.mjs";
import { captureWorkspaceSnapshot } from "../failure-gate-v4/snapshot.mjs";
import { runControlledWriter } from "../failure-gate-v4/writer-routes.mjs";
import {
  assertActiveWriterProof,
  runWriterLocked,
  withWriterLock,
  WriterLockTimeout,
} from "../failure-gate-v4/writer-lock.mjs";

const moduleUrl = new URL("../failure-gate-v4/writer-lock.mjs", import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(testDirectory, "../..");

async function makeSandbox() {
  const root = await mkdtemp(path.join(testDirectory, ".failure-gate-writer-lock-"));
  return {
    root,
    lockPath: path.join(root, "writer.lock"),
    file(name) {
      return path.join(root, name);
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await delay(10);
    }
  }
  assert.fail(`timed out waiting for ${filePath}`);
}

function childSource() {
  return `import { runWriterLocked } from ${JSON.stringify(moduleUrl.href)};
const status = await runWriterLocked(process.argv[1], [process.execPath, "-e", process.argv[2], ...process.argv.slice(3, -1)], { timeoutMs: Number(process.argv.at(-1) ?? 2000) });
process.exitCode = status;`;
}

function launchLocked(lockPath, code, args = [], timeoutMs = 2000) {
  return spawn(process.execPath, [
    "--input-type=module",
    "-e",
    childSource(),
    lockPath,
    code,
    ...args,
    String(timeoutMs),
  ], { stdio: "ignore" });
}

function waitForExit(child, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timed out waiting for child process"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeProductionRaceContext(box) {
  const root = box.root;
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Failure Gate writer-race fixture");
  git(root, "config", "user.email", "failure-gate-writer-race@example.invalid");
  await writeJson(join(root, ".agents/failure-gate-v4/reviewers.json"), {
    reviewers: [{ id: "admin", active: true }, { id: "Dan", active: true }],
  });
  await mkdir(join(root, "lib/api-spec"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Fixture\n<!-- GENERATED:API-ROUTES:START -->\n<!-- GENERATED:API-ROUTES:END -->\n");
  await writeFile(join(root, "replit.md"), "# Fixture\n<!-- GENERATED:API-ROUTES:START -->\n<!-- GENERATED:API-ROUTES:END -->\n");
  await writeFile(join(root, "lib/api-spec/openapi.yaml"), [
    "openapi: 3.0.0",
    "paths:",
    "  /fixture:",
    "    get:",
    "      tags: [datasets]",
    "      summary: Fixture endpoint",
    "",
  ].join("\n"));
  await copyFile(path.join(workspaceRoot, "scripts/generate-api-docs.mjs"),
    join(root, "scripts/generate-api-docs.mjs"));
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "writer race fixture project");

  for (const file of TIER_POLICY_FILES) {
    const target = join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(join(workspaceRoot, file), target);
  }
  const baselineTarget = join(root, "docs/validation/failure-baseline.json");
  await mkdir(path.dirname(baselineTarget), { recursive: true });
  await copyFile(join(workspaceRoot, "docs/validation/failure-baseline.json"), baselineTarget);
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "writer race fixture validation policy");

  const store = new FailureGateStore({
    projectNamespace: "test:writer-lock-live-final-race",
    databasePath: join(box.root, "fixture-runtime.sqlite"),
    projectRoot: root,
  });
  const coordinator = new FailureGateCoordinator({ store });
  const tierPolicy = getRegisteredTierPolicy(root, "test-fast");
  const task = store.reserveTask({
    plan: {
      title: "Exercise the production final completion writer race",
      validation: { rationale: "Fixture-only diagnostic", requirements: ["registered fast evidence fixture"] },
    },
    tier: "test-fast",
    tierDefinitionDigest: tierPolicy.tierDefinitionDigest,
    parameters: { mode: "diagnostic-fixture-only" },
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
    reference: "fixture:reviewed-diagnostic-plan",
  };
  await writeJson(join(root, `.agents/failure-gate-v4/decisions/${task.taskId}.json`), decision);
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", `approve fixture ${task.taskId}`);
  const revision = git(root, "rev-parse", "HEAD");
  const activeTask = coordinator.activateTask({
    taskId: task.taskId,
    revision,
    taskAgent: "fixture-agent",
  });
  return { root, store, coordinator, task: activeTask };
}

function fixtureRunSnapshot(runContext) {
  // This is a one-file fixture-adapter input for existing evidence validation,
  // never a workspace snapshot or all-writer claim. The terminal decision below
  // uses the coordinator's actual captured workspace snapshot and stays blocked.
  // Its environment binding comes from the actual captured run context.
  const manifest = {
    integrity: "verified",
    writerCoordination: {
      status: "verified",
      adapterId: "fixture-run-evidence-only-v1",
      evidenceDigest: "e".repeat(64),
    },
    files: [{ path: "fixture-run-input", digest: "a".repeat(64) }],
  };
  return {
    manifest,
    manifestContent: canonicalJson(manifest),
    manifestDigest: digestJson(manifest),
    environment: runContext.environment,
    environmentContent: runContext.environmentContent,
    environmentDigest: runContext.environmentDigest,
  };
}

async function makeFixtureRunEvidence(attempt) {
  const runRoot = join(homedir(), ".failure-gate-v4", "runs");
  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  await chmod(runRoot, 0o700);
  const reportPath = join(runRoot, `${randomUUID()}.json`);
  const caseDirectory = `${reportPath}.cases`;
  await mkdir(caseDirectory, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const summary = {
    schemaVersion: 1,
    available: false,
    notApplicable: true,
    reason: "this tier has no registered test-case suite",
    caseCount: 0,
    allPassed: false,
    reports: [],
  };
  const steps = attempt.stepResults.map(({ stepName }) => ({
    name: stepName,
    phase: "validation",
    status: "passed",
    rawExitStatus: 0,
    signal: null,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    discovery: null,
    reason: null,
  }));
  const report = {
    schemaVersion: 1,
    runner: "run-tier",
    tier: "fast",
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    rawExitStatus: 0,
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
  await writeFile(reportPath, reportBytes, { mode: 0o600 });
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
    schemaVersion: 2,
    complete: true,
    authorizationDigest: attempt.authorizationDigest,
    inputDigest: attempt.inputDigest,
    rawExitStatus: 0,
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
      rawExitStatus: 0,
      reportReference: reportPath,
      reportDigest,
    })),
  };
}

test("serializes cooperating foreground writers", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const events = box.file("events");
  const started = box.file("started");
  const first = launchLocked(box.lockPath,
    "const fs = await import('node:fs/promises'); const [events, started] = process.argv.slice(1); await fs.appendFile(events, 'first-start\\n'); await fs.writeFile(started, 'yes'); await new Promise(r => setTimeout(r, 180)); await fs.appendFile(events, 'first-end\\n');",
    [events, started]);
  await waitForFile(started);
  const second = launchLocked(box.lockPath,
    "const fs = await import('node:fs/promises'); await fs.appendFile(process.argv[1], 'second\\n');",
    [events]);

  assert.deepEqual(await waitForExit(first), { code: 0, signal: null });
  assert.deepEqual(await waitForExit(second), { code: 0, signal: null });
  assert.equal(await readFile(events, "utf8"), "first-start\nfirst-end\nsecond\n");
});

test("timeout fails closed without running the protected operation", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  let ran = false;
  const held = withWriterLock(box.lockPath, async () => new Promise((resolve) => setTimeout(resolve, 180)));
  await delay(30);
  await assert.rejects(
    withWriterLock(box.lockPath, () => { ran = true; }, { timeoutMs: 40 }),
    WriterLockTimeout,
  );
  assert.equal(ran, false);
  await held;
});

test("failed foreground commands preserve status and release the lock", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  assert.equal(await runWriterLocked(box.lockPath, [process.execPath, "-e", "process.exit(17)"]), 17);
  assert.equal(await runWriterLocked(box.lockPath, [process.execPath, "-e", "process.exit(0)"]), 0);
});

test("writer proofs are bound to the live lease, lock path, and exact snapshot", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const snapshotDigest = "a".repeat(64);
  let proof;
  await withWriterLock(box.lockPath, async (lock) => {
    proof = lock.createProof({
      snapshotDigest,
      snapshotIntegrity: "verified",
      adapterId: "test-flock",
    });
    assert.equal(assertActiveWriterProof(proof, {
      lockPath: lock.lockPath,
      snapshotDigest,
      snapshotIntegrity: "verified",
    }).adapterId, "test-flock");
    assert.throws(() => assertActiveWriterProof(proof, {
      lockPath: box.file("other.lock"),
      snapshotDigest,
    }), /active writer-lock proof/);
    assert.throws(() => assertActiveWriterProof(proof, {
      lockPath: lock.lockPath,
      snapshotDigest: "b".repeat(64),
    }), /active writer-lock proof/);
  });
  assert.throws(() => assertActiveWriterProof(proof, {
    lockPath: box.lockPath,
    snapshotDigest,
  }), /active writer-lock proof/);
});

test("rejects a symlink lock path", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const target = box.file("target");
  await writeFile(target, "");
  await import("node:fs/promises").then(({ symlink }) => symlink(target, box.lockPath));
  await assert.rejects(withWriterLock(box.lockPath, () => {}));
});

test("final input check and terminal write exclude a waiting cooperating writer", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const input = box.file("input");
  const terminal = box.file("terminal");
  const checked = box.file("checked");
  const writerDone = box.file("writer-done");
  await writeFile(input, "original");

  let writer;
  await withWriterLock(box.lockPath, async ({ lockPath, createProof }) => {
    const seen = await readFile(input, "utf8");
    await writeFile(checked, "yes");
    writer = launchLocked(box.lockPath,
      "const fs = await import('node:fs/promises'); const [input, done] = process.argv.slice(1); await fs.writeFile(input, 'changed'); await fs.writeFile(done, 'yes');",
      [input, writerDone]);
    await delay(60);
    await assert.rejects(readFile(writerDone), { code: "ENOENT" });
    const proof = createProof({
      snapshotDigest: "c".repeat(64),
      snapshotIntegrity: "verified",
      adapterId: "test-flock",
    });
    assertActiveWriterProof(proof, {
      lockPath,
      snapshotDigest: "c".repeat(64),
      snapshotIntegrity: "verified",
    });
    await writeFile(terminal, seen);
  });
  assert.equal(await readFile(terminal, "utf8"), "original");
  assert.deepEqual(await waitForExit(writer), { code: 0, signal: null });
  await waitForFile(writerDone);
  assert.equal(await readFile(input, "utf8"), "changed");
});

test("a foreground child retains the lock if its wrapper is killed", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const started = box.file("started");
  const finished = box.file("finished");
  const child = launchLocked(box.lockPath,
    "const fs = await import('node:fs/promises'); const [started, finished] = process.argv.slice(1); await fs.writeFile(started, 'yes'); await new Promise(r => setTimeout(r, 300)); await fs.writeFile(finished, 'yes');",
    [started, finished]);
  await waitForFile(started);
  child.kill("SIGKILL");
  assert.equal((await waitForExit(child)).signal, "SIGKILL");

  await assert.rejects(
    withWriterLock(box.lockPath, () => {}, { timeoutMs: 50 }),
    WriterLockTimeout,
  );
  await waitForFile(finished);
  await withWriterLock(box.lockPath, () => {}, { timeoutMs: 1000 });
});

test("diagnostic fixture: production completion denies an actual unknown snapshot while a registered writer waits", async (t) => {
  const box = await makeSandbox();
  t.after(() => box.cleanup());
  const home = box.file("home");
  await mkdir(home, { recursive: true });
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const lockPath = join(home, ".failure-gate-v4", "writer.lock");
  const auditPath = box.file("writer-routes.jsonl");
  let context;
  let attempt;
  let child;
  const generatedRunArtifacts = join(home, ".failure-gate-v4", "runs");

  try {
    context = await makeProductionRaceContext(box);
    const realCapturedSnapshot = await captureWorkspaceSnapshot(context.root);
    const runContext = withRunEnvironment(realCapturedSnapshot);
    attempt = context.coordinator.beginRunAttempt({
      taskId: context.task.taskId,
      expectedAuthorizationVersion: context.task.authorizationVersion,
      inputDigest: digestJson({ diagnostic: "writer-lock-live-final-race" }),
      snapshot: fixtureRunSnapshot(runContext),
    });
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    await once(child, "spawn");
    const identity = captureRunProcessIdentity(child.pid);
    context.store.recordRunProcessIdentity({ attemptId: attempt.attemptId, identity });
    const childClosed = once(child, "close");
    process.kill(-identity.processGroupId, "SIGTERM");
    await childClosed;
    assertRecordedRunStopped(identity);

    const evidence = await makeFixtureRunEvidence(attempt);
    context.coordinator.finishRunAttempt({
      attemptId: attempt.attemptId,
      outcome: "completed",
      evidence,
    });
    const assessment = context.store.assessRunAttempt({
      taskId: context.task.taskId,
      attemptId: attempt.attemptId,
    });
    assert.equal(assessment.eligible, true);

    let finalCheckEntered;
    const entered = new Promise((resolve) => { finalCheckEntered = resolve; });
    let continueFinalCheck;
    const paused = new Promise((resolve) => { continueFinalCheck = resolve; });
    const originalCompleteTask = context.store.completeTask.bind(context.store);
    context.store.completeTask = async (input) => {
      const proof = assertActiveWriterProof(input.writerProof, { lockPath });
      assert.equal(proof.snapshotIntegrity, "unknown");
      assert.equal(input.finalSnapshotDigest.length, 64);
      finalCheckEntered();
      await paused;
      return originalCompleteTask(input);
    };

    const completion = context.coordinator.completeTask({
      taskId: context.task.taskId,
      attemptId: attempt.attemptId,
      expectedAuthorizationVersion: context.task.authorizationVersion,
      authorizationDigest: attempt.authorizationDigest,
      inputDigest: attempt.inputDigest,
    });
    await entered;

    let writerFinished = false;
    const writer = runControlledWriter("generated-docs", {
      projectRoot: context.root,
      lockPath,
      auditPath,
      acquireTimeoutMs: 5000,
      orphanGraceMs: 100,
    }).then((status) => {
      writerFinished = true;
      return status;
    });
    await delay(100);
    assert.equal(writerFinished, false, "registered writer must wait while the production final check owns the lease");
    let routeEvents = [];
    try {
      routeEvents = (await readFile(auditPath, "utf8"))
        .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    assert.equal(routeEvents.some((event) => event.state === "acquired"), false);

    continueFinalCheck();
    await assert.rejects(
      completion,
      /completion is blocked: final snapshot integrity or effective writer coordination is unverified/,
    );
    assert.equal(context.store.getTask(context.task.taskId).status, "active");
    const completionBlocked = context.store.auditEvents(context.task.taskId)
      .find((event) => event.action === "completion_blocked");
    assert.ok(completionBlocked);
    assert.equal(completionBlocked.details.snapshotIntegrity, "unknown");
    assert.equal(context.store.auditEvents(context.task.taskId)
      .some((event) => event.action === "completed_terminal"), false);

    assert.equal(await writer, 0, "the waiting registered writer proceeds after the failed final decision");
    assert.match(await readFile(join(context.root, "README.md"), "utf8"), /Fixture endpoint/);
    routeEvents = (await readFile(auditPath, "utf8"))
      .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(routeEvents.map((event) => event.state), ["acquired", "running", "released"]);
    assert.equal(context.store.getTask(context.task.taskId).status, "active");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Child group already stopped. */ }
    }
    if (context) {
      context.coordinator.close();
      context.store.close();
    }
    await rm(generatedRunArtifacts, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});