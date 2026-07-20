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

import {
  openSync, closeSync, unlinkSync, mkdirSync, writeSync,
  readFileSync, writeFileSync, existsSync, statSync, utimesSync,
} from "fs";
import { createHash } from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSpecDir = resolve(__dirname, "..");
const root = resolve(apiSpecDir, "..", "..");

const generatedDir = resolve(root, "lib", "api-zod", "src", "generated");
const lockFile = resolve(generatedDir, ".codegen.lock");
const stampFile = resolve(generatedDir, ".codegen.stamp");

// ── Skip-if-unchanged stamp ─────────────────────────────────────────────────
// Concurrent validation workflows (typecheck, test-unit, e2e) each run this
// script. The lock serializes them, but a second regeneration still rewrites
// the generated files while the first run's tsc/vitest may be reading them
// (the "missing .int()" patch race). To make back-to-back runs true no-ops,
// we hash the pipeline inputs AND the current outputs; when both match the
// stamp written by the previous successful run, we skip the pipeline
// entirely and never touch the generated files.

const inputFiles = [
  resolve(apiSpecDir, "openapi.yaml"),
  resolve(apiSpecDir, "orval.config.ts"),
  resolve(apiSpecDir, "package.json"),
  resolve(apiSpecDir, "scripts", "patch-zod-band-boundaries.mjs"),
  resolve(apiSpecDir, "scripts", "patch-zod-integer-settings.mjs"),
];

const outputFiles = [
  resolve(root, "lib", "api-client-react", "src", "generated", "api.ts"),
  resolve(root, "lib", "api-client-react", "src", "generated", "api.schemas.ts"),
  resolve(generatedDir, "api.ts"),
];

function hashFiles(files) {
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f);
    h.update("\0");
    try {
      h.update(readFileSync(f));
    } catch {
      h.update("<missing>");
    }
    h.update("\0");
  }
  return h.digest("hex");
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(stampFile, "utf8"));
  } catch {
    return null;
  }
}

function isUpToDate() {
  if (!outputFiles.every((f) => existsSync(f))) return false;
  const stamp = readStamp();
  if (!stamp) return false;
  return (
    stamp.inputsHash === hashFiles(inputFiles) &&
    stamp.outputsHash === hashFiles(outputFiles)
  );
}

function writeStamp() {
  writeFileSync(
    stampFile,
    JSON.stringify(
      {
        inputsHash: hashFiles(inputFiles),
        outputsHash: hashFiles(outputFiles),
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
}

const POLL_INTERVAL_MS = 200;
const TIMEOUT_MS = 60_000;
const HEARTBEAT_MS = 15_000;
const STALE_HEARTBEAT_MS = 60_000;

let heartbeatTimer = null;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

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
    if (err.code !== "EEXIST") throw err;
    // Stale-lock reclaim: the holder may have been SIGKILLed (e.g. by the
    // budget-breach timeout) without ever releasing the lock.
    try {
      const holderPid = Number(readFileSync(lockFile, "utf8").split("\n")[0]?.trim());
      const mtimeMs = statSync(lockFile).mtimeMs;
      const now = Date.now();
      let reason = null;
      if (Number.isInteger(holderPid) && holderPid > 0 && !pidAlive(holderPid)) {
        reason = `held by dead pid ${holderPid}`;
      } else if (now - mtimeMs > STALE_HEARTBEAT_MS) {
        reason =
          `heartbeat stale for ${Math.round((now - mtimeMs) / 1000)}s ` +
          `(pid ${holderPid} presumed reused/gone)`;
      }
      if (reason) {
        console.warn(`codegen-locked: reclaiming stale lock (${reason})`);
        try { unlinkSync(lockFile); } catch { /* raced with another reclaimer */ }
      }
    } catch { /* lock vanished between open and read — just retry */ }
    return false;
  }
}

function releaseLock() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  try {
    // Only delete the lock if we still own it — another process may have
    // reclaimed it (e.g. after a stale-heartbeat verdict) and re-acquired.
    const holderPid = Number(readFileSync(lockFile, "utf8").split("\n")[0]?.trim());
    if (holderPid === process.pid) unlinkSync(lockFile);
  } catch (_) { /* already gone */ }
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
  // Async spawn (not execSync) so the event loop stays alive and the lock
  // heartbeat keeps ticking during long-running codegen steps. execSync would
  // block the loop, freeze the heartbeat, and let waiters misclassify a live
  // holder as stale after STALE_HEARTBEAT_MS.
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, { stdio: "inherit", cwd: apiSpecDir, shell: true });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`codegen-locked: command failed (${signal ?? `exit ${code}`}): ${cmd}`));
    });
  });
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
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { cleanup(); process.exit(1); });
}

await acquireWithTimeout();
lockAcquired = true;
startHeartbeat();

try {
  // Check under the lock so a concurrent run that just finished regenerating
  // is fully accounted for before we decide to skip.
  if (isUpToDate()) {
    console.log(
      "codegen-locked: inputs and outputs unchanged since last run — skipping pipeline",
    );
  } else {
    console.log("codegen-locked: lock acquired — starting codegen pipeline");
    await run("orval --config ./orval.config.ts");
    await run("node ./scripts/patch-zod-band-boundaries.mjs");
    await run("node ./scripts/patch-zod-integer-settings.mjs");
    writeStamp();
    console.log("codegen-locked: pipeline complete");
  }
} finally {
  cleanup();
}
