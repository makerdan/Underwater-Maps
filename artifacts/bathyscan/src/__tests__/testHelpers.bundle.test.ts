// @vitest-environment node
/**
 * Bundle-inspection guard: runs a real Vite production build of the
 * bathyscan app and asserts that the dev-only e2e test back door
 * (`window.__bathyTest`, installed by `src/lib/testHelpers.ts`) does
 * not leak into any emitted chunk.
 *
 * Paired with:
 *   - the call-site gate in `src/main.tsx`
 *   - the runtime `PROD` throw in `installTestHelpers`
 *   - the `failOnTestBackdoor` Vite plugin in `vite.config.ts`
 *
 * This test is the CI-level safety net: if any of those gates regress,
 * `pnpm --filter @workspace/bathyscan run test:unit` fails before the
 * bundle could ever ship.
 */
import { describe, it, expect } from "vitest";
import { build, type RollupOutput } from "vite";
import path from "path";
import { E2E_BUNDLE_TEST_PORT } from "../../../../tests/e2e/ports";

describe("production bundle", () => {
  it("does not contain the dev-only __bathyTest back door", async () => {
    // `vite.config.ts` hard-throws unless PORT and BASE_PATH are set
    // (they only matter for the dev server, not for `build`), so seed
    // safe defaults if the test runner didn't already provide them.
    // This keeps the guard self-contained for unit-test runs.
    process.env.PORT ??= String(E2E_BUNDLE_TEST_PORT);
    process.env.BASE_PATH ??= "/";
    // Vite prioritizes an existing process.env.NODE_ENV over `mode`, and
    // vitest sets NODE_ENV=test — which made this a *non*-production build:
    // `import.meta.env.DEV` stayed true, so the dev-only back door survived
    // and the guard produced a false positive. Force a real production
    // build for the duration of this test, then restore.
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const root = path.resolve(__dirname, "..", "..");
    let result: RollupOutput | RollupOutput[];
    try {
      result = (await build({
        root,
        configFile: path.resolve(root, "vite.config.ts"),
        mode: "production",
        logLevel: "error",
        build: {
          write: false,
          minify: false,
          sourcemap: false,
          ssr: false,
          emptyOutDir: false,
        },
      })) as RollupOutput | RollupOutput[];
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }

    const outputs = Array.isArray(result) ? result : [result];
    const offenders: string[] = [];
    for (const out of outputs) {
      for (const chunk of out.output) {
        if (chunk.type !== "chunk") continue;
        if (chunk.code.includes("__bathyTest")) {
          offenders.push(chunk.fileName);
        }
      }
    }

    expect(
      offenders,
      `Production bundle leaked the test back door in: ${offenders.join(", ")}`,
    ).toEqual([]);
  }, 180_000);
});
