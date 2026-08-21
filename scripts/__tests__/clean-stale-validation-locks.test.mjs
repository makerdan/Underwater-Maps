/**
 * clean-stale-validation-locks.test.mjs — regression tests for the post-merge
 * validation-lock cleanup (scripts/clean-stale-validation-locks.mjs).
 *
 * The critical property under test: cleanup must NEVER remove a lock whose
 * recorded holder process is alive. The validation lock is an
 * exclusive-pathname lock (the file's existence is the mutual exclusion), so
 * deleting a live holder's lock would let a second validation command run
 * concurrently with the first — the exact interference the lock prevents.
 *
 * Run: node --test scripts/__tests__/clean-stale-validation-locks.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, openSync, closeSync,
  unlinkSync, utimesSync, rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  cleanStaleValidationLocks,
  UNPARSABLE_STALE_MS,
} from "../clean-stale-validation-locks.mjs";
import { mutexPathFor, reclaimStaleLock } from "../lib/reclaim-mutex.mjs";

const silent = { log: () => {} };

function makeDir() {
  return mkdtempSync(join(tmpdir(), "lock-cleanup-test-"));
}

function writeLock(dir, name, contents) {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

/** A pid guaranteed dead: spawn a trivial node child and wait for it to exit. */
function deadPid() {
  const res = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  assert.equal(res.status, 0, "helper child should exit cleanly");
  return res.pid;
}

