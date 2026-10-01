import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXTERNAL_WRITER_BOUNDARY,
  getWriterRouteIds,
  runControlledWriter,
  WRITER_ROUTE_AUDIT_VERSION,
} from "../failure-gate-v4/writer-routes.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const docsGenerator = path.resolve(testDirectory, "../generate-api-docs.mjs");
const cli = path.resolve(testDirectory, "../failure-gate-v4/run-writer.mjs");
const startSentinel = "<!-- GENERATED:API-ROUTES:START -->";
const endSentinel = "<!-- GENERATED:API-ROUTES:END -->";

async function makeFixture({ scriptSuffix = "" } = {}) {
  const root = await mkdtemp(path.join(testDirectory, ".failure-gate-writer-routes-"));
  const lockPath = path.join(root, "writer.lock");
  const auditPath = path.join(root, "audit.jsonl");
  await mkdir(path.join(root, "lib/api-spec"), { recursive: true });
  await writeFile(path.join(root, "README.md"), `# Fixture\n${startSentinel}\n${endSentinel}\n`);
  await writeFile(path.join(root, "replit.md"), `# Fixture\n${startSentinel}\n${endSentinel}\n`);
  await writeFile(path.join(root, "lib/api-spec/openapi.yaml"), [
    "openapi: 3.0.0",
    "paths:",
    "  /fixture:",
    "    get:",
    "      tags: [datasets]",
    "      summary: Fixture endpoint",
    "",
  ].join("\n"));
  const scriptPath = path.join(root, "scripts/generate-api-docs.mjs");
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await copyFile(docsGenerator, scriptPath);
  if (scriptSuffix) await writeFile(scriptPath, `\n${scriptSuffix}\n`, { flag: "a" });
  return {
    root,
    lockPath,
    auditPath,
    scriptPath,
    options(overrides = {}) {
      return {
        projectRoot: root,
        lockPath,
        auditPath,
        acquireTimeoutMs: 500,
        orphanGraceMs: 80,
        ...overrides,
      };
    },
    async audit() {
      try {
        return (await readFile(auditPath, "utf8"))
          .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(10);
  }
  assert.fail("timed out waiting for writer route fixture state");
}

function launchCli(args) {
  return spawn(process.execPath, [cli, ...args], { stdio: "ignore" });
}

function waitExit(child, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timed out waiting for CLI process"));
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

test("only the versioned fixed routes are registered and arbitrary argv/proof options are refused", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fixture.cleanup());

  assert.deepEqual(getWriterRouteIds(), [
    "codegen-generate",
    "codegen-stale",
    "schema-drift",
    "generated-docs",
  ]);
  assert.equal(EXTERNAL_WRITER_BOUNDARY.status, "unknown");
  assert.equal(EXTERNAL_WRITER_BOUNDARY.verifiedSnapshotClaim, false);
  await assert.rejects(
    runControlledWriter("run-anything", fixture.options()),
    /arbitrary commands are refused/,
  );
  for (const extra of [
    { argv: ["/bin/sh", "-c", "touch escaped"] },
    { executable: "/bin/sh" },
    { writerProof: true },
    { snapshotIntegrity: "verified" },
    { skipLock: true },
  ]) {
    await assert.rejects(
      runControlledWriter("generated-docs", fixture.options(extra)),
      /options are not permitted/,
    );
  }

  const cliResult = await waitExit(launchCli(["generated-docs", "--check"]));
  assert.equal(cliResult.code, 2);
  assert.equal(await fixture.audit().then((events) => events.length), 0);
});

test("a real registered foreground generator holds the stable lease until it stops", async (t) => {
  const fixture = await makeFixture({
    scriptSuffix: "await new Promise((resolve) => setTimeout(resolve, 350));",
  });
  t.after(() => fixture.cleanup());

  const firstRun = runControlledWriter("generated-docs", fixture.options());
  const running = await waitFor(async () =>
    (await fixture.audit()).find((event) => event.state === "running"));
  assert.equal(running.auditVersion, WRITER_ROUTE_AUDIT_VERSION);
  assert.equal(running.routeId, "generated-docs");
  assert.equal(running.externalWriterBoundary.status, "unknown");
  assert.equal(running.externalWriterBoundary.verifiedSnapshotClaim, false);
  assert.deepEqual(running.argv, [fixture.scriptPath]);
  assert.match(running.routeDigest, /^[0-9a-f]{64}$/);
  assert.match(running.executable.sha256, /^[0-9a-f]{64}$/);
  assert.equal(running.entrypoints[0].path, "scripts/generate-api-docs.mjs");
  assert.match(running.entrypoints[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(running.outputScope, ["README.md", "replit.md"]);
  assert.ok(running.processIdentity.pid > 0);
  assert.equal(running.processIdentity.processGroupId, running.processIdentity.pid);

  await assert.rejects(
    runControlledWriter("generated-docs", fixture.options({ acquireTimeoutMs: 60 })),
    /writer route lock is held; nested-entry borrowing is unavailable/,
  );
  assert.equal(await firstRun, 0);

  const states = (await fixture.audit()).map((event) => event.state);
  assert.deepEqual(states, ["acquired", "running", "released"]);
});

test("a failed registered command is audited and releases only after its foreground process stops", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fixture.cleanup());
  await writeFile(path.join(fixture.root, "README.md"), "# missing sentinels\n");

  assert.equal(await runControlledWriter("generated-docs", fixture.options()), 1);
  const released = (await fixture.audit()).at(-1);
  assert.equal(released.state, "released");
  assert.equal(released.exitCode, 1);
  assert.equal(released.outcome, "finished");
  assert.equal(await runControlledWriter("generated-docs", fixture.options()), 1);
});

test("an orphan in the registered writer session is quarantined and keeps competitors blocked", async (t) => {
  const pidFile = path.join(tmpdir(), `failure-gate-v4-writer-orphan-${process.pid}`);
  const fixture = await makeFixture({
    scriptSuffix: [
      "const fixtureFs = await import('node:fs');",
      "import { spawn } from 'node:child_process';",
      `const orphan = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });`,
      `fixtureFs.writeFileSync(${JSON.stringify(pidFile)}, String(orphan.pid));`,
      "orphan.unref();",
    ].join("\n"),
  });
  t.after(async () => {
    try {
      const pid = Number(await readFile(pidFile, "utf8"));
      process.kill(pid, "SIGKILL");
    } catch { /* The orphan has already stopped. */ }
    await rm(pidFile, { force: true });
    await fixture.cleanup();
  });

  const running = runControlledWriter("generated-docs", fixture.options());
  const pid = await waitFor(async () => {
    try { return Number(await readFile(pidFile, "utf8")); } catch { return null; }
  });
  const quarantined = await waitFor(async () =>
    (await fixture.audit()).find((event) => event.state === "quarantined"));
  assert.equal(quarantined.processIdentity.processGroupId, quarantined.processIdentity.pid);
  await assert.rejects(
    runControlledWriter("generated-docs", fixture.options({ acquireTimeoutMs: 60 })),
    /writer route lock is held; nested-entry borrowing is unavailable/,
  );

  process.kill(pid, "SIGTERM");
  assert.equal(await running, 0);
  const released = (await fixture.audit()).at(-1);
  assert.equal(released.state, "released");
  assert.equal(released.quarantined, true);
  assert.equal(released.processIdentity.pid, quarantined.processIdentity.pid);
});

test("cancellation signals and joins the active process group before releasing", async (t) => {
  const fixture = await makeFixture({
    scriptSuffix: "await new Promise((resolve) => setTimeout(resolve, 5000));",
  });
  t.after(() => fixture.cleanup());
  const controller = new AbortController();
  const run = runControlledWriter("generated-docs", fixture.options({ signal: controller.signal }));
  await waitFor(async () => (await fixture.audit()).find((event) => event.state === "running"));
  controller.abort();
  assert.equal(await run, 143);

  const released = (await fixture.audit()).at(-1);
  assert.equal(released.state, "released");
  assert.equal(released.outcome, "cancelled");
  assert.equal(released.signal, "SIGTERM");
});