/**
 * vitest.config.validation.ts
 *
 * Collects all regression tests from the validation-regression project.
 * Run with: pnpm test:validation
 *
 * Includes:
 *  - gunzipBounded size-cap unit tests
 *  - multer chunk 6 MB limit → 413
 *  - parse error propagation → 422
 *  - NCEI query-param validation → 400
 *  - settings response-parse failure → 500
 *  - me route auth guard → 401 + DB error → 500
 *  - requireAuth production bypass guard (Step 8)
 *  - rateLimit Postgres fallback (Step 9)
 *  - marker schema cross-layer constraints (Step 10)
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "validation-regression",
    environment: "node",
    globals: true,
    testTimeout: 30000,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: [
      "src/__tests__/gunzipBounded.test.ts",
      "src/__tests__/multer-chunk-limit.test.ts",
      "src/__tests__/parse-worker-errors.test.ts",
      "src/middlewares/__tests__/requireAuth-bypass-guard.test.ts",
      "src/routes/__tests__/rateLimit-pg.test.ts",
      "src/routes/__tests__/ncei-validation.test.ts",
      "src/routes/__tests__/settings-response-parse.test.ts",
      "src/routes/__tests__/me-validation.test.ts",
      "src/routes/__tests__/datasets-response-parse.test.ts",
    ],
  },
});
