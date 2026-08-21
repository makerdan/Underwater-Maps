/**
 * Self-test for scripts/check-skip-count.mjs
 *
 * Run via:  node --test scripts/__tests__/check-skip-count.test.mjs
 * (wired into the `check:skip-count` npm script, which runs in the
 * test-fast validation tier.)
 *
 * Covers the hardening guards:
 *   (a) missing or malformed baseline → exit 1 with a clear, path-naming
 *       message instead of a raw ENOENT / SyntaxError stack trace;
 *   (b) missing scan root → exit 1 with a message naming the directory
 *       (never silently treated as zero coverage);
 *   (c) unreadable test file inside a valid root → warn + skip, counting
 *       continues for the remaining files;
 * plus the unchanged normal ratchet behaviour (count ≤ baseline → OK,
 * count > baseline → exit 1).
 *
 * NOTE: this file is itself scanned by the ratchet (a *.test.mjs under
 * scripts/), so skip-call fixtures are built by string concatenation —
 * never written literally — or they would count against the baseline.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { countMatches, loadBaseline, findMissingScanRoots } from "../check-skip-count.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "..", "check-skip-count.mjs");
const ignoredDirsPath = resolve(__dirname, "..", "lib", "ignored-dirs.mjs");

// Built dynamically so the ratchet scanning THIS file never counts them.
const UNIT_SKIP_CALL = ["it", "skip("].join(".");
const E2E_SKIP_CALL = ["test", "skip("].join(".");

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "skip-count-test-"));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Copy the real script into a fake repo layout so its resolve(scriptDir, "..")
 * root points at the sandbox. Creates all configured scan roots and a
 * zero/zero baseline; individual tests then mutate the layout.
 */
function makeFakeRepo(name) {
  const repo = join(sandbox, name);
  mkdirSync(join(repo, "scripts", "lib"), { recursive: true });
  copyFileSync(scriptPath, join(repo, "scripts", "check-skip-count.mjs"));
  copyFileSync(ignoredDirsPath, join(repo, "scripts", "lib", "ignored-dirs.mjs"));
  for (const d of ["artifacts", "lib", join("tests", "e2e")]) {
    mkdirSync(join(repo, d), { recursive: true });
  }
  writeBaseline(repo, { unitStaticSkips: 0, e2eSkipSites: 0 });
  return repo;
}

function writeBaseline(repo, obj) {
  writeFileSync(join(repo, "tests", "skip-baseline.json"), JSON.stringify(obj));
}

function runScript(repo, { nodeArgs = [], ...options } = {}) {
  const res = spawnSync("node", [...nodeArgs, join(repo, "scripts", "check-skip-count.mjs")], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return {
    status: res.status,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

function assertNoRawStackTrace(result) {
  assert.ok(
    !result.stderr.includes("Node.js v") && !result.stderr.includes("throw err"),
    `stderr should not contain a raw Node.js stack trace.\nstderr: ${result.stderr}`,
  );
}

// ── (a) baseline guards ────────────────────────────────────────────────────

describe("baseline guards", () => {
  it("missing baseline → exit 1 with a clear path-naming message", () => {
    const repo = makeFakeRepo("missing-baseline");
    rmSync(join(repo, "tests", "skip-baseline.json"));

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stderr}`);
    assert.ok(
      result.stderr.includes("baseline file not found"),
      `stderr should say the baseline file was not found.\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes(join(repo, "tests", "skip-baseline.json")),
      `stderr should name the baseline path.\nstderr: ${result.stderr}`,
    );
    assertNoRawStackTrace(result);
  });

  it("malformed baseline JSON → exit 1 with a clear message", () => {
    const repo = makeFakeRepo("malformed-baseline");
    writeFileSync(join(repo, "tests", "skip-baseline.json"), "{ not json !");

    const result = runScript(repo);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes("not valid JSON"),
      `stderr should say the baseline is not valid JSON.\nstderr: ${result.stderr}`,
    );
    assertNoRawStackTrace(result);
  });

  it("JSON-valid but null baseline → exit 1 with a clear message, no stack trace", () => {
    const repo = makeFakeRepo("null-baseline");
    writeFileSync(join(repo, "tests", "skip-baseline.json"), "null");

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stderr}`);
    assert.ok(
      result.stderr.includes("malformed"),
      `stderr should say the baseline is malformed.\nstderr: ${result.stderr}`,
    );
    assertNoRawStackTrace(result);
  });

  it("baseline with a non-integer field → exit 1 naming the key, no stack trace", () => {
    const repo = makeFakeRepo("bad-field-baseline");
    writeBaseline(repo, { unitStaticSkips: 0, e2eSkipSites: "lots" });

    const result = runScript(repo);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes('"e2eSkipSites"') && result.stderr.includes("non-negative integer"),
      `stderr should name the bad key and expected type.\nstderr: ${result.stderr}`,
    );
    assertNoRawStackTrace(result);
  });
});

// ── (b) missing scan root ──────────────────────────────────────────────────

describe("missing scan roots", () => {
  it("missing unit scan root → exit 1 naming the directory", () => {
    const repo = makeFakeRepo("missing-artifacts-root");
    rmSync(join(repo, "artifacts"), { recursive: true });

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stderr}`);
    assert.ok(
      result.stderr.includes("scan root missing") && result.stderr.includes('"artifacts"'),
      `stderr should name the missing "artifacts" root.\nstderr: ${result.stderr}`,
    );
    assertNoRawStackTrace(result);
  });

  it("missing e2e scan root → exit 1 naming the directory", () => {
    const repo = makeFakeRepo("missing-e2e-root");
    rmSync(join(repo, "tests", "e2e"), { recursive: true });

    const result = runScript(repo);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes("scan root missing") && result.stderr.includes("tests/e2e"),
      `stderr should name the missing tests/e2e root.\nstderr: ${result.stderr}`,
    );
  });

  it("findMissingScanRoots flags a root that exists but is a file, and passes real dirs", () => {
    const repo = makeFakeRepo("root-is-a-file");
    rmSync(join(repo, "lib"), { recursive: true });
    writeFileSync(join(repo, "lib"), "not a directory");
    assert.deepEqual(findMissingScanRoots(repo, ["artifacts", "lib", "tests/e2e"]), ["lib"]);
  });
});

