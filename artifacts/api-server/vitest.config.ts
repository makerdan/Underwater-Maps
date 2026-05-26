import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30000,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
