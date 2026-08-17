/**
 * mobileAnalyze2d.test.tsx — Regression Guard for task "Mobile Plan & Analyze
 * tabs".
 *
 * Covers: the Analyze visualization redirect — on mobile, Analyze overlays
 * must render on the 2D chart with NO 3D scene mounted. A refactor could
 * silently re-couple overlay activation to the 3D scene (overlays toggle
 * "on" in state but nothing renders on mobile — the old wrong-for-mobile
 * behavior).
 *
 * What it checks: with the mobile path active and no 3D scene, enabling the
 * habitat / substrate / EFH / intertidal overlay settings causes the
 * corresponding 2D chart overlay renderers to be invoked with overlay data
 * and the compact mobile legend to appear. Fails if overlay rendering
 * becomes 3D-scene-dependent again or the gating stops reaching the 2D
 * renderer.
 *
 * Also covers: tap-to-query surfacing a depth readout, and the mobile
 * Analyze empty state routing to the mobile dataset picker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";

vi.mock("three");

// ── overviewRenderer: keep the real coordinate math, spy on the overlay
//    renderers the guard asserts on, and stub the canvas-touching builders
//    (jsdom has no real 2D context). ─────────────────────────────────────────
vi.mock("@/lib/overviewRenderer", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildHeatmapBitmap: vi.fn(() => ({ width: 4, height: 4 })),
    buildContourLines: vi.fn(() => []),
    renderHeatmap: vi.fn(),
    renderContourLines: vi.fn(),
    renderScaleBar: vi.fn(),
    // The four overlay layers under guard:
    renderIntertidalBand: vi.fn(),
    renderHabitatOverlay: vi.fn(),
    renderEfhOverlay: vi.fn(),
    renderSubstrateOverlay: vi.fn(),
    // jsdom's 1×1 layout box would fail the desktop LOD zoom gate; the gate's
    // own math is not what this guard covers.
    shouldDrawOverlayAtScale: vi.fn(() => true),
  };
});

// Panels hosted by the Analyze sheet — heavy, irrelevant to the guard.
vi.mock("@/components/HabitatPanel", () => ({
  HabitatPanel: () => <div data-testid="stub-habitat-panel" />,
}));
vi.mock("@/components/SeafloorClassificationPanel", () => ({
  SeafloorClassificationPanel: () => <div data-testid="stub-seafloor-panel" />,
}));
// Panels imported by MobileChartShell for the other tabs — stubbed so the
// shell-level occlusion test below stays focused on Analyze.
vi.mock("@/components/LivePanel", () => ({ LivePanel: () => null }));
vi.mock("@/components/CurrentsPanel", () => ({ CurrentsPanel: () => null }));
vi.mock("@/components/RoutesPanel", () => ({ RoutesPanel: () => null }));

// Overlay fixture data served by the mocked api-client hooks.
const apiFixtures = vi.hoisted(() => ({
  efhFeature: {
    properties: { commonName: "Pacific Cod", species: "G. macrocephalus", color: "#00e5ff" },
    geometry: {
      type: "Polygon",
      coordinates: [[[-122.7, 47.3], [-122.3, 47.3], [-122.3, 47.7], [-122.7, 47.7], [-122.7, 47.3]]],
    },
  },
  substrateFeature: {
    properties: { substrate: "gravel", color: "#e2d5a0" },
    geometry: {
      type: "Polygon",
      coordinates: [[[-122.6, 47.4], [-122.4, 47.4], [-122.4, 47.6], [-122.6, 47.6], [-122.6, 47.4]]],
    },
  },
  intertidalFeature: {
    properties: { unitId: "u1", tidepoolScore: 55, beachcombingScore: 5 },
    geometry: {
      type: "Polygon",
      coordinates: [[[-122.55, 47.45], [-122.45, 47.45], [-122.45, 47.55], [-122.55, 47.45]]],
    },
  },
}));

// Auto-stubbing api-client mock — pattern copied from mobileChartShell.test.tsx.
// NOTE: keep data:undefined for unlisted hooks — never data:[] (useEffect loop hazard).
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook()    { return { data: undefined, isLoading: false, isError: false }; }
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
          return (...a: unknown[]) => `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasets: () => ({
      data: [{ id: "guard-ds", name: "Guard DS", hasEfh: true }],
      isLoading: false,
      isError: false,
    }),
    useGetUserDatasets: () => ({ data: undefined, isLoading: false, isError: false }),
    useGetEfh: () => ({
      data: { features: [apiFixtures.efhFeature] },
      isLoading: false,
      isError: false,
    }),
    useGetSubstrate: () => ({
      data: { features: [apiFixtures.substrateFeature] },
      isLoading: false,
      isError: false,
    }),
    useGetIntertidalSpots: () => ({
      data: { features: [apiFixtures.intertidalFeature] },
      isLoading: false,
      isError: false,
    }),
  }),
);

vi.mock("@/lib/clerkCompat", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  };
});

import { MobileChartView } from "@/components/mobile/MobileChartView";
import { MobileChartShell } from "@/components/mobile/MobileChartShell";
import { MobileAnalyzeTab } from "@/components/mobile/MobileAnalyzeTab";
import {
  renderIntertidalBand,
  renderHabitatOverlay,
  renderEfhOverlay,
  renderSubstrateOverlay,
} from "@/lib/overviewRenderer";
import { RemoteData } from "@workspace/shared-types";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { useHabitatStore } from "@/lib/habitatStore";

/** 4×4 grid over lon −123..−122, lat 47..48 (row 0 = SOUTH). */
function makeGrid(): TerrainData {
  return {
    datasetId: "guard-ds",
    width: 4,
    height: 4,
    depths: Array.from({ length: 16 }, (_, i) => 10 + i),
    minLon: -123,
    maxLon: -122,
    minLat: 47,
    maxLat: 48,
  } as unknown as TerrainData;
}

