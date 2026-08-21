/**
 * Self-test for scripts/check-schema-drift.mjs
 *
 * Run via:  node --test scripts/__tests__/check-schema-drift.test.mjs
 *
 * Covers the hardening added for I/O guards and cleanup:
 *   (a) journal absent → the script exits 1 with a clear, path-naming
 *       message instead of a raw ENOENT stack trace;
 *   (b) the Guard 2 cleanup path is idempotent — safe to call with an
 *       empty `created` list and a valid backup string, and safe to call
 *       repeatedly.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { loadJournal, listDirOrThrow, cleanupGenerated } from "../check-schema-drift.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "..", "check-schema-drift.mjs");

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "schema-drift-test-"));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Copy the real script into a fake repo layout so its
 * resolve(scriptDir, "..") root points at the sandbox. This runs the
 * genuine script end-to-end without touching the real lib/db tree.
 */
function makeFakeRepo(name) {
  const repo = join(sandbox, name);
  mkdirSync(join(repo, "scripts"), { recursive: true });
  copyFileSync(scriptPath, join(repo, "scripts", "check-schema-drift.mjs"));
  return repo;
}

function runScript(repo, env = {}) {
  try {
    const stdout = execFileSync("node", [join(repo, "scripts", "check-schema-drift.mjs")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: err.status,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  }
}

describe("journal absent", () => {
  it("exits 1 with a clear message naming the missing journal path", () => {
    const repo = makeFakeRepo("missing-journal");
    // lib/db/drizzle exists but meta/_journal.json does not.
    mkdirSync(join(repo, "lib", "db", "drizzle", "meta"), { recursive: true });
    rmSync(join(repo, "lib", "db", "drizzle", "meta", "_journal.json"), { force: true });

    const result = runScript(repo);
    const expectedPath = join(repo, "lib", "db", "drizzle", "meta", "_journal.json");

    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stderr}`);
    assert.ok(
      result.stderr.includes(expectedPath),
      `stderr should name the missing journal path.\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("missing"),
      `stderr should say the journal is missing.\nstderr: ${result.stderr}`,
    );
    // Guarded failure, not a raw uncaught ENOENT stack trace.
    assert.ok(
      !result.stderr.includes("Node.js v") && !result.stderr.includes("throw err"),
      `stderr should not contain a raw Node.js stack trace.\nstderr: ${result.stderr}`,
    );
  });

  it("exits 1 with a clear message when the drizzle directory is missing entirely", () => {
    const repo = makeFakeRepo("missing-drizzle-dir");
    // lib/db exists but drizzle/ does not.
    mkdirSync(join(repo, "lib", "db"), { recursive: true });

    const result = runScript(repo);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes("missing"),
      `stderr should mention a missing path.\nstderr: ${result.stderr}`,
    );
    assert.ok(
      !result.stderr.includes("Node.js v"),
      `stderr should not contain a raw Node.js stack trace.\nstderr: ${result.stderr}`,
    );
  });
});

describe("loadJournal", () => {
  it("throws a path-naming error for a missing file", () => {
    const missing = join(sandbox, "nope", "_journal.json");
    assert.throws(() => loadJournal(missing), (err) => {
      assert.ok(err.message.includes(missing), `message should include path: ${err.message}`);
      assert.ok(err.message.includes("missing"), `message should say missing: ${err.message}`);
      return true;
    });
  });

  it("throws a path-naming error for malformed JSON", () => {
    const badPath = join(sandbox, "bad-journal.json");
    writeFileSync(badPath, "{ not json !");
    assert.throws(() => loadJournal(badPath), (err) => {
      assert.ok(err.message.includes(badPath), `message should include path: ${err.message}`);
      assert.ok(
        err.message.includes("not valid JSON"),
        `message should say invalid JSON: ${err.message}`,
      );
      return true;
    });
  });

  it("parses a valid journal", () => {
    const goodPath = join(sandbox, "good-journal.json");
    writeFileSync(goodPath, JSON.stringify({ entries: [{ idx: 0, tag: "0000_init" }] }));
    const journal = loadJournal(goodPath);
    assert.equal(journal.entries.length, 1);
  });
});

