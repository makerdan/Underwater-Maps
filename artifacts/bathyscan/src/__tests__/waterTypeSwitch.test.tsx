/**
 * End-to-end integration test for the water-type (saltwater ↔ freshwater)
 * switch wired up in App.tsx. Renders the real <WaterTypeToggle/> against
 * the real settings/terrain/classification/habitat stores plus the extracted
 * useWaterTypeSideEffects hook (same hook App.tsx mounts), then asserts:
 *
 *   - The active dataset auto-switches to the first preset of the new mode.
 *   - Derived stores (terrain grid, zone classification, habitat scoring)
 *     are cleared so stale data from the previous mode can't leak through.
 *   - The colormap auto-flips to the freshwater default when the user was
 *     still on the ocean default.
 */
import React, { useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
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
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () => makeApiClientMock());

// Default: auto-confirm any synthetic-data prompt so the existing tests
// (which assert the switch happens) keep exercising the post-confirm path.
// Individual tests can override via requestDatasetSwitchMock.
const requestDatasetSwitchMock = vi.fn(
  async (args: { onConfirm: () => void; onCancel?: () => void }) => {
    args.onConfirm();
  },
);
vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: (args: Parameters<typeof requestDatasetSwitchMock>[0]) =>
    requestDatasetSwitchMock(args),
  useSimulatedDataStore: { getState: () => ({ suppressed: false, setPending: () => {} }) },
}));

import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useClassificationStore } from "@/lib/classificationStore";
import { useHabitatStore } from "@/lib/habitatStore";
import { useWaterTypeSideEffects } from "@/lib/useWaterTypeSideEffects";
import { WaterTypeToggle } from "@/components/WaterTypeToggle";
import { TooltipProvider } from "@/components/ui/tooltip";

type FakeDataset = {
  id: string;
  waterType: "saltwater" | "freshwater";
  title: string;
};

const DATASETS: FakeDataset[] = [
  { id: "salt-1", waterType: "saltwater", title: "Mariana Trench" },
  { id: "salt-2", waterType: "saltwater", title: "Puget Sound" },
  { id: "fresh-1", waterType: "freshwater", title: "Lake Tahoe" },
  { id: "fresh-2", waterType: "freshwater", title: "Mississippi" },
];

function Harness({
  onDatasetChange,
  initialDatasetId = "salt-1",
}: {
  onDatasetChange?: (id: string | null) => void;
  initialDatasetId?: string | null;
}) {
  const [datasetId, setDatasetId] = useState<string | null>(initialDatasetId);
  // Use the same hook App.tsx mounts so we test the real side-effect code path.
  useWaterTypeSideEffects(
    DATASETS as unknown as Parameters<typeof useWaterTypeSideEffects>[0],
    (id) => {
      setDatasetId(id);
      onDatasetChange?.(id);
    },
  );
  return (
    <TooltipProvider>
      <div>
        <div data-testid="active-dataset">{datasetId ?? "none"}</div>
        <WaterTypeToggle />
      </div>
    </TooltipProvider>
  );
}

function resetAllStores() {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
  useTerrainStore.setState({ activeGrid: null, overviewGrid: null });
  useClassificationStore.setState({
    zoneMap: null,
    aiZoneMap: null,
    hasEdits: false,
    loading: false,
    error: null,
    currentGridHash: null,
  });
  useHabitatStore.setState({
    activeSpecies: null,
    scores: null,
    hotspots: [],
    scoreCache: new Map(),
  });
}

