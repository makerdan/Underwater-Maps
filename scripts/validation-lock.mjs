#!/usr/bin/env node
/**
 * validation-lock.mjs — cross-process serialization for validation steps.
 *
 * Problem: the validation harness may trigger several heavy steps (typecheck,
 * unit tests, two Playwright e2e suites, lint) at the same time on one
 * machine. The suites then contend for CPU and their run budgets
 * (tests/timeout-guard/budgets.json) — which are calibrated for an idle
 * machine — get breached even though every test passes. There are also real
 * races: concurrent codegen regenerating lib/api-zod/src/generated/api.ts,
 * and port collisions between e2e suites.
 *
 * Fix: each heavy validation command is wrapped as
 *   node scripts/validation-lock.mjs [--resource <name>] [--priority <1-9>] -- <command...>
 *
 * Named resources: pass --resource <name> to acquire a per-resource lock
 * (.local/validation-lock-<name>.lock) instead of the single global lock.
 * Steps that don't conflict with each other use different resource names and
 * run in parallel; steps that share a resource serialize. Default resource
 * is "global" for backward compatibility.
 *
 * Priority queue: pass --priority <N> (1 = highest, 9 = lowest; default 5).
 * Each waiting process writes a waiter manifest entry to
 * .local/validation-waiters-<name>/<pid>.json. On each poll tick, a waiter
 * checks whether any other waiter with a strictly higher priority (lower N)
 * has been waiting longer than PRIORITY_GRACE_MS; if so it backs off,
 * biasing the OS-level lock race toward the more important step.
 *
 * Stale-lock handling (three layers, checked by waiting processes):
 *  1. Dead-pid reclaim: the lock file records the holder pid; if that
 *     process is no longer alive the lock is reclaimed.
 *  2. Stale-heartbeat reclaim: the holder touches the lock file's mtime
 *     every HEARTBEAT_MS. If the mtime is older than STALE_HEARTBEAT_MS the
 *     holder is presumed gone even if its pid appears alive (pid reuse
 *     after SIGKILL) and the lock is reclaimed.
 *  3. Max-hold-age safety valve: if the lock has been held longer than
 *     MAX_HOLD_MS (holder hung but alive and heartbeating), waiters reclaim
 *     it with a loud warning rather than stalling until the wait timeout.
 *
 * Lock file format: line 1 = holder pid, line 2 = acquire time (ms epoch).
 * Lock location: .local/validation-lock-<resource>.lock
 *   (override: VALIDATION_LOCK_FILE env var, applied before resource logic)
 *
 * Reentrancy: nested wrappers for the same resource skip acquisition if an
 * ancestor already holds it. The holder exports
 * VALIDATION_LOCK_HELD_PID_<RESOURCE_UPPER> (e.g. _CODEGEN, _UNIT_CPU).
 * For backward compatibility the legacy VALIDATION_LOCK_HELD_PID var is also
 * checked/set when resource is "global".
 */
import {
  openSync, closeSync, unlinkSync, mkdirSync, writeSync, writeFileSync, readFileSync,
  utimesSync, statSync, readdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const localDir = resolve(root, ".local");

const POLL_INTERVAL_MS = Number(process.env.VALIDATION_LOCK_POLL_MS || 1_000);
const TIMEOUT_MS = Number(process.env.VALIDATION_LOCK_TIMEOUT_MS || 3 * 60 * 60 * 1000);
const HEARTBEAT_MS = Number(process.env.VALIDATION_LOCK_HEARTBEAT_MS || 30_000);
// Lowered from 5 min to 60 s to shrink the PID-reuse window: if a lock holder
// is SIGKILLed and its PID is immediately reused by an unrelated OS process,
// pidAlive(holderPid) returns true and this stale-heartbeat fallback is the
// only reclaim path.  60 s keeps the false-live window acceptably short while
// still tolerating brief system pauses.  Override via env var for CI machines
// with exceptionally long scheduling pauses.
const STALE_HEARTBEAT_MS = Number(process.env.VALIDATION_LOCK_STALE_HEARTBEAT_MS || 60_000);
const MAX_HOLD_MS = Number(process.env.VALIDATION_LOCK_MAX_HOLD_MS || 2 * 60 * 60 * 1000);
// How long a higher-priority waiter must have been queued before lower-priority
// waiters yield to it on their next poll tick.
const PRIORITY_GRACE_MS = Number(process.env.VALIDATION_LOCK_PRIORITY_GRACE_MS || 2_000);

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === argv.length - 1) {
  console.error("Usage: validation-lock.mjs [--resource <name>] [--priority <1-9>] -- <command...>");
  process.exit(2);
}
const lockArgs = argv.slice(0, sep);
const command = argv.slice(sep + 1);
const commandLabel = command.join(" ");

