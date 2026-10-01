import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngineEvidence,
  engineEnvironment,
  writeEngineEvidenceReport,
} from "./engine-evidence.mjs";

const args = process.argv.slice(2);
const outputDirectory = process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR;
const reporterPath = fileURLToPath(new URL("./node-test-reporter.mjs", import.meta.url));
if (!outputDirectory) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} else {
  const directory = await mkdtemp(join(tmpdir(), "failure-gate-node-events-"));
  const eventPath = join(directory, "events.json");
  try {
    const result = spawnSync(process.execPath, [
      `--test-reporter=${reporterPath}`,
      `--test-reporter-destination=${eventPath}`,
      ...args,
    ], { stdio: "inherit" });
    try {
      const parsed = JSON.parse((await readFile(eventPath, "utf8")).trim());
      const evidence = createEngineEvidence({
        engine: "node-test",
        suite: parsed.suite,
        step: parsed.step,
        outcome: result.status === 0 ? parsed.outcome : "failed",
        complete: parsed.complete && result.status !== null && result.signal === null,
        environment: engineEnvironment("node-test"),
        reportedCaseCount: parsed.reportedCaseCount,
        globalErrors: parsed.globalErrors,
        cases: parsed.cases,
      });
      await writeEngineEvidenceReport({
        outputDirectory,
        evidence,
      });
    } catch (error) {
      console.error(`Failure Gate Node event evidence unavailable: ${error.message}`);
      if (result.status === 0) process.exitCode = 1;
    }
    if (process.exitCode === undefined) process.exitCode = result.status ?? 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}