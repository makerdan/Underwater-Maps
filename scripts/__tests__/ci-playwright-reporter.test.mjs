import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import CiPlaywrightReporter from "../ci-playwright-reporter.mjs";

function testCase(id, file, line, title, annotations = []) {
  return {
    id,
    annotations,
    location: { file, line },
    titlePath: () => [title],
  };
}

test("records final retry outcomes and runtime skip reasons", () => {
  const directory = mkdtempSync(join(tmpdir(), "ci-playwright-reporter-"));
  const resultPath = join(directory, "outcome.json");
  const priorResults = process.env.PLAYWRIGHT_CI_RESULTS;
  const priorSuite = process.env.PLAYWRIGHT_CI_SUITE;

  try {
    process.env.PLAYWRIGHT_CI_RESULTS = resultPath;
    process.env.PLAYWRIGHT_CI_SUITE = "pr-smoke";
    const reporter = new CiPlaywrightReporter();
    const retried = testCase("retried", "tests/e2e/retry.spec.ts", 12, "passes on retry");
    reporter.onTestEnd(retried, { status: "failed", retry: 0 });
    reporter.onTestEnd(retried, { status: "passed", retry: 1 });
    reporter.onTestEnd(
      testCase(
        "skipped",
        "tests/e2e/gated.spec.ts",
        24,
        "reports gate",
        [{ type: "skip", description: "WebGL is unavailable on this runner" }],
      ),
      { status: "skipped", retry: 0 },
    );
    reporter.onEnd({ status: "passed" });

    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(result.suite, "pr-smoke");
    assert.deepEqual(result.counts, {
      passed: 1,
      failed: 0,
      skipped: 1,
      interrupted: 0,
      flaky: 1,
    });
    assert.deepEqual(result.skips, [{
      test: "tests/e2e/gated.spec.ts:24 › reports gate",
      reason: "WebGL is unavailable on this runner",
    }]);
  } finally {
    if (priorResults === undefined) delete process.env.PLAYWRIGHT_CI_RESULTS;
    else process.env.PLAYWRIGHT_CI_RESULTS = priorResults;
    if (priorSuite === undefined) delete process.env.PLAYWRIGHT_CI_SUITE;
    else process.env.PLAYWRIGHT_CI_SUITE = priorSuite;
    rmSync(directory, { recursive: true, force: true });
  }
});