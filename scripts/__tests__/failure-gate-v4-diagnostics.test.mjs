import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digestJson } from "../failure-gate-v4/canonical.mjs";
import {
  FAILURE_GATE_DIAGNOSTICS_CAPABILITIES,
  FailureGateDiagnostics,
  resolveStoredDiagnosticRunRecord,
} from "../failure-gate-v4/diagnostics.mjs";
import { getRegisteredValidationPolicy, TIER_POLICY_FILES } from "../failure-gate-v4/policy.mjs";

const ISOLATION_TEST_FILE = "scripts/__tests__/isolation-fixture.test.mjs";
const SUCCESS_CASE = "diagnostics fixture passing case";
const FAILURE_CASE = "diagnostics fixture controlled failure";
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIAGNOSTICS_TEST_FILE = fileURLToPath(import.meta.url);
let isolationRootPromise;

async function diagnosticsFixture(projectRoot) {
  projectRoot ??= await getIsolationRoot();
  const policy = getRegisteredValidationPolicy(projectRoot);
  const taskId = "TASK-000001";
  const plan = {
    taskId,
    projectNamespace: "diagnostics-test",
    planVersion: 1,
    validation: {
      tier: "test-fast",
      why: "Exercise the diagnostics-only local classification boundary.",
      doNotEscalate: "Run only this authorized tier test-fast; do not escalate.",
      maximumTier: "test-fast",
      noEscalation: true,
    },
    baselines: { ignore: [], owned: [] },
    regressionGuard: { selfSatisfying: "The diagnostics service is its own focused test subject." },
  };
  const task = {
    taskId,
    projectNamespace: plan.projectNamespace,
    planVersion: plan.planVersion,
    plan,
    planDigest: digestJson(plan),
    status: "draft",
    requestedTier: "test-fast",
    tierDefinitionDigest: policy.tiers["test-fast"].tierDefinitionDigest,
  };
  const store = {
    projectRoot,
    database: new DatabaseSync(":memory:"),
    getTask(id) {
      return id === taskId ? task : null;
    },
  };
  return { taskId, store, diagnostics: new FailureGateDiagnostics({ store }) };
}

async function createTrackedIsolationRoot() {
  const projectRoot = PROJECT_ROOT;
  const root = await mkdtemp(join(tmpdir(), "failure-gate-v4-diagnostics-test-"));
  const files = [...new Set([...TIER_POLICY_FILES, "docs/validation/failure-baseline.json"])];
  for (const relativePath of files) {
    const source = resolve(projectRoot, relativePath);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`diagnostics fixture requires regular policy input '${relativePath}'`);
    }
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    let content = await readFile(source);
    if (relativePath === ".npmrc") {
      const safeLines = content.toString("utf8").split(/\r?\n/).map((line) => {
        const separator = line.indexOf("=");
        if (separator < 0 || !/(?:auth|token|password|username)/i.test(line.slice(0, separator))) return line;
        return `${line.slice(0, separator)}=<redacted>`;
      });
      content = Buffer.from(safeLines.join("\n"), "utf8");
    }
    await writeFile(destination, content, { mode: 0o600 });
  }
  const fixtureContents = [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `test(${JSON.stringify(SUCCESS_CASE)}, () => assert.equal(2 + 2, 4));`,
    `test(${JSON.stringify(FAILURE_CASE)}, () => {`,
    '  if (process.env.FAILURE_GATE_V4_ISOLATION === "1") assert.fail("controlled fixture failure");',
    "});",
    "",
  ].join("\n");
  const fixturePath = join(root, ISOLATION_TEST_FILE);
  await mkdir(dirname(fixturePath), { recursive: true, mode: 0o700 });
  await writeFile(fixturePath, fixtureContents, { mode: 0o600 });
  execFileSync("git", ["-C", root, "init", "--quiet"], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "add", "--", ...files, ISOLATION_TEST_FILE], { stdio: "ignore" });
  execFileSync("git", [
    "-C", root,
    "-c", "user.name=Failure Gate diagnostics tests",
    "-c", "user.email=diagnostics-tests@example.invalid",
    "commit", "--quiet", "-m", "create isolated diagnostics fixture",
  ], { stdio: "ignore" });
  return root;
}

