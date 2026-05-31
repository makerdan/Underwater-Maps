/**
 * Unit tests for zoneOverlayStore and substrateClassToSlot.
 *
 * Covers:
 *   - Initial state matches ZONE_DEFAULT_COLORS / all slots visible
 *   - setSlotColor mutates only the targeted slot and persists to localStorage
 *   - setSlotVisible mutates only the targeted slot and persists to localStorage
 *   - resetToDefaults restores all slots to defaults and writes localStorage
 *   - localStorage round-trip: mutations are stored; resetToDefaults is reflected
 *   - substrateClassToSlot: known substrate strings map to expected slots
 *   - substrateClassToSlot: handles compound labels, mixed case, and unknowns
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  useZoneOverlayStore,
  ZONE_DEFAULT_COLORS,
  substrateClassToSlot,
} from "@/lib/zoneOverlayStore";

const LS_KEY = "bathyscan:zoneOverlaySlots";

function resetStore() {
  try {
    localStorage.clear();
  } catch { /* ignore */ }
  useZoneOverlayStore.getState().resetToDefaults();
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

  it("writes the new state to localStorage", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#112233");
    const raw = localStorage.getItem(LS_KEY);
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

  it("writes the new visibility to localStorage", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    const raw = localStorage.getItem(LS_KEY);
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
    const raw = localStorage.getItem(LS_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Array<{ color: string; visible: boolean }>;
    expect(parsed[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
    expect(parsed[3]!.color).toBe(ZONE_DEFAULT_COLORS[3]);
    expect(parsed.every((s) => s.visible)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// localStorage round-trip
// ---------------------------------------------------------------------------

describe("zoneOverlayStore — localStorage round-trip", () => {
  beforeEach(() => resetStore());

  it("setSlotColor writes a 4-element JSON array to localStorage", () => {
    useZoneOverlayStore.getState().setSlotColor(2, "#aabbcc");
    const raw = localStorage.getItem(LS_KEY);
    expect(raw).not.toBeNull();
    const parsed: unknown = JSON.parse(raw as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBe(4);
  });

  it("localStorage reflects the final state after a sequence of mutations", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#010203");
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    useZoneOverlayStore.getState().setSlotColor(3, "#040506");

    const raw = localStorage.getItem(LS_KEY);
    const parsed = JSON.parse(raw as string) as Array<{ color: string; visible: boolean }>;
    expect(parsed[0]!.color).toBe("#010203");
    expect(parsed[1]!.visible).toBe(false);
    expect(parsed[2]!.color).toBe(ZONE_DEFAULT_COLORS[2]);
    expect(parsed[3]!.color).toBe("#040506");
  });

  it("resetToDefaults overwrites any previous localStorage value", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#ffffff");
    useZoneOverlayStore.getState().resetToDefaults();

    const raw = localStorage.getItem(LS_KEY);
    const parsed = JSON.parse(raw as string) as Array<{ color: string; visible: boolean }>;
    expect(parsed[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
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
