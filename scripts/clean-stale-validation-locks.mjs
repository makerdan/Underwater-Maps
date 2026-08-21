#!/usr/bin/env node
/**
 * clean-stale-validation-locks.mjs — remove validation lock files whose
 * recorded holder process is dead.
 *
 * Called from scripts/post-merge.sh so a lock left behind by an aborted
 * validation run (holder SIGKILLed, environment restarted, etc.) never
 * requires a manual `rm` before the next validation run can proceed.
 *
 * SAFETY CONTRACT — this is deliberately NOT `rm -f .local/validation-lock-*`:
 * the lock protocol in scripts/validation-lock.mjs is an exclusive-pathname
 * lock (openSync(..., "wx")); the fd is closed right after writing, so the
 * *file's existence* is the mutual exclusion, not an open fd or flock.
 * Blindly deleting a lock held by a live wrapper would let a second command
 * acquire a replacement lock while the first is still running — exactly the
 * concurrent-validation interference the lock exists to prevent.
 *
 * Rules (lock file format: line 1 = holder pid, line 2 = acquire ms epoch):
 *   - holder pid parses and is alive          → KEEP (never break a live lock)
 *   - holder pid parses and is dead           → REMOVE
 *   - holder pid unparsable, mtime recent     → KEEP (in-flight write / unknown
 *     writer; validation-lock.mjs's own stale-heartbeat reclaim covers it)
 *   - holder pid unparsable, mtime very stale → REMOVE (garbage file)
 *
 * The REMOVE cases do not unlink directly: a read → check-dead → unlink
 * sequence has a TOCTOU race (between the read and the unlink, a waiting
 * validation-lock.mjs wrapper can reclaim the stale file and a new wrapper
 * can acquire a replacement lock at the same pathname — the direct unlink
 * would then destroy the new live lock). All removals go through
 * reclaimStaleLock() in scripts/lib/reclaim-mutex.mjs — the same atomic
 * verify-then-unlink protocol validation-lock.mjs's own reclaim uses — which
 * re-verifies, under a per-lock-file mutex, that the pathname still holds
 * the exact lock generation this cleaner inspected and that it is still
 * stale before unlinking.
 *
 * Live-but-orphaned holders (wrapper alive, parent gone) are intentionally
 * NOT killed here: post-merge cannot distinguish them from a legitimately
 * running validation step. validation-lock.mjs's max-hold safety valve
 * reclaims from hung-but-alive holders; truly wedged holders need the manual
 * pgid kill documented in .agents/memory/validation-lock-stale-holders.md.
 *
 * Unit-tested in scripts/__tests__/clean-stale-validation-locks.test.mjs
 * (run in CI via the check:stale-lock-cleanup step).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reclaimStaleLock } from "./lib/reclaim-mutex.mjs";

/** Lock files created by validation-lock.mjs: validation-lock-<resource>.lock */
export const LOCK_FILE_RE = /^validation-lock-[a-zA-Z0-9-]+\.lock$/;

/**
 * Unparsable lock files are removed only when older than this. Generous
 * multiple of validation-lock.mjs's 60 s stale-heartbeat window so a lock
 * caught mid-write (created but pid line not yet flushed) is never swept.
 */
export const UNPARSABLE_STALE_MS = 10 * 60 * 1000;

/** Same liveness probe validation-lock.mjs uses (EPERM = alive, other = dead). */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Staleness predicate shared between the outside-mutex screening pass and
 * the inside-mutex re-verification in reclaimStaleLock(): a lock is stale
 * when its recorded holder pid is provably dead, or its pid is unreadable
 * and the file has not been touched for UNPARSABLE_STALE_MS.
 */
function isStaleLockInfo({ pid, mtimeMs }, now) {
  const pidParses = Number.isInteger(pid) && pid > 0;
  if (pidParses) return !pidAlive(pid);
  return now - mtimeMs > UNPARSABLE_STALE_MS;
}

/**
 * Lock files have a two-line format: holder PID, then acquire-time epoch.
 * A missing or non-numeric acquire time is malformed regardless of PID
 * liveness and must be reclaimed.
 */
