/**
 * Unit tests for zoneOverlayStore and substrateClassToSlot.
 *
 * Covers:
 *   - Initial state matches ZONE_DEFAULT_COLORS / all slots visible (saltwater active)
 *   - setSlotColor mutates only the targeted slot in the active set and persists
 *   - setSlotVisible mutates only the targeted slot in the active set and persists
 *   - resetToDefaults resets only the active water-type set
 *   - localStorage round-trip: per-waterType keys are used correctly
 *   - setActiveWaterType switches the active palette without touching the other set
 *   - Saltwater and freshwater palettes are independent — changes to one do not
 *     bleed into the other
 *   - Legacy flat-array LS key is migrated to saltwater on first load
 *   - substrateClassToSlot: known substrate strings map to expected slots
 *   - substrateClassToSlot: handles compound labels, mixed case, and unknowns
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  useZoneOverlayStore,
  ZONE_DEFAULT_COLORS,
  substrateClassToSlot,
} from "@/lib/zoneOverlayStore";

const LS_KEY_SW = "bathyscan:zoneOverlaySlots:saltwater";
const LS_KEY_FW = "bathyscan:zoneOverlaySlots:freshwater";

function resetStore() {
  try {
    localStorage.clear();
  } catch { /* ignore */ }
  // Reset to saltwater active and defaults for both sets
  useZoneOverlayStore.setState({
    saltwater: [
      { color: "#f5d58a", visible: true },
      { color: "#c49a6c", visible: true },
      { color: "#8ab4d0", visible: true },
      { color: "#b06060", visible: true },
    ],
    freshwater: [
      { color: "#f5d58a", visible: true },
      { color: "#c49a6c", visible: true },
      { color: "#8ab4d0", visible: true },
      { color: "#b06060", visible: true },
    ],
    activeWaterType: "saltwater",
    slots: [
      { color: "#f5d58a", visible: true },
      { color: "#c49a6c", visible: true },
      { color: "#8ab4d0", visible: true },
      { color: "#b06060", visible: true },
    ],
  });
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("zoneOverlayStore — initial state", () => {
  beforeEach(() => resetStore());

  it("exposes exactly four slots", () => {
    expect(useZoneOverlayStore.getState().slots).toHaveLength(4);
  });

  it("each slot defaults to visible=true", () => {
    const { slots } = useZoneOverlayStore.getState();
    for (const slot of slots) {
      expect(slot.visible).toBe(true);
    }
  });

  it("slot colors match ZONE_DEFAULT_COLORS in order", () => {
    const { slots } = useZoneOverlayStore.getState();
    for (let i = 0; i < 4; i++) {
      expect(slots[i]!.color).toBe(ZONE_DEFAULT_COLORS[i]);
    }
  });

  it("slot 0 (sand) defaults to the warm-yellow tint", () => {
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#f5d58a");
  });

  it("slot 1 (sediment) defaults to the earthy-amber tint", () => {
    expect(useZoneOverlayStore.getState().slots[1]!.color).toBe("#c49a6c");
  });

  it("slot 2 (silt) defaults to the cool-blue-grey tint", () => {
    expect(useZoneOverlayStore.getState().slots[2]!.color).toBe("#8ab4d0");
  });

  it("slot 3 (basalt) defaults to the muted-terracotta tint", () => {
    expect(useZoneOverlayStore.getState().slots[3]!.color).toBe("#b06060");
  });

  it("activeWaterType defaults to saltwater", () => {
    expect(useZoneOverlayStore.getState().activeWaterType).toBe("saltwater");
  });
});

// ---------------------------------------------------------------------------
// setSlotColor
// ---------------------------------------------------------------------------

describe("zoneOverlayStore — setSlotColor", () => {
  beforeEach(() => resetStore());

  it("updates only the targeted slot's color", () => {
    useZoneOverlayStore.getState().setSlotColor(1, "#abcdef");
    const { slots } = useZoneOverlayStore.getState();
    expect(slots[1]!.color).toBe("#abcdef");
    expect(slots[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
    expect(slots[2]!.color).toBe(ZONE_DEFAULT_COLORS[2]);
    expect(slots[3]!.color).toBe(ZONE_DEFAULT_COLORS[3]);
  });

  it("leaves the targeted slot's visibility unchanged", () => {
    useZoneOverlayStore.getState().setSlotColor(2, "#ff0000");
    expect(useZoneOverlayStore.getState().slots[2]!.visible).toBe(true);
  });

  it("writes the new state to localStorage under the saltwater key", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#112233");
    const raw = localStorage.getItem(LS_KEY_SW);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Array<{ color: string; visible: boolean }>;
    expect(parsed[0]!.color).toBe("#112233");
  });

  it("can update all four slots independently", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#000001");
    useZoneOverlayStore.getState().setSlotColor(1, "#000002");
    useZoneOverlayStore.getState().setSlotColor(2, "#000003");
    useZoneOverlayStore.getState().setSlotColor(3, "#000004");
    const { slots } = useZoneOverlayStore.getState();
    expect(slots[0]!.color).toBe("#000001");
    expect(slots[1]!.color).toBe("#000002");
    expect(slots[2]!.color).toBe("#000003");
    expect(slots[3]!.color).toBe("#000004");
  });
});

