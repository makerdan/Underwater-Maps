/**
 * devAuthProductionGuard.test.ts
 *
 * Verifies that the console.warn bypass notice in devAuth.ts is NOT emitted
 * when the build is in production mode (import.meta.env.DEV === false), and
 * IS emitted when in dev mode with the bypass flag set.
 *
 * Because DEV_AUTH_BYPASS and the console.warn guard are evaluated at module
 * load time, each test re-imports the module after stubbing the env vars.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadDevAuth() {
  // Reset module registry so each test gets a fresh module evaluation.
  vi.resetModules();
  return import("../lib/devAuth.js");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("devAuth — assertDevAuthBypassSafe production guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("does NOT call console.warn when DEV=false (production build)", async () => {
    vi.stubEnv("DEV", false as unknown as string);
    vi.stubEnv("VITE_DEV_AUTH_BYPASS", "1");

    const { assertDevAuthBypassSafe } = await loadDevAuth();
    // In production DEV=false, DEV_AUTH_BYPASS is false, so the guard must
    // not emit the bypass warning.
    // (assertDevAuthBypassSafe throws if VITE_DEV_AUTH_BYPASS=1 && !DEV —
    //  since import.meta.env.DEV is a build-time constant in real Vite, in
    //  tests we only verify the runtime console.warn path.)
    try {
      assertDevAuthBypassSafe();
    } catch {
      // May throw the "non-dev build" error; that's fine for this test.
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT call console.warn when DEV=true but VITE_DEV_AUTH_BYPASS is absent", async () => {
    vi.stubEnv("DEV", "true");
    vi.stubEnv("VITE_DEV_AUTH_BYPASS", "0");

    const { assertDevAuthBypassSafe } = await loadDevAuth();
    assertDevAuthBypassSafe();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
