/**
 * Tests that switching water type clears BOTH activeGrid and overviewGrid in
 * a single store update, so no cross-dataset mix is ever observable mid-switch.
 */
import React, { useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";

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
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () => makeApiClientMock());

// Bypass the async preview/confirmation flow so the side-effect runs
// synchronously inside the test's `act()` block.
vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: ({ onConfirm }: { onConfirm: () => void }) => {
    onConfirm();
    return Promise.resolve();
  },
}));

import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useWaterTypeSideEffects } from "@/lib/useWaterTypeSideEffects";

function Harness() {
  const [, setDatasetId] = useState<string | null>("salt-1");
  useWaterTypeSideEffects(
    [
      { id: "salt-1", waterType: "saltwater" },
      { id: "fresh-1", waterType: "freshwater" },
    ] as never,
    setDatasetId,
  );
  return null;
}

describe("water-type switch atomically clears both grids", () => {
  beforeEach(() => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
    useTerrainStore.setState({ activeGrid: null, overviewGrid: null });
  });

  it("clears activeGrid AND overviewGrid in one store update", () => {
    // Seed both grids with a previous saltwater dataset.
    useTerrainStore.setState({
      activeGrid: { datasetId: "salt-1" } as never,
      overviewGrid: { datasetId: "salt-1" } as never,
    });

    // Subscribe and capture every snapshot the store emits during the switch.
    const snapshots: Array<{ a: string | null; o: string | null }> = [];
    const unsub = useTerrainStore.subscribe((s) => {
      snapshots.push({
        a: (s.activeGrid as { datasetId?: string } | null)?.datasetId ?? null,
        o: (s.overviewGrid as { datasetId?: string } | null)?.datasetId ?? null,
      });
    });

    render(<Harness />);
    act(() => {
      useSettingsStore.setState({ waterType: "freshwater" });
    });
    unsub();

    // No intermediate snapshot may have one grid cleared and the other still
    // pointing at the stale dataset.
    for (const snap of snapshots) {
      const mixed =
        (snap.a === null && snap.o !== null) ||
        (snap.a !== null && snap.o === null);
      expect(mixed).toBe(false);
    }

    const state = useTerrainStore.getState();
    expect(state.activeGrid).toBeNull();
    expect(state.overviewGrid).toBeNull();
  });
});