// ── (c) unreadable file inside a valid root ────────────────────────────────

describe("unreadable file handling", () => {
  it("warns, skips the file, and keeps counting the rest (end-to-end)", () => {
    const repo = makeFakeRepo("unreadable-file");
    // One unreadable unit test file with 2 skip sites (must NOT count or abort)…
    const unreadable = join(repo, "artifacts", "broken.test.ts");
    writeFileSync(unreadable, `${UNIT_SKIP_CALL}"a");\n${UNIT_SKIP_CALL}"b");\n`);
    chmodSync(unreadable, 0o000);
    // …and one readable file with 1 skip site that must still be counted.
    writeFileSync(join(repo, "lib", "counted.test.ts"), `${UNIT_SKIP_CALL}"c");\n`);
    writeBaseline(repo, { unitStaticSkips: 1, e2eSkipSites: 0 });

    const result = runScript(repo);
    chmodSync(unreadable, 0o644); // restore for sandbox cleanup

    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.ok(
      result.stderr.includes("could not read") && result.stderr.includes("broken.test.ts"),
      `stderr should warn about the unreadable file.\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes("OK — unit static skips") && result.stdout.includes("1 skip site(s)"),
      `stdout should show counting continued with the readable file.\nstdout: ${result.stdout}`,
    );
  });

  it("EACCES directory → warns and exits 1 instead of counting partial coverage", () => {
    const repo = makeFakeRepo("unreadable-directory");
    const unreadableDir = join(repo, "artifacts", "private");
    mkdirSync(unreadableDir);
    writeFileSync(join(unreadableDir, "hidden.test.ts"), `${UNIT_SKIP_CALL}"hidden");\n`);
    const preload = join(repo, "deny-readdir.mjs");
    writeFileSync(
      preload,
      [
        'import fs from "node:fs";',
        'import { syncBuiltinESMExports } from "node:module";',
        "const originalReaddirSync = fs.readdirSync;",
        "fs.readdirSync = (path, ...args) => {",
        '  if (path.endsWith("/private")) {',
        '    const error = new Error("permission denied by test");',
        '    error.code = "EACCES";',
        "    throw error;",
        "  }",
        "  return originalReaddirSync(path, ...args);",
        "};",
        "syncBuiltinESMExports();",
      ].join("\n"),
    );
    writeBaseline(repo, { unitStaticSkips: 0, e2eSkipSites: 0 });

    const result = runScript(repo, { nodeArgs: ["--import", preload] });

    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stderr}`);
    assert.ok(
      result.stderr.includes("could not read directory") && result.stderr.includes("private"),
      `stderr should identify the unreadable directory.\nstderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("refusing to compare a partial skip count"),
      `stderr should refuse partial coverage.\nstderr: ${result.stderr}`,
    );
  });

  it("countMatches skips a nonexistent file and counts the rest (unit)", () => {
    const repo = makeFakeRepo("countmatches-unit");
    const good = join(repo, "artifacts", "good.test.ts");
    writeFileSync(good, `${UNIT_SKIP_CALL}"x");\n`);
    const re = new RegExp(String.raw`\b(?:it|test|describe)\.skip\(`, "g");

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    let out;
    try {
      out = countMatches([join(repo, "artifacts", "gone.test.ts"), good], re);
    } finally {
      console.warn = origWarn;
    }

    assert.equal(out.total, 1);
    assert.equal(out.perFile.length, 1);
    assert.ok(out.perFile[0].file.endsWith("good.test.ts"));
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("gone.test.ts") && warnings[0].includes("could not read"));
  });

  it("countMatches normalizes non-global regexes and counts every match", () => {
    const repo = makeFakeRepo("countmatches-non-global");
    const file = join(repo, "artifacts", "three.test.ts");
    writeFileSync(file, `${UNIT_SKIP_CALL}"a");\n${UNIT_SKIP_CALL}"b");\n${UNIT_SKIP_CALL}"c");\n`);

    const nonGlobal = countMatches([file], new RegExp(String.raw`\b(?:it|test|describe)\.skip\(`));
    const global = countMatches(
      [file],
      new RegExp(String.raw`\b(?:it|test|describe)\.skip\(`, "g"),
    );

    assert.deepEqual(nonGlobal, global);
    assert.equal(nonGlobal.total, 3);
  });
});

// ── loadBaseline direct unit coverage ──────────────────────────────────────

describe("loadBaseline", () => {
  it("throws a path-naming error for a missing file", () => {
    const missing = join(sandbox, "nope", "skip-baseline.json");
    assert.throws(() => loadBaseline(missing), (err) => {
      assert.ok(err.message.includes(missing), `message should include path: ${err.message}`);
      assert.ok(err.message.includes("not found"), `message should say not found: ${err.message}`);
      return true;
    });
  });

  it("throws a clear error for malformed JSON", () => {
    const badPath = join(sandbox, "bad-baseline.json");
    writeFileSync(badPath, "{{{{");
    assert.throws(() => loadBaseline(badPath), (err) => {
      assert.ok(err.message.includes("not valid JSON"), `message: ${err.message}`);
      assert.ok(err.message.includes(badPath), `message should include path: ${err.message}`);
      return true;
    });
  });

  it("throws a clear error for JSON-valid non-object shapes (null, array, scalar)", () => {
    for (const [name, content] of [
      ["null-shape.json", "null"],
      ["array-shape.json", "[1, 2]"],
      ["scalar-shape.json", "42"],
    ]) {
      const p = join(sandbox, name);
      writeFileSync(p, content);
      assert.throws(() => loadBaseline(p), (err) => {
        assert.ok(err.message.includes("malformed"), `(${name}) message: ${err.message}`);
        assert.ok(err.message.includes(p), `(${name}) message should include path: ${err.message}`);
        return true;
      });
    }
  });

  it("throws a key-naming error for missing or invalid field values", () => {
    for (const [name, obj] of [
      ["missing-key.json", { unitStaticSkips: 0 }],
      ["negative-value.json", { unitStaticSkips: -1, e2eSkipSites: 0 }],
      ["string-value.json", { unitStaticSkips: 0, e2eSkipSites: "7" }],
      ["float-value.json", { unitStaticSkips: 0, e2eSkipSites: 1.5 }],
    ]) {
      const p = join(sandbox, name);
      writeFileSync(p, JSON.stringify(obj));
      assert.throws(() => loadBaseline(p), (err) => {
        assert.ok(
          err.message.includes("non-negative integer"),
          `(${name}) message: ${err.message}`,
        );
        return true;
      });
    }
  });

  it("parses a valid baseline", () => {
    const goodPath = join(sandbox, "good-baseline.json");
    writeFileSync(goodPath, JSON.stringify({ unitStaticSkips: 0, e2eSkipSites: 7 }));
    assert.deepEqual(loadBaseline(goodPath), { unitStaticSkips: 0, e2eSkipSites: 7 });
  });
});

// ── normal ratchet behaviour unchanged ─────────────────────────────────────

describe("normal ratchet behaviour", () => {
  it("count == baseline → exit 0 with OK lines", () => {
    const repo = makeFakeRepo("ratchet-ok");
    writeFileSync(join(repo, "tests", "e2e", "gate.spec.ts"), `${E2E_SKIP_CALL}cond, "msg");\n`);
    writeBaseline(repo, { unitStaticSkips: 0, e2eSkipSites: 1 });

    const result = runScript(repo);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stderr}`);
    assert.ok(result.stdout.includes("OK — e2e conditional"), `stdout: ${result.stdout}`);
  });

  it("count > baseline → exit 1 with FAIL naming the offending file", () => {
    const repo = makeFakeRepo("ratchet-fail");
    writeFileSync(join(repo, "artifacts", "new.test.tsx"), `${UNIT_SKIP_CALL}"parked");\n`);

    const result = runScript(repo);
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}`);
    assert.ok(
      result.stderr.includes("FAIL — unit static skips") && result.stderr.includes("new.test.tsx"),
      `stderr should FAIL and name the file.\nstderr: ${result.stderr}`,
    );
  });

  it("count below baseline → exit 0 with ratchet-down NOTE", () => {
    const repo = makeFakeRepo("ratchet-below");
    writeBaseline(repo, { unitStaticSkips: 0, e2eSkipSites: 5 });

    const result = runScript(repo);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("NOTE —"), `stdout: ${result.stdout}`);
  });

  it("baseline key missing → exit 1", () => {
    const repo = makeFakeRepo("baseline-key-missing");
    writeBaseline(repo, { unitStaticSkips: 0 });

    const result = runScript(repo);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('"e2eSkipSites"'), `stderr: ${result.stderr}`);
  });
});
