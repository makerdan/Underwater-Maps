/**
 * Unit tests for uiStore.sidebarMode / setSidebarMode.
 *
 * Covers:
 * - Default value is 'explore'.
 * - All three mode transitions.
 * - Shortcut cycle logic (explore → plan → analyze → explore).
 * - Persistence round-trip: setSidebarMode writes through to settingsStore.
 * - Mode switch does NOT mutate any other uiStore field.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Live-mode transitions trigger toast notifications on GPS errors; mock the
// toast module so jsdom tests stay silent and side-effect free.
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { useUiStore } from "../uiStore";
import { useSettingsStore } from "../settingsStore";
import { useTrailStore } from "../trailStore";
import { useGpsStore } from "../gpsStore";
import { useCameraStore } from "../cameraStore";
import { __resetLiveModeForTests } from "../liveMode";

// Reset both stores to a known baseline before each test so tests are isolated.
beforeEach(() => {
  // Stub geolocation so setSidebarMode('live') orchestration is inert but
  // well-behaved in jsdom.
  Object.defineProperty(globalThis.navigator, "geolocation", {
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
    configurable: true,
  });
  __resetLiveModeForTests();
  useGpsStore.setState({ active: false, position: null, error: null, watchId: null });
  useCameraStore.setState({ gpsFollowMode: false });
  useUiStore.setState({ sidebarMode: "explore" });
  useSettingsStore.setState({ sidebarMode: "explore" });
});

afterEach(() => {
  __resetLiveModeForTests();
  const trail = useTrailStore.getState();
  if (trail.recording) trail.stopRecording();
  useTrailStore.getState().clearPoints();
});

describe("uiStore — sidebarMode default", () => {
  it("defaults sidebarMode to 'explore'", () => {
    expect(useUiStore.getState().sidebarMode).toBe("explore");
  });
});

describe("uiStore — sidebarMode transitions", () => {
  it("explore → plan", () => {
    useUiStore.getState().setSidebarMode("plan");
    expect(useUiStore.getState().sidebarMode).toBe("plan");
  });

  it("plan → analyze", () => {
    useUiStore.getState().setSidebarMode("plan");
    useUiStore.getState().setSidebarMode("analyze");
    expect(useUiStore.getState().sidebarMode).toBe("analyze");
  });

  it("analyze → explore", () => {
    useUiStore.getState().setSidebarMode("analyze");
    useUiStore.getState().setSidebarMode("explore");
    expect(useUiStore.getState().sidebarMode).toBe("explore");
  });

  it("analyze → live", () => {
    useUiStore.getState().setSidebarMode("analyze");
    useUiStore.getState().setSidebarMode("live");
    expect(useUiStore.getState().sidebarMode).toBe("live");
  });

  it("live → explore", () => {
    useUiStore.getState().setSidebarMode("live");
    useUiStore.getState().setSidebarMode("explore");
    expect(useUiStore.getState().sidebarMode).toBe("explore");
  });

  it("setting same mode twice leaves mode unchanged", () => {
    useUiStore.getState().setSidebarMode("plan");
    useUiStore.getState().setSidebarMode("plan");
    expect(useUiStore.getState().sidebarMode).toBe("plan");
  });
});

describe("uiStore — sidebarMode shortcut cycle logic", () => {
  it("cycles explore → plan → analyze → live → explore in order", () => {
    const MODES = ["explore", "plan", "analyze", "live"] as const;

    function cycleMode(): void {
      const store = useUiStore.getState();
      const idx = MODES.indexOf(store.sidebarMode);
      const next = MODES[(idx + 1) % MODES.length];
      store.setSidebarMode(next);
    }

    expect(useUiStore.getState().sidebarMode).toBe("explore");
    cycleMode();
    expect(useUiStore.getState().sidebarMode).toBe("plan");
    cycleMode();
    expect(useUiStore.getState().sidebarMode).toBe("analyze");
    cycleMode();
    expect(useUiStore.getState().sidebarMode).toBe("live");
    cycleMode();
    expect(useUiStore.getState().sidebarMode).toBe("explore");
  });
});

describe("uiStore — sidebarMode persistence round-trip", () => {
  it("setSidebarMode('plan') writes through to settingsStore", () => {
    useUiStore.getState().setSidebarMode("plan");
    expect(useSettingsStore.getState().sidebarMode).toBe("plan");
  });

  it("setSidebarMode('analyze') writes through to settingsStore", () => {
    useUiStore.getState().setSidebarMode("analyze");
    expect(useSettingsStore.getState().sidebarMode).toBe("analyze");
  });

  it("setSidebarMode('explore') writes through to settingsStore", () => {
    useUiStore.getState().setSidebarMode("analyze");
    useUiStore.getState().setSidebarMode("explore");
    expect(useSettingsStore.getState().sidebarMode).toBe("explore");
  });

  it("setSidebarMode('live') writes through to settingsStore", () => {
    useUiStore.getState().setSidebarMode("live");
    expect(useSettingsStore.getState().sidebarMode).toBe("live");
  });

  it("uiStore and settingsStore remain in sync after each transition", () => {
    const MODES = ["explore", "plan", "analyze", "live"] as const;
    for (const mode of MODES) {
      useUiStore.getState().setSidebarMode(mode);
      expect(useUiStore.getState().sidebarMode).toBe(mode);
      expect(useSettingsStore.getState().sidebarMode).toBe(mode);
    }
  });
});

describe("uiStore — setSidebarMode does not alter other uiStore fields", () => {
  it("overlay toggles are unchanged after switching modes", () => {
    useUiStore.setState({
      windOverlayActive: true,
      tideOverlayActive: true,
      currentOverlayActive: true,
      weatherStationsActive: false,
      rawsOverlayActive: false,
    });

    useUiStore.getState().setSidebarMode("plan");
    const s = useUiStore.getState();
    expect(s.windOverlayActive).toBe(true);
    expect(s.tideOverlayActive).toBe(true);
    expect(s.currentOverlayActive).toBe(true);
    expect(s.weatherStationsActive).toBe(false);
    expect(s.rawsOverlayActive).toBe(false);

    useUiStore.getState().setSidebarMode("analyze");
    const s2 = useUiStore.getState();
    expect(s2.windOverlayActive).toBe(true);
    expect(s2.tideOverlayActive).toBe(true);
    expect(s2.currentOverlayActive).toBe(true);
  });

  it("sidePaneCollapsed is unchanged after switching modes", () => {
    useUiStore.setState({ sidePaneCollapsed: true });
    useUiStore.getState().setSidebarMode("plan");
    expect(useUiStore.getState().sidePaneCollapsed).toBe(true);
    useUiStore.getState().setSidebarMode("analyze");
    expect(useUiStore.getState().sidePaneCollapsed).toBe(true);
  });

  it("findDataPanelOpen is unchanged after switching modes", () => {
    useUiStore.setState({ findDataPanelOpen: false });
    useUiStore.getState().setSidebarMode("plan");
    expect(useUiStore.getState().findDataPanelOpen).toBe(false);
  });

  it("markerFormOpen is unchanged after switching modes", () => {
    useUiStore.setState({ markerFormOpen: true });
    useUiStore.getState().setSidebarMode("analyze");
    expect(useUiStore.getState().markerFormOpen).toBe(true);
  });

  it("overviewOpen is unchanged after switching modes", () => {
    useUiStore.setState({ overviewOpen: true });
    useUiStore.getState().setSidebarMode("plan");
    expect(useUiStore.getState().overviewOpen).toBe(true);
  });

  it("zoneOverlayEnabled is unchanged after switching modes", () => {
    useUiStore.setState({ zoneOverlayEnabled: true });
    useUiStore.getState().setSidebarMode("analyze");
    expect(useUiStore.getState().zoneOverlayEnabled).toBe(true);
  });

  it("efhOverlayEnabled is unchanged after switching modes", () => {
    useUiStore.setState({ efhOverlayEnabled: true });
    useUiStore.getState().setSidebarMode("plan");
    expect(useUiStore.getState().efhOverlayEnabled).toBe(true);
  });

  it("scrubDatetime is unchanged after switching modes", () => {
    const dt = new Date("2026-01-01T12:00:00Z");
    useUiStore.setState({ scrubDatetime: dt });
    useUiStore.getState().setSidebarMode("analyze");
    expect(useUiStore.getState().scrubDatetime).toBe(dt);
  });

  it("thermalCursorDepthM is unchanged after switching modes", () => {
    useUiStore.setState({ thermalCursorDepthM: 42.5 });
    useUiStore.getState().setSidebarMode("plan");
    expect(useUiStore.getState().thermalCursorDepthM).toBe(42.5);
  });
});
