import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30000,
    setupFiles: ["./src/__tests__/setup.ts"],
    // Run all test files in a single forked process so the bagWorker singleton
    // (stored under a global symbol) is shared across all BAG test files.
    // This eliminates repeated Python + h5py cold-starts between test files.
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
