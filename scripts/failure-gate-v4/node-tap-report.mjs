import { stableTestCaseId } from "./test-case-report.mjs";

export function parseNodeTap(output) {
  const summary = (name) => Number(output.match(new RegExp(`^# ${name} ([0-9]+)$`, "m"))?.[1] ?? NaN);
  const tests = summary("tests");
  const passed = summary("pass");
  const failed = summary("fail");
  const skipped = summary("skipped");
  const todo = summary("todo");
  const cancelled = summary("cancelled");
  const lines = output.split(/\r?\n/);
  const resultPattern = /^( *)(ok|not ok) \d+(?:\s+-\s+(.*?))?(?:\s+#\s+(SKIP|TODO)\b.*)?$/;
  const resultType = (index, resultIndent) => {
    const yamlStart = lines[index + 1]?.match(/^( +)---\s*$/);
    if (!yamlStart || yamlStart[1].length <= resultIndent) return null;
    const yamlIndent = yamlStart[1].length;
    for (let cursor = index + 2; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      const indentation = line.match(/^ */)?.[0].length ?? 0;
      if (indentation === yamlIndent && line.trim() === "...") return null;
      const type = line.match(/^( +)type:\s*['"]?([a-z]+)['"]?\s*$/);
      if (type && type[1].length === yamlIndent) return type[2];
    }
    return null;
  };
  const cases = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const match = line.match(resultPattern);
    if (!match || resultType(lineIndex, match[1].length) === "suite") continue;

    const marker = match[4]?.toUpperCase();
    const status = marker ? "skipped" : match[2] === "ok" ? "passed" : "failed";
    const index = cases.length + 1;
    const title = match?.[3]?.trim() || `unnamed node:test case ${index}`;
    const source = `node:test/${index}`;
    cases.push({
      id: stableTestCaseId({ engine: "node-test", suite: "scripts-unit", source, title }),
      source,
      title,
      line: null,
      status,
    });
  }
  const countsAvailable = [tests, passed, failed, skipped, todo, cancelled].every(Number.isInteger);
  const statusCountsAgree = countsAvailable &&
    passed === cases.filter((entry) => entry.status === "passed").length &&
    failed === cases.filter((entry) => entry.status === "failed").length &&
    skipped + todo === cases.filter((entry) => entry.status === "skipped").length;
  return Object.freeze({
    tests,
    cases: Object.freeze(cases),
    complete: tests > 0 && tests === cases.length && cancelled === 0 && statusCountsAgree,
  });
}