import { defineConfig } from "vitest/config";
import budgets from "../../tests/timeout-guard/budgets.json";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: budgets.libDbUnit.testTimeoutMs,
    hookTimeout: budgets.libDbUnit.hookTimeoutMs,
    ...(process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR
      ? {
          reporters: [
            "default",
            [
              fileURLToPath(new URL("../../scripts/failure-gate-v4/vitest-reporter.mjs", import.meta.url)),
              {
                outputDirectory: process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR,
                suite: "lib-db-unit",
              },
            ],
          ],
        }
      : {}),
    include: ["src/__tests__/**/*.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        // Run all test files in a single forked process so the isolated
        // schema is created only once per suite invocation, not per-file.
        singleFork: true,
      },
    },
  },
});