function getIsolationRoot() {
  isolationRootPromise ??= createTrackedIsolationRoot();
  return isolationRootPromise;
}

after(async () => {
  if (!isolationRootPromise) return;
  const root = await isolationRootPromise;
  await rm(root, { recursive: true, force: true });
});

function makeObserved(testName, marker = "same-failure") {
  return {
    suite: "focused Node test suite",
    test: testName,
    failureSignature: `diagnostic test signature ${marker}`,
    environment: { tier: "test-fast", runtime: process.version },
  };
}

test("plan ownership is derived from the reserved plan and tracked catalog", async () => {
  const { diagnostics, store, taskId } = await diagnosticsFixture();
  try {
    await assert.rejects(
      diagnostics.derivePlanOwnership({ taskId, ownedBaselineIds: ["BASE-CALLER-CLAIM"] }),
      /unsupported fields/,
    );
    const ownership = await diagnostics.derivePlanOwnership({ taskId });
    assert.equal(ownership.taskId, taskId);
    assert.match(ownership.planDigest, /^[0-9a-f]{64}$/);
    assert.match(ownership.catalogDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(ownership.ignoredBaselineIds, []);
    assert.deepEqual(ownership.ownedBaselineIds, []);
  } finally {
    store.database.close();
  }
});

test("untrusted exact identities persist as immutable blocked diagnostics", async () => {
  const { diagnostics, store, taskId } = await diagnosticsFixture();
  const observed = {
    suite: "unit suite",
    test: "example.test.mjs — exact test",
    failureSignature: "assertion failed: expected current value",
    environment: { tier: "test-fast", variant: "node-test" },
  };
  try {
    const result = await diagnostics.classify({ taskId, observed });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.accepted, false);
    assert.equal(result.planOwnershipDerived, true);

    const stored = diagnostics.getDiagnostic(result.diagnosticReference);
    assert.deepEqual(stored.diagnostic.observed, observed);
    assert.equal(stored.diagnostic.observationTrust, "caller-supplied-untrusted");
    assert.equal(stored.diagnostic.outcome, "blocked");
    assert.equal(stored.diagnostic.accepted, false);
    assert.equal(Object.hasOwn(stored.diagnostic, "verified"), false);
    assert.match(stored.digest, /^[0-9a-f]{64}$/);

    const table = "failure_gate_v4_diagnostic_requests";
    assert.throws(
      () => store.database.prepare(`UPDATE ${table} SET diagnostic_content = '{}'` ).run(),
      /immutable/,
    );
  } finally {
    store.database.close();
  }
});

test("caller assertions and arbitrary isolation execution are rejected", async () => {
  const { diagnostics, store, taskId } = await diagnosticsFixture();
  const observed = {
    suite: "unit suite",
    test: "example.test.mjs — exact test",
    failureSignature: "assertion failed",
    environment: {},
  };
  try {
    await assert.rejects(
      diagnostics.classify({
        taskId,
        observed,
        preTaskEvidence: { verified: true, outcome: "fail" },
      }),
      /unsupported fields/,
    );
    await assert.rejects(
      diagnostics.classify({ taskId, observed, ownedBaselineIds: ["BASE-CALLER-CLAIM"] }),
      /unsupported fields/,
    );
    await assert.rejects(
      diagnostics.runIsolationRetry({
        taskId,
        observed,
        testName: observed.test,
        testFile: ISOLATION_TEST_FILE,
        command: "arbitrary command",
      }),
      /unsupported fields/,
    );
    await assert.rejects(
      diagnostics.runIsolationRetry({
        taskId,
        observed: makeObserved("declared exact baseline is ignored only when authoritative, active, and unexpired"),
        testName: "declared exact baseline is ignored only when authoritative, active, and unexpired",
        testFile: ISOLATION_TEST_FILE,
        env: { PATH: "/tmp/attacker-bin" },
      }),
      /unsupported fields/,
    );
    const untrackedTestFile = "scripts/__tests__/untracked-isolation-fixture.test.mjs";
    const untrackedTestPath = join(await getIsolationRoot(), untrackedTestFile);
    await writeFile(untrackedTestPath, 'import { test } from "node:test"; test("untracked", () => {});', {
      mode: 0o600,
    });
    try {
      await assert.rejects(
        diagnostics.runIsolationRetry({
          taskId,
          observed: makeObserved(SUCCESS_CASE),
          testName: SUCCESS_CASE,
          testFile: untrackedTestFile,
        }),
        /not tracked by Git/,
      );
    } finally {
      await unlink(untrackedTestPath);
    }
    assert.equal(FAILURE_GATE_DIAGNOSTICS_CAPABILITIES.trustedIsolationExecution, true);
    assert.equal(FAILURE_GATE_DIAGNOSTICS_CAPABILITIES.callerObservedIsolationTrusted, false);
    assert.equal(FAILURE_GATE_DIAGNOSTICS_CAPABILITIES.boundedNodeTestIsolation, true);
    assert.equal(FAILURE_GATE_DIAGNOSTICS_CAPABILITIES.maxIsolationRetries, 3);
  } finally {
    store.database.close();
  }
});