describe("listDirOrThrow", () => {
  it("throws a path-naming error for a missing directory", () => {
    const missingDir = join(sandbox, "no-such-dir");
    assert.throws(() => listDirOrThrow(missingDir), (err) => {
      assert.ok(err.message.includes(missingDir), `message should include dir: ${err.message}`);
      return true;
    });
  });

  it("lists an existing directory", () => {
    const dir = join(sandbox, "listable");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.sql"), "-- test");
    assert.deepEqual(listDirOrThrow(dir), ["a.sql"]);
  });
});

describe("cleanupGenerated is idempotent", () => {
  it("is safe with an empty created list and a valid backup string", () => {
    const journalFile = join(sandbox, "cleanup-journal.json");
    const backup = JSON.stringify({ entries: [] });
    writeFileSync(journalFile, "MUTATED BY GENERATE");

    // First call restores the journal.
    cleanupGenerated([], journalFile, backup);
    assert.equal(readFileSync(journalFile, "utf8"), backup);

    // Second call (double-cleanup, e.g. catch + finally) is a no-op rewrite.
    cleanupGenerated([], journalFile, backup);
    assert.equal(readFileSync(journalFile, "utf8"), backup);
  });

  it("removes created files and tolerates already-removed files", () => {
    const journalFile = join(sandbox, "cleanup-journal-2.json");
    const backup = "{}";
    writeFileSync(journalFile, "stale");
    const createdFile = join(sandbox, "0042_drifted.sql");
    writeFileSync(createdFile, "ALTER TABLE ...");

    cleanupGenerated([createdFile], journalFile, backup);
    assert.ok(!existsSync(createdFile), "created file should be removed");
    assert.equal(readFileSync(journalFile, "utf8"), backup);

    // Calling again with the same (now nonexistent) file must not throw.
    cleanupGenerated([createdFile], journalFile, backup);
    assert.ok(!existsSync(createdFile));
    assert.equal(readFileSync(journalFile, "utf8"), backup);
  });

  it("does not touch the journal when the backup is not a string", () => {
    const journalFile = join(sandbox, "cleanup-journal-3.json");
    writeFileSync(journalFile, "original");
    cleanupGenerated([], journalFile, undefined);
    assert.equal(readFileSync(journalFile, "utf8"), "original");
  });
});

describe("schema drift cleanup", () => {
  it("restores an existing snapshot rewritten by drizzle-kit", () => {
    const repo = makeFakeRepo("rewritten-snapshot");
    const drizzleDir = join(repo, "lib", "db", "drizzle");
    const metaDir = join(drizzleDir, "meta");
    mkdirSync(metaDir, { recursive: true });

    const journalPath = join(metaDir, "_journal.json");
    const snapshotPath = join(metaDir, "0000_snapshot.json");
    const originalSnapshot = '{"id":"original"}\n';
    writeFileSync(journalPath, JSON.stringify({ entries: [] }));
    writeFileSync(snapshotPath, originalSnapshot);

    const binDir = join(repo, "bin");
    const fakePnpm = join(binDir, "pnpm");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      fakePnpm,
      '#!/bin/sh\nprintf \'{"id":"rewritten"}\\n\' > "$REWRITE_TARGET"\n',
    );
    chmodSync(fakePnpm, 0o755);

    const result = runScript(repo, {
      PATH: `${binDir}:${process.env.PATH}`,
      REWRITE_TARGET: snapshotPath,
    });

    assert.equal(result.status, 0, `expected success, got ${result.status}\n${result.stderr}`);
    assert.equal(readFileSync(snapshotPath, "utf8"), originalSnapshot);
  });
});
