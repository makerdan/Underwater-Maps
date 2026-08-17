/**
 * Regression tests for WT-004 (water-type scoped UX audit):
 * `clearStaleDefaultMapLoad` — the shared helper both water-type switch
 * entry points (compact HUD toggle + Settings "Exploration Mode" radios)
 * call after flipping the mode. A preset Default Map Load that doesn't
 * exist in the new mode's preset list must be cleared; everything else
 * must be left untouched.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

// Deferred-capable getDatasets stand-in; referenced lazily so a plain
// module-level object is safe (nothing dereferences it at module init).
const getDatasetsMock: {
  impl: ((params: unknown) => Promise<{ id: string }[]>) | null;
  calls: unknown[];
} = { impl: null, calls: [] };

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    getDatasets: (params: unknown) => {
      getDatasetsMock.calls.push(params);
      if (!getDatasetsMock.impl) throw new Error("getDatasetsMock.impl not set");
      return getDatasetsMock.impl(params);
    },
  }),
);

import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { clearStaleDefaultMapLoad } from "@/lib/clearStaleDefaultMapLoad";

const PRESET_DEFAULT = { kind: "preset", id: "old-mode-preset" } as never;

describe("clearStaleDefaultMapLoad (WT-004)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
    getDatasetsMock.impl = null;
    getDatasetsMock.calls = [];
  });

  it("clears a preset default that vanished from the new mode's list", async () => {
    useSettingsStore.setState({ waterType: "freshwater", defaultMapLoad: PRESET_DEFAULT });
    getDatasetsMock.impl = async () => [{ id: "lake-ray-roberts" }];

    await clearStaleDefaultMapLoad("freshwater");

    expect(useSettingsStore.getState().defaultMapLoad).toBeNull();
    // Fetched the NEW mode's preset list.
    expect(getDatasetsMock.calls[0]).toEqual({ waterType: "freshwater" });
  });

  it("keeps a preset default that still exists in the new mode's list", async () => {
    useSettingsStore.setState({ waterType: "freshwater", defaultMapLoad: PRESET_DEFAULT });
    getDatasetsMock.impl = async () => [{ id: "old-mode-preset" }];

    await clearStaleDefaultMapLoad("freshwater");

    expect(useSettingsStore.getState().defaultMapLoad).toEqual(PRESET_DEFAULT);
  });

  it("leaves upload-kind defaults untouched without fetching", async () => {
    const uploadDefault = { kind: "upload", id: "user-upload-1" } as never;
    useSettingsStore.setState({ waterType: "freshwater", defaultMapLoad: uploadDefault });

    await clearStaleDefaultMapLoad("freshwater");

    expect(useSettingsStore.getState().defaultMapLoad).toEqual(uploadDefault);
    expect(getDatasetsMock.calls).toHaveLength(0);
  });

  it("keeps the stored value when the preset fetch fails", async () => {
    useSettingsStore.setState({ waterType: "freshwater", defaultMapLoad: PRESET_DEFAULT });
    getDatasetsMock.impl = async () => { throw new Error("network down"); };

    await clearStaleDefaultMapLoad("freshwater");

    expect(useSettingsStore.getState().defaultMapLoad).toEqual(PRESET_DEFAULT);
  });

  it("does nothing when the user switched modes again mid-flight", async () => {
    useSettingsStore.setState({ waterType: "freshwater", defaultMapLoad: PRESET_DEFAULT });
    let resolveFetch!: (v: { id: string }[]) => void;
    getDatasetsMock.impl = () => new Promise((res) => { resolveFetch = res; });

    const done = clearStaleDefaultMapLoad("freshwater");
    // User flips back to saltwater before the freshwater list arrives.
    useSettingsStore.setState({ waterType: "saltwater" });
    resolveFetch([]);
    await done;

    expect(useSettingsStore.getState().defaultMapLoad).toEqual(PRESET_DEFAULT);
  });
});