describe("water-type switch (end-to-end)", () => {
  beforeEach(() => {
    resetAllStores();
    requestDatasetSwitchMock.mockReset();
    requestDatasetSwitchMock.mockImplementation(async (args) => {
      args.onConfirm();
    });
  });

  it("switching saltwater → freshwater auto-loads a freshwater preset and clears derived stores", async () => {
    // Seed derived stores with non-empty state representing the prior
    // saltwater session, so we can assert they get wiped.
    useTerrainStore.setState({
      activeGrid: { fakeGrid: true } as never,
      overviewGrid: null,
    });
    useClassificationStore.setState({
      zoneMap: new Uint8Array([1, 2, 3, 4]),
      aiZoneMap: new Uint8Array([1, 2, 3, 4]),
      hasEdits: true,
      loading: false,
      error: null,
      currentGridHash: "deadbeef",
    });
    useHabitatStore.setState({
      activeSpecies: "rockfish" as never,
      scores: new Float32Array([0.5, 0.6]),
      hotspots: [{ row: 1, col: 2 } as never],
      scoreCache: new Map(),
    });

    const onDatasetChange = vi.fn();
    render(<Harness onDatasetChange={onDatasetChange} />);

    // Baseline: saltwater is the default, salt-1 is active.
    expect(useSettingsStore.getState().waterType).toBe("saltwater");
    expect(screen.getByTestId("active-dataset").textContent).toBe("salt-1");

    // Click the freshwater segment of the toggle.
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("water-type-freshwater"));
    });

    // Settings store flipped to freshwater.
    expect(useSettingsStore.getState().waterType).toBe("freshwater");

    // Active dataset switched to the first freshwater preset in the list.
    expect(onDatasetChange).toHaveBeenCalledWith("fresh-1");
    expect(screen.getByTestId("active-dataset").textContent).toBe("fresh-1");

    // Derived stores from the previous (saltwater) session are cleared.
    expect(useTerrainStore.getState().activeGrid).toBeNull();
    expect(useClassificationStore.getState().zoneMap).toBeNull();
    expect(useClassificationStore.getState().aiZoneMap).toBeNull();
    expect(useClassificationStore.getState().hasEdits).toBe(false);
    expect(useClassificationStore.getState().currentGridHash).toBeNull();
    expect(useHabitatStore.getState().activeSpecies).toBeNull();
    expect(useHabitatStore.getState().scores).toBeNull();
    expect(useHabitatStore.getState().hotspots).toEqual([]);

    // Colormap auto-flipped from "ocean" (saltwater default) to "freshwater".
    expect(useSettingsStore.getState().colormapTheme).toBe("freshwater");
  });

  it("switching back freshwater → saltwater also clears stores and auto-loads a saltwater preset", async () => {
    // Start in freshwater with fresh-1 already active.
    useSettingsStore.setState({ waterType: "freshwater", colormapTheme: "freshwater" });
    const onDatasetChange = vi.fn();
    render(<Harness onDatasetChange={onDatasetChange} initialDatasetId="fresh-1" />);

    // Seed terrain after mount to ensure it survives only until the toggle.
    useTerrainStore.setState({ activeGrid: { fakeGrid: true } as never, overviewGrid: null });

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("water-type-saltwater"));
    });

    expect(useSettingsStore.getState().waterType).toBe("saltwater");
    expect(onDatasetChange).toHaveBeenCalledWith("salt-1");
    expect(screen.getByTestId("active-dataset").textContent).toBe("salt-1");
    expect(useTerrainStore.getState().activeGrid).toBeNull();
    // Colormap auto-flipped back to the saltwater default ("ocean").
    expect(useSettingsStore.getState().colormapTheme).toBe("ocean");
  });

  it("cancelling the synthetic-data warning keeps the previous dataset and water-type", async () => {
    // Override the mock: simulate the user clicking "Cancel" in the
    // simulated-data warning dialog.
    requestDatasetSwitchMock.mockImplementation(async (args) => {
      args.onCancel?.();
    });

    // Start in saltwater with salt-1 active and seeded derived state.
    const seededGrid = { fakeGrid: true } as never;
    useTerrainStore.setState({ activeGrid: seededGrid, overviewGrid: null });
    useClassificationStore.setState({
      zoneMap: new Uint8Array([1, 2, 3, 4]),
      aiZoneMap: null,
      hasEdits: true,
      loading: false,
      error: null,
      currentGridHash: "deadbeef",
    });

    const onDatasetChange = vi.fn();
    render(<Harness onDatasetChange={onDatasetChange} />);

    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("water-type-freshwater"));
    });

    // Cancel path: water-type was reverted, dataset unchanged, derived state preserved.
    expect(useSettingsStore.getState().waterType).toBe("saltwater");
    expect(onDatasetChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("active-dataset").textContent).toBe("salt-1");
    expect(useTerrainStore.getState().activeGrid).toBe(seededGrid);
    expect(useClassificationStore.getState().zoneMap).not.toBeNull();
    expect(useClassificationStore.getState().hasEdits).toBe(true);
  });

  it("preserves a user-chosen non-default colormap across a water-type switch", async () => {
    // User has explicitly picked "thermal" — neither environment's default.
    useSettingsStore.setState({ waterType: "saltwater", colormapTheme: "thermal" });

    render(<Harness />);
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByTestId("water-type-freshwater"));
    });

    expect(useSettingsStore.getState().waterType).toBe("freshwater");
    // Explicit choice respected — not auto-clobbered.
    expect(useSettingsStore.getState().colormapTheme).toBe("thermal");
  });
});
