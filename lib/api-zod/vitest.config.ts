import { defineConfig } from "vitest/config";
import budgets from "../../tests/timeout-guard/budgets.json";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Layers 1+2: per-test / per-hook timeouts from the shared budget config.
    testTimeout: budgets.apiZod.testTimeoutMs,
    hookTimeout: budgets.apiZod.hookTimeoutMs,
    // Layer 3: per-file wall-clock budget guard.
    setupFiles: ["./vitest.setup.ts"],
  },
});
