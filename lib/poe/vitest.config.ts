import { defineConfig } from "vitest/config";
import budgets from "../../tests/timeout-guard/budgets.json";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    // Layers 1+2: per-test / per-hook timeouts from the shared budget config.
    testTimeout: budgets.poe.testTimeoutMs,
    hookTimeout: budgets.poe.hookTimeoutMs,
    // Layer 3: per-file wall-clock budget guard.
    setupFiles: ["./vitest.setup.ts"],
    ...(process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR
      ? {
          reporters: [
            "default",
            [
              fileURLToPath(new URL("../../scripts/failure-gate-v4/vitest-reporter.mjs", import.meta.url)),
              {
                outputDirectory: process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR,
                suite: "poe-unit",
              },
            ],
          ],
        }
      : {}),
  },
});