test("keeps a lock whose recorded holder pid is alive (mutual exclusion preserved)", () => {
  const dir = makeDir();
  try {
    // Use our own pid as the live holder — indistinguishable from a running
    // validation-lock.mjs wrapper from the cleaner's perspective.
    const path = writeLock(dir, "validation-lock-unit-cpu.lock", `${process.pid}\n${Date.now()}\n`);

    const { removed, kept } = cleanStaleValidationLocks(dir, silent);

    assert.deepEqual(removed, []);
    assert.deepEqual(kept, ["validation-lock-unit-cpu.lock"]);
    assert.ok(existsSync(path), "live holder's lock file must survive cleanup");

    // The regression scenario end-to-end: after cleanup, a second command
    // attempting the same exclusive-pathname acquisition (openSync "wx",
    // as validation-lock.mjs tryAcquire does) must still be excluded.
    assert.throws(
      () => closeSync(openSync(path, "wx")),
      /EEXIST/,
      "a second acquirer must still hit EEXIST while the live holder runs",
    );
    assert.equal(
      readFileSync(path, "utf8").split("\n")[0],
      String(process.pid),
      "lock contents must be untouched",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removes a lock whose recorded holder pid is dead", () => {
  const dir = makeDir();
  try {
    const pid = deadPid();
    const path = writeLock(dir, "validation-lock-global.lock", `${pid}\n${Date.now()}\n`);

    const { removed, kept } = cleanStaleValidationLocks(dir, silent);

    assert.deepEqual(removed, ["validation-lock-global.lock"]);
    assert.deepEqual(kept, []);
    assert.ok(!existsSync(path), "dead holder's lock file must be removed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps an unparsable lock file that is recent (possible in-flight write)", () => {
  const dir = makeDir();
  try {
    const path = writeLock(dir, "validation-lock-codegen.lock", "not-a-pid\n");

    const { removed, kept } = cleanStaleValidationLocks(dir, silent);

    assert.deepEqual(removed, []);
    assert.deepEqual(kept, ["validation-lock-codegen.lock"]);
    assert.ok(existsSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removes an unparsable lock file once it is very stale", () => {
  const dir = makeDir();
  try {
    const path = writeLock(dir, "validation-lock-codegen.lock", "garbage\n");
    const old = new Date(Date.now() - UNPARSABLE_STALE_MS - 60_000);
    utimesSync(path, old, old);

    const { removed } = cleanStaleValidationLocks(dir, silent);

    assert.deepEqual(removed, ["validation-lock-codegen.lock"]);
    assert.ok(!existsSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only touches validation-lock-*.lock files, and mixed dirs clean correctly", () => {
  const dir = makeDir();
  try {
    const live = writeLock(dir, "validation-lock-e2e-web.lock", `${process.pid}\n${Date.now()}\n`);
    const dead = writeLock(dir, "validation-lock-unit-cpu.lock", `${deadPid()}\n${Date.now()}\n`);
    const other = writeLock(dir, "some-other-file.lock", "unrelated");
    const codegen = writeLock(dir, ".codegen.lock", "unrelated");

    const { removed, kept } = cleanStaleValidationLocks(dir, silent);

    assert.deepEqual(removed, ["validation-lock-unit-cpu.lock"]);
    assert.deepEqual(kept, ["validation-lock-e2e-web.lock"]);
    assert.ok(existsSync(live), "live lock survives");
    assert.ok(!existsSync(dead), "dead lock removed");
    assert.ok(existsSync(other), "non-validation lock files are never touched");
    assert.ok(existsSync(codegen), "codegen lock is out of scope for this cleaner");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns empty result when the directory does not exist", () => {
  const { removed, kept } = cleanStaleValidationLocks(
    join(tmpdir(), "definitely-missing-dir-xyz"),
    silent,
  );
  assert.deepEqual(removed, []);
  assert.deepEqual(kept, []);
});

test("reports and propagates non-ENOENT directory read errors", () => {
  const diagnostics = [];
  const error = Object.assign(new Error("permission denied"), { code: "EACCES" });

  assert.throws(
    () =>
      cleanStaleValidationLocks("/unreadable-lock-dir", {
        ...silent,
        readdirSync: () => {
          throw error;
        },
        errorLog: (message) => diagnostics.push(message),
      }),
    (thrown) => thrown === error,
  );
  assert.deepEqual(diagnostics, [
    "clean-stale-validation-locks: cannot read lock directory — EACCES: permission denied",
  ]);
});

// ---------------------------------------------------------------------------
// TOCTOU regression: cleanup inspects a stale lock while a concurrent waiter
// reclaims it and a NEW wrapper acquires a replacement lock at the same
// pathname. Cleanup must leave the new holder's lock intact — the exact
// interleaving that a naive read → check-dead → unlink sequence gets wrong.
// ---------------------------------------------------------------------------

test("TOCTOU: keeps a replacement lock acquired between inspection and unlink", () => {
  const dir = makeDir();
  try {
    const name = "validation-lock-global.lock";
    const path = join(dir, name);
    writeLock(dir, name, `${deadPid()}\n${Date.now()}\n`);

    const newHolderContents = `${process.pid}\n${Date.now() + 1}\n`;
    const { removed, kept } = cleanStaleValidationLocks(dir, {
      ...silent,
      onBeforeReclaim: () => {
        // Simulate a concurrent validation-lock waiter reclaiming the stale
        // file and a new live wrapper acquiring a replacement lock, in the
        // window between the cleaner's inspection and its unlink attempt.
        unlinkSync(path);
        const fd = openSync(path, "wx"); // same exclusive-create as tryAcquire()
        writeFileSync(fd, newHolderContents);
        closeSync(fd);
      },
    });

    assert.deepEqual(removed, [], "cleanup must not remove the replacement lock");
    assert.deepEqual(kept, [name]);
    assert.ok(existsSync(path), "new holder's lock must survive");
    assert.equal(
      readFileSync(path, "utf8"),
      newHolderContents,
      "new holder's lock contents must be byte-identical after cleanup",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TOCTOU: keeps the lock when the stale file vanishes and is NOT replaced", () => {
  const dir = makeDir();
  try {
    const name = "validation-lock-unit-cpu.lock";
    const path = join(dir, name);
    writeLock(dir, name, `${deadPid()}\n${Date.now()}\n`);

    const { removed } = cleanStaleValidationLocks(dir, {
      ...silent,
      onBeforeReclaim: () => unlinkSync(path), // concurrent reclaimer won the race
    });

    // Nothing left to remove; must not report a removal it did not perform.
    assert.deepEqual(removed, []);
    assert.ok(!existsSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not reclaim while another process holds the reclaim mutex", () => {
  const dir = makeDir();
  try {
    const name = "validation-lock-codegen.lock";
    const path = writeLock(dir, name, `${deadPid()}\n${Date.now()}\n`);

    // Simulate a live concurrent reclaimer holding the per-lock mutex.
    const mutexDir = mutexPathFor(path);
    mkdirSync(mutexDir);
    writeFileSync(join(mutexDir, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now() }));

    const busy = cleanStaleValidationLocks(dir, { ...silent, mutexTimeoutMs: 100 });
    assert.deepEqual(busy.removed, [], "must not unlink while the mutex is held elsewhere");
    assert.ok(existsSync(path), "lock must survive a busy mutex");

    // Once the concurrent reclaimer releases, cleanup proceeds normally.
    rmSync(mutexDir, { recursive: true, force: true });
    const after = cleanStaleValidationLocks(dir, silent);
    assert.deepEqual(after.removed, [name]);
    assert.ok(!existsSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("takes over an abandoned reclaim mutex (dead owner) and still cleans safely", () => {
  const dir = makeDir();
  try {
    const name = "validation-lock-e2e-web.lock";
    const path = writeLock(dir, name, `${deadPid()}\n${Date.now()}\n`);

    // Abandoned mutex: recorded owner pid is dead (reclaimer was SIGKILLed
    // inside its microseconds-long critical section).
    const mutexDir = mutexPathFor(path);
    mkdirSync(mutexDir);
    writeFileSync(join(mutexDir, "owner.json"), JSON.stringify({ pid: deadPid(), at: Date.now() }));

    const { removed } = cleanStaleValidationLocks(dir, silent);
    assert.deepEqual(removed, [name], "abandoned mutex must not deadlock cleanup");
    assert.ok(!existsSync(path));
    assert.ok(!existsSync(mutexDir), "mutex must be released after reclaim");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reclaimStaleLock refuses a generation it did not inspect", () => {
  const dir = makeDir();
  try {
    const path = writeLock(dir, "validation-lock-global.lock", `${process.pid}\n${Date.now()}\n`);
    const outcome = reclaimStaleLock(path, {
      expectedRaw: "999999\n1\n", // some other generation
      isStillStale: () => true,   // even an always-stale verdict must not override the generation check
    });
    assert.equal(outcome, "changed");
    assert.ok(existsSync(path), "mismatched generation must never be unlinked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
