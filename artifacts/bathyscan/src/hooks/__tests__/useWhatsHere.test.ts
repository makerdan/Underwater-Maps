/**
 * useWhatsHere — unit tests
 *
 * Covers:
 *   - All overlays active (substrate + habitat + tidal)
 *   - No overlays active
 *   - Each overlay active in isolation
 *   - null/undefined values from any store (crosshairGps=null, tidalData=null)
 *   - Referential stability of memoised values across re-renders
 *   - Data refreshes when active species changes while card is pinned
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/overviewRenderer", () => ({
  hitTestSubstrate: vi.fn(() => null),
}));

vi.mock("@/hooks/useSurfaceTemperature", () => ({
  useSurfaceTemperature: vi.fn(() => ({ anchor: null, loading: false, error: false })),
}));

// Both makeApiClientMock AND substrateDataRef must live inside vi.hoisted() so
// they are initialised before any vi.mock() factory runs (vi.mock factories are
// hoisted above module-level variable declarations in vitest's ESM transform).
const { makeApiClientMock, substrateDataRef } = vi.hoisted(() => {
  const substrateDataRef = { current: undefined as { features: unknown[] } | undefined };

  function noop() {}
  function mutationHook() {
    return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined };
  }
  function makeApiClientMock(overrides: Record<string, unknown> = {}) {
    return new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return () => ({ data: undefined, isLoading: false, isError: false, refetch: noop });
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
  }

  return { makeApiClientMock, substrateDataRef };
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    // useGetSubstrate reads from substrateDataRef so individual tests can
    // inject feature-collection data without re-mocking the entire module.
    // substrateDataRef lives in vi.hoisted() so it is defined before this factory runs.
    useGetSubstrate: () => ({ data: substrateDataRef.current, isLoading: false }),
    getGetSubstrateQueryKey: (id: string) => ["Substrate", id],
  }),
);

// ── After mocks: imports under test ─────────────────────────────────────────
import { useWhatsHere } from "@/hooks/useWhatsHere";
import { useCameraStore } from "@/lib/cameraStore";
import { useHabitatStore } from "@/lib/habitatStore";
import { useUiStore } from "@/lib/uiStore";
import { hitTestSubstrate } from "@/lib/overviewRenderer";
import type { TidalDataResult } from "@/hooks/useTidalData";
import type { TerrainData } from "@workspace/api-client-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return Wrapper;
}

const TERRAIN: TerrainData = {
  datasetId: "test-ds",
  name: "Test",
  waterType: "saltwater",
  resolution: 4,
  width: 4,
  height: 4,
  depths: Array(16).fill(50),
  minLat: 55.0,
  maxLat: 56.0,
  minLon: -133.0,
  maxLon: -132.0,
  minDepth: 50,
  maxDepth: 50,
  pixelWidthM: 1000,
  pixelHeightM: 1000,
  source: "preset",
};

const TIDAL_DATA: TidalDataResult = {
  available: true,
  tideHeight: 1.5,
  currentDirection: 90,
  currentSpeed: 0.4,
  stationId: "9445958",
  stationName: "Test Station",
  source: "noaa",
  currentsSource: "noaa",
  currentsStation: { id: "9445958", name: "Test Station" },
  nextEvent: { type: "high", time: "2026-07-15T12:00:00Z", height: 2.1 },
  slack: null,
  isPredicted: false,
  isOfflinePack: false,
  packSnapshotAt: null,
};

function seedCrosshair(lat = 55.5, lon = -132.5, depth = 75) {
  act(() => {
    useCameraStore.getState().setCrosshairGps({ lat, lon, depth });
  });
}

function clearCrosshair() {
  act(() => {
    useCameraStore.getState().setCrosshairGps(null);
  });
}

function setSubstrateOverlay(enabled: boolean) {
  act(() => {
    useUiStore.setState({ substrateColorMode: enabled });
  });
}

function setHabitatSpecies(id: "rockfish" | "dungeness_crab" | null) {
  act(() => {
    useHabitatStore.setState({ activeSpecies: id as string | null as never, scores: null, hotspots: [] });
  });
}

// ── Reset stores between tests ───────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(hitTestSubstrate).mockReturnValue(null);
  substrateDataRef.current = undefined;
  clearCrosshair();
  setSubstrateOverlay(false);
  setHabitatSpecies(null);
  useCameraStore.setState({
    cameraLon: null,
    cameraLat: null,
    cameraDepth: null,
    heading: 0,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useWhatsHere — no crosshair GPS", () => {
  it("returns null depth/lat/lon when crosshairGps is null", () => {
    const { result } = renderHook(
      () => useWhatsHere(TIDAL_DATA, true, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.depth).toBeNull();
    expect(result.current.lat).toBeNull();
    expect(result.current.lon).toBeNull();
  });

  it("tidalActive is false when tidalOverlay=false even with data", () => {
    const { result } = renderHook(
      () => useWhatsHere(TIDAL_DATA, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tidalActive).toBe(false);
    expect(result.current.tidalPhase).toBeNull();
    expect(result.current.tidalHeight).toBeNull();
  });

  it("tidalActive is false when tidalData is null", () => {
    const { result } = renderHook(
      () => useWhatsHere(null, true, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tidalActive).toBe(false);
  });

  it("hasAnyData is false with no overlays active and null crosshair", () => {
    const { result } = renderHook(
      () => useWhatsHere(null, false, null),
      { wrapper: makeWrapper() },
    );
    expect(result.current.hasAnyData).toBe(false);
  });
});

describe("useWhatsHere — all overlays active", () => {
  it("reports tidalActive, habitatActive, substrateActive all true", () => {
    seedCrosshair();
    setSubstrateOverlay(true);
    setHabitatSpecies("rockfish");

    const { result } = renderHook(
      () => useWhatsHere(TIDAL_DATA, true, TERRAIN),
      { wrapper: makeWrapper() },
    );

    expect(result.current.tidalActive).toBe(true);
    expect(result.current.habitatActive).toBe(true);
    expect(result.current.substrateActive).toBe(true);
  });

  it("tidalPhase is 'Flooding' when nextEvent.type === 'high' and not slack", () => {
    seedCrosshair();
    const { result } = renderHook(
      () => useWhatsHere(TIDAL_DATA, true, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tidalPhase).toBe("Flooding");
    expect(result.current.tidalHeight).toBe(1.5);
  });

  it("tidalPhase is 'Ebbing' when nextEvent.type === 'low'", () => {
    seedCrosshair();
    const ebbingTidal: TidalDataResult = {
      ...TIDAL_DATA,
      nextEvent: { type: "low", time: "2026-07-15T13:00:00Z", height: 0.3 },
    };
    const { result } = renderHook(
      () => useWhatsHere(ebbingTidal, true, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tidalPhase).toBe("Ebbing");
  });

  it("tidalPhase is 'Slack' when slack.isSlack === true", () => {
    seedCrosshair();
    const slackTidal: TidalDataResult = {
      ...TIDAL_DATA,
      slack: { isSlack: true, phase: "flooding", minutesToSlack: 3 },
    };
    const { result } = renderHook(
      () => useWhatsHere(slackTidal, true, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tidalPhase).toBe("Slack");
  });

  it("hasAnyData is true when tidal is active and available", () => {
    seedCrosshair();
    const { result } = renderHook(
      () => useWhatsHere(TIDAL_DATA, true, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.hasAnyData).toBe(true);
  });
});

describe("useWhatsHere — no overlays active", () => {
  it("all overlay flags are false when nothing is enabled", () => {
    seedCrosshair();
    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.substrateActive).toBe(false);
    expect(result.current.habitatActive).toBe(false);
    expect(result.current.tidalActive).toBe(false);
    expect(result.current.hasAnyData).toBe(false);
  });

  it("depth is returned even when overlays are disabled (terrain data always available)", () => {
    seedCrosshair(55.5, -132.5, 120);
    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.depth).toBe(120);
  });
});

describe("useWhatsHere — only substrate overlay active", () => {
  it("substrateActive=true, habitatActive=false, tidalActive=false", () => {
    seedCrosshair();
    setSubstrateOverlay(true);

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.substrateActive).toBe(true);
    expect(result.current.habitatActive).toBe(false);
    expect(result.current.tidalActive).toBe(false);
  });

  it("substrateName is null when hitTestSubstrate returns null", () => {
    seedCrosshair();
    setSubstrateOverlay(true);
    vi.mocked(hitTestSubstrate).mockReturnValue(null);

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.substrateName).toBeNull();
    expect(result.current.hasAnyData).toBe(false);
  });

  it("substrateName is returned when hitTestSubstrate finds a hit", () => {
    seedCrosshair();
    setSubstrateOverlay(true);
    const ROCK_FEATURE = {
      type: "Feature",
      properties: { substrate: "Rock", shoreZoneClass: "R", cmecsCode: "M1", color: "#ff0" },
      geometry: { type: "Polygon", coordinates: [[]] },
    };
    // Must provide features so the hook's `features.length === 0` guard passes.
    substrateDataRef.current = { features: [ROCK_FEATURE] };
    vi.mocked(hitTestSubstrate).mockReturnValue(ROCK_FEATURE as never);

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.substrateName).toBe("Rock");
    expect(result.current.hasAnyData).toBe(true);
  });

  it("substrateName is null when crosshairGps is null (no point to hit-test)", () => {
    clearCrosshair();
    setSubstrateOverlay(true);
    vi.mocked(hitTestSubstrate).mockReturnValue({
      type: "Feature",
      properties: { substrate: "Sand" },
      geometry: { type: "Polygon", coordinates: [[]] },
    } as never);

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.substrateName).toBeNull();
  });
});

describe("useWhatsHere — only habitat overlay active", () => {
  it("habitatActive=true, substrateActive=false, tidalActive=false", () => {
    seedCrosshair();
    setHabitatSpecies("rockfish");

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.habitatActive).toBe(true);
    expect(result.current.substrateActive).toBe(false);
    expect(result.current.tidalActive).toBe(false);
  });

  it("habitatScore is null when scores array is null", () => {
    seedCrosshair();
    setHabitatSpecies("rockfish");

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.habitatScore).toBeNull();
  });

  it("habitatScore is computed from scores grid when available", () => {
    seedCrosshair(55.5, -132.5, 50);
    setHabitatSpecies("rockfish");
    const scores = new Float32Array(16).fill(0.75);
    act(() => {
      useHabitatStore.setState({ activeSpecies: "rockfish", scores, hotspots: [] });
    });

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.habitatScore).toBeGreaterThanOrEqual(0);
    expect(result.current.habitatScore).toBeLessThanOrEqual(1);
  });

  it("habitatSpeciesLabel is non-null for a known species", () => {
    seedCrosshair();
    setHabitatSpecies("rockfish");

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.habitatSpeciesLabel).not.toBeNull();
  });

  it("habitatActive is false when species is null", () => {
    seedCrosshair();
    setHabitatSpecies(null);

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.habitatActive).toBe(false);
    expect(result.current.habitatSpeciesLabel).toBeNull();
    expect(result.current.habitatScore).toBeNull();
  });
});

describe("useWhatsHere — only tidal overlay active", () => {
  it("tidalActive=true, substrateActive=false, habitatActive=false", () => {
    seedCrosshair();
    const { result } = renderHook(
      () => useWhatsHere(TIDAL_DATA, true, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tidalActive).toBe(true);
    expect(result.current.substrateActive).toBe(false);
    expect(result.current.habitatActive).toBe(false);
  });

  it("tidalActive is false when tidalData.available is false", () => {
    seedCrosshair();
    const unavailable: TidalDataResult = { available: false };
    const { result } = renderHook(
      () => useWhatsHere(unavailable, true, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tidalActive).toBe(false);
    expect(result.current.tidalPhase).toBeNull();
    expect(result.current.tidalHeight).toBeNull();
  });

  it("tidalPhase is null when nextEvent is null and slack is null", () => {
    seedCrosshair();
    const noPhase: TidalDataResult = {
      ...TIDAL_DATA,
      nextEvent: null,
      slack: null,
    };
    const { result } = renderHook(
      () => useWhatsHere(noPhase, true, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tidalPhase).toBeNull();
  });
});

describe("useWhatsHere — null safety", () => {
  it("does not crash when terrain is null", () => {
    seedCrosshair();
    expect(() => {
      const { result } = renderHook(
        () => useWhatsHere(TIDAL_DATA, true, null),
        { wrapper: makeWrapper() },
      );
      expect(result.current.habitatScore).toBeNull();
    }).not.toThrow();
  });

  it("habitatScore is null when terrain.resolution is 0", () => {
    seedCrosshair();
    setHabitatSpecies("rockfish");
    const scores = new Float32Array(16).fill(0.8);
    act(() => {
      useHabitatStore.setState({ activeSpecies: "rockfish", scores, hotspots: [] });
    });

    const badTerrain = { ...TERRAIN, resolution: 0 };
    const { result } = renderHook(
      () => useWhatsHere(null, false, badTerrain as TerrainData),
      { wrapper: makeWrapper() },
    );
    expect(result.current.habitatScore).toBeNull();
  });

  it("returns tempC as a number when crosshairGps has a depth", () => {
    seedCrosshair(55.5, -132.5, 100);
    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tempC).not.toBeNull();
    expect(typeof result.current.tempC).toBe("number");
  });

  it("returns tempC as null when crosshairGps is null", () => {
    clearCrosshair();
    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );
    expect(result.current.tempC).toBeNull();
  });
});

describe("useWhatsHere — referential stability", () => {
  it("tidalSummary fields are stable across re-renders when inputs unchanged", () => {
    seedCrosshair();
    const { result, rerender } = renderHook(
      ({ tidal, overlay }: { tidal: TidalDataResult; overlay: boolean }) =>
        useWhatsHere(tidal, overlay, TERRAIN),
      {
        initialProps: { tidal: TIDAL_DATA, overlay: true },
        wrapper: makeWrapper(),
      },
    );

    const phase1 = result.current.tidalPhase;
    const height1 = result.current.tidalHeight;

    rerender({ tidal: TIDAL_DATA, overlay: true });

    expect(result.current.tidalPhase).toBe(phase1);
    expect(result.current.tidalHeight).toBe(height1);
  });

  it("tempResult values are stable across re-renders when depth unchanged", () => {
    seedCrosshair(55.5, -132.5, 80);
    const { result, rerender } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );

    const tempC1 = result.current.tempC;
    const tempLive1 = result.current.tempLive;

    rerender();

    expect(result.current.tempC).toBe(tempC1);
    expect(result.current.tempLive).toBe(tempLive1);
  });

  it("substrate values update when substrateColorMode changes to false", () => {
    seedCrosshair();
    setSubstrateOverlay(true);

    // Provide substrate collection so the hook's enabled guard is satisfied
    // and hitTestSubstrate is actually called.
    const FAKE_FEATURE = {
      type: "Feature",
      properties: { substrate: "Gravel" },
      geometry: { type: "Polygon", coordinates: [[]] },
    };
    substrateDataRef.current = { features: [FAKE_FEATURE] };
    vi.mocked(hitTestSubstrate).mockReturnValue(FAKE_FEATURE as never);

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );

    expect(result.current.substrateActive).toBe(true);
    expect(result.current.substrateName).toBe("Gravel");

    act(() => {
      setSubstrateOverlay(false);
    });

    expect(result.current.substrateActive).toBe(false);
    expect(result.current.substrateName).toBeNull();
  });
});

describe("useWhatsHere — species change while pinned", () => {
  it("habitatActive updates when activeSpecies changes from null to a species", () => {
    seedCrosshair();
    setHabitatSpecies(null);

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );

    expect(result.current.habitatActive).toBe(false);

    act(() => {
      setHabitatSpecies("dungeness_crab");
    });

    expect(result.current.habitatActive).toBe(true);
    expect(result.current.habitatSpeciesLabel).not.toBeNull();
  });

  it("habitatSpeciesLabel changes when species changes from rockfish to dungeness_crab", () => {
    seedCrosshair();
    setHabitatSpecies("rockfish");

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );

    const rockfishLabel = result.current.habitatSpeciesLabel;
    expect(rockfishLabel).not.toBeNull();

    act(() => {
      setHabitatSpecies("dungeness_crab");
    });

    const crabLabel = result.current.habitatSpeciesLabel;
    expect(crabLabel).not.toBeNull();
    expect(crabLabel).not.toBe(rockfishLabel);
  });

  it("habitatActive becomes false again when species is cleared to null", () => {
    seedCrosshair();
    setHabitatSpecies("rockfish");

    const { result } = renderHook(
      () => useWhatsHere(null, false, TERRAIN),
      { wrapper: makeWrapper() },
    );

    expect(result.current.habitatActive).toBe(true);

    act(() => {
      setHabitatSpecies(null);
    });

    expect(result.current.habitatActive).toBe(false);
    expect(result.current.habitatSpeciesLabel).toBeNull();
    expect(result.current.habitatScore).toBeNull();
  });
});
