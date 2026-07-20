import { defineConfig } from "vitest/config";
import budgets from "../../tests/timeout-guard/budgets.json";

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
  },
});
