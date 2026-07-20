import { defineConfig } from "vitest/config";
import budgets from "../../tests/timeout-guard/budgets.json";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: budgets.libDbUnit.testTimeoutMs,
    hookTimeout: budgets.libDbUnit.hookTimeoutMs,
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