test("stored-source diagnosis accepts selectors only and requires the synchronous canonical resolver", async () => {
  const { diagnostics, store, taskId } = await diagnosticsFixture();
  const selector = {
    taskId,
    attemptId: "attempt-with-no-record",
    reportReference: "runs/report.json",
    reportDigest: "a".repeat(64),
    caseId: "b".repeat(64),
  };
  try {
    await assert.rejects(
      diagnostics.runStoredIsolationRetry({
        ...selector,
        observed: makeObserved(SUCCESS_CASE),
      }),
      /unsupported fields/,
    );
    await assert.rejects(
      diagnostics.runStoredIsolationRetry(selector),
      /without synchronous getStoredRunRecord/,
    );
    assert.equal(FAILURE_GATE_DIAGNOSTICS_CAPABILITIES.trustedStoredSourceIsolation, true);
    assert.equal(FAILURE_GATE_DIAGNOSTICS_CAPABILITIES.v2BoundDiagnosticRetryEvidence, true);
  } finally {
    store.database.close();
  }
});

test("bounded Node isolation stores passing raw status, TAP discovery, and both snapshots", async () => {
  const { diagnostics, store, taskId } = await diagnosticsFixture();
  try {
    const result = await diagnostics.runIsolationRetry({
      taskId,
      observed: makeObserved(SUCCESS_CASE),
      testFile: ISOLATION_TEST_FILE,
      testName: SUCCESS_CASE,
    });
    assert.equal(result.retryNumber, 1);
    assert.equal(result.rawExitStatus, 0);
    assert.equal(result.outcome, "blocked");
    assert.equal(result.accepted, false);
    const stored = diagnostics.getIsolationAttempt(result.reference);
    assert.equal(stored.attempt.execution.rawExitStatus, 0);
    assert.equal(resolveStoredDiagnosticRunRecord({
      store,
      taskId,
      attemptId: result.attemptId,
    }), null);
    assert.equal(stored.attempt.discovery.available, true);
    assert.ok(stored.attempt.beforeSnapshot.manifestDigest);
    assert.ok(stored.attempt.afterSnapshot.manifestDigest);
    assert.equal(stored.attempt.ownershipStable, true);
    assert.equal(stored.attempt.identityBinding.selectedCaseTitleMatched, true);
    assert.equal(stored.attempt.identityBinding.failureSignatureBound, false);
    assert.equal(stored.attempt.identityBinding.verified, false);
    assert.throws(
      () => store.database.prepare(`
        UPDATE failure_gate_v4_isolation_attempts SET attempt_content = '{}'
      `).run(),
      /immutable/,
    );
    store.database.exec("DROP TRIGGER failure_gate_v4_isolation_attempts_immutable_update");
    store.database.prepare(`
      UPDATE failure_gate_v4_isolation_attempts
      SET attempt_content = attempt_content || 'corrupt'
      WHERE attempt_id = ?
    `).run(result.attemptId);
    assert.throws(
      () => diagnostics.getIsolationAttempt(result.reference),
      /hash does not match/,
    );
  } finally {
    store.database.close();
  }
});