function isMalformedLock(raw) {
  const acquireLine = raw.split("\n")[1]?.trim();
  return !acquireLine || Number.isNaN(Number(acquireLine));
}

/**
 * Scan `dir` for validation lock files and remove only those whose recorded
 * holder is provably gone. Returns { removed, kept } filename arrays.
 *
 * @param {string} dir directory containing validation-lock-*.lock files
 * @param {{
 *   log?: (msg: string) => void,
 *   now?: number,
 *   mutexTimeoutMs?: number,
 *   readdirSync?: (dir: string) => string[], // test hook for directory read errors
 *   errorLog?: (msg: string) => void,
 *   onBeforeReclaim?: (name: string) => void,  // test hook: fires between the
 *     // outside-mutex staleness screen and the atomic reclaim, to simulate a
 *     // concurrent reclaim-and-reacquire interleaving deterministically
 * }} [opts]
 */
export function cleanStaleValidationLocks(dir, opts = {}) {
  const log = opts.log ?? console.log;
  const errorLog = opts.errorLog ?? console.error;
  const readDir = opts.readdirSync ?? readdirSync;
  const now = opts.now ?? Date.now();
  let entries;
  try {
    entries = readDir(dir);
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { removed: [], kept: [] }; // no .local dir yet — nothing to clean
    }
    const code = err?.code ?? "UNKNOWN";
    const message = err instanceof Error ? err.message : String(err);
    errorLog(`clean-stale-validation-locks: cannot read lock directory — ${code}: ${message}`);
    throw err;
  }

  const removed = [];
  const kept = [];
  for (const name of entries) {
    if (!LOCK_FILE_RE.test(name)) continue;
    try {
      const path = join(dir, name);

      // Screening pass (outside the mutex): cheap read to find candidates.
      let raw;
      let holderPid;
      let mtimeMs;
      try {
        raw = readFileSync(path, "utf8");
        holderPid = Number(raw.split("\n")[0]?.trim());
        mtimeMs = statSync(path).mtimeMs;
      } catch {
        continue; // lock released/vanished between readdir and read — done
      }

      if (!isMalformedLock(raw) && !isStaleLockInfo({ pid: holderPid, mtimeMs }, now)) {
        kept.push(name);
        log(
          Number.isInteger(holderPid) && holderPid > 0
            ? `[clean-stale-locks] keeping ${name} — holder pid ${holderPid} is alive`
            : `[clean-stale-locks] keeping ${name} — holder pid unreadable but file is recent`,
        );
        continue;
      }

      opts.onBeforeReclaim?.(name);

      // Atomic verify-then-unlink: under the per-lock-file reclaim mutex,
      // re-verify the pathname still holds the exact generation we screened
      // (byte-identical contents) and that it is still stale. A replacement
      // lock acquired by a live wrapper in the meantime is left untouched.
      const outcome = reclaimStaleLock(path, {
        expectedRaw: raw,
        now,
        isStillStale: (fresh, recheckNow) =>
          isMalformedLock(fresh.raw) || isStaleLockInfo(fresh, recheckNow),
        mutexTimeoutMs: opts.mutexTimeoutMs,
      });
      if (outcome === "reclaimed") {
        removed.push(name);
        log(`[clean-stale-locks] removed ${name} — stale (holder pid ${holderPid || "unreadable"} gone)`);
      } else {
        kept.push(name);
        log(`[clean-stale-locks] keeping ${name} — reclaim outcome "${outcome}" (lock changed hands, vanished, or reclaim mutex busy)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errorLog(`clean-stale-locks: error processing ${name}: ${message}`);
    }
  }
  return { removed, kept };
}

// ---------------------------------------------------------------------------
// CLI entry point (used by scripts/post-merge.sh)
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const localDir = resolve(here, "..", ".local");
  const { removed, kept } = cleanStaleValidationLocks(localDir);
  console.log(
    `[clean-stale-locks] done — removed ${removed.length} stale lock(s), kept ${kept.length} live lock(s).`,
  );
}
