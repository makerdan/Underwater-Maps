import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "..", "validation-lock.mjs");

let workDir;
before(() => { workDir = mkdtempSync(join(tmpdir(), "vlock-test-")); });
after(() => { rmSync(workDir, { recursive: true, force: true }); });

let lockCounter = 0;
function freshLockFile() {
  return join(workDir, `serial-${lockCounter++}.lock`);
}

function runLock({ lockFile, env = {}, args }) {
  const child = spawn(process.execPath, [script, "--", ...args], {
    env: {
      ...process.env,
      VALIDATION_LOCK_FILE: lockFile,
      VALIDATION_LOCK_POLL_MS: "50",
      // The whole test suite may itself run under a validation-lock wrapper
      // (e.g. inside the test-heavy validation step). Clear the reentrancy
      // marker so spawned wrappers actually exercise the locking logic.
      VALIDATION_LOCK_HELD_PID: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  const done = new Promise((res) => {
    child.on("exit", (code, signal) => res({ code, signal, get stdout() { return stdout; }, get stderr() { return stderr; } }));
  });
  return {
    child, done,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 10_000, label = "condition") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for ${label}`);
}

test("acquires lock, runs command, propagates exit code, releases lock", async () => {
  const lockFile = freshLockFile();
  const ok = runLock({ lockFile, args: ["node", "-e", "process.exit(0)"] });
  const okRes = await ok.done;
  assert.equal(okRes.code, 0);
  assert.equal(existsSync(lockFile), false, "lock file removed after clean exit");
  assert.match(okRes.stdout, /lock acquired/);

  const fail = runLock({ lockFile, args: ["node", "-e", "process.exit(7)"] });
  const failRes = await fail.done;
  assert.equal(failRes.code, 7, "wrapped command exit code propagated");
  assert.equal(existsSync(lockFile), false);
});

test("second process queues behind holder and runs after release", async () => {
  const lockFile = freshLockFile();
  const marker = join(workDir, "queue-marker.txt");
  const holder = runLock({
    lockFile,
    args: ["node", "-e", `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "done"), 600)`],
  });
  await waitFor(() => existsSync(lockFile), 10_000, "holder to acquire lock");

  const waiter = runLock({
    lockFile,
    args: ["node", "-e", `const fs=require("fs"); process.exit(fs.existsSync(${JSON.stringify(marker)}) ? 0 : 9)`],
  });
  await waitFor(() => waiter.stdout.includes("queued, waiting"), 10_000, "waiter to queue");

  const holderRes = await holder.done;
  assert.equal(holderRes.code, 0);
  const waiterRes = await waiter.done;
  assert.equal(waiterRes.code, 0, "waiter ran only after holder finished (marker existed)");
  assert.equal(existsSync(lockFile), false);
});

test("reclaims a stale lock whose recorded pid is dead", async () => {
  const lockFile = freshLockFile();
  // Spawn a short-lived process to get a genuinely dead pid.
  const deadProc = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const deadPid = deadProc.pid;
  await new Promise((r) => deadProc.on("exit", r));
  writeFileSync(lockFile, `${deadPid}\n${Date.now()}\n`);

  const run = runLock({ lockFile, args: ["node", "-e", "process.exit(0)"] });
  const res = await run.done;
  assert.equal(res.code, 0);
  assert.match(res.stdout, /reclaiming stale lock \(held by dead pid/);
  assert.equal(existsSync(lockFile), false);
});

test("reclaims a lock with a stale heartbeat even if pid is alive (pid reuse)", async () => {
  const lockFile = freshLockFile();
  // Use our own (alive, non-heartbeating) pid to simulate pid reuse.
  writeFileSync(lockFile, `${process.pid}\n${Date.now()}\n`);
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockFile, old, old);

  const run = runLock({
    lockFile,
    env: { VALIDATION_LOCK_STALE_HEARTBEAT_MS: "500" },
    args: ["node", "-e", "process.exit(0)"],
  });
  const res = await run.done;
  assert.equal(res.code, 0);
  assert.match(res.stdout, /heartbeat stale/);
});

test("holder heartbeat keeps lock fresh; waiter does not reclaim", async () => {
  const lockFile = freshLockFile();
  const holder = runLock({
    lockFile,
    env: { VALIDATION_LOCK_HEARTBEAT_MS: "100" },
    args: ["node", "-e", "setTimeout(() => {}, 1200)"],
  });
  await waitFor(() => existsSync(lockFile), 10_000, "holder to acquire lock");

  const waiter = runLock({
    lockFile,
    env: { VALIDATION_LOCK_STALE_HEARTBEAT_MS: "600" },
    args: ["node", "-e", "process.exit(0)"],
  });
  const holderRes = await holder.done;
  assert.equal(holderRes.code, 0);
  const waiterRes = await waiter.done;
  assert.equal(waiterRes.code, 0);
  assert.doesNotMatch(waiter.stdout, /reclaiming stale lock/, "heartbeating holder must not be reclaimed");
});

test("max-hold-age safety valve reclaims a hung-but-alive holder", async () => {
  const lockFile = freshLockFile();
  const holder = runLock({
    lockFile,
    env: { VALIDATION_LOCK_HEARTBEAT_MS: "100" },
    args: ["node", "-e", "setTimeout(() => {}, 60000)"],
  });
  await waitFor(() => existsSync(lockFile), 10_000, "holder to acquire lock");

  const waiter = runLock({
    lockFile,
    env: {
      VALIDATION_LOCK_STALE_HEARTBEAT_MS: "60000",
      VALIDATION_LOCK_MAX_HOLD_MS: "400",
    },
    args: ["node", "-e", "process.exit(0)"],
  });
  const waiterRes = await waiter.done;
  assert.equal(waiterRes.code, 0, "waiter proceeds despite hung holder");
  assert.match(waiter.stderr, /max-hold safety valve/);
  holder.child.kill("SIGTERM");
  await holder.done;
});

test("nested wrapper under a lock-holding ancestor runs without re-acquiring (no self-deadlock)", async () => {
  const lockFile = freshLockFile();
  // Outer wrapper runs an inner wrapper as its wrapped command; without
  // reentrancy the inner one would queue forever behind its own ancestor.
  const outer = runLock({
    lockFile,
    args: [
      process.execPath, script, "--", "node", "-e", "process.exit(0)",
    ],
  });
  const res = await outer.done;
  assert.equal(res.code, 0, "nested invocation completed instead of deadlocking");
  assert.match(res.stdout, /lock already held by ancestor pid \d+/);
  assert.equal(existsSync(lockFile), false);
});

test("SIGTERM releases the lock and terminates the wrapped command", async () => {
  const lockFile = freshLockFile();
  const holder = runLock({
    lockFile,
    args: ["node", "-e", "setTimeout(() => {}, 60000)"],
  });
  await waitFor(() => existsSync(lockFile), 10_000, "holder to acquire lock");
  assert.equal(readFileSync(lockFile, "utf8").split("\n")[0], String(holder.child.pid));

  holder.child.kill("SIGTERM");
  const res = await holder.done;
  assert.equal(res.code, 1);
  assert.equal(existsSync(lockFile), false, "lock released on SIGTERM");
});
