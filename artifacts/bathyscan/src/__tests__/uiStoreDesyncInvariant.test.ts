/**
 * uiStoreDesyncInvariant.test.ts
 *
 * Unit tests for the DEV-mode desync assertion added to the uiStore→settingsStore
 * mirror subscription (SEED F-004).
 *
 * The assertion fires a console.assert() for every MIRRORED_UI_KEYS entry where
 * uiStore and settingsStore hold different values after the mirror subscription
 * runs.  These tests verify:
 *  1. When the stores are in sync (normal operation) console.assert is NOT called.
 *  2. When settingsStore.getState() returns a stale value for a mirrored key
 *     (simulating a stuck _suppressMirror or failed setState), console.assert
 *     fires with the correct key name.
 *  3. The assertion is gated on NODE_ENV === "development" so it is silent in
 *     production.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoist shared state so the vi.mock factory can read them ────────────────
// vi.mock factories are hoisted before variable declarations; plain `let` is in
// TDZ when the factory runs, so we must use vi.hoisted().
const { storeStateRef, getStateFnRef } = vi.hoisted(() => {
  const storeStateRef = { current: {} as Record<string, unknown> };
  const getStateFnRef = { current: () => storeStateRef.current };
  return { storeStateRef, getStateFnRef };
});

// ─── settingsStore mock ─────────────────────────────────────────────────────
// Must follow the importOriginal + persist/setState/getState/subscribe pattern
// so uiStore.ts module-level code does not crash on import.
vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const { DEFAULT_SETTINGS } = actual;

  // Initialise backing state from defaults so selectors don't crash.
  storeStateRef.current = { ...(DEFAULT_SETTINGS as Record<string, unknown>) };

  const useSettingsStore = Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel(storeStateRef.current),
    {
      getState: () => getStateFnRef.current(),
      setState: (patch: Record<string, unknown>) => {
        Object.assign(storeStateRef.current, patch);
      },
      persist: {
        hasHydrated: () => false,
        onFinishHydration: () => () => {},
      },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

// Import after mocks are set up.
import { useUiStore, MIRRORED_UI_KEYS } from "@/lib/uiStore";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Trigger the mirror subscription by updating a MIRRORED_UI_KEYS field in
 * uiStore.  The subscription fires synchronously in Zustand.
 */
function triggerMirrorSubscription(key: string, value: unknown) {
  useUiStore.setState({ [key]: value } as Parameters<typeof useUiStore.setState>[0]);
}

// ─── Setup ──────────────────────────────────────────────────────────────────

let assertSpy: ReturnType<typeof vi.spyOn>;
const originalNodeEnv = process.env["NODE_ENV"];

beforeEach(() => {
  // Reset backing store state from current uiStore state.
  storeStateRef.current = {
    ...(useUiStore.getState() as unknown as Record<string, unknown>),
  };
  // Default getState returns the real backing state (in-sync scenario).
  getStateFnRef.current = () => storeStateRef.current;

  assertSpy = vi.spyOn(console, "assert").mockImplementation(() => {});
});

afterEach(() => {
  assertSpy.mockRestore();
  // Restore NODE_ENV in case a test changed it.
  process.env["NODE_ENV"] = originalNodeEnv;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("uiStore desync invariant — DEV assertion (SEED F-004)", () => {
  it("MIRRORED_UI_KEYS is a non-empty array of strings", () => {
    expect(Array.isArray(MIRRORED_UI_KEYS)).toBe(true);
    expect(MIRRORED_UI_KEYS.length).toBeGreaterThan(0);
    for (const key of MIRRORED_UI_KEYS) {
      expect(typeof key).toBe("string");
    }
  });

  it("does NOT fire console.assert when stores are in sync (normal flow)", () => {
    process.env["NODE_ENV"] = "development";

    // Mutate a mirrored key — setState mock keeps storeState in sync.
    const mirroredKey = MIRRORED_UI_KEYS[0]!;
    const currentVal = (useUiStore.getState() as unknown as Record<string, unknown>)[mirroredKey];
    // Toggle boolean or flip string to produce a change the subscription detects.
    const newVal = typeof currentVal === "boolean" ? !currentVal : `__test_${mirroredKey}`;
    triggerMirrorSubscription(mirroredKey, newVal);

    // storeState was updated by the mock setState, so getState returns newVal.
    // assert should pass for all keys — no failure call expected.
    const failureCalls = assertSpy.mock.calls.filter(
      (args) => args[0] === false,
    );
    expect(failureCalls).toHaveLength(0);
  });

  it("fires console.assert with the desync key name when settingsStore is stale", () => {
    process.env["NODE_ENV"] = "development";

    const desyncKey = MIRRORED_UI_KEYS[0]!;
    const staleValue = "__STALE__";

    // Make getState() return a deliberately stale value for desyncKey,
    // simulating a scenario where setState did not propagate (e.g. stuck mirror).
    getStateFnRef.current = () => ({
      ...storeStateRef.current,
      [desyncKey]: staleValue,
    });

    // Mutate uiStore so the subscription runs.
    const currentVal = (useUiStore.getState() as unknown as Record<string, unknown>)[desyncKey];
    const newVal = typeof currentVal === "boolean" ? !currentVal : `__live_${desyncKey}`;
    triggerMirrorSubscription(desyncKey, newVal);

    // The DEV assertion should have been called with a falsy first arg for this key.
    const desyncCall = assertSpy.mock.calls.find(
      (args) =>
        args[1] === "uiStore/settingsStore desync on key:" &&
        args[2] === desyncKey,
    );
    expect(desyncCall).toBeDefined();
    expect(desyncCall![0]).toBe(false);
  });

  it("does NOT fire console.assert in production (NODE_ENV !== development)", () => {
    process.env["NODE_ENV"] = "production";

    // Force a desync scenario — but the assert block should be skipped entirely.
    const desyncKey = MIRRORED_UI_KEYS[0]!;
    getStateFnRef.current = () => ({
      ...storeStateRef.current,
      [desyncKey]: "__STALE_PROD__",
    });

    const currentVal = (useUiStore.getState() as unknown as Record<string, unknown>)[desyncKey];
    const newVal = typeof currentVal === "boolean" ? !currentVal : `__prod_${desyncKey}`;
    triggerMirrorSubscription(desyncKey, newVal);

    expect(assertSpy).not.toHaveBeenCalled();
  });
});