test("literal exact selection records zero discovery without treating it as a pass", async () => {
  const { diagnostics, store, taskId } = await diagnosticsFixture();
  const missingName = "no test has this exact (title) [literal]";
  try {
    const result = await diagnostics.runIsolationRetry({
      taskId,
      observed: makeObserved(missingName),
      testFile: ISOLATION_TEST_FILE,
      testName: missingName,
    });
    assert.equal(result.rawExitStatus, 0);
    assert.equal(result.discovery.available, false);
    assert.equal(result.discovery.complete, false);
    const stored = diagnostics.getIsolationAttempt(result.reference);
    assert.equal(stored.attempt.discovery.selectedCaseCount, 0);
    assert.equal(stored.attempt.accepted, false);
  } finally {
    store.database.close();
  }
});

test("Node TAP failure status is stored for a deterministic tracked fixture", async () => {
  const { diagnostics, store, taskId } = await diagnosticsFixture();
  try {
    const result = await diagnostics.runIsolationRetry({
      taskId,
      observed: makeObserved(FAILURE_CASE),
      testFile: ISOLATION_TEST_FILE,
      testName: FAILURE_CASE,
    });
    assert.equal(result.rawExitStatus, 1);
    assert.equal(result.discovery.available, true);
    assert.equal(result.outcome, "blocked");
    assert.equal(diagnostics.getIsolationAttempt(result.reference).attempt.accepted, false);
  } finally {
    store.database.close();
  }
});

test("the exact task/failure identity rejects a fourth reserved isolation attempt", async () => {
  const { diagnostics, store, taskId } = await diagnosticsFixture();
  const identity = makeObserved(SUCCESS_CASE, "retry-limit");
  try {
    const attempts = [];
    for (let retryNumber = 1; retryNumber <= 3; retryNumber += 1) {
      attempts.push(await diagnostics.runIsolationRetry({
        taskId,
        observed: identity,
        testFile: ISOLATION_TEST_FILE,
        testName: SUCCESS_CASE,
      }));
    }
    assert.deepEqual(attempts.map(({ retryNumber }) => retryNumber), [1, 2, 3]);
    await assert.rejects(
      diagnostics.runIsolationRetry({
        taskId,
        observed: identity,
        testFile: ISOLATION_TEST_FILE,
        testName: SUCCESS_CASE,
      }),
      /retry limit reached/,
    );
    assert.equal(diagnostics.listIsolationAttempts({ taskId }).length, 3);
  } finally {
    store.database.close();
  }
});

test("diagnostics fixture cwd probe", async () => {
  if (process.env.FAILURE_GATE_V4_DIAGNOSTICS_CWD_PROBE !== "1") return;
  const { store } = await diagnosticsFixture();
  const root = await getIsolationRoot();
  try {
    const fixture = await lstat(join(root, ISOLATION_TEST_FILE));
    assert.equal(fixture.isFile(), true);
    const tracked = execFileSync("git", [
      "-C", root, "ls-files", "--error-unmatch", "--", ISOLATION_TEST_FILE,
    ], { encoding: "utf8" }).trim();
    assert.equal(tracked, ISOLATION_TEST_FILE);
  } finally {
    store.database.close();
  }
});

test("tracked diagnostics fixture builds from both repository and scripts working directories", () => {
  for (const cwd of [PROJECT_ROOT, join(PROJECT_ROOT, "scripts")]) {
    execFileSync(process.execPath, [
      "--test",
      "--test-name-pattern=diagnostics fixture cwd probe",
      DIAGNOSTICS_TEST_FILE,
    ], {
      cwd,
      env: { ...process.env, FAILURE_GATE_V4_DIAGNOSTICS_CWD_PROBE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
});