let resource = "global";
let priority = 5;
for (let i = 0; i < lockArgs.length; i++) {
  if (lockArgs[i] === "--resource" && lockArgs[i + 1] !== undefined) {
    resource = lockArgs[++i];
  } else if (lockArgs[i] === "--priority" && lockArgs[i + 1] !== undefined) {
    priority = Math.max(1, Math.min(9, Number(lockArgs[++i]) || 5));
  }
}

// Sanitise resource name for use in file/env paths (alphanumeric + hyphen only).
const safeResource = resource.replace(/[^a-zA-Z0-9-]/g, "-");
const resourceUpper = safeResource.toUpperCase().replace(/-/g, "_");

// Lock file: override via env (for tests) or derive from resource name.
const lockFile = process.env.VALIDATION_LOCK_FILE
  ? resolve(process.env.VALIDATION_LOCK_FILE)
  : resolve(localDir, `validation-lock-${safeResource}.lock`);
const lockDir = dirname(lockFile);

// Waiter manifest directory for this resource.
const waitersDir = process.env.VALIDATION_LOCK_WAITERS_DIR
  ? resolve(process.env.VALIDATION_LOCK_WAITERS_DIR)
  : resolve(localDir, `validation-waiters-${safeResource}`);

// Reentrancy env var for this resource (plus legacy global var).
const heldPidEnvVar = `VALIDATION_LOCK_HELD_PID_${resourceUpper}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function readLockInfo() {
  const lines = readFileSync(lockFile, "utf8").split("\n");
  const pid = Number(lines[0]?.trim());
  const acquiredAt = Number(lines[1]?.trim());
  const mtimeMs = statSync(lockFile).mtimeMs;
  return { pid, acquiredAt, mtimeMs };
}

function tryAcquire() {
  try {
    const fd = openSync(lockFile, "wx");
    try { writeSync(fd, `${process.pid}\n${Date.now()}\n`); } catch { /* best-effort */ }
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    try {
      const { pid: holderPid, acquiredAt, mtimeMs } = readLockInfo();
      const now = Date.now();
      let reason = null;
      let isHungHolder = false;
      if (Number.isInteger(holderPid) && holderPid > 0 && !pidAlive(holderPid)) {
        reason = `held by dead pid ${holderPid}`;
      } else if (now - mtimeMs > STALE_HEARTBEAT_MS) {
        reason = `heartbeat stale for ${Math.round((now - mtimeMs) / 1000)}s (pid ${holderPid} presumed reused/gone)`;
      } else if (Number.isFinite(acquiredAt) && acquiredAt > 0 && now - acquiredAt > MAX_HOLD_MS) {
        reason = `held for ${Math.round((now - acquiredAt) / 60000)} min by pid ${holderPid}, ` +
          `exceeding the ${Math.round(MAX_HOLD_MS / 60000)} min max-hold safety valve — holder appears hung`;
        console.error(`[validation-lock] WARNING: forcibly reclaiming lock: ${reason}`);
        isHungHolder = true;
      }
      if (reason) {
        console.log(`[validation-lock] reclaiming stale lock (${reason})`);
        if (isHungHolder && Number.isInteger(holderPid) && holderPid > 0) {
          try {
            process.kill(holderPid, "SIGTERM");
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000);
            try { process.kill(holderPid, "SIGKILL"); } catch { /* ESRCH — already exited, suppress */ }
          } catch { /* process already gone — proceed with reclaim */ }
        }
        try { unlinkSync(lockFile); } catch { /* raced with another reclaimer */ }
      }
    } catch { /* lock vanished between open and read — just retry */ }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Waiter manifest (priority queue sidecar)
// ---------------------------------------------------------------------------

const waiterFile = join(waitersDir, `${process.pid}.json`);
let waiterRegistered = false;

function registerWaiter() {
  try {
    mkdirSync(waitersDir, { recursive: true });
    writeFileSync(waiterFile, JSON.stringify({ pid: process.pid, priority, enqueuedAt: Date.now() }));
    waiterRegistered = true;
  } catch { /* non-fatal — priority biasing degrades gracefully */ }
}

function deregisterWaiter() {
  if (!waiterRegistered) return;
  waiterRegistered = false;
  try { unlinkSync(waiterFile); } catch { /* already gone */ }
}

/**
 * Returns true if a higher-priority (lower N) waiter for the same resource
 * has been queued longer than PRIORITY_GRACE_MS. In that case the current
 * waiter should skip its poll tick to yield to the faster step.
 */
function shouldYieldToPriorityWaiter() {
  try {
    const now = Date.now();
    for (const f of readdirSync(waitersDir)) {
      if (!f.endsWith(".json")) continue;
      if (f === `${process.pid}.json`) continue;
      try {
        const entry = JSON.parse(readFileSync(join(waitersDir, f), "utf8"));
        if (
          typeof entry.priority === "number" &&
          entry.priority < priority &&
          typeof entry.enqueuedAt === "number" &&
          now - entry.enqueuedAt > PRIORITY_GRACE_MS &&
          pidAlive(entry.pid)
        ) {
          return true;
        }
      } catch { /* stale manifest entry — ignore */ }
    }
  } catch { /* waiters dir may not exist yet */ }
  return false;
}

// ---------------------------------------------------------------------------
// Lock lifecycle
// ---------------------------------------------------------------------------

let lockAcquired = false;
let heartbeatTimer = null;

function releaseLock() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (!lockAcquired) return;
  lockAcquired = false;
  try {
    const { pid: holderPid } = readLockInfo();
    if (holderPid === process.pid) unlinkSync(lockFile);
  } catch { /* already gone */ }
}

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(lockFile, now, now);
    } catch { /* lock reclaimed out from under us — nothing to refresh */ }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();
}

async function acquireWithTimeout() {
  registerWaiter();
  const deadline = Date.now() + TIMEOUT_MS;
  let logged = false;
  try {
    while (true) {
      if (!shouldYieldToPriorityWaiter() && tryAcquire()) {
        deregisterWaiter();
        return;
      }
      if (Date.now() >= deadline) {
        deregisterWaiter();
        console.error(
          `[validation-lock] timed out after ${(TIMEOUT_MS / 60000).toFixed(0)} min waiting for ` +
          `${lockFile} (resource="${resource}"). ` +
          "If no other validation step is running, delete the lock file manually.",
        );
        process.exit(3);
      }
      if (!logged) {
        console.log(
          `[validation-lock] another validation step holds the lock (resource="${resource}") — ` +
          `queued at priority ${priority}, waiting…`,
        );
        logged = true;
      }
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
    }
  } catch (err) {
    deregisterWaiter();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(lockDir, { recursive: true });

// Reentrancy check: if an ancestor wrapper already holds this named resource,
// running the command directly avoids a deadlock. The holder exports
// VALIDATION_LOCK_HELD_PID_<RESOURCE> (and the legacy VALIDATION_LOCK_HELD_PID
// for the "global" resource) into child env.
const heldPid = (() => {
  const v = Number(process.env[heldPidEnvVar] || 0);
  if (v) return v;
  // Legacy fallback: honor old VALIDATION_LOCK_HELD_PID for global resource.
  if (resource === "global") return Number(process.env.VALIDATION_LOCK_HELD_PID || 0);
  return 0;
})();

if (Number.isInteger(heldPid) && heldPid > 0 && heldPid !== process.pid && pidAlive(heldPid)) {
  console.log(
    `[validation-lock] lock already held by ancestor pid ${heldPid} (resource="${resource}") — running reentrantly: ${commandLabel}`,
  );
  const child = spawn(command[0], command.slice(1), { stdio: "inherit" });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill(sig); } catch { /* already gone */ }
      }
      process.exit(1);
    });
  }
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
} else {
  let child = null;
  process.on("exit", () => { deregisterWaiter(); releaseLock(); });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        try { child.kill(sig); } catch { /* already gone */ }
      }
      deregisterWaiter();
      releaseLock();
      process.exit(1);
    });
  }

  const waitStart = Date.now();
  await acquireWithTimeout();
  lockAcquired = true;
  startHeartbeat();
  const waitedSecs = ((Date.now() - waitStart) / 1000).toFixed(1);
  console.log(
    `[validation-lock] lock acquired after ${waitedSecs}s wait (resource="${resource}", priority=${priority}) — running: ${commandLabel}`,
  );

  // Build the child env: set the resource-keyed held-pid var so nested
  // wrappers for the same resource skip re-acquisition. Also set the legacy
  // global var when resource is "global" so old callers still work.
  const childEnv = {
    ...process.env,
    [heldPidEnvVar]: String(process.pid),
  };
  if (resource === "global") {
    childEnv.VALIDATION_LOCK_HELD_PID = String(process.pid);
  }

  child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env: childEnv,
  });
  child.on("exit", (code, signal) => {
    releaseLock();
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}
