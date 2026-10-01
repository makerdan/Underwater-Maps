import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import budgets from "../../tests/timeout-guard/budgets.json";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  // Explicit automatic JSX runtime: @vitejs/plugin-react >=5.2 stopped applying
  // its transform under vitest, so files without `import React` crashed with
  // "React is not defined". esbuild handles the transform independently.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    // Layers 1+2: per-test / per-hook timeouts from the shared budget config.
    testTimeout: budgets.bathyscanUnit.testTimeoutMs,
    hookTimeout: budgets.bathyscanUnit.hookTimeoutMs,
    ...(process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR
      ? {
          reporters: [
            "default",
            [
              fileURLToPath(new URL("../../scripts/failure-gate-v4/vitest-reporter.mjs", import.meta.url)),
              {
                outputDirectory: process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR,
                suite: "bathyscan-unit",
              },
            ],
          ],
        }
      : {}),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
