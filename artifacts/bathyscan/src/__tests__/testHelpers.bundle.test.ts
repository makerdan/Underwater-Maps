// @vitest-environment node
/**
 * Bundle-inspection guard: runs a real Vite production/PWA build of the
 * BathyScan app and checks both its security boundary and load-time split.
 * It asserts that the dev-only e2e test back door (`window.__bathyTest`,
 * installed by `src/lib/testHelpers.ts`) does not leak into any emitted chunk,
 * optional features stay outside the static entry graph, and every JavaScript
 * chunk remains below Workbox's default precache ceiling.
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
import fs from "fs";
import path from "path";
import { E2E_BUNDLE_TEST_PORT } from "../../../../tests/e2e/ports";

describe("production bundle", () => {
  it("keeps the production bundle safe and split below the precache ceiling", async () => {
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
          // vite-plugin-pwa injects the final Workbox manifest into sw.js as a
          // post-build step, so this must write the real production output
          // before we inspect its install-time cache list below.
          write: true,
          minify: true,
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
    const chunks = outputs.flatMap((out) =>
      out.output.filter((item) => item.type === "chunk"),
    );
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

    const appEntry = chunks.find(
      (chunk) =>
        chunk.isEntry &&
        chunk.moduleIds.some((id) =>
          id.replaceAll("\\", "/").endsWith("/src/main.tsx"),
        ),
    );
    expect(appEntry, "Production build did not emit the BathyScan entry chunk").toBeDefined();

    const chunksByName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
    const staticDependencies = new Set<string>();
    const visitStaticImports = (fileName: string) => {
      if (staticDependencies.has(fileName)) return;
      staticDependencies.add(fileName);
      const chunk = chunksByName.get(fileName);
      if (!chunk) return;
      for (const imported of chunk.imports) visitStaticImports(imported);
    };
    visitStaticImports(appEntry!.fileName);

    const excelChunk = chunks.find((chunk) =>
      chunk.moduleIds.some((id) => id.replaceAll("\\", "/").includes("/exceljs/")),
    );
    expect(excelChunk, "Production build did not emit the Excel import chunk").toBeDefined();
    expect(
      staticDependencies.has(excelChunk!.fileName),
      "Excel import tooling returned to the initial static dependency graph",
    ).toBe(false);

    const tourSceneChunk = chunks.find((chunk) =>
      chunk.facadeModuleId
        ?.replaceAll("\\", "/")
        .endsWith("/src/pages/TourScene.tsx"),
    );
    expect(tourSceneChunk, "Production build did not emit a deferred TourScene chunk").toBeDefined();
    expect(
      staticDependencies.has(tourSceneChunk!.fileName),
      "TourScene returned to the initial static dependency graph",
    ).toBe(false);

    const rendererChunks = chunks.filter((chunk) =>
      chunk.moduleIds.some((id) => {
        const normalized = id.replaceAll("\\", "/");
        return (
          normalized.includes("/node_modules/@react-three/fiber/") ||
          normalized.includes("/node_modules/@react-three/drei/")
        );
      }),
    );
    expect(rendererChunks, "Production build did not emit a 3D renderer chunk").not.toEqual([]);
    const staticRendererChunks = rendererChunks
      .filter((chunk) => staticDependencies.has(chunk.fileName))
      .map((chunk) => chunk.fileName);
    expect(
      staticRendererChunks,
      `3D renderer dependencies returned to the initial static graph: ${staticRendererChunks.join(", ")}`,
    ).toEqual([]);

    const threeChunk = chunks.find((chunk) =>
      chunk.moduleIds.some((id) =>
        id.replaceAll("\\", "/").includes("/node_modules/three/"),
      ),
    );
    expect(threeChunk, "Production build did not emit the shared Three.js chunk").toBeDefined();

    const precacheManifest = fs.readFileSync(
      path.join(root, "dist", "public", "sw.js"),
      "utf8",
    );
    const precachedUrls = new Set(
      [...precacheManifest.matchAll(/"url":"([^"]+)"/g)].map((match) => match[1]),
    );
    const deferredChunks = [
      excelChunk!.fileName,
      tourSceneChunk!.fileName,
      threeChunk!.fileName,
      ...rendererChunks.map((chunk) => chunk.fileName),
    ];
    const precachedDeferredChunks = deferredChunks.filter((fileName) =>
      precachedUrls.has(fileName),
    );
    expect(
      precachedDeferredChunks,
      `Deferred import chunks leaked into the install-time Workbox precache: ${precachedDeferredChunks.join(", ")}`,
    ).toEqual([]);
    expect(
      precachedUrls.has(appEntry!.fileName),
      "The application shell entry is missing from the Workbox precache",
    ).toBe(true);

    const workboxDefaultLimit = 2 * 1024 * 1024;
    const oversizedChunks = chunks
      .filter((chunk) => Buffer.byteLength(chunk.code, "utf8") > workboxDefaultLimit)
      .map((chunk) => `${chunk.fileName} (${Buffer.byteLength(chunk.code, "utf8")} bytes)`);
    expect(
      oversizedChunks,
      `Production JavaScript chunks exceeded Workbox's default precache limit: ${oversizedChunks.join(", ")}`,
    ).toEqual([]);
  }, 180_000);
});
