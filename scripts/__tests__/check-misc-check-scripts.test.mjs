/**
 * Regression coverage for the hardcoded-port, codegen-stale, and duplicate-
 * hooks registry checks.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const scriptsDir = resolve(here, "..");
const repoRoot = resolve(scriptsDir, "..");
const portsScript = join(scriptsDir, "check-hardcoded-ports.mjs");
const codegenScript = join(scriptsDir, "check-codegen-stale.mjs");
const hooksScript = join(scriptsDir, "check-duplicate-hooks-registry.mjs");
const ignoredDirs = join(scriptsDir, "lib", "ignored-dirs.mjs");

let sandbox;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "misc-check-scripts-"));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function runNode(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

describe("check-hardcoded-ports --scan restrictions", () => {
  it("applies onlyUnder relative to a custom scan root", () => {
    const scanRoot = join(sandbox, "ports-scan");
    mkdirSync(join(scanRoot, "tests", "e2e"), { recursive: true });
    writeFileSync(
      join(scanRoot, "allowed.mjs"),
      "const url = 'http://localhost:3250/allowed';\n",
    );
    writeFileSync(
      join(scanRoot, "tests", "e2e", "outside.mjs"),
      "const url = 'http://localhost:3250/outside';\n",
    );

    const result = runNode(portsScript, ["--scan", scanRoot]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside\.mjs/);
    assert.doesNotMatch(result.stderr, /allowed\.mjs/);
  });
});

describe("check-codegen-stale process failures", () => {
  it("reports a spawn error separately from a non-zero generator exit", () => {
    const emptyPath = join(sandbox, "no-pnpm");
    mkdirSync(emptyPath);
    const result = runNode(codegenScript, [], {
      env: { ...process.env, PATH: emptyPath },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /failed to spawn codegen:generate/i);
    assert.match(result.stderr, /pnpm|ENOENT/i);
    assert.doesNotMatch(result.stderr, /codegen:generate failed; cannot determine staleness/);
  });

  it("reports signal termination distinctly", () => {
    const binDir = join(sandbox, "signal-bin");
    mkdirSync(binDir);
    const fakePnpm = join(binDir, "pnpm");
    writeFileSync(fakePnpm, "#!/bin/sh\n/bin/kill -TERM $$\n");
    chmodSync(fakePnpm, 0o755);

    const result = runNode(codegenScript, [], {
      env: { ...process.env, PATH: binDir },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /terminated by signal SIGTERM/);
    assert.doesNotMatch(result.stderr, /codegen:generate failed; cannot determine staleness/);
  });
});

describe("check-duplicate-hooks-registry hook counting", () => {
  it("counts let, var, and destructured hook calls but not non-calls", () => {
    const fakeRepo = join(sandbox, "hooks-repo");
    mkdirSync(join(fakeRepo, "scripts", "lib"), { recursive: true });
    mkdirSync(join(fakeRepo, "artifacts", "bathyscan", "src", "__tests__"), {
      recursive: true,
    });
    cpSync(hooksScript, join(fakeRepo, "scripts", "check-duplicate-hooks-registry.mjs"));
    cpSync(ignoredDirs, join(fakeRepo, "scripts", "lib", "ignored-dirs.mjs"));
    writeFileSync(
      join(fakeRepo, "artifacts", "bathyscan", "src", "__tests__",
        "appTsxDuplicateHooks.test.ts"),
      "const SCANNED_FILES: string[] = [\n];\n",
    );

    const hooks = [
      "let one = useOne();",
      "var two = useTwo();",
      "const [three] = useThree();",
      "const { four } = useFour();",
      "const [five, setFive] = useFive();",
      "const six = useSix<string>();",
      "let seven = useSeven();",
      "var eight = useEight();",
      "const [nine] = useNine();",
      "const { ten } = useTen();",
      "const notACall = useNotACall",
    ];
    const source = Array.from({ length: 505 }, (_, index) =>
      index < hooks.length ? hooks[index] : `const filler${index} = ${index};`,
    ).join("\n");
    writeFileSync(
      join(fakeRepo, "artifacts", "bathyscan", "src", "Large.tsx"),
      source,
    );

    const result = spawnSync(process.execPath, [
      join(fakeRepo, "scripts", "check-duplicate-hooks-registry.mjs"),
    ], {
      cwd: fakeRepo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 1);
    assert.match(String(result.stderr), /Large\.tsx \(505 lines, 10 hook declarations\)/);
  });
});