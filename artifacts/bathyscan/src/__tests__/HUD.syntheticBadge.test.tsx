/**
 * HUD synthetic-badge regression guard — post-removal.
 *
 * The "SIMULATED DATA" badge was removed because buildTerrainGrid now throws
 * NoDataError instead of falling back to procedural (fbm) terrain. This file
 * verifies that the badge is never rendered regardless of the terrain state,
 * so no ghost badge can appear from legacy cached grids.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";
import { HUD } from "@/components/HUD";
import { useCameraStore } from "@/lib/cameraStore";

let mockTerrain: TerrainData | null = null;

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false }; }
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

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasets: () => ({ data: [] }),
  }),
);

vi.mock("@/hooks/use-mobile", () => ({
  useIsNarrow: () => false,
  useIsMobile: () => false,
}));

vi.mock("@/hooks/useSurfaceTemperature", () => ({
  useSurfaceTemperature: () => ({ anchor: null, loading: false, error: false }),
}));

vi.mock("@/hooks/useTemperatureProfile", () => ({
  useTemperatureProfile: () => ({ profile: null, loading: false, error: false }),
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: mockTerrain,
  }),
}));

vi.mock("@/lib/gpsStore", () => ({
  useGpsStore: (sel: (s: { active: boolean; position: null }) => unknown) =>
    sel({ active: false, position: null }),
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { overviewGrid: null; visibleDatasets: unknown[]; selectedIds: string[] }) => unknown) =>
    sel({ overviewGrid: null, visibleDatasets: [], selectedIds: [] }),
}));

vi.mock("@/lib/proximityStreamingStore", () => ({
  useProximityStreamingStore: (sel: (s: { loadingDatasetId: null; distanceTableM: Record<string, number>; nameMap: Record<string, string> }) => unknown) =>
    sel({ loadingDatasetId: null, distanceTableM: {}, nameMap: {} }),
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const defaults = {
    showCrosshairGps: true,
    showCameraPosition: true,
    showHeading: true,
    coordinateFormat: "decimal" as const,
    depthUnit: "metres" as const,
    units: "metric" as const,
    hudOpacity: 1,
    globalFontSize: "medium" as const,
    highContrastHud: false,
    colorBlindSafePalette: false,
    manualConditionsActiveSource: {} as Record<string, "real" | "manual">,
    datasetManualConditions: {} as Record<string, unknown>,
  };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof defaults) => unknown) => sel(defaults),
    {
      getState: () => defaults,
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return {
    ...actual,
    useSettingsStore,
    FONT_SIZE_SCALE: {
      smallest: 0.80,
      small: 0.875,
      medium: 1.0,
      large: 1.15,
      "x-large": 1.30,
      largest: 1.45,
    },
  };
});

function makeLegacySyntheticTerrain(): TerrainData {
  return {
    datasetId: "gebco-test",
    bounds: { minLon: 0, maxLon: 1, minLat: 0, maxLat: 1 },
    grid: {
      width: 2,
      height: 2,
      depths: [0, -1, -1, -2],
    },
    // Legacy field — the server no longer produces this, but guard against
    // any stale in-memory state that might have slipped through.
    synthetic: true,
  } as unknown as TerrainData;
}

describe("HUD simulated-data badge (removed)", () => {
  beforeEach(() => {
    useCameraStore.setState({
      crosshairGps: null,
      lastClickedGps: null,
      cameraPosition: { known: false },
      cameraDepth: null,
      heading: 0,
      speedIndex: 0,
    });
    mockTerrain = null;
  });

  it("never renders the synthetic-data badge even when legacy terrain.synthetic is true", () => {
    mockTerrain = makeLegacySyntheticTerrain();
    render(<HUD />);
    expect(screen.queryByTestId("synthetic-data-badge")).not.toBeInTheDocument();
  });

  it("never renders the synthetic-data badge when terrain is null", () => {
    mockTerrain = null;
    render(<HUD />);
    expect(screen.queryByTestId("synthetic-data-badge")).not.toBeInTheDocument();
  });

  it("never renders the synthetic-data badge for real-source terrain", () => {
    mockTerrain = {
      datasetId: "ncei-test",
      bounds: { minLon: 0, maxLon: 1, minLat: 0, maxLat: 1 },
      grid: { width: 2, height: 2, depths: [0, -5, -10, -15] },
      dataSource: "ncei",
    } as unknown as TerrainData;
    render(<HUD />);
    expect(screen.queryByTestId("synthetic-data-badge")).not.toBeInTheDocument();
  });
});
