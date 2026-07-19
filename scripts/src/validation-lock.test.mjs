import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync,
  utimesSync, readdirSync,
} from "node:fs";
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

/**
 * Spawn validation-lock.mjs with the given lock file, optional flags
 * (--resource, --priority), and command args.
 *
 * opts.lockFile  — VALIDATION_LOCK_FILE override (required for isolation)
 * opts.waitersDir — VALIDATION_LOCK_WAITERS_DIR override (optional)
 * opts.flags     — array of flags to pass before "--", e.g. ["--resource", "codegen"]
 * opts.env       — extra env vars
 * opts.args      — command to wrap (array), default: ["node", "-e", "process.exit(0)"]
 */
function runLock({ lockFile, waitersDir, flags = [], env = {}, args = ["node", "-e", "process.exit(0)"] }) {
  const allArgs = [...flags, "--", ...args];
  // Strip all reentrancy markers from the inherited env so tests are isolated
  // from any outer validation-lock wrapper (e.g. the unit-cpu lock that wraps
  // the test:unit step when run via run-tier.mjs standard).
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("VALIDATION_LOCK_HELD_PID")),
  );
  const child = spawn(process.execPath, [script, ...allArgs], {
    env: {
      ...cleanEnv,
      VALIDATION_LOCK_FILE: lockFile,
      ...(waitersDir ? { VALIDATION_LOCK_WAITERS_DIR: waitersDir } : {}),
      VALIDATION_LOCK_POLL_MS: "50",
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

// ---------------------------------------------------------------------------
// Existing behaviour (backward-compat)
// ---------------------------------------------------------------------------

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
  await waitFor(() => waiter.stdout.includes("queued"), 10_000, "waiter to queue");

  const holderRes = await holder.done;
  assert.equal(holderRes.code, 0);
  const waiterRes = await waiter.done;
  assert.equal(waiterRes.code, 0, "waiter ran only after holder finished (marker existed)");
  assert.equal(existsSync(lockFile), false);
});

test("reclaims a stale lock whose recorded pid is dead", async () => {
  const lockFile = freshLockFile();
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

// ---------------------------------------------------------------------------
// Named resources
// ---------------------------------------------------------------------------

test("--resource gives each resource its own lock file", async () => {
  const lockA = freshLockFile();
  const lockB = freshLockFile();

  const a = runLock({ lockFile: lockA, flags: ["--resource", "codegen"], args: ["node", "-e", "process.exit(0)"] });
  const b = runLock({ lockFile: lockB, flags: ["--resource", "unit-cpu"], args: ["node", "-e", "process.exit(0)"] });

  const [resA, resB] = await Promise.all([a.done, b.done]);
  assert.equal(resA.code, 0);
  assert.equal(resB.code, 0);
  // Lock files are separate paths — both should be gone after clean exit.
  assert.equal(existsSync(lockA), false, "codegen lock released");
  assert.equal(existsSync(lockB), false, "unit-cpu lock released");
});

test("two processes competing for the same named resource serialize", async () => {
  const lockFile = freshLockFile();
  const marker = join(workDir, "named-queue-marker.txt");

  const holder = runLock({
    lockFile,
    flags: ["--resource", "codegen"],
    args: ["node", "-e", `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "done"), 500)`],
  });
  await waitFor(() => existsSync(lockFile), 10_000, "holder to acquire named lock");

  const waiter = runLock({
    lockFile,
    flags: ["--resource", "codegen"],
    args: ["node", "-e", `const fs=require("fs"); process.exit(fs.existsSync(${JSON.stringify(marker)}) ? 0 : 9)`],
  });
  await waitFor(() => waiter.stdout.includes("queued"), 10_000, "named waiter to queue");

  const holderRes = await holder.done;
  assert.equal(holderRes.code, 0);
  const waiterRes = await waiter.done;
  assert.equal(waiterRes.code, 0, "named waiter ran after holder (marker existed)");
});

test("processes for different named resources do not block each other", async () => {
  const lockA = freshLockFile();
  const lockB = freshLockFile();
  const done = { a: false, b: false };

  // Holder on resource "codegen" holds the lock for 400ms.
  const holderA = runLock({
    lockFile: lockA,
    flags: ["--resource", "codegen"],
    args: ["node", "-e", "setTimeout(() => {}, 400)"],
  });
  await waitFor(() => existsSync(lockA), 10_000, "holderA to acquire lock");

  // Waiter for resource "unit-cpu" (different lock file) should not queue
  // behind holderA at all.
  const start = Date.now();
  const waiterB = runLock({
    lockFile: lockB,
    flags: ["--resource", "unit-cpu"],
    args: ["node", "-e", "process.exit(0)"],
  });
  const resB = await waiterB.done;
  const elapsed = Date.now() - start;

  assert.equal(resB.code, 0, "different-resource waiter should not be blocked");
  // 1500ms is generous enough for Node.js startup overhead (~300-500ms) while
  // still catching any case where the waiter incorrectly blocks on holderA's
  // 400ms lock.
  assert.ok(elapsed < 1500, `different-resource waiter should not wait for holderA (elapsed ${elapsed}ms)`);

  holderA.child.kill("SIGTERM");
  await holderA.done;
});

test("reentrancy per named resource: nested wrapper for same resource skips re-acquire", async () => {
  const lockFile = freshLockFile();

  // Outer wrapper acquires "codegen" lock; inner wrapper for "codegen" should
  // skip re-acquisition (reentrancy) instead of deadlocking.
  const outer = runLock({
    lockFile,
    flags: ["--resource", "codegen"],
    args: [
      process.execPath, script,
      "--resource", "codegen",
      "--", "node", "-e", "process.exit(0)",
    ],
    env: {
      // Ensure inner wrapper uses the same lock file.
      VALIDATION_LOCK_FILE: lockFile,
      VALIDATION_LOCK_POLL_MS: "50",
    },
  });
  const res = await outer.done;
  assert.equal(res.code, 0, "nested same-resource invocation did not deadlock");
  assert.match(res.stdout, /lock already held by ancestor pid \d+/);
});

test("outer codegen lock exports only CODEGEN env var, not UNIT_CPU (correct per-resource env)", async () => {
  const lockFile = freshLockFile();
  const envDumpFile = join(workDir, `env-dump-${lockCounter++}.json`);

  // Verify the lock wrapper exports only its own resource's reentrancy env var.
  // The child command inspects what it sees in its environment.
  const outer = runLock({
    lockFile,
    flags: ["--resource", "codegen"],
    args: [
      "node", "-e",
      `require("fs").writeFileSync(${JSON.stringify(envDumpFile)}, JSON.stringify({
        codegen: process.env.VALIDATION_LOCK_HELD_PID_CODEGEN || null,
        unitCpu: process.env.VALIDATION_LOCK_HELD_PID_UNIT_CPU || null,
        global:  process.env.VALIDATION_LOCK_HELD_PID || null,
      })); process.exit(0);`,
    ],
  });
  const res = await outer.done;
  assert.equal(res.code, 0);

  const envDump = JSON.parse(readFileSync(envDumpFile, "utf8"));
  // CODEGEN reentrancy var must be set (outer holds the codegen lock).
  assert.ok(envDump.codegen, "VALIDATION_LOCK_HELD_PID_CODEGEN must be set in child env");
  // UNIT_CPU reentrancy var must NOT be set (different resource — no reentrancy skip).
  assert.ok(!envDump.unitCpu, "VALIDATION_LOCK_HELD_PID_UNIT_CPU must NOT be set in child env");
  // Legacy global var must NOT be set (resource is 'codegen', not 'global').
  assert.ok(!envDump.global, "VALIDATION_LOCK_HELD_PID (legacy) must NOT be set for non-global resource");
});

// ---------------------------------------------------------------------------
// Priority queue
// ---------------------------------------------------------------------------

test("higher-priority waiter acquires lock before lower-priority waiter", { timeout: 30_000 }, async () => {
  const lockFile = freshLockFile();
  const waitersDir = join(workDir, `waiters-prio-${lockCounter}`);
  const order = join(workDir, `prio-order-${lockCounter++}.txt`);

  // Holder holds the lock indefinitely — we release it manually after both
  // waiters are confirmed to be queued and the grace period has elapsed.
  const holder = runLock({
    lockFile,
    waitersDir,
    args: ["node", "-e", "setTimeout(() => {}, 60000)"],
  });
  await waitFor(() => existsSync(lockFile), 10_000, "holder to acquire lock");

  // Low-priority waiter queues first (priority 5 = default).
  const low = runLock({
    lockFile,
    waitersDir,
    flags: ["--priority", "5"],
    args: [
      "node", "-e",
      // "low\\n" — literal backslash-n so the embedded script sees "low\n"
      // as an escape sequence.  A real newline in "..." is a SyntaxError.
      `require("fs").appendFileSync(${JSON.stringify(order)}, "low\\n"); process.exit(0)`,
    ],
    env: { VALIDATION_LOCK_PRIORITY_GRACE_MS: "200" },
  });
  await waitFor(() => low.stdout.includes("queued"), 15_000, "low waiter to queue");

  // High-priority waiter queues second (priority 1).
  const high = runLock({
    lockFile,
    waitersDir,
    flags: ["--priority", "1"],
    args: [
      "node", "-e",
      `require("fs").appendFileSync(${JSON.stringify(order)}, "high\\n"); process.exit(0)`,
    ],
    env: { VALIDATION_LOCK_PRIORITY_GRACE_MS: "200" },
  });
  // Wait until the high-priority waiter is also confirmed to be polling.
  await waitFor(() => high.stdout.includes("queued"), 15_000, "high waiter to queue");

  // Wait an extra 400 ms so high has been in the manifest for well over the
  // 200 ms grace period.  At this point low *must* yield to high on each poll.
  await sleep(400);

  // Release the holder; low's next poll will yield (high > grace), high will
  // acquire the lock and run its command first.
  holder.child.kill("SIGTERM");
  await holder.done;

  const [lowRes, highRes] = await Promise.all([low.done, high.done]);
  assert.equal(lowRes.code, 0, `low exited non-zero: code=${lowRes.code} stderr=${lowRes.stderr}`);
  assert.equal(highRes.code, 0, `high exited non-zero: code=${highRes.code} stderr=${highRes.stderr}`);

  const acquired = readFileSync(order, "utf8").trim().split("\n");
  assert.equal(acquired[0], "high", `high-priority waiter should acquire first; got order: ${acquired.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Waiter manifest cleanup
// ---------------------------------------------------------------------------

test("waiter manifest entry is removed after lock acquisition", async () => {
  const lockFile = freshLockFile();
  const waitersDir = join(workDir, `waiters-cleanup-${lockCounter++}`);

  const run = runLock({
    lockFile,
    waitersDir,
    args: ["node", "-e", "setTimeout(() => {}, 50)"],
  });
  // Once the lock is acquired the waiter manifest should already be gone.
  await waitFor(() => existsSync(lockFile), 10_000, "lock to be acquired");
  // Give a brief moment for the manifest write+delete cycle.
  await sleep(100);
  try {
    const files = readdirSync(waitersDir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 0, `waiter manifest entry should be removed after acquisition; found: ${files.join(", ")}`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // waitersDir doesn't exist = no manifest entries. That's also fine.
  }

  await run.done;
});

test("waiter manifest entry is removed on SIGTERM (before acquisition)", async () => {
  const lockFile = freshLockFile();
  const waitersDir = join(workDir, `waiters-sigterm-${lockCounter++}`);

  // Holder holds the lock so the waiter must queue.
  const holder = runLock({
    lockFile,
    waitersDir,
    args: ["node", "-e", "setTimeout(() => {}, 60000)"],
  });
  await waitFor(() => existsSync(lockFile), 10_000, "holder to acquire lock");

  const waiter = runLock({
    lockFile,
    waitersDir,
    args: ["node", "-e", "setTimeout(() => {}, 60000)"],
  });
  await waitFor(() => waiter.stdout.includes("queued"), 15_000, "waiter to queue");

  // Waiter manifest entry should exist while waiting.
  await waitFor(() => {
    try {
      return readdirSync(waitersDir).filter((f) => f.endsWith(".json")).length > 0;
    } catch { return false; }
  }, 5_000, "waiter manifest entry to appear");

  // Kill the waiter before it acquires the lock.
  waiter.child.kill("SIGTERM");
  await waiter.done;

  // After SIGTERM the waiter manifest entry should be gone.
  await sleep(100);
  try {
    const files = readdirSync(waitersDir).filter((f) => f.endsWith(".json"));
    // Only the holder's entry (if any) should remain — the killed waiter's is gone.
    const waiterEntry = files.find((f) => f === `${waiter.child.pid}.json`);
    assert.equal(waiterEntry, undefined, "killed waiter's manifest entry should be removed on SIGTERM");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  holder.child.kill("SIGTERM");
  await holder.done;
});
