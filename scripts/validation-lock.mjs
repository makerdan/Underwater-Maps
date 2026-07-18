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
 *   node scripts/validation-lock.mjs -- <command...>
 * The wrapper acquires a global exclusive lock file BEFORE the wrapped
 * command starts, so any run-with-timeout.mjs budget timer inside the
 * command only starts ticking once the step actually has the machine to
 * itself. Steps queue up and run one at a time in whatever order they win
 * the lock.
 *
 * Stale-lock handling: the lock file records the holder pid; if that process
 * is no longer alive the lock is treated as stale and reclaimed.
 *
 * Lock location: .local/validation-serial.lock
 *
 * Reentrancy: some commands are double-wrapped (e.g. the test-e2e workflow
 * runs `validation-lock.mjs -- pnpm run test:e2e` and the test:e2e script
 * itself wraps validation-lock again). Without reentrancy the inner wrapper
 * deadlocks waiting on the lock its own ancestor holds. The holder exports
 * VALIDATION_LOCK_HELD_PID; a nested wrapper that sees a live holder pid in
 * that variable skips acquisition and runs the command directly.
 */
import { openSync, closeSync, unlinkSync, mkdirSync, writeSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const lockDir = resolve(root, ".local");
const lockFile = resolve(lockDir, "validation-serial.lock");

const POLL_INTERVAL_MS = 1_000;
// Generous: a full e2e suite can hold the lock for up to an hour, and
// several steps may be queued behind it.
const TIMEOUT_MS = Number(process.env.VALIDATION_LOCK_TIMEOUT_MS || 3 * 60 * 60 * 1000);

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === argv.length - 1) {
  console.error("Usage: validation-lock.mjs -- <command...>");
  process.exit(2);
}
const command = argv.slice(sep + 1);
const commandLabel = command.join(" ");

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function tryAcquire() {
  try {
    const fd = openSync(lockFile, "wx");
    try { writeSync(fd, `${process.pid}\n`); } catch { /* best-effort */ }
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    // Stale-lock reclaim: if the recorded holder is dead, remove and retry.
    try {
      const holderPid = Number(readFileSync(lockFile, "utf8").trim());
      if (Number.isInteger(holderPid) && holderPid > 0 && !pidAlive(holderPid)) {
        console.log(`[validation-lock] reclaiming stale lock held by dead pid ${holderPid}`);
        try { unlinkSync(lockFile); } catch { /* raced with another reclaimer */ }
      }
    } catch { /* lock vanished between open and read — just retry */ }
    return false;
  }
}

let lockAcquired = false;
function releaseLock() {
  if (!lockAcquired) return;
  lockAcquired = false;
  try {
    const holderPid = Number(readFileSync(lockFile, "utf8").trim());
    if (holderPid === process.pid) unlinkSync(lockFile);
  } catch { /* already gone */ }
}

async function acquireWithTimeout() {
  const deadline = Date.now() + TIMEOUT_MS;
  let logged = false;
  while (true) {
    if (tryAcquire()) return;
    if (Date.now() >= deadline) {
      console.error(
        `[validation-lock] timed out after ${(TIMEOUT_MS / 60000).toFixed(0)} min waiting for ${lockFile}. ` +
        "If no other validation step is running, delete the lock file manually.",
      );
      process.exit(3);
    }
    if (!logged) {
      console.log("[validation-lock] another validation step holds the lock — queued, waiting…");
      logged = true;
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
}

mkdirSync(lockDir, { recursive: true });

// Reentrant path: an ancestor wrapper already holds the lock — don't try to
// acquire it again (that would deadlock); just run the command.
const heldPid = Number(process.env.VALIDATION_LOCK_HELD_PID || "");
if (Number.isInteger(heldPid) && heldPid > 0 && heldPid !== process.pid && pidAlive(heldPid)) {
  console.log(`[validation-lock] lock already held by ancestor pid ${heldPid} — running: ${commandLabel}`);
  const child = spawn(command[0], command.slice(1), { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
} else {
  process.on("exit", releaseLock);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => { releaseLock(); process.exit(1); });
  }

  const waitStart = Date.now();
  await acquireWithTimeout();
  lockAcquired = true;
  const waitedSecs = ((Date.now() - waitStart) / 1000).toFixed(1);
  console.log(`[validation-lock] lock acquired after ${waitedSecs}s wait — running: ${commandLabel}`);

  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env: { ...process.env, VALIDATION_LOCK_HELD_PID: String(process.pid) },
  });
  child.on("exit", (code, signal) => {
    releaseLock();
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}
