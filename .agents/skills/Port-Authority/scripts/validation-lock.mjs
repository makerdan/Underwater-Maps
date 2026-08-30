#!/usr/bin/env node
/**
 * validation-lock.mjs — dependency-free crash-safe validation serialization.
 *
 * TEMPLATE — adaptation points:
 *   1. LOCK LOCATION: defaults to .local/validation-lock-<resource>.lock
 *      relative to the directory above this script. Override with
 *      VALIDATION_LOCK_FILE in isolated tests or a project-specific layout.
 *   2. ENVIRONMENT: VALIDATION_LOCK_* names are deliberately explicit; rename
 *      them only together with the documented interface and your tests.
 *   3. TIMINGS: tune the positive millisecond variables below for the longest
 *      legitimate step. Budgets in the wrapped command must begin after lock
 *      acquisition, not while waiting.
 *   4. RESOURCE NAMES: use alphanumeric and hyphen names such as codegen,
 *      unit-cpu, and e2e-port. The resource becomes part of a lock filename
 *      and reentrancy environment variable.
 *
 * Usage:
 *   node scripts/validation-lock.mjs [--resource <name>] [--priority <1-9>] -- <command...>
 *
 * The lock uses an atomic exclusive file, a PID/acquire-time record, a
 * heartbeat, a max-hold safety valve, and an isolated priority-waiter
 * manifest. Stale takeover is loud. A small sidecar mutex makes stale
 * verify-and-unlink atomic among competing waiters; every acquisition uses
 * that same mutex so a replacement lock cannot be removed accidentally.
 * No npm package, project import, or application-specific path is required.
 */
import {
  openSync, closeSync, unlinkSync, mkdirSync, writeSync, writeFileSync,
  readFileSync, utimesSync, statSync, readdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

function positiveMs(name, fallback) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`validation-lock: invalid value for ${name}: '${raw}'`);
    process.exit(1);
  }
  return value;
}

const POLL_MS = positiveMs("VALIDATION_LOCK_POLL_MS", 1_000);
const TIMEOUT_MS = positiveMs("VALIDATION_LOCK_TIMEOUT_MS", 3 * 60 * 60 * 1000);
const HEARTBEAT_MS = positiveMs("VALIDATION_LOCK_HEARTBEAT_MS", 30_000);
const STALE_HEARTBEAT_MS = positiveMs("VALIDATION_LOCK_STALE_HEARTBEAT_MS", 60_000);
const MAX_HOLD_MS = positiveMs("VALIDATION_LOCK_MAX_HOLD_MS", 2 * 60 * 60 * 1000);
const PRIORITY_GRACE_MS = positiveMs("VALIDATION_LOCK_PRIORITY_GRACE_MS", 2_000);
const RECLAIM_MUTEX_STALE_MS = positiveMs("VALIDATION_LOCK_RECLAIM_MUTEX_STALE_MS", 30_000);

const isDevelopmentWorkspace = Boolean(process.env.REPLIT_DEV_DOMAIN);
if (
  !isDevelopmentWorkspace &&
  (process.env.NODE_ENV === "production" ||
    process.env.REPLIT_DEPLOYMENT === "1" ||
    process.env.REPLIT_ENVIRONMENT === "production")
) {
  console.error("validation-lock: refusing to run in a production environment.");
  process.exit(2);
}

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
if (separator < 0 || separator === argv.length - 1) {
  console.error(
    "Usage: validation-lock.mjs [--resource <name>] [--priority <1-9>] -- <command...>",
  );
  process.exit(2);
}

let resource = "global";
let priority = 5;
for (let i = 0; i < separator; i++) {
  const arg = argv[i];
  if (arg === "--resource") {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error("Usage: validation-lock.mjs --resource requires a non-empty name.");
      process.exit(2);
    }
    resource = value;
    i++;
  } else if (arg === "--priority") {
    const value = argv[i + 1];
    if (value === undefined || !/^[1-9]$/.test(value)) {
      console.error("Usage: validation-lock.mjs --priority must be an integer from 1 to 9.");
      process.exit(2);
    }
    priority = Number(value);
    i++;
  } else {
    console.error(`validation-lock: unknown option '${arg}'.`);
    process.exit(2);
  }
}