// ---------------------------------------------------------------------------
// setSlotVisible
// ---------------------------------------------------------------------------

describe("zoneOverlayStore — setSlotVisible", () => {
  beforeEach(() => resetStore());

  it("hides the targeted slot", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    expect(useZoneOverlayStore.getState().slots[0]!.visible).toBe(false);
  });

  it("re-shows a previously hidden slot", () => {
    useZoneOverlayStore.getState().setSlotVisible(3, false);
    useZoneOverlayStore.getState().setSlotVisible(3, true);
    expect(useZoneOverlayStore.getState().slots[3]!.visible).toBe(true);
  });

  it("only affects the targeted slot, leaving others unchanged", () => {
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    const { slots } = useZoneOverlayStore.getState();
    expect(slots[0]!.visible).toBe(true);
    expect(slots[1]!.visible).toBe(true);
    expect(slots[2]!.visible).toBe(false);
    expect(slots[3]!.visible).toBe(true);
  });

  it("does not change the targeted slot's color", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    expect(useZoneOverlayStore.getState().slots[1]!.color).toBe(ZONE_DEFAULT_COLORS[1]);
  });

  it("writes the new visibility to localStorage under the saltwater key", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    const raw = localStorage.getItem(LS_KEY_SW);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Array<{ color: string; visible: boolean }>;
    expect(parsed[0]!.visible).toBe(false);
    expect(parsed[1]!.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetToDefaults
// ---------------------------------------------------------------------------

describe("zoneOverlayStore — resetToDefaults", () => {
  beforeEach(() => resetStore());

  it("restores all colors to ZONE_DEFAULT_COLORS after mutations", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#111111");
    useZoneOverlayStore.getState().setSlotColor(3, "#333333");
    useZoneOverlayStore.getState().resetToDefaults();
    const { slots } = useZoneOverlayStore.getState();
    for (let i = 0; i < 4; i++) {
      expect(slots[i]!.color).toBe(ZONE_DEFAULT_COLORS[i]);
    }
  });

  it("restores all slots to visible=true after hiding some", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    useZoneOverlayStore.getState().resetToDefaults();
    const { slots } = useZoneOverlayStore.getState();
    for (const slot of slots) {
      expect(slot.visible).toBe(true);
    }
  });

  it("writes the default slots to localStorage", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#deadbe");
    useZoneOverlayStore.getState().resetToDefaults();
    const raw = localStorage.getItem(LS_KEY_SW);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Array<{ color: string; visible: boolean }>;
    expect(parsed[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
    expect(parsed[3]!.color).toBe(ZONE_DEFAULT_COLORS[3]);
    expect(parsed.every((s) => s.visible)).toBe(true);
  });

  it("does not reset the other water-type's palette", () => {
    // Switch to freshwater, change a colour, switch back and reset saltwater
    useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    useZoneOverlayStore.getState().setSlotColor(0, "#abcdef");
    useZoneOverlayStore.getState().setActiveWaterType("saltwater");
    useZoneOverlayStore.getState().resetToDefaults();
    // Freshwater colour should be untouched
    expect(useZoneOverlayStore.getState().freshwater[0]!.color).toBe("#abcdef");
  });
});

// ---------------------------------------------------------------------------
// localStorage round-trip
// ---------------------------------------------------------------------------

describe("zoneOverlayStore — localStorage round-trip", () => {
  beforeEach(() => resetStore());

  it("setSlotColor writes a 4-element JSON array to the saltwater LS key", () => {
    useZoneOverlayStore.getState().setSlotColor(2, "#aabbcc");
    const raw = localStorage.getItem(LS_KEY_SW);
    expect(raw).not.toBeNull();
    const parsed: unknown = JSON.parse(raw as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBe(4);
  });

  it("saltwater and freshwater use separate LS keys", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#aaa111");
    useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    useZoneOverlayStore.getState().setSlotColor(0, "#bbb222");

    const swRaw = localStorage.getItem(LS_KEY_SW);
    const fwRaw = localStorage.getItem(LS_KEY_FW);
    expect(swRaw).not.toBeNull();
    expect(fwRaw).not.toBeNull();

    const sw = JSON.parse(swRaw as string) as Array<{ color: string }>;
    const fw = JSON.parse(fwRaw as string) as Array<{ color: string }>;
    expect(sw[0]!.color).toBe("#aaa111");
    expect(fw[0]!.color).toBe("#bbb222");
  });

  it("localStorage reflects the final state after a sequence of mutations", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#010203");
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    useZoneOverlayStore.getState().setSlotColor(3, "#040506");

    const raw = localStorage.getItem(LS_KEY_SW);
    const parsed = JSON.parse(raw as string) as Array<{ color: string; visible: boolean }>;
    expect(parsed[0]!.color).toBe("#010203");
    expect(parsed[1]!.visible).toBe(false);
    expect(parsed[2]!.color).toBe(ZONE_DEFAULT_COLORS[2]);
    expect(parsed[3]!.color).toBe("#040506");
  });

  it("resetToDefaults overwrites the active palette in localStorage", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#ffffff");
    useZoneOverlayStore.getState().resetToDefaults();

    const raw = localStorage.getItem(LS_KEY_SW);
    const parsed = JSON.parse(raw as string) as Array<{ color: string; visible: boolean }>;
    expect(parsed[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
  });
});

// ---------------------------------------------------------------------------
// setActiveWaterType and palette independence
// ---------------------------------------------------------------------------

describe("zoneOverlayStore — per-water-type palette independence", () => {
  beforeEach(() => resetStore());

  it("setActiveWaterType switches slots to the freshwater palette", () => {
    useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    expect(useZoneOverlayStore.getState().activeWaterType).toBe("freshwater");
    expect(useZoneOverlayStore.getState().slots).toBe(
      useZoneOverlayStore.getState().freshwater,
    );
  });

  it("colour change on saltwater does not affect freshwater slots", () => {
    useZoneOverlayStore.getState().setActiveWaterType("saltwater");
    useZoneOverlayStore.getState().setSlotColor(0, "#salt00");
    expect(useZoneOverlayStore.getState().freshwater[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
  });

  it("colour change on freshwater does not affect saltwater slots", () => {
    useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    useZoneOverlayStore.getState().setSlotColor(0, "#fresh0");
    expect(useZoneOverlayStore.getState().saltwater[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
  });

  it("slots mirror the active set after a water-type switch", () => {
    useZoneOverlayStore.getState().setActiveWaterType("saltwater");
    useZoneOverlayStore.getState().setSlotColor(1, "#salt01");
    useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    useZoneOverlayStore.getState().setSlotColor(1, "#fresh1");

    // Switch back to saltwater — slots should reflect saltwater palette
    useZoneOverlayStore.getState().setActiveWaterType("saltwater");
    expect(useZoneOverlayStore.getState().slots[1]!.color).toBe("#salt01");

    // Switch to freshwater — slots should reflect freshwater palette
    useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    expect(useZoneOverlayStore.getState().slots[1]!.color).toBe("#fresh1");
  });

  it("store has no datasetId concept: slots read without dataset argument", () => {
    const state = useZoneOverlayStore.getState();
    expect("slots" in state).toBe(true);
    expect(typeof state.setSlotColor).toBe("function");
    expect(typeof state.setSlotVisible).toBe("function");
    expect(typeof state.resetToDefaults).toBe("function");
    expect(typeof state.setActiveWaterType).toBe("function");
    expect(Object.keys(state).filter((k) => k.toLowerCase().includes("dataset"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// hydrateFromServer
// ---------------------------------------------------------------------------

describe("zoneOverlayStore — hydrateFromServer", () => {
  beforeEach(() => resetStore());

  it("new object format hydrates both sets independently", () => {
    useZoneOverlayStore.getState().hydrateFromServer({
      saltwater: [
        { color: "#aaa000", visible: true },
        { color: "#aaa001", visible: false },
        { color: "#aaa002", visible: true },
        { color: "#aaa003", visible: true },
      ],
      freshwater: [
        { color: "#bbb000", visible: true },
        { color: "#bbb001", visible: true },
        { color: "#bbb002", visible: false },
        { color: "#bbb003", visible: true },
      ],
    });
    const state = useZoneOverlayStore.getState();
    expect(state.saltwater[0]!.color).toBe("#aaa000");
    expect(state.saltwater[1]!.visible).toBe(false);
    expect(state.freshwater[0]!.color).toBe("#bbb000");
    expect(state.freshwater[2]!.visible).toBe(false);
  });

  it("legacy flat array is applied to saltwater only", () => {
    const legacy = [
      { color: "#aabbcc", visible: true },
      { color: "#112233", visible: true },
      { color: "#445566", visible: true },
      { color: "#778899", visible: true },
    ];
    useZoneOverlayStore.getState().hydrateFromServer(legacy);
    const state = useZoneOverlayStore.getState();
    expect(state.saltwater[0]!.color).toBe("#aabbcc");
    expect(state.freshwater[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
  });

  it("slots mirrors the active set after hydration", () => {
    useZoneOverlayStore.getState().setActiveWaterType("saltwater");
    useZoneOverlayStore.getState().hydrateFromServer({
      saltwater: [
        { color: "#aa0000", visible: true },
        { color: "#aa0001", visible: true },
        { color: "#aa0002", visible: true },
        { color: "#aa0003", visible: true },
      ],
      freshwater: [
        { color: "#bb0000", visible: true },
        { color: "#bb0001", visible: true },
        { color: "#bb0002", visible: true },
        { color: "#bb0003", visible: true },
      ],
    });
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#aa0000");
  });
});

// ---------------------------------------------------------------------------
// substrateClassToSlot — canonical substrate names
// ---------------------------------------------------------------------------

describe("substrateClassToSlot — canonical substrate strings", () => {
  it("'sand' maps to slot 0", () => {
    expect(substrateClassToSlot("sand")).toBe(0);
  });

  it("'gravel' maps to slot 1", () => {
    expect(substrateClassToSlot("gravel")).toBe(1);
  });

  it("'silt' maps to slot 2", () => {
    expect(substrateClassToSlot("silt")).toBe(2);
  });

  it("'bedrock' maps to slot 3", () => {
    expect(substrateClassToSlot("bedrock")).toBe(3);
  });

  it("'reef' maps to slot 0 (sand group)", () => {
    expect(substrateClassToSlot("reef")).toBe(0);
  });

  it("'coral' maps to slot 0 (sand group)", () => {
    expect(substrateClassToSlot("coral")).toBe(0);
  });

  it("'shell' maps to slot 0 (sand group)", () => {
    expect(substrateClassToSlot("shell")).toBe(0);
  });

  it("'aquatic vegetation' maps to slot 0 (sand group)", () => {
    expect(substrateClassToSlot("aquatic vegetation")).toBe(0);
  });

  it("'coarse' maps to slot 1 (sediment group)", () => {
    expect(substrateClassToSlot("coarse")).toBe(1);
  });

  it("'cobble' maps to slot 1 (sediment group)", () => {
    expect(substrateClassToSlot("cobble")).toBe(1);
  });

  it("'sediment' maps to slot 1 (sediment group)", () => {
    expect(substrateClassToSlot("sediment")).toBe(1);
  });

  it("'wood' maps to slot 1 (sediment group)", () => {
    expect(substrateClassToSlot("wood")).toBe(1);
  });

  it("'mud' maps to slot 2 (silt group)", () => {
    expect(substrateClassToSlot("mud")).toBe(2);
  });

  it("'clay' maps to slot 2 (silt group)", () => {
    expect(substrateClassToSlot("clay")).toBe(2);
  });

  it("'soft substrate' maps to slot 2 (silt group)", () => {
    expect(substrateClassToSlot("soft substrate")).toBe(2);
  });

  it("'tidal flat' maps to slot 2 (silt group)", () => {
    expect(substrateClassToSlot("tidal flat")).toBe(2);
  });

  it("'rock' maps to slot 3 (basalt group)", () => {
    expect(substrateClassToSlot("rock")).toBe(3);
  });

  it("'basalt' maps to slot 3 (basalt group)", () => {
    expect(substrateClassToSlot("basalt")).toBe(3);
  });

  it("'hard substrate' maps to slot 3 (basalt group)", () => {
    expect(substrateClassToSlot("hard substrate")).toBe(3);
  });

  it("'boulder' maps to slot 3 (basalt group)", () => {
    expect(substrateClassToSlot("boulder")).toBe(3);
  });

  it("'stone' maps to slot 3 (basalt group)", () => {
    expect(substrateClassToSlot("stone")).toBe(3);
  });

  it("'volcanic' maps to slot 3 (basalt group)", () => {
    expect(substrateClassToSlot("volcanic")).toBe(3);
  });
});

describe("substrateClassToSlot — case-insensitivity and compound labels", () => {
  it("uppercase 'SAND' maps to slot 0", () => {
    expect(substrateClassToSlot("SAND")).toBe(0);
  });

  it("mixed-case 'Sandy Gravel' still resolves (first match wins: sand → 0)", () => {
    expect(substrateClassToSlot("Sandy Gravel")).toBe(0);
  });

  it("'Coarse Gravel' maps to slot 1", () => {
    expect(substrateClassToSlot("Coarse Gravel")).toBe(1);
  });

  it("'Soft Silt' maps to slot 2", () => {
    expect(substrateClassToSlot("Soft Silt")).toBe(2);
  });

  it("'Basaltic Bedrock' maps to slot 3", () => {
    expect(substrateClassToSlot("Basaltic Bedrock")).toBe(3);
  });

  it("empty string falls back to slot 0 (default)", () => {
    expect(substrateClassToSlot("")).toBe(0);
  });

  it("completely unknown substrate label falls back to slot 0 (default)", () => {
    expect(substrateClassToSlot("unknown exotic material xyz")).toBe(0);
  });
});
