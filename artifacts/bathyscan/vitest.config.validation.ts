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
import react from "@vitejs/plugin-react";
import path from "path";
import budgets from "../../tests/timeout-guard/budgets.json";

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
