/**
 * terrain-mock-guard.test.ts — mock-completeness guard for lib/terrain.js.
 *
 * Why: many suites fully mock lib/terrain.js via the shared factory in
 * helpers/terrainMock.ts. If terrain.ts gains a new export that any module
 * reads at init time (as happened with NYSDEC_BATHY_FEATURE_SERVICE,
 * MN_DNR_BATHY_FEATURE_SERVICE and BUNDLED_TERRAIN in
 * catalogFetchStrategy.ts), every suite mocking terrain.js crashes at
 * collection time with an opaque "No export is defined on the mock" error.
 * This test fails FIRST, with an actionable message naming the missing keys.
 *
 * ── Generalizing this pattern to other fully-mocked modules ──────────────
 * For any module `lib/foo.js` that multiple suites replace wholesale:
 *   1. Put a `createFooMock(overrides?)` factory in __tests__/helpers/ that
 *      stubs every runtime export.
 *   2. Add a describe block here (or a sibling guard test) that does:
 *        const real = await import("../lib/foo.js");
 *        const mock = createFooMock();
 *        expect missing = Object.keys(real).filter(k => !(k in mock)) to be [].
 *   3. Keep the message format below so the fix is obvious from CI output.
 * Runtime-only comparison is intentional: type-only exports don't exist at
 * runtime and never break mocks.
 */
import { describe, it, expect } from "vitest";
import { createTerrainMock } from "./helpers/terrainMock.js";

describe("shared terrain mock factory completeness", () => {
  it("stubs every runtime export of lib/terrain.js", async () => {
    // Dynamic import of the REAL module (no vi.mock in this file).
    const real = await import("../lib/terrain.js");
    const mock = createTerrainMock();

    const realKeys = Object.keys(real).sort();
    const missing = realKeys.filter((k) => !(k in mock));

    expect(
      missing,
      `lib/terrain.js has export(s) missing from createTerrainMock() in ` +
        `src/__tests__/helpers/terrainMock.ts: [${missing.join(", ")}]. ` +
        `Add stub(s) for them to the factory — otherwise every suite that ` +
        `mocks terrain.js will fail at collection time with ` +
        `"No export is defined on the mock" as soon as any module reads ` +
        `the new export at init time.`,
    ).toEqual([]);
  });

  it("does not stub keys that no longer exist in lib/terrain.js", async () => {
    const real = await import("../lib/terrain.js");
    const mock = createTerrainMock();

    const stale = Object.keys(mock).filter((k) => !(k in real));

    expect(
      stale,
      `createTerrainMock() stubs key(s) that lib/terrain.js no longer ` +
        `exports: [${stale.join(", ")}]. Remove them from ` +
        `src/__tests__/helpers/terrainMock.ts so the factory stays in ` +
        `lock-step with the real module.`,
    ).toEqual([]);
  });
});
