/**
 * reclaim-mutex.mjs — shared atomic reclaim protocol for validation lock files.
 *
 * PROBLEM: the validation lock (scripts/validation-lock.mjs) is an
 * exclusive-pathname lock: openSync(lockFile, "wx") creates it, and the
 * file's existence IS the mutual exclusion (no flock, no held fd). Reclaiming
 * a stale lock therefore means unlinking a pathname — and a naive
 * read-pid → check-dead → unlink sequence has a TOCTOU race: between the
 * read and the unlink, another reclaimer can remove the stale file and a new
 * wrapper can acquire a replacement lock at the same pathname. The naive
 * unlink then destroys the NEW holder's lock, and two mutually-exclusive
 * validation commands run concurrently.
 *
 * PROTOCOL: every stale-lock unlink (from any reclaimer — a waiting
 * validation-lock.mjs wrapper or the post-merge cleaner) must go through
 * reclaimStaleLock(), which:
 *   1. serializes all reclaimers of one lock file through a per-lock-file
 *      mkdir mutex (`<lockFile>.reclaim-mutex/`, atomic-create), and
 *   2. inside the mutex, re-reads the lock file and unlinks it ONLY if its
 *      raw contents still byte-match what the caller inspected (generation
 *      check — a replacement lock has a new `pid\nacquiredAt` line pair) AND
 *      the caller's staleness predicate still holds on the fresh read.
 *
 * WHY THIS CLOSES THE RACE: a lock file at pathname P can only be replaced
 * via unlink+create. Creation (openSync "wx") requires P to be absent.
 * Unlink happens in exactly two places: (a) inside this mutex, and (b) the
 * holder's own releaseLock() — which only runs while the holder is alive,
 * a state in which every staleness predicate is false, so (b) and a reclaim
 * cannot target the same lock generation. Hence, while a reclaimer holds the
 * mutex, the file it re-read cannot be swapped out from under it before its
 * unlink.
 *
 * Mutex staleness: a reclaimer SIGKILLed inside the (microseconds-long)
 * critical section would leave the mutex dir behind. Waiters treat a mutex
 * as abandoned when its recorded owner pid is dead or its mtime is older
 * than MUTEX_STALE_MS, remove it, and retry the atomic mkdir (single winner).
 *
 * Unit-tested via scripts/__tests__/clean-stale-validation-locks.test.mjs
 * (CI step check:stale-lock-cleanup).
 */
import {
  mkdirSync, rmSync, writeFileSync, readFileSync, statSync, unlinkSync,
} from "node:fs";
import { join } from "node:path";

/** An abandoned reclaim mutex is taken over after this long. The critical
 * section is a read + unlink (no awaits), so anything older than a few
 * seconds means the owner died inside it. */
export const MUTEX_STALE_MS = 30_000;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function mutexPathFor(lockFile) {
  return `${lockFile}.reclaim-mutex`;
}

/**
 * Acquire the per-lock-file reclaim mutex. Returns true on success, false on
 * timeout. Abandoned mutexes (dead owner pid, or unreadable owner and stale
 * mtime) are removed and re-raced; the atomic mkdir guarantees one winner.
 */
export function acquireReclaimMutex(lockFile, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const pollMs = opts.pollMs ?? 25;
  const dir = mutexPathFor(lockFile);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      mkdirSync(dir);
      try {
        writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now() }));
      } catch { /* best-effort — mtime-based staleness still covers us */ }
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }

    // Mutex exists — is it abandoned?
    let ownerDead = false;
    let dirStale = false;
    try {
      const owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8"));
      ownerDead = Number.isInteger(owner.pid) && owner.pid > 0 && !pidAlive(owner.pid);
    } catch { /* owner file missing/corrupt — fall back to mtime below */ }
    try {
      dirStale = Date.now() - statSync(dir).mtimeMs > MUTEX_STALE_MS;
    } catch {
      continue; // dir vanished (owner released) — retry mkdir immediately
    }
    if (ownerDead || dirStale) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* raced */ }
      continue; // re-race the mkdir
    }

    if (Date.now() >= deadline) return false;
    sleepSync(pollMs);
  }
}

export function releaseReclaimMutex(lockFile) {
  try { rmSync(mutexPathFor(lockFile), { recursive: true, force: true }); } catch { /* already gone */ }
}

/**
 * Atomically verify-and-unlink a stale validation lock file.
 *
 * The caller has already inspected the lock outside the mutex and believes
 * it is stale; `expectedRaw` is the exact raw contents it inspected and
 * `isStillStale` re-evaluates the staleness condition on a fresh read taken
 * inside the mutex (receives `{ pid, acquiredAt, mtimeMs, raw }`).
 *
 * @returns {"reclaimed"|"changed"|"gone"|"busy"}
 *   reclaimed — the inspected lock generation was stale and has been removed
 *   changed   — the pathname now holds a different (or no-longer-stale) lock; NOT removed
 *   gone      — the lock vanished on its own (holder released / other reclaimer)
 *   busy      — could not obtain the reclaim mutex in time; NOT removed
 */
export function reclaimStaleLock(lockFile, { expectedRaw, isStillStale, mutexTimeoutMs } = {}) {
  if (typeof expectedRaw !== "string" || typeof isStillStale !== "function") {
    throw new Error("reclaimStaleLock: expectedRaw (string) and isStillStale (function) are required");
  }
  if (!acquireReclaimMutex(lockFile, { timeoutMs: mutexTimeoutMs })) return "busy";
  try {
    let raw;
    let mtimeMs;
    try {
      raw = readFileSync(lockFile, "utf8");
      mtimeMs = statSync(lockFile).mtimeMs;
    } catch {
      return "gone";
    }
    // Generation check: a replacement lock written by a new holder has
    // different contents (fresh pid + acquire timestamp). Never unlink a
    // generation we did not inspect.
    if (raw !== expectedRaw) return "changed";
    const lines = raw.split("\n");
    const pid = Number(lines[0]?.trim());
    const acquiredAt = Number(lines[1]?.trim());
    if (!isStillStale({ pid, acquiredAt, mtimeMs, raw })) return "changed";
    try {
      unlinkSync(lockFile);
    } catch {
      return "gone";
    }
    return "reclaimed";
  } finally {
    releaseReclaimMutex(lockFile);
  }
}
