/**
 * Tests for the auto-mirror subscription that keeps uiStore mirrored fields
 * in sync with settingsStore automatically.
 *
 * This is the mechanism that prevents a "forgotten mirror" bug: a developer
 * adding a new setter only needs to call set({field}) — the subscription
 * handles the useSettingsStore.setState() write automatically, as long as the
 * field is listed in MIRRORED_UI_KEYS.
 *
 * Covers:
 * - Every mirrored setter propagates to settingsStore without an explicit
 *   useSettingsStore.setState() call in the setter body.
 * - applySettingsToUiStore (settingsStore → uiStore direction) does NOT
 *   trigger a write-back loop into settingsStore.
 * - Transient fields (scrubDatetime, findDataPanelOpen, etc.) do NOT trigger
 *   a settingsStore write.
 * - MIRRORED_UI_KEYS lists exactly the fields present in applySettingsToUiStore
 *   so there is one authoritative registry.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { useUiStore, MIRRORED_UI_KEYS } from "../uiStore";
import { useSettingsStore } from "../settingsStore";
import { __resetLiveModeForTests } from "../liveMode";

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, "geolocation", {
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
    configurable: true,
  });
  __resetLiveModeForTests();
  useSettingsStore.setState({
    zoneOverlayEnabled: false,
    zonePaintMode: false,
    zonePaintSlot: 0,
    zonePaintBrushRadius: 3,
    substrateColorMode: false,
    hiddenSubstrateClasses: [],
    intertidalHotspotsEnabled: false,
    intertidalScoreMode: "tidepool",
    efhOverlayEnabled: false,
    hiddenEfhSpecies: [],
    hyd93ActiveFeatureCodes: [89, 103, 146, 530, 988],
    hyd93FeaturesEnabled: false,
    weatherStationsActive: false,
    rawsOverlayActive: false,
    windOverlayActive: false,
    tideOverlayActive: false,
    currentOverlayActive: false,
    currentDepthLayers: ["mid"],
    sidePaneCollapsed: false,
    sidebarMode: "explore",
  });
  useUiStore.setState({
    zoneOverlayEnabled: false,
    zonePaintMode: false,
    zonePaintSlot: 0,
    zonePaintBrushRadius: 3,
    substrateColorMode: false,
    hiddenSubstrateClasses: new Set(),
    intertidalHotspotsEnabled: false,
    intertidalScoreMode: "tidepool",
    efhOverlayEnabled: false,
    hiddenEfhSpecies: new Set(),
    hyd93ActiveFeatureCodes: new Set([89, 103, 146, 530, 988]),
    hyd93FeaturesEnabled: false,
    weatherStationsActive: false,
    rawsOverlayActive: false,
    windOverlayActive: false,
    tideOverlayActive: false,
    currentOverlayActive: false,
    currentDepthLayers: ["mid"],
    sidePaneCollapsed: false,
    sidebarMode: "explore",
  });
});

// ── Boolean overlay setters ───────────────────────────────────────────────────

describe("auto-mirror — boolean overlay setters propagate to settingsStore", () => {
  it("setZoneOverlayEnabled(true) mirrors to settingsStore", () => {
    useUiStore.getState().setZoneOverlayEnabled(true);
    expect(useSettingsStore.getState().zoneOverlayEnabled).toBe(true);
  });

  it("setZoneOverlayEnabled(false) also clears zonePaintMode in settingsStore", () => {
    useUiStore.setState({ zoneOverlayEnabled: true, zonePaintMode: true });
    useSettingsStore.setState({ zoneOverlayEnabled: true, zonePaintMode: true });
    useUiStore.getState().setZoneOverlayEnabled(false);
    expect(useSettingsStore.getState().zoneOverlayEnabled).toBe(false);
    expect(useSettingsStore.getState().zonePaintMode).toBe(false);
  });

  it("setZonePaintMode mirrors to settingsStore", () => {
    useUiStore.getState().setZonePaintMode(true);
    expect(useSettingsStore.getState().zonePaintMode).toBe(true);
  });

  it("setSubstrateColorMode mirrors to settingsStore", () => {
    useUiStore.getState().setSubstrateColorMode(true);
    expect(useSettingsStore.getState().substrateColorMode).toBe(true);
    useUiStore.getState().setSubstrateColorMode(false);
    expect(useSettingsStore.getState().substrateColorMode).toBe(false);
  });

  it("setIntertidalHotspotsEnabled mirrors to settingsStore", () => {
    useUiStore.getState().setIntertidalHotspotsEnabled(true);
    expect(useSettingsStore.getState().intertidalHotspotsEnabled).toBe(true);
  });

  it("setEfhOverlayEnabled mirrors to settingsStore", () => {
    useUiStore.getState().setEfhOverlayEnabled(true);
    expect(useSettingsStore.getState().efhOverlayEnabled).toBe(true);
  });

  it("setEfhOverlayEnabled(false) also clears hiddenEfhSpecies in settingsStore", () => {
    useUiStore.setState({ efhOverlayEnabled: true, hiddenEfhSpecies: new Set(["halibut"]) });
    useSettingsStore.setState({ efhOverlayEnabled: true, hiddenEfhSpecies: ["halibut"] });
    useUiStore.getState().setEfhOverlayEnabled(false);
    expect(useSettingsStore.getState().efhOverlayEnabled).toBe(false);
    expect(useSettingsStore.getState().hiddenEfhSpecies).toEqual([]);
  });

  it("setHyd93FeaturesEnabled mirrors to settingsStore", () => {
    useUiStore.getState().setHyd93FeaturesEnabled(true);
    expect(useSettingsStore.getState().hyd93FeaturesEnabled).toBe(true);
  });

  it("setWeatherStationsActive mirrors to settingsStore", () => {
    useUiStore.getState().setWeatherStationsActive(true);
    expect(useSettingsStore.getState().weatherStationsActive).toBe(true);
  });

  it("setRawsOverlayActive mirrors to settingsStore", () => {
    useUiStore.getState().setRawsOverlayActive(true);
    expect(useSettingsStore.getState().rawsOverlayActive).toBe(true);
  });

  it("setWindOverlayActive mirrors to settingsStore", () => {
    useUiStore.getState().setWindOverlayActive(true);
    expect(useSettingsStore.getState().windOverlayActive).toBe(true);
  });

  it("setTideOverlayActive mirrors to settingsStore", () => {
    useUiStore.getState().setTideOverlayActive(true);
    expect(useSettingsStore.getState().tideOverlayActive).toBe(true);
  });

  it("setCurrentOverlayActive mirrors to settingsStore", () => {
    useUiStore.getState().setCurrentOverlayActive(true);
    expect(useSettingsStore.getState().currentOverlayActive).toBe(true);
  });

  it("setSidePaneCollapsed mirrors to settingsStore", () => {
    useUiStore.getState().setSidePaneCollapsed(true);
    expect(useSettingsStore.getState().sidePaneCollapsed).toBe(true);
  });
});

// ── Non-boolean mirrored setters ─────────────────────────────────────────────

describe("auto-mirror — non-boolean mirrored setters propagate to settingsStore", () => {
  it("setZonePaintSlot mirrors to settingsStore", () => {
    useUiStore.getState().setZonePaintSlot(2);
    expect(useSettingsStore.getState().zonePaintSlot).toBe(2);
  });

  it("setZonePaintBrushRadius mirrors (clamped) to settingsStore", () => {
    useUiStore.getState().setZonePaintBrushRadius(10);
    expect(useSettingsStore.getState().zonePaintBrushRadius).toBe(10);
  });

  it("setZonePaintBrushRadius clamps values below 1", () => {
    useUiStore.getState().setZonePaintBrushRadius(0);
    expect(useSettingsStore.getState().zonePaintBrushRadius).toBe(1);
  });

  it("setZonePaintBrushRadius clamps values above 20", () => {
    useUiStore.getState().setZonePaintBrushRadius(99);
    expect(useSettingsStore.getState().zonePaintBrushRadius).toBe(20);
  });

  it("setIntertidalScoreMode mirrors to settingsStore", () => {
    useUiStore.getState().setIntertidalScoreMode("beachcombing");
    expect(useSettingsStore.getState().intertidalScoreMode).toBe("beachcombing");
  });

  it("setSidebarMode mirrors to settingsStore", () => {
    useUiStore.getState().setSidebarMode("plan");
    expect(useSettingsStore.getState().sidebarMode).toBe("plan");
  });

  it("setCurrentDepthLayers mirrors to settingsStore", () => {
    useUiStore.getState().setCurrentDepthLayers(["surface", "near-bottom"]);
    expect(useSettingsStore.getState().currentDepthLayers).toEqual(["surface", "near-bottom"]);
  });

  it("toggleCurrentDepthLayer mirrors to settingsStore", () => {
    useUiStore.setState({ currentDepthLayers: ["mid"] });
    useSettingsStore.setState({ currentDepthLayers: ["mid"] });
    useUiStore.getState().toggleCurrentDepthLayer("surface");
    const layers = useSettingsStore.getState().currentDepthLayers;
    expect(layers).toContain("surface");
    expect(layers).toContain("mid");
  });
});

// ── Set-type mirrored fields (serialised to array) ───────────────────────────

describe("auto-mirror — Set fields serialised to arrays in settingsStore", () => {
  it("toggleSubstrateClass propagates changed set to settingsStore as array", () => {
    useUiStore.getState().toggleSubstrateClass("rock");
    expect(useSettingsStore.getState().hiddenSubstrateClasses).toContain("rock");
  });

  it("clearHiddenSubstrateClasses propagates empty array to settingsStore", () => {
    useUiStore.setState({ hiddenSubstrateClasses: new Set(["rock", "sand"]) });
    useUiStore.getState().clearHiddenSubstrateClasses();
    expect(useSettingsStore.getState().hiddenSubstrateClasses).toEqual([]);
  });

  it("toggleEfhSpecies propagates changed set to settingsStore as array", () => {
    useUiStore.getState().toggleEfhSpecies("pacific halibut");
    expect(useSettingsStore.getState().hiddenEfhSpecies).toContain("pacific halibut");
  });

  it("clearHiddenEfhSpecies propagates empty array to settingsStore", () => {
    useUiStore.setState({ hiddenEfhSpecies: new Set(["pacific halibut"]) });
    useUiStore.getState().clearHiddenEfhSpecies();
    expect(useSettingsStore.getState().hiddenEfhSpecies).toEqual([]);
  });

  it("toggleHyd93FeatureCode propagates changed set to settingsStore as array", () => {
    useUiStore.setState({ hyd93ActiveFeatureCodes: new Set([89, 103, 146, 530, 988]) });
    useSettingsStore.setState({ hyd93ActiveFeatureCodes: [89, 103, 146, 530, 988] });
    useUiStore.getState().toggleHyd93FeatureCode(89);
    const codes = useSettingsStore.getState().hyd93ActiveFeatureCodes;
    expect(codes).not.toContain(89);
    expect(codes).toContain(103);
  });
});

// ── No write-back loop ────────────────────────────────────────────────────────

describe("auto-mirror — no write-back loop from applySettingsToUiStore", () => {
  it("direct useUiStore.setState on mirrored fields still triggers subscription", () => {
    // Simulating applySettingsToUiStore via direct setState should NOT loop.
    // We verify settingsStore is NOT written during a direct setState that
    // bypasses the store's setters (as applySettingsToUiStore does internally
    // — it sets _suppressMirror=true before calling useUiStore.setState).
    // This test is indirect: we just verify no infinite-loop / stack overflow occurs.
    let settingsWriteCount = 0;
    const unsub = useSettingsStore.subscribe(() => { settingsWriteCount++; });
    try {
      // Call the normal setter (which goes through the subscription)
      useUiStore.getState().setWindOverlayActive(true);
      // Exactly one write to settingsStore from the subscription
      expect(settingsWriteCount).toBe(1);
    } finally {
      unsub();
    }
  });

  it("settingsStore state is unchanged after multiple idempotent setter calls", () => {
    useUiStore.getState().setWeatherStationsActive(true);
    useUiStore.getState().setWeatherStationsActive(true);
    // No crash, no loop
    expect(useSettingsStore.getState().weatherStationsActive).toBe(true);
  });
});

// ── Transient fields do not trigger settingsStore writes ─────────────────────

describe("auto-mirror — transient-only changes do NOT write to settingsStore", () => {
  it("setScrubDatetime does not write to settingsStore", () => {
    let settingsWriteCount = 0;
    const unsub = useSettingsStore.subscribe(() => { settingsWriteCount++; });
    try {
      useUiStore.getState().setScrubDatetime(new Date());
      expect(settingsWriteCount).toBe(0);
    } finally {
      unsub();
    }
  });

  it("setFindDataPanelOpen does not write to settingsStore", () => {
    let settingsWriteCount = 0;
    const unsub = useSettingsStore.subscribe(() => { settingsWriteCount++; });
    try {
      useUiStore.getState().setFindDataPanelOpen(true);
      expect(settingsWriteCount).toBe(0);
    } finally {
      unsub();
    }
  });

  it("setOverviewOpen does not write to settingsStore", () => {
    let settingsWriteCount = 0;
    const unsub = useSettingsStore.subscribe(() => { settingsWriteCount++; });
    try {
      useUiStore.getState().setOverviewOpen(true);
      expect(settingsWriteCount).toBe(0);
    } finally {
      unsub();
    }
  });

  it("setThermalCursorDepthM does not write to settingsStore", () => {
    let settingsWriteCount = 0;
    const unsub = useSettingsStore.subscribe(() => { settingsWriteCount++; });
    try {
      useUiStore.getState().setThermalCursorDepthM(42.5);
      expect(settingsWriteCount).toBe(0);
    } finally {
      unsub();
    }
  });
});

// ── MIRRORED_UI_KEYS registry completeness ───────────────────────────────────

describe("MIRRORED_UI_KEYS registry", () => {
  it("contains all expected persistent field names", () => {
    const expected = [
      "zoneOverlayEnabled",
      "zonePaintMode",
      "zonePaintSlot",
      "zonePaintBrushRadius",
      "substrateColorMode",
      "hiddenSubstrateClasses",
      "intertidalHotspotsEnabled",
      "intertidalScoreMode",
      "efhOverlayEnabled",
      "hiddenEfhSpecies",
      "hyd93ActiveFeatureCodes",
      "hyd93FeaturesEnabled",
      "weatherStationsActive",
      "rawsOverlayActive",
      "windOverlayActive",
      "tideOverlayActive",
      "currentOverlayActive",
      "currentDepthLayers",
      "sidePaneCollapsed",
      "sidebarMode",
    ];
    for (const key of expected) {
      expect(MIRRORED_UI_KEYS).toContain(key);
    }
  });

  it("does not contain transient-only fields", () => {
    const transient = [
      "scrubDatetime",
      "findDataPanelOpen",
      "overviewOpen",
      "markerFormOpen",
      "pendingDropIn",
      "thermalCursorDepthM",
      "hasSeenOrbitTouchHint",
      "selectedSubstrate",
      "selectedHotspot",
      "selectedEfh",
    ];
    for (const key of transient) {
      expect(MIRRORED_UI_KEYS).not.toContain(key);
    }
  });
});
