import { relative } from "node:path";
import { Transform } from "node:stream";
import {
  createEngineEvidence,
  engineEnvironment,
  summarizeEngineError,
} from "./engine-evidence.mjs";

function sourceFile(data) {
  if (typeof data?.file === "string") return data.file;
  if (typeof data?.details?.file === "string") return data.details.file;
  return "";
}

function errorList(value) {
  if (Array.isArray(value)) return value.map(summarizeEngineError).filter(Boolean);
  const error = summarizeEngineError(value);
  return error ? [error] : [];
}

export default function failureGateNodeTestReporter(_source) {
  const events = [];
  return new Transform({
    writableObjectMode: true,
    transform(event, _encoding, callback) {
      events.push(event);
      callback();
    },
    flush(callback) {
      try {
        const stackByFile = new Map();
        const cases = [];
        const globalErrors = [];
        let summary = null;
        for (const event of events) {
          const data = event?.data ?? {};
          const file = sourceFile(data);
          const nesting = Number.isInteger(data.nesting) && data.nesting >= 0 ? data.nesting : null;
          if (event?.type === "test:summary") {
            summary = data.counts ?? null;
            continue;
          }
          if (event?.type === "test:start" || event?.type === "test:enqueue") {
            if (nesting === null || typeof data.name !== "string" || !file) continue;
            const hierarchy = stackByFile.get(file) ?? [];
            hierarchy.length = nesting;
            hierarchy[nesting] = data.name;
            stackByFile.set(file, hierarchy);
            continue;
          }
          if (!["test:pass", "test:fail", "test:skip", "test:todo"].includes(event?.type)) continue;
          const details = data.details ?? {};
          const isSuite = details.type === "suite" || data.type === "suite";
          const rawErrors = details.error ?? data.error;
          const errors = errorList(rawErrors);
          const errorCount = Array.isArray(rawErrors) ? rawErrors.length : rawErrors ? 1 : 0;
          if (isSuite) {
            if (event.type === "test:fail" && details.error?.failureType !== "subtestsFailed") {
              globalErrors.push(...errors);
            }
            continue;
          }
          if (details.type !== "test" || nesting === null || typeof data.name !== "string" || !file) {
            globalErrors.push(...errors);
            continue;
          }
          const hierarchy = stackByFile.get(file) ?? [];
          const parentTitles = hierarchy.slice(0, nesting).filter((title) => typeof title === "string");
          const title = parentTitles.length === nesting
            ? [...parentTitles, data.name].join(" › ")
            : "";
          const rawStatus = event.type === "test:fail"
            ? "failed"
            : event.type === "test:skip" || event.type === "test:todo" ||
              details.skip || details.todo || data.skip || data.todo ? "skipped" : "passed";
          cases.push({
            source: relative(process.cwd(), file).replaceAll("\\", "/"),
            title,
            line: data.line ?? details.line ?? null,
            column: data.column ?? details.column ?? null,
            status: rawStatus,
            rawStatus,
            expectedStatus: "",
            errorCount: rawStatus === "failed" ? errorCount : 0,
            errors: rawStatus === "failed" ? errors : [],
            attempts: [],
          });
        }
        const reportedCaseCount = Number.isInteger(summary?.tests) ? summary.tests : null;
        const summaryMatches = reportedCaseCount !== null &&
          reportedCaseCount === cases.length &&
          summary.passed === cases.filter((entry) => entry.status === "passed").length &&
          summary.failed === cases.filter((entry) => entry.status === "failed").length &&
          (summary.skipped ?? 0) + (summary.todo ?? 0) === cases.filter((entry) => entry.status === "skipped").length &&
          summary.cancelled === 0;
        const evidence = createEngineEvidence({
          engine: "node-test",
          suite: process.env.FAILURE_GATE_TEST_CASE_SUITE ?? "scripts-unit",
          outcome: summary ? "completed" : "missing-summary",
          complete: summaryMatches && globalErrors.length === 0,
          environment: engineEnvironment("node-test"),
          reportedCaseCount,
          globalErrors,
          cases,
        });
        this.push(JSON.stringify(evidence));
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
}