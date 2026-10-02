/**
 * vitest.config.validation.ts (bathyscan)
 *
 * Collects the cross-layer schema constraint regression tests from the
 * BathyScan frontend package. Run via: pnpm test:validation
 *
 * Included tests:
 *  - markerSchema.crossLayer.test.ts — confirms that the Zod marker schema
 *    in bathyscan matches the DB column constraints enforced by Drizzle.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import path from "path";
import budgets from "../../tests/timeout-guard/budgets.json";

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
    ...(process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR
      ? {
          reporters: [
            "default",
            [
              fileURLToPath(new URL("../../scripts/failure-gate-v4/vitest-reporter.mjs", import.meta.url)),
              {
                outputDirectory: process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR,
                suite: "bathyscan-validation",
              },
            ],
          ],
        }
      : {}),
    name: "validation-regression-bathyscan",
    environment: "jsdom",
    globals: true,
    // Layers 1+2: per-test / per-hook timeouts from the shared budget config.
    testTimeout: budgets.bathyscanValidation.testTimeoutMs,
    hookTimeout: budgets.bathyscanValidation.hookTimeoutMs,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: [
      "src/lib/__tests__/markerSchema.crossLayer.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
