/**
 * Regression tests for the compact HUD WaterTypeToggle — water-type scoped
 * UX audit findings:
 *
 *   WT-004 — the toggle must reconcile a stale preset Default Map Load the
 *            same way the Settings "Exploration Mode" radios do (shared
 *            clearStaleDefaultMapLoad helper), so the two switch entry
 *            points cannot drift apart.
 *   WT-005 — the toggle must NOT fire a direct PUT /api/settings. Server
 *            persistence rides the debounced settings sync; an out-of-band
 *            immediate PUT races the serialized sync chain when a switch is
 *            cancelled and the mode reverts, and can leave the server
 *            holding the wrong water type.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

// Plain module-level trackers — only dereferenced lazily (inside hook/fn
// bodies invoked after the module body has run), never at mock-factory time.
const putSettingsCalls: unknown[] = [];
const getDatasetsMock: { presets: { id: string }[]; calls: unknown[] } = {
  presets: [],
  calls: [],
};

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    usePutSettings: () => ({
      mutate: (...a: unknown[]) => { putSettingsCalls.push(a); },
      mutateAsync: async (...a: unknown[]) => { putSettingsCalls.push(a); },
      isPending: false,
    }),
    getDatasets: async (params: unknown) => {
      getDatasetsMock.calls.push(params);
      return getDatasetsMock.presets;
    },
  }),
);

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { WaterTypeToggle } from "@/components/WaterTypeToggle";

describe("WaterTypeToggle — water-type audit regressions", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
    putSettingsCalls.length = 0;
    getDatasetsMock.presets = [];
    getDatasetsMock.calls = [];
  });

  it("does NOT fire a direct settings PUT — persistence rides the debounced sync (WT-005)", async () => {
    render(<WaterTypeToggle />);
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("water-type-freshwater"));
    });

    expect(useSettingsStore.getState().waterType).toBe("freshwater");
    // No out-of-band PUT: the debounced server settings sync (subscribed to
    // the store) is the single persistence path, same as the Settings radios.
    expect(putSettingsCalls).toHaveLength(0);
  });

  it("clears a stale preset Default Map Load when switching modes (WT-004)", async () => {
    // A saltwater preset is stored as the Default Map Load; the freshwater
    // list doesn't contain it.
    useSettingsStore.setState({
      defaultMapLoad: { kind: "preset", id: "salt-preset-1" } as never,
    });
    getDatasetsMock.presets = [{ id: "lake-ray-roberts" }];

    render(<WaterTypeToggle />);
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("water-type-freshwater"));
    });

    await waitFor(() => {
      expect(useSettingsStore.getState().defaultMapLoad).toBeNull();
    });
    // Reconciled against the NEW mode's preset list.
    expect(getDatasetsMock.calls[0]).toEqual({ waterType: "freshwater" });
  });

  it("keeps a preset Default Map Load that exists in the new mode (WT-004)", async () => {
    const keepDefault = { kind: "preset", id: "lake-ray-roberts" } as never;
    useSettingsStore.setState({ defaultMapLoad: keepDefault });
    getDatasetsMock.presets = [{ id: "lake-ray-roberts" }];

    render(<WaterTypeToggle />);
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("water-type-freshwater"));
    });

    // Give the async reconcile a chance to (wrongly) clear it.
    await act(async () => { await Promise.resolve(); });
    expect(useSettingsStore.getState().defaultMapLoad).toEqual(keepDefault);
  });
});