/** Minimal 2D-context stub — jsdom returns null from getContext otherwise. */
function stubCanvas2d() {
  const ctx = new Proxy(
    {},
    {
      get(target: Record<string, unknown>, prop: string | symbol) {
        if (typeof prop === "symbol") return undefined;
        if (!(prop in target)) target[prop as string] = vi.fn();
        return target[prop as string];
      },
      set(target: Record<string, unknown>, prop: string | symbol, value: unknown) {
        target[prop as string] = value;
        return true;
      },
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
}

const overlaySpies = [
  renderHabitatOverlay,
  renderEfhOverlay,
  renderSubstrateOverlay,
  renderIntertidalBand,
] as unknown as Array<ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  stubCanvas2d();
  useSettingsStore.getState().resetAll();
  useTerrainStore.setState({ overviewGrid: makeGrid(), primaryDatasetId: "guard-ds" });
  useUiStore.setState({
    sidebarMode: "analyze",
    efhOverlayEnabled: false,
    substrateColorMode: false,
    intertidalHotspotsEnabled: false,
    hiddenEfhSpecies: new Set<string>(),
    hiddenSubstrateClasses: new Set<string>(),
    intertidalScoreMode: "tidepool",
  });
  useHabitatStore.setState({ activeSpecies: null, scores: RemoteData.idle() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useTerrainStore.setState({ overviewGrid: null, primaryDatasetId: null });
});

describe("mobile Analyze overlays render on the 2D chart (no 3D scene mounted)", () => {
  it("draws NO overlay layers while every overlay setting is off", async () => {
    render(<MobileChartView onOpenPicker={() => {}} />);
    // Let the rAF loop complete at least one frame.
    await new Promise((r) => setTimeout(r, 80));
    for (const spy of overlaySpies) expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mobile-analyze-legend")).toBeNull();
  });

  it("enabling the four overlay settings drives all four 2D overlay renderers plus the legend", async () => {
    render(<MobileChartView onOpenPicker={() => {}} />);

    // Flip the same flags the Analyze panels/settings flip — no 3D scene
    // exists anywhere in this test environment.
    useUiStore.setState({
      efhOverlayEnabled: true,
      substrateColorMode: true,
      intertidalHotspotsEnabled: true,
    });
    useHabitatStore.setState({
      activeSpecies: "dungeness_crab",
      scores: RemoteData.done(new Float32Array(64 * 64).fill(0.5)),
    });
    // Intertidal band datums via the settings override path.
    useSettingsStore.setState({ intertidalMhwOverrideFt: 4, intertidalMhhwOverrideFt: 5 });

    // Each overlay layer must reach the 2D renderer with its data.
    await waitFor(() => {
      expect(renderHabitatOverlay).toHaveBeenCalled();
      expect(renderEfhOverlay).toHaveBeenCalled();
      expect(renderSubstrateOverlay).toHaveBeenCalled();
      expect(renderIntertidalBand).toHaveBeenCalled();
    });

    const habitatArgs = (renderHabitatOverlay as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(habitatArgs[1]).toBeInstanceOf(Float32Array);
    const efhArgs = (renderEfhOverlay as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(efhArgs[1]).toHaveLength(1); // the bbox-visible EFH feature
    const subArgs = (renderSubstrateOverlay as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(subArgs[1]).toHaveLength(1);

    // Compact mobile legend pills for every active overlay.
    await waitFor(() => {
      expect(screen.getByTestId("mobile-analyze-legend")).toBeTruthy();
    });
    expect(screen.getByTestId("mobile-legend-habitat")).toBeTruthy();
    expect(screen.getByTestId("mobile-legend-efh")).toBeTruthy();
    expect(screen.getByTestId("mobile-legend-substrate")).toBeTruthy();
    expect(screen.getByTestId("mobile-legend-intertidal")).toBeTruthy();
  });
});

describe("mobile Analyze tap-to-query", () => {
  it("shows a dismissible depth readout after a tap on the chart", async () => {
    const { container } = render(<MobileChartView onOpenPicker={() => {}} />);
    const canvas = container.querySelector("canvas")!;
    expect(canvas).toBeTruthy();

    // Wait for the fit transform (set by the resize effect) to exist, then
    // tap the canvas centre. jsdom's layout box is 1×1, so the centre of the
    // fitted terrain sits at ~(0.5, 0.5).
    await new Promise((r) => setTimeout(r, 40));
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 0.5, clientY: 0.5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 0.5, clientY: 0.5 });

    await waitFor(() => {
      expect(screen.getByTestId("mobile-tap-query")).toBeTruthy();
    });
    expect(screen.getByTestId("mobile-tap-query-depth").textContent).toBeTruthy();

    fireEvent.click(screen.getByTestId("mobile-tap-query-close"));
    expect(screen.queryByTestId("mobile-tap-query")).toBeNull();
  });

  it("chip is visible above the open Analyze bottom sheet (full shell stacking context)", async () => {
    // Regression guard for the occlusion bug: Analyze taps only happen while
    // the bottom sheet (bottom 62%, z-index 50) is open, so a bottom-anchored
    // chip would sit entirely behind the sheet. Render the REAL shell so the
    // sheet and chip share a stacking context, then assert the chip's
    // geometry/stacking invariants keep it in the visible chart region.
    const { container } = render(<MobileChartShell />);

    // Analyze mode ⇒ the bottom sheet is open before/during the tap.
    const sheet = screen.getByTestId("mobile-bottom-sheet");
    expect(sheet).toBeTruthy();

    const canvas = container.querySelector("canvas")!;
    await new Promise((r) => setTimeout(r, 40));
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 0.5, clientY: 0.5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 0.5, clientY: 0.5 });

    const chip = await waitFor(() => screen.getByTestId("mobile-tap-query"));

    // Not nested inside (and thus clipped/scrolled by) the sheet.
    expect(sheet.contains(chip)).toBe(false);
    // Top-anchored inside the visible chart region: the sheet claims the
    // bottom 62% of the shell, so the chip must anchor from the top and stay
    // within the top ~38% of any phone-sized viewport (top ≤ 120px).
    expect(chip.style.bottom).toBe("");
    const top = Number.parseInt(chip.style.top, 10);
    expect(Number.isNaN(top)).toBe(false);
    expect(top).toBeLessThanOrEqual(120);
    // And it must stack above the sheet for very short viewports.
    expect(Number(chip.style.zIndex)).toBeGreaterThan(Number(sheet.style.zIndex));

    // Still dismissible from within the shell.
    fireEvent.click(screen.getByTestId("mobile-tap-query-close"));
    expect(screen.queryByTestId("mobile-tap-query")).toBeNull();
  });

  it("ignores taps outside Analyze mode", async () => {
    useUiStore.setState({ sidebarMode: "explore" });
    const { container } = render(<MobileChartView onOpenPicker={() => {}} />);
    const canvas = container.querySelector("canvas")!;
    await new Promise((r) => setTimeout(r, 40));
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 0.5, clientY: 0.5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 0.5, clientY: 0.5 });
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.queryByTestId("mobile-tap-query")).toBeNull();
  });
});

describe("mobile Analyze empty state", () => {
  it("routes to the mobile dataset picker, not the desktop Explore sidebar", () => {
    useTerrainStore.setState({ overviewGrid: null, primaryDatasetId: null });
    const onOpenPicker = vi.fn();
    render(<MobileAnalyzeTab onOpenPicker={onOpenPicker} />);

    expect(screen.getByTestId("mobile-analyze-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mobile-analyze-choose-dataset"));
    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });

  it("hosts the analysis panels once a dataset grid is loaded", () => {
    render(<MobileAnalyzeTab onOpenPicker={() => {}} />);
    expect(screen.queryByTestId("mobile-analyze-empty")).toBeNull();
    expect(screen.getByTestId("stub-seafloor-panel")).toBeTruthy();
  });
});
