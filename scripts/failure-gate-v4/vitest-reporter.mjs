import { relative } from "node:path";
import {
  createEngineEvidence,
  engineEnvironment,
  summarizeEngineError,
  writeEngineEvidenceReport,
} from "./engine-evidence.mjs";

function plainErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map(summarizeEngineError).filter(Boolean);
}

export default class FailureGateVitestReporter {
  constructor(options = {}) {
    this.outputDirectory = options.outputDirectory ?? process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR;
    this.suite = options.suite ?? process.env.FAILURE_GATE_VALIDATION_TIER ?? "vitest-unit";
    this.vitestVersion = "3.2.7";
  }

  onInit(vitest) {
    this.vitestVersion = vitest?.version;
  }

  async onTestRunEnd(testModules, unhandledErrors, reason) {
    if (!this.outputDirectory) return;
    const cases = [];
    for (const module of testModules) {
      const source = relative(process.cwd(), module.moduleId).replaceAll("\\", "/");
      for (const testCase of module.children.allTests()) {
        const result = testCase.result();
        const errors = plainErrors(result.errors);
        const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
        const reportedStatus = typeof result.state === "string" ? result.state : "unknown";
        const status = reportedStatus === "passed" && errorCount > 0
          ? "unknown"
          : reportedStatus;
        const location = testCase.location ?? null;
        cases.push({
          source,
          title: testCase.fullName,
          line: location?.line ?? null,
          column: location?.column ?? null,
          status,
          rawStatus: reportedStatus,
          expectedStatus: "",
          errorCount,
          errors,
          attempts: [],
        });
      }
    }
    const globals = plainErrors(unhandledErrors);
    const evidence = createEngineEvidence({
      engine: "vitest",
      suite: this.suite,
      outcome: typeof reason === "string" ? reason : "unknown",
      complete: reason !== "interrupted" &&
        (!Array.isArray(unhandledErrors) || unhandledErrors.length === 0) &&
        cases.length > 0 && cases.every((entry) => entry.status !== "unknown"),
      environment: engineEnvironment("vitest", this.vitestVersion),
      reportedCaseCount: cases.length,
      globalErrors: globals,
      cases,
    });
    await writeEngineEvidenceReport({ outputDirectory: this.outputDirectory, evidence });
  }
}