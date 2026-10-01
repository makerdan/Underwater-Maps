/**
 * Cooperative, project-local writer coordination for foreground processes.
 *
 * This adapter depends on Linux util-linux `flock` and an advisory-lock-capable
 * local filesystem. It is not an authorization gate and cannot cover writers
 * that bypass it. Keep the lock file in a trusted, stable directory and never
 * remove or replace it while writers/checkers may be active.
 */

import { constants as fsConstants, promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const FLOCK_EXECUTABLE = "/usr/bin/flock";
const CONTENTION_EXIT_CODE = 75;
const RETRY_DELAY_MS = 20;
const activeProofs = new WeakMap();

export class WriterLockError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "WriterLockError";
  }
}

export class WriterLockTimeout extends WriterLockError {
  constructor(message = "timed out waiting for the project writer lock") {
    super(message);
    this.name = "WriterLockTimeout";
  }
}

function validateArguments(lockPath, operation, timeoutMs) {
  if (process.platform !== "linux") {
    throw new WriterLockError("this adapter requires Linux util-linux flock");
  }
  if (typeof lockPath !== "string" || !path.isAbsolute(lockPath)) {
    throw new TypeError("writer lock path must be absolute");
  }
  if (typeof operation !== "function") {
    throw new TypeError("writer lock operation must be a function");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("writer lock timeout must be finite and nonnegative");
  }
}

function flockOnce(fd) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const child = spawn(
      FLOCK_EXECUTABLE,
      ["--exclusive", "--nonblock", "--conflict-exit-code", String(CONTENTION_EXIT_CODE), "3"],
      { stdio: ["ignore", "ignore", "pipe", fd] },
    );

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk.slice(0, 4096 - stderr.length);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(new WriterLockError(`cannot start ${FLOCK_EXECUTABLE}`, { cause: error }));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, stderr: stderr.trim() });
    });
  });
}

async function acquire(lockPath, timeoutMs) {
  if (!(fsConstants.O_NOFOLLOW > 0)) {
    throw new WriterLockError("the host runtime does not support O_NOFOLLOW");
  }

  const parent = await fs.realpath(path.dirname(lockPath));
  const stablePath = path.join(parent, path.basename(lockPath));
  const flags = fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW;
  const handle = await fs.open(stablePath, flags, 0o600);
  let keepOpen = false;

  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new WriterLockError("writer lock path is not a regular file");
    }

    const deadline = performance.now() + timeoutMs;
    while (true) {
      const result = await flockOnce(handle.fd);
      if (result.code === 0 && result.signal === null) {
        const visible = await fs.lstat(stablePath);
        if (!visible.isFile() || visible.dev !== opened.dev || visible.ino !== opened.ino) {
          throw new WriterLockError("writer lock path was replaced during acquisition");
        }
        keepOpen = true;
        return { handle, stablePath };
      }
      if (result.code !== CONTENTION_EXIT_CODE || result.signal !== null) {
        throw new WriterLockError(
          `flock failed${result.stderr ? `: ${result.stderr}` : ` (status ${result.code ?? result.signal})`}`,
        );
      }

      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new WriterLockTimeout();
      await delay(Math.min(RETRY_DELAY_MS, remaining));
    }
  } finally {
    if (!keepOpen) await handle.close();
  }
}

/**
 * Hold the shared exclusive lock for the full async operation. A final check
 * must perform input/evidence assessment and its terminal write in this one
 * callback, not in separate lock acquisitions.
 */
export async function withWriterLock(lockPath, operation, { timeoutMs = 30_000 } = {}) {
  validateArguments(lockPath, operation, timeoutMs);
  const { handle, stablePath } = await acquire(lockPath, timeoutMs);
  const lease = { active: true, lockPath: stablePath };
  try {
    return await operation({
      fd: handle.fd,
      lockPath: stablePath,
      createProof({ snapshotDigest, snapshotIntegrity, adapterId }) {
        if (!/^[0-9a-f]{64}$/.test(snapshotDigest ?? "")) {
          throw new TypeError("writer proof requires a snapshot SHA-256 digest");
        }
        if (typeof snapshotIntegrity !== "string" || !snapshotIntegrity ||
            typeof adapterId !== "string" || !adapterId) {
          throw new TypeError("writer proof requires snapshot integrity and an adapter id");
        }
        const proof = Object.freeze({});
        activeProofs.set(proof, {
          lease,
          snapshotDigest,
          snapshotIntegrity,
          adapterId,
        });
        return proof;
      },
    });
  } finally {
    lease.active = false;
    await handle.close();
  }
}

export function assertActiveWriterProof(proof, {
  lockPath,
  snapshotDigest,
  snapshotIntegrity,
} = {}) {
  const record = proof && typeof proof === "object" ? activeProofs.get(proof) : null;
  if (!record || !record.lease.active ||
      (lockPath !== undefined && record.lease.lockPath !== lockPath) ||
      (snapshotDigest !== undefined && record.snapshotDigest !== snapshotDigest) ||
      (snapshotIntegrity !== undefined && record.snapshotIntegrity !== snapshotIntegrity)) {
    throw new WriterLockError("completion requires an active writer-lock proof bound to the exact final snapshot");
  }
  return Object.freeze({
    lockPath: record.lease.lockPath,
    snapshotDigest: record.snapshotDigest,
    snapshotIntegrity: record.snapshotIntegrity,
    adapterId: record.adapterId,
  });
}

/**
 * Run a foreground argv command under the same lock used by withWriterLock.
 * The child inherits the lock descriptor so killing this wrapper does not
 * release protection before the foreground writer/checker exits.
 */
export async function runWriterLocked(lockPath, argv, options = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== "string")) {
    throw new TypeError("writer command must be a nonempty argv array of strings");
  }
  const { timeoutMs = 30_000, cwd, env } = options;

  return withWriterLock(lockPath, ({ fd }) => new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: ["inherit", "inherit", "inherit", fd],
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== null) {
        resolve(code);
        return;
      }
      const signalNumber = signal ? os.constants.signals[signal] : undefined;
      resolve(128 + (signalNumber ?? 0));
    });
  }), { timeoutMs });
}