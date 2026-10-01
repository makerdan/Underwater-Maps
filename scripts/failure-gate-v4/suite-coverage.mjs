const UNIT_SUITES = Object.freeze([
  Object.freeze({ step: "test:unit", engine: "vitest", suite: "api-server-unit", reportCount: 2 }),
  Object.freeze({ step: "test:unit", engine: "vitest", suite: "bathyscan-unit" }),
  Object.freeze({ step: "test:unit", engine: "vitest", suite: "api-zod-unit" }),
  Object.freeze({ step: "test:unit", engine: "vitest", suite: "lib-db-unit" }),
  Object.freeze({ step: "test:unit", engine: "vitest", suite: "poe-unit" }),
  Object.freeze({ step: "test:unit", engine: "node-test", suite: "scripts-unit" }),
]);

const CASE_SUITES_BY_TIER = Object.freeze({
  "test-fast": Object.freeze([]),
  "test-standard": UNIT_SUITES,
  "test-standard-plus": UNIT_SUITES,
  "test-heavy": Object.freeze([
    ...UNIT_SUITES,
    Object.freeze({ step: "e2e-palette", engine: "playwright", suite: "e2e-palette" }),
    Object.freeze({ step: "test:e2e", engine: "playwright", suite: "test:e2e" }),
  ]),
});

function reportObject(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  return entry.report && typeof entry.report === "object" ? entry.report : entry;
}

function reportBindingIsUnique(entry, report, references, digests, rawReferences) {
  const reference = entry.reference;
  const digest = entry.digest;
  const rawReference = report.rawReport?.reference;
  const rawDigest = report.rawReport?.digest;
  if (typeof reference !== "string" || !reference ||
      typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest) ||
      typeof rawReference !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.(?:engine|jsonl)$/.test(rawReference) ||
      typeof rawDigest !== "string" || !/^[0-9a-f]{64}$/.test(rawDigest) ||
      references.has(reference) || digests.has(digest) || rawReferences.has(rawReference)) {
    return false;
  }
  references.add(reference);
  digests.add(digest);
  rawReferences.add(rawReference);
  return true;
}

/**
 * Returns the exact code-registered engine/suite obligations for an authorized
 * validation tier. The result is deliberately independent of fixture-provided
 * environment labels.
 */
export function requiredCaseSuitesForTier(authorizedTier) {
  const suites = CASE_SUITES_BY_TIER[authorizedTier];
  if (!suites) throw new TypeError(`unknown authorized validation tier '${String(authorizedTier)}'`);
  return suites;
}

/**
 * Verify exact suite coverage from the bound report objects returned by
 * loadTestCaseReports(). Legacy schema-1 reports remain parseable elsewhere,
 * but cannot satisfy a current v2 adapter's step-bound coverage obligations.
 */
export function hasExactRegisteredCaseCoverage(discoveryReportObjects, requiredSteps, authorizedTier) {
  if (!Array.isArray(discoveryReportObjects) || !Array.isArray(requiredSteps) ||
      new Set(requiredSteps).size !== requiredSteps.length ||
      requiredSteps.some((step) => typeof step !== "string" || !step)) {
    return false;
  }
  let requiredSuites;
  try {
    requiredSuites = requiredCaseSuitesForTier(authorizedTier);
  } catch {
    return false;
  }
  if (requiredSuites.some(({ step }) => !requiredSteps.includes(step))) return false;

  const expected = new Map(requiredSuites.map((item) => [
    `${item.step}\u0000${item.engine}\u0000${item.suite}`,
    item,
  ]));
  const reportCounts = new Map();
  const seenCases = new Set();
  const references = new Set();
  const digests = new Set();
  const rawReferences = new Set();

  for (const entry of discoveryReportObjects) {
    const report = reportObject(entry);
    const expectedEngineVersion = report?.engine === "node-test" ? "24"
      : report?.engine === "vitest" ? "3.2.7"
        : report?.engine === "playwright" ? "1.60.0" : null;
    if (!report || report.schemaVersion !== 2 ||
        !reportBindingIsUnique(entry, report, references, digests, rawReferences) ||
        typeof report.step !== "string" ||
        !Array.isArray(report.cases) || report.cases.length === 0 ||
        report.complete !== true ||
        !["node-test", "vitest", "playwright"].includes(report.engine) ||
        typeof report.suite !== "string" ||
        !["passed", "failed", "interrupted", "completed"].includes(report.outcome) ||
        !report.environment || report.environment.nodeMajor !== 24 ||
        report.environment.engineVersion !== expectedEngineVersion) {
      return false;
    }
    const key = `${report.step}\u0000${report.engine}\u0000${report.suite}`;
    if (!expected.has(key) || !requiredSteps.includes(report.step)) return false;
    reportCounts.set(key, (reportCounts.get(key) ?? 0) + 1);
    if (reportCounts.get(key) > (expected.get(key).reportCount ?? 1)) return false;

    for (const testCase of report.cases) {
      if (!testCase || typeof testCase !== "object" ||
          typeof testCase.id !== "string" || !/^[0-9a-f]{64}$/.test(testCase.id) ||
          typeof testCase.source !== "string" || !testCase.source ||
          typeof testCase.title !== "string" || !testCase.title ||
          typeof testCase.reportedStatus !== "string" ||
          !["passed", "failed"].includes(testCase.status) ||
          testCase.status === "failed" &&
            !/^[0-9a-f]{64}$/.test(testCase.failureSignature ?? "") ||
          testCase.status === "passed" && testCase.failureSignature !== null ||
          seenCases.has(testCase.id)) {
        return false;
      }
      seenCases.add(testCase.id);
    }
  }
  return [...expected.entries()].every(([key, suite]) =>
    reportCounts.get(key) === (suite.reportCount ?? 1));
}