if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(resource)) {
  console.error(
    "Usage: validation-lock.mjs --resource accepts only alphanumeric characters and hyphens.",
  );
  process.exit(2);
}
const safeResource = resource;
const resourceUpper = safeResource.toUpperCase().replaceAll("-", "_");
const command = argv.slice(separator + 1);
const commandLabel = command.join(" ");

const lockFile = process.env.VALIDATION_LOCK_FILE
  ? resolve(process.env.VALIDATION_LOCK_FILE)
  : resolve(projectRoot, ".local", `validation-lock-${safeResource}.lock`);
const lockDir = dirname(lockFile);
const waitersDir = process.env.VALIDATION_LOCK_WAITERS_DIR
  ? resolve(process.env.VALIDATION_LOCK_WAITERS_DIR)
  : resolve(projectRoot, ".local", `validation-waiters-${safeResource}`);
const reclaimMutex = `${lockFile}.reclaim`;
const heldPidEnv = `VALIDATION_LOCK_HELD_PID_${resourceUpper}`;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readLockInfo() {
  const raw = readFileSync(lockFile, "utf8");
  const lines = raw.split("\n");
  const pid = Number(lines[0]?.trim());
  const acquiredAt = Number(lines[1]?.trim());
  const mtimeMs = statSync(lockFile).mtimeMs;
  return { raw, pid, acquiredAt, mtimeMs };
}

function staleReason(info, now) {
  if (!Number.isInteger(info.pid) || info.pid <= 0) return "invalid holder pid";
  if (!Number.isFinite(info.acquiredAt) || info.acquiredAt <= 0) {
    return "invalid acquire timestamp";
  }
  if (!pidAlive(info.pid)) return `held by dead pid ${info.pid}`;
  if (now - info.mtimeMs > STALE_HEARTBEAT_MS) {
    return `heartbeat stale for ${Math.round((now - info.mtimeMs) / 1000)}s (pid ${info.pid} presumed reused/gone)`;
  }
  if (now - info.acquiredAt > MAX_HOLD_MS) {
    return `held for ${Math.round((now - info.acquiredAt) / 60000)} min by pid ${info.pid}, exceeding the ${Math.round(MAX_HOLD_MS / 60000)} min max-hold safety valve — holder appears hung`;
  }
  return null;
}

function acquireReclaimMutex() {
  try {
    const fd = openSync(reclaimMutex, "wx");
    try {
      writeSync(fd, `${process.pid}\n${Date.now()}\n`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      const raw = readFileSync(reclaimMutex, "utf8").split("\n");
      const pid = Number(raw[0]);
      const createdAt = Number(raw[1]);
      const age = Date.now() - statSync(reclaimMutex).mtimeMs;
      if (
        !Number.isInteger(pid) ||
        pid <= 0 ||
        !Number.isFinite(createdAt) ||
        createdAt <= 0 ||
        !pidAlive(pid) ||
        age > RECLAIM_MUTEX_STALE_MS
      ) {
        console.error("[validation-lock] WARNING: reclaiming abandoned stale-takeover mutex.");
        try { unlinkSync(reclaimMutex); } catch { /* another waiter reclaimed it */ }
      }
    } catch { /* mutex changed while inspected */ }
    return false;
  }
}

function releaseReclaimMutex() {
  try {
    const owner = Number(readFileSync(reclaimMutex, "utf8").split("\n")[0]);
    if (owner === process.pid) unlinkSync(reclaimMutex);
  } catch { /* already gone or replaced */ }
}

function tryAcquire() {
  if (!acquireReclaimMutex()) return { acquired: false, reason: "reclaim-busy" };
  try {
    try {
      const lockFd = openSync(lockFile, "wx");
      try {
        writeSync(lockFd, `${process.pid}\n${Date.now()}\n`);
        closeSync(lockFd);
        return { acquired: true };
      } catch (error) {
        try { closeSync(lockFd); } catch { /* best effort */ }
        try { unlinkSync(lockFile); } catch { /* best effort */ }
        console.error(`[validation-lock] failed to write lock file ${lockFile}: ${error.message}`);
        return { acquired: false, reason: "write-failed" };
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let info;
      try { info = readLockInfo(); } catch { return { acquired: false, reason: "lock-changing" }; }
      const reason = staleReason(info, Date.now());
      if (reason) {
        console.error(`[validation-lock] WARNING: forcibly reclaiming stale lock (${reason})`);
        try { unlinkSync(lockFile); } catch (unlinkError) {
          if (unlinkError.code !== "ENOENT") {
            console.error(`[validation-lock] failed to reclaim ${lockFile}: ${unlinkError.message}`);
          }
        }
      }
      return { acquired: false, reason: reason ? "reclaimed" : "held" };
    }
  } finally {
    releaseReclaimMutex();
  }
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const waiterFile = join(waitersDir, `${process.pid}.json`);
let waiterRegistered = false;
function registerWaiter() {
  try {
    mkdirSync(waitersDir, { recursive: true });
    writeFileSync(waiterFile, JSON.stringify({ pid: process.pid, priority, enqueuedAt: Date.now() }));
    waiterRegistered = true;
  } catch { /* priority is best effort */ }
}
function deregisterWaiter() {
  if (!waiterRegistered) return;
  waiterRegistered = false;
  try { unlinkSync(waiterFile); } catch { /* already gone */ }
}
function shouldYield() {
  try {
    const now = Date.now();
    for (const file of readdirSync(waitersDir)) {
      if (!file.endsWith(".json") || file === `${process.pid}.json`) continue;
      try {
        const entry = JSON.parse(readFileSync(join(waitersDir, file), "utf8"));
        if (
          entry.priority < priority &&
          typeof entry.enqueuedAt === "number" &&
          now - entry.enqueuedAt > PRIORITY_GRACE_MS &&
          typeof entry.pid === "number" &&
          pidAlive(entry.pid)
        ) return true;
      } catch { /* stale waiter manifest */ }
    }
  } catch { /* directory may not exist */ }
  return false;
}

let lockAcquired = false;
let heartbeatTimer = null;
function releaseLock() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (!lockAcquired) return;
  lockAcquired = false;
  try {
    if (readLockInfo().pid === process.pid) unlinkSync(lockFile);
  } catch { /* lock was reclaimed or already removed */ }
}
function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(lockFile, now, now);
    } catch { /* lock was reclaimed */ }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();
}

