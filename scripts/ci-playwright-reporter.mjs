/**
 * CI-only Playwright reporter.
 *
 * GitHub's list and HTML reporters make a failed run readable, but neither
 * leaves a small machine-readable record of final test outcomes. This reporter
 * is deliberately additive: workflows keep list + html and add this reporter
 * to publish the final passed/failed/skipped counts and runtime skip reasons.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function testKey(test) {
  const location = test.location ?? {};
  return `${location.file ?? "unknown"}:${location.line ?? 0} › ${test.titlePath().join(" › ")}`;
}

function skipReason(test) {
  const annotations = Array.isArray(test.annotations) ? test.annotations : [];
  const annotation = annotations.find((item) => item.type === "skip" && item.description);
  return annotation?.description ?? "No skip reason was supplied by Playwright.";
}

export default class CiPlaywrightReporter {
  constructor() {
    this.startedAt = Date.now();
    this.finalResults = new Map();
    this.resultPath = resolve(
      process.cwd(),
      process.env.PLAYWRIGHT_CI_RESULTS ?? "test-results/ci-playwright-results.json",
    );
    this.suite = process.env.PLAYWRIGHT_CI_SUITE ?? "unknown";
  }

  onTestEnd(test, result) {
    // A retried test receives multiple events. Keep its final execution only:
    // the CI baseline describes final browser coverage, not retry attempts.
    this.finalResults.set(test.id, {
      test: testKey(test),
      status: result.status,
      retry: result.retry,
      reason: result.status === "skipped" ? skipReason(test) : undefined,
    });
  }

  onEnd(fullResult) {
    const outcomes = [...this.finalResults.values()];
    const counts = {
      passed: outcomes.filter((entry) => entry.status === "passed").length,
      failed: outcomes.filter((entry) => entry.status === "failed").length,
      skipped: outcomes.filter((entry) => entry.status === "skipped").length,
      interrupted: outcomes.filter((entry) => entry.status === "interrupted").length,
      flaky: outcomes.filter((entry) => entry.status === "passed" && entry.retry > 0).length,
    };
    const skips = outcomes
      .filter((entry) => entry.status === "skipped")
      .map(({ test, reason }) => ({ test, reason }))
      .sort((a, b) => a.test.localeCompare(b.test));
    const payload = {
      schemaVersion: 1,
      suite: this.suite,
      outcome: fullResult.status,
      durationMs: Date.now() - this.startedAt,
      counts,
      skips,
    };

    mkdirSync(dirname(this.resultPath), { recursive: true });
    writeFileSync(this.resultPath, `${JSON.stringify(payload, null, 2)}\n`);

    const summary = [
      "## Playwright runtime coverage",
      "",
      `Suite: \`${this.suite}\` · outcome: **${fullResult.status}**`,
      "",
      "| Passed | Failed | Skipped | Interrupted | Flaky |",
      "| ---: | ---: | ---: | ---: | ---: |",
      `| ${counts.passed} | ${counts.failed} | ${counts.skipped} | ${counts.interrupted} | ${counts.flaky} |`,
      "",
      skips.length
        ? "### Runtime skip reasons\n\n" +
          skips.map(({ test, reason }) => `- \`${test}\` — ${reason}`).join("\n")
        : "No tests were skipped at runtime.",
      "",
      `Machine-readable result: \`${this.resultPath.replace(`${process.cwd()}/`, "")}\``,
      "",
    ].join("\n");
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    else console.log(summary);
  }
}