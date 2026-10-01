import { relative } from "node:path";
import playwrightPackage from "@playwright/test/package.json" with { type: "json" };
import {
  createEngineEvidence,
  engineEnvironment,
  summarizeEngineError,
  writeEngineEvidenceReport,
} from "./engine-evidence.mjs";

export default class FailureGatePlaywrightReporter {
  constructor(options = {}) {
    this.outputDirectory = options.outputDirectory ?? process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR;
    this.suite = options.suite ?? process.env.FAILURE_GATE_VALIDATION_TIER ?? "playwright";
    this.cases = new Map();
    this.globalErrors = [];
    this.globalErrorCount = 0;
  }

  onBegin(_config, rootSuite) {
    for (const test of rootSuite.allTests()) {
      const source = relative(process.cwd(), test.location?.file ?? "").replaceAll("\\", "/");
      const titlePath = test.titlePath();
      this.cases.set(test.id, {
        source,
        title: Array.isArray(titlePath) ? titlePath.join(" › ") : "",
        line: test.location?.line ?? null,
        column: test.location?.column ?? null,
        status: "unknown",
        rawStatus: "unknown",
        expectedStatus: test.expectedStatus,
        errorCount: 0,
        errors: [],
        attempts: [],
      });
    }
  }

  onError(error) {
    this.globalErrorCount += 1;
    const safeError = summarizeEngineError(error);
    if (safeError && this.globalErrors.length < 8) this.globalErrors.push(safeError);
  }

  onTestEnd(test, result) {
    const entry = this.cases.get(test.id);
    if (!entry) return;
    const rawStatus = typeof result.status === "string" ? result.status : "unknown";
    const errors = Array.isArray(result.errors)
      ? result.errors.map(summarizeEngineError).filter(Boolean)
      : [];
    const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
    const expectedStatus = typeof test.expectedStatus === "string" ? test.expectedStatus : "";
    entry.attempts.push({
      rawStatus,
      expectedStatus,
      retry: result.retry,
      errorCount,
      errors,
    });
    entry.rawStatus = rawStatus;
    entry.status = rawStatus === "passed" && expectedStatus !== "passed"
      ? "failed"
      : rawStatus;
    entry.expectedStatus = expectedStatus;
    entry.errorCount = errorCount;
    entry.errors = errors;
  }

  async onEnd(result) {
    if (!this.outputDirectory) return;
    const cases = [...this.cases.values()];
    const evidence = createEngineEvidence({
      engine: "playwright",
      suite: this.suite,
      outcome: typeof result?.status === "string" ? result.status : "unknown",
      complete: result?.status !== "interrupted" && this.globalErrorCount === 0 &&
        cases.length > 0 && cases.every((entry) => entry.status !== "unknown"),
      environment: engineEnvironment("playwright", playwrightPackage.version),
      reportedCaseCount: cases.length,
      globalErrors: this.globalErrors,
      cases,
    });
    await writeEngineEvidenceReport({ outputDirectory: this.outputDirectory, evidence });
  }
}