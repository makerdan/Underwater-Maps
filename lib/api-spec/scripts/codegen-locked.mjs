#!/usr/bin/env node
/**
 * codegen-locked.mjs
 *
 * Exclusive-lock wrapper for the codegen:generate pipeline.
 *
 * Acquires an exclusive lock file before running orval, then runs both patch
 * scripts in sequence, then releases the lock. A second concurrent invocation
 * will poll (200 ms interval, 60 s timeout) and wait until the first finishes,
 * preventing the race where one process's orval overwrites the already-patched
 * file just as the other process's patch script is about to run.
 *
 * Lock location: lib/api-zod/src/generated/.codegen.lock
 *   (same directory as the generated file being patched)
 */

import { openSync, closeSync, unlinkSync, mkdirSync, writeSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSpecDir = resolve(__dirname, "..");
const root = resolve(apiSpecDir, "..", "..");

const generatedDir = resolve(root, "lib", "api-zod", "src", "generated");
const lockFile = resolve(generatedDir, ".codegen.lock");

const POLL_INTERVAL_MS = 200;
const TIMEOUT_MS = 60_000;

/**
 * Try to atomically create the lock file. On POSIX, O_EXCL|O_CREAT is
 * atomic — exactly one process wins. Returns true on success, false if
 * the file already exists (someone else holds the lock).
 */
function tryAcquire() {
  try {
    // wx = write-only + O_EXCL — fails atomically if the file exists
    const fd = openSync(lockFile, "wx");
    try { writeSync(fd, `${process.pid}\n`); } catch (_) { /* best-effort */ }
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
}

function releaseLock() {
  try { unlinkSync(lockFile); } catch (_) { /* already gone */ }
}

async function acquireWithTimeout() {
  const deadline = Date.now() + TIMEOUT_MS;
  let logged = false;
  while (true) {
    if (tryAcquire()) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `codegen-locked: timed out after ${TIMEOUT_MS / 1000}s waiting for ` +
        `lock at ${lockFile}. ` +
        `If no other codegen is running, delete the lock file manually.`
      );
    }
    if (!logged) {
      console.log(
        "codegen-locked: lock held by another process — waiting up to " +
        `${TIMEOUT_MS / 1000}s…`
      );
      logged = true;
    }
    const remaining = deadline - Date.now();
    await new Promise((res) => setTimeout(res, Math.min(POLL_INTERVAL_MS, remaining)));
  }
}

function run(cmd) {
  console.log(`codegen-locked: running: ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: apiSpecDir, shell: true });
}

// Ensure the generated directory exists before we try to create the lock file
mkdirSync(generatedDir, { recursive: true });

let lockAcquired = false;

function cleanup() {
  if (lockAcquired) {
    releaseLock();
    lockAcquired = false;
  }
}

process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { cleanup(); process.exit(1); });
}

await acquireWithTimeout();
lockAcquired = true;
console.log("codegen-locked: lock acquired — starting codegen pipeline");

try {
  run("orval --config ./orval.config.ts");
  run("node ./scripts/patch-zod-band-boundaries.mjs");
  run("node ./scripts/patch-zod-integer-settings.mjs");
  console.log("codegen-locked: pipeline complete");
} finally {
  cleanup();
}
