/**
 * MapLayersSection data-correctness regression tests (Task: settings data
 * correctness).
 *
 * Covers:
 *   - Two rapid toggleMarkerType calls both apply (no stale-snapshot race).
 *     The mock store is stateful but never re-renders the component, which
 *     reproduces the "two toggles before a re-render" scenario.
 *   - Missing layerArrowDensity object renders without crash and falls back
 *     to the global currentArrowDensity.
 *   - Out-of-range GPS recording interval is normalised to the nearest valid
 *     option and written back to the store.
 *   - Persisted 360° current direction is corrected to 0° on read.
 *   - Out-of-range / NaN slider values are clamped before reaching the input.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => {
  // Mutable backing state: setters update it, getState() reads it live, but
  // nothing triggers a React re-render (subscribe is a no-op) — mirroring
  // rapid user input that lands before React repaints.
  const data = {
    visibleMarkerTypes: ["fish", "shipwreck", "coral"] as string[],
    gpsRecordingInterval: 2000,
    currentsManualDirectionDeg: 90,
    currentsManualSpeedKt: 1.0,
    followResumeDelaySec: 20,
    markerClusterThreshold: 25,
    layerArrowDensity: undefined as Record<string, string> | undefined,
    currentArrowDensity: "dense",
  };
  const setVisibleMarkerTypes = vi.fn((v: string[]) => { data.visibleMarkerTypes = v; });
  const setGpsRecordingInterval = vi.fn((v: number) => { data.gpsRecordingInterval = v; });
  const setCurrentsManualDirectionDeg = vi.fn((v: number) => { data.currentsManualDirectionDeg = v; });
  const setCurrentsManualSpeedKt = vi.fn((v: number) => { data.currentsManualSpeedKt = v; });
  const setFollowResumeDelaySec = vi.fn((v: number) => { data.followResumeDelaySec = v; });
  const setMarkerClusterThreshold = vi.fn((v: number) => { data.markerClusterThreshold = v; });
  return {
    data,
    setVisibleMarkerTypes,
    setGpsRecordingInterval,
    setCurrentsManualDirectionDeg,
    setCurrentsManualSpeedKt,
    setFollowResumeDelaySec,
    setMarkerClusterThreshold,
  };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    waterType: "saltwater" as const,
    showMarkerLabels: true,
    setShowMarkerLabels: vi.fn(),
    privateMarkers: false,
    setPrivateMarkers: vi.fn(),
    defaultMarkerType: "fish" as const,
    setDefaultMarkerType: vi.fn(),
    visibleMarkerTypes: h.data.visibleMarkerTypes as import("@/lib/settingsStore").MarkerType[],
    setVisibleMarkerTypes: h.setVisibleMarkerTypes,
    autoStartTrailRecording: false,
    setAutoStartTrailRecording: vi.fn(),
    defaultTrailColor: "#00e5ff",
    setDefaultTrailColor: vi.fn(),
    gpsRecordingInterval: h.data.gpsRecordingInterval,
    setGpsRecordingInterval: h.setGpsRecordingInterval,
    followResumeDelaySec: h.data.followResumeDelaySec,
    setFollowResumeDelaySec: h.setFollowResumeDelaySec,
    defaultDepthPoleColor: "#ff6600",
    setDefaultDepthPoleColor: vi.fn(),
    markerClusterThreshold: h.data.markerClusterThreshold,
    setMarkerClusterThreshold: h.setMarkerClusterThreshold,
    trailRetention: "30" as const,
    setTrailRetention: vi.fn(),
    autoLoadTidal: true,
    setAutoLoadTidal: vi.fn(),
    defaultTidalDepthLayer: "surface" as const,
    setDefaultTidalDepthLayer: vi.fn(),
    currentsEnabled: false,
    setCurrentsEnabled: vi.fn(),
    currentsSource: "manual" as const,
    setCurrentsSource: vi.fn(),
    currentsManualDirectionDeg: h.data.currentsManualDirectionDeg,
    setCurrentsManualDirectionDeg: h.setCurrentsManualDirectionDeg,
    currentsManualSpeedKt: h.data.currentsManualSpeedKt,
    setCurrentsManualSpeedKt: h.setCurrentsManualSpeedKt,
    currentArrowDensity: h.data.currentArrowDensity as "dense",
    setCurrentArrowDensity: vi.fn(),
    layerArrowDensity: h.data.layerArrowDensity as unknown as Record<
      import("@/lib/settingsStore").TidalDepthLayer,
      import("@/lib/settingsStore").CurrentArrowDensity
    >,
    setLayerArrowDensity: vi.fn(),
    windOverlayStyle: "arrows" as const,
    setWindOverlayStyle: vi.fn(),
    tideOverlayStyle: "arrows" as const,
    setTideOverlayStyle: vi.fn(),
    currentOverlayStyle: "arrows" as const,
    setCurrentOverlayStyle: vi.fn(),
    currentsShowParticles: true,
    setCurrentsShowParticles: vi.fn(),
    currentsShowArrows: true,
    setCurrentsShowArrows: vi.fn(),
    currentsShowStreamlines: false,
    setCurrentsShowStreamlines: vi.fn(),
    currentsAutoAdvance: false,
    setCurrentsAutoAdvance: vi.fn(),
    syncedSnapshot: null,
    lastSyncedAt: null,
    resetSection: vi.fn(),
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => state(),
      setState: vi.fn(),
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

vi.mock("@/components/AdvancedDisclosure", () => ({
  AdvancedDisclosure: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="advanced-disclosure">{children}</div>
  ),
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/pages/settings/components/SyncContext", () => ({
  SectionActionsRow: () => null,
}));

import { MapLayersSection } from "../MapLayersSection";

beforeEach(() => {
  h.setVisibleMarkerTypes.mockClear();
  h.setGpsRecordingInterval.mockClear();
  h.setCurrentsManualDirectionDeg.mockClear();
  h.setCurrentsManualSpeedKt.mockClear();
  h.setFollowResumeDelaySec.mockClear();
  h.setMarkerClusterThreshold.mockClear();
  h.data.visibleMarkerTypes = ["fish", "shipwreck", "coral"];
  h.data.gpsRecordingInterval = 2000;
  h.data.currentsManualDirectionDeg = 90;
  h.data.currentsManualSpeedKt = 1.0;
  h.data.followResumeDelaySec = 20;
  h.data.markerClusterThreshold = 25;
  h.data.layerArrowDensity = { surface: "normal", mid: "normal", "near-bottom": "sparse" };
});

describe("MapLayersSection — toggleMarkerType stale snapshot", () => {
  it("applies two rapid toggles without one overwriting the other", () => {
    render(<MapLayersSection />);
    // No re-render happens between these clicks (subscribe is a no-op), so
    // the handler must read call-time state, not the render snapshot.
    fireEvent.click(screen.getByRole("switch", { name: "Fish" }));
    fireEvent.click(screen.getByRole("switch", { name: "Shipwreck" }));

    expect(h.setVisibleMarkerTypes).toHaveBeenCalledTimes(2);
    expect(h.data.visibleMarkerTypes).not.toContain("fish");
    expect(h.data.visibleMarkerTypes).not.toContain("shipwreck");
    expect(h.data.visibleMarkerTypes).toContain("coral");
  });

  it("applies a rapid remove + add pair cumulatively", () => {
    render(<MapLayersSection />);
    fireEvent.click(screen.getByRole("switch", { name: "Fish" })); // remove
    fireEvent.click(screen.getByRole("switch", { name: "Anchorage" })); // add

    expect(h.data.visibleMarkerTypes).not.toContain("fish");
    expect(h.data.visibleMarkerTypes).toContain("anchorage");
    expect(h.data.visibleMarkerTypes).toContain("shipwreck");
  });
});

describe("MapLayersSection — layerArrowDensity fallback", () => {
  it("renders without crashing when layerArrowDensity is absent", () => {
    h.data.layerArrowDensity = undefined;
    const { container } = render(<MapLayersSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("falls back to the global currentArrowDensity for missing keys", () => {
    h.data.layerArrowDensity = undefined;
    render(<MapLayersSection />);
    const selects = screen.getAllByRole("combobox");
    // Surface / Mid-water / Near-bottom selects must show the global value.
    const layerSelects = selects.filter(
      (el) => (el as HTMLSelectElement).value === "dense",
    );
    // Global Arrow Density select + 3 per-layer selects all read "dense".
    expect(layerSelects.length).toBeGreaterThanOrEqual(4);
  });

  it("uses a per-layer override when only some keys are present", () => {
    h.data.layerArrowDensity = { surface: "sparse" };
    render(<MapLayersSection />);
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects.some((el) => el.value === "sparse")).toBe(true);
  });
});

describe("MapLayersSection — GPS sample-rate normalisation", () => {
  it("normalises an out-of-range persisted interval to the nearest option and stores it", () => {
    h.data.gpsRecordingInterval = 3000;
    render(<MapLayersSection />);
    expect(h.setGpsRecordingInterval).toHaveBeenCalledWith(2000);
  });

  it("normalises a large out-of-range interval to 10000", () => {
    h.data.gpsRecordingInterval = 60_000;
    render(<MapLayersSection />);
    expect(h.setGpsRecordingInterval).toHaveBeenCalledWith(10_000);
  });

  it("normalises NaN to the default interval", () => {
    h.data.gpsRecordingInterval = NaN;
    render(<MapLayersSection />);
    expect(h.setGpsRecordingInterval).toHaveBeenCalledWith(1000);
  });

  it("does not touch the store when the interval is already valid", () => {
    h.data.gpsRecordingInterval = 10_000;
    render(<MapLayersSection />);
    expect(h.setGpsRecordingInterval).not.toHaveBeenCalled();
  });
});

describe("MapLayersSection — direction 360° normalisation & slider clamping", () => {
  it("corrects a persisted 360° bearing to 0° in the store", () => {
    h.data.currentsManualDirectionDeg = 360;
    render(<MapLayersSection />);
    expect(h.setCurrentsManualDirectionDeg).toHaveBeenCalledWith(0);
  });

  it("caps the direction slider at 355", () => {
    render(<MapLayersSection />);
    const slider = screen.getByLabelText("Direction (°)") as HTMLInputElement;
    expect(slider.max).toBe("355");
  });

  it("clamps an out-of-range follow-resume delay to the slider bounds", () => {
    h.data.followResumeDelaySec = 999;
    render(<MapLayersSection />);
    const slider = screen.getByLabelText("Follow Resume Delay") as HTMLInputElement;
    expect(slider.value).toBe("120");
  });

  it("replaces a NaN speed with the field default", () => {
    h.data.currentsManualSpeedKt = NaN;
    render(<MapLayersSection />);
    const slider = screen.getByLabelText("Speed (kt)") as HTMLInputElement;
    expect(slider.value).toBe("0.8");
  });

  it("clamps a negative cluster threshold to 0", () => {
    h.data.markerClusterThreshold = -50;
    render(<MapLayersSection />);
    const slider = screen.getByLabelText("Cluster Threshold") as HTMLInputElement;
    expect(slider.value).toBe("0");
  });
});
