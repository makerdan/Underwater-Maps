import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const repoRoot = resolve(import.meta.dirname, "../..");
const script = resolve(repoRoot, "scripts/check-audit.mjs");

function runFakeAudit({ exitCode = 0, stdout = "", stderr = "" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "check-audit-"));
  try {
    const pnpm = join(directory, "pnpm");
    writeFileSync(
      pnpm,
      `#!/bin/sh
printf '%s' ${JSON.stringify(stdout)}
printf '%s' ${JSON.stringify(stderr)} >&2
exit ${exitCode}
`,
    );
    chmodSync(pnpm, 0o755);
    return spawnSync(process.execPath, [script], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: directory },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("fails closed when pnpm audit fails without output", () => {
  const result = runFakeAudit({ exitCode: 1, stderr: "registry unavailable" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /without JSON output/);
  assert.doesNotMatch(result.stdout, /assuming clean/);
});

test("fails closed when audit output is invalid JSON", () => {
  const result = runFakeAudit({ stdout: "not-json" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed to parse pnpm audit JSON/);
});

test("accepts a valid clean audit response", () => {
  const result = runFakeAudit({
    stdout: JSON.stringify({ advisories: {} }),
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /no unexempted high or critical/);
});