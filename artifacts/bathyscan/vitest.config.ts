import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import budgets from "../../tests/timeout-guard/budgets.json";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  // Keep JSX explicit under Vitest 4, which uses Vite 8's Oxc transformer.
  // Relying on the legacy esbuild options makes Vitest report that they are ignored.
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
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