async function acquire() {
  registerWaiter();
  const deadline = Date.now() + TIMEOUT_MS;
  let announced = false;
  try {
    while (Date.now() < deadline) {
      if (!shouldYield() && tryAcquire().acquired) {
        deregisterWaiter();
        return;
      }
      if (!announced) {
        console.log(`[validation-lock] queued at priority ${priority} for resource="${resource}" — waiting…`);
        announced = true;
      }
      await sleep(POLL_MS);
    }
    deregisterWaiter();
    console.error(
      `[validation-lock] timed out after ${(TIMEOUT_MS / 60000).toFixed(0)} min waiting for ${lockFile}. ` +
      "If no validation step is running, inspect the lock before removing it.",
    );
    process.exit(3);
  } catch (error) {
    deregisterWaiter();
    throw error;
  }
}

try {
  mkdirSync(lockDir, { recursive: true });
} catch (error) {
  console.error(`validation-lock: cannot create lock directory '${lockDir}': ${error.message}`);
  process.exit(1);
}

const heldPid = Number(
  process.env[heldPidEnv] ||
    (resource === "global" ? process.env.VALIDATION_LOCK_HELD_PID : 0) ||
    0,
);

function runChild(options = {}) {
  const child = spawn(command[0], command.slice(1), { stdio: "inherit", ...options });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } }
      }
      releaseLock();
      process.exit(1);
    });
  }
  return child;
}

if (Number.isInteger(heldPid) && heldPid > 0 && heldPid !== process.pid && pidAlive(heldPid)) {
  console.log(`[validation-lock] lock already held by ancestor pid ${heldPid} (resource="${resource}") — running reentrantly: ${commandLabel}`);
  const child = runChild();
  child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
} else {
  let child = null;
  process.on("exit", () => { deregisterWaiter(); releaseLock(); });
  await acquire();
  lockAcquired = true;
  startHeartbeat();
  console.log(`[validation-lock] lock acquired (resource="${resource}", priority=${priority}) — running: ${commandLabel}`);
  const childEnv = { ...process.env, [heldPidEnv]: String(process.pid) };
  if (resource === "global") childEnv.VALIDATION_LOCK_HELD_PID = String(process.pid);
  child = runChild({ detached: true, env: childEnv });
  child.unref();
  const lifecycleTimer = setInterval(() => {}, 60_000);
  child.on("exit", (code, signal) => {
    clearInterval(lifecycleTimer);
    releaseLock();
    process.exit(signal ? 1 : code ?? 1);
  });
}