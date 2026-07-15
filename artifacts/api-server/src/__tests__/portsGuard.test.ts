// @vitest-environment node
/**
 * Regression tests for the hardcoded-port guard
 * (scripts/check-hardcoded-ports.mjs) and the centralized E2E port registry.
 *
 * NOTE: this file lives inside a path the guard scans, so every fixture
 * pattern below is built via string concatenation — a literal violation
 * written directly in this file would (correctly!) fail the guard.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const guardScript = path.join(repoRoot, "scripts", "check-hardcoded-ports.mjs");

// Fixture patterns, concatenated so this test file never matches the guard.
const LISTEN_VIOLATION = "app.lis" + "ten(" + "9999);";
const PORT_FALLBACK_VIOLATION =
  "const p = process.env." + "PO" + "RT ?? " + "3000;";
const SHELL_FALLBACK_VIOLATION =
  '"dev": "export ' + "PO" + "RT=${" + "PO" + "RT:-" + '8080} && node ."';

function runGuard(args: string[] = []) {
  const result = spawnSync(process.execPath, [guardScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

function withTempDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ports-guard-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("hardcoded-port guard", () => {
  it("passes on the clean tree", () => {
    const { status, output } = runGuard();
    expect(output).toContain("OK");
    expect(status).toBe(0);
  }, 60_000);

  it("fails on a hardcoded listen() port", () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "bad.ts"), LISTEN_VIOLATION);
      const { status, output } = runGuard(["--scan", dir]);
      expect(status).toBe(1);
      expect(output).toContain("bad.ts");
    });
  });

  it("fails on a JS PORT fallback pattern", () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "fallback.ts"), PORT_FALLBACK_VIOLATION);
      const { status, output } = runGuard(["--scan", dir]);
      expect(status).toBe(1);
      expect(output).toContain("fallback.ts");
    });
  });

  it("fails on a shell PORT fallback in package.json", () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        `{ "scripts": { ${SHELL_FALLBACK_VIOLATION} } }`,
      );
      const { status, output } = runGuard(["--scan", dir]);
      expect(status).toBe(1);
      expect(output).toContain("package.json");
    });
  });

  it("does NOT flag lookalike numbers (timeouts, test data)", () => {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "clean.ts"),
        [
          "setTimeout(() => {}, 3000);",
          "const testTimeout = 30000;",
          "await page.waitForTimeout(3000);",
          "const depths = [3000, 3150, 3161, 4173, 8080];",
          "const RETRY_DELAY_MS = 8080;",
          "expect(elapsed).toBeLessThan(30000);",
        ].join("\n"),
      );
      const { status } = runGuard(["--scan", dir]);
      expect(status).toBe(0);
    });
  });

  it("catches a synthetic violation written into a real scanned path", () => {
    // Proves the scan pattern AND the scan path coverage work together: if
    // a future change to the scanned roots silently excludes real source,
    // this test fails.
    const syntheticFile = path.join(__dirname, "__tmp-synthetic-port-violation.ts");
    try {
      fs.writeFileSync(syntheticFile, LISTEN_VIOLATION);
      const { status, output } = runGuard();
      expect(status).toBe(1);
      expect(output).toContain("__tmp-synthetic-port-violation.ts");
    } finally {
      fs.rmSync(syntheticFile, { force: true });
    }
  }, 60_000);
});

describe("centralized E2E port registry", () => {
  it("playwright.config.ts contains no inline port literals", () => {
    const configText = fs.readFileSync(
      path.join(repoRoot, "playwright.config.ts"),
      "utf8",
    );
    // Must import from the central registry…
    expect(configText).toContain("./tests/e2e/ports");
    // …and contain no inline host:port literals or PORT= assignments with
    // digits (regexes built to avoid self-matching in the guard).
    expect(configText).not.toMatch(/\b(?:localhost|127\.0\.0\.1):\d/);
    expect(configText).not.toMatch(/\bPORT=\d/);
    expect(configText).not.toMatch(/\b(?:3150|3161)\b/);
  });

  it("tests/e2e/ports.ts is the allowlisted registry in the guard", () => {
    const guardText = fs.readFileSync(guardScript, "utf8");
    expect(guardText).toContain("tests/e2e/ports.ts");
  });
});
