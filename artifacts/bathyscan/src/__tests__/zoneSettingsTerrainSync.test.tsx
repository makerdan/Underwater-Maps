/**
 * Zone Settings → Terrain Live Sync
 *
 * Verifies that visibility and colour changes made in Settings → Visuals
 * (ZoneColoursCard) immediately update zoneOverlayStore — the single source
 * of truth that TerrainMesh.tsx reads via `getState()` on every R3F frame.
 *
 * Because TerrainMesh runs inside an R3F Canvas and calls
 *   `useZoneOverlayStore.getState().slots`
 * on EVERY frame in its `useFrame` loop, any store mutation is picked up
 * within one render frame — no page reload or panel re-open required.
 *
 * These tests act as a contract:
 *   1. Settings → store update is synchronous and correct.
 *   2. `getState()` (the terrain's read path) always reflects the latest state.
 *   3. Both colour and visibility changes are propagated.
 *   4. Both saltwater and freshwater palettes are handled independently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "test@example.com" }, username: "test" },
    isSignedIn: true,
  }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetSettings: () => ({ data: null }),
  usePutSettings: () => ({ mutate: vi.fn() }),
  useDeleteMarkersMine: () => ({ mutate: vi.fn(), isPending: false }),
  getGetSettingsQueryKey: () => ["/api/settings"],
  getGetMarkersQueryKey: () => ["/api/markers"],
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { activeGrid: null }) => unknown) => sel({ activeGrid: null }),
}));

vi.mock("idb-keyval", () => ({
  keys: () => Promise.resolve([]),
  clear: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(),
}));

vi.mock("@/hooks/useUpscaledHeatmap", () => ({
  clearUpscaleCache: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { useZoneOverlayStore, ZONE_DEFAULT_COLORS } from "@/lib/zoneOverlayStore";

function resetStores() {
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
  useZoneOverlayStore.setState({
    saltwater: ZONE_DEFAULT_COLORS.map((color) => ({ color, visible: true })) as [
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
    ],
    freshwater: ZONE_DEFAULT_COLORS.map((color) => ({ color, visible: true })) as [
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
    ],
    activeWaterType: "saltwater",
    slots: ZONE_DEFAULT_COLORS.map((color) => ({ color, visible: true })) as [
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
    ],
  });
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  resetStores();
});

// ---------------------------------------------------------------------------
// Visibility sync (what uZoneVisible uniform reads via getState())
// ---------------------------------------------------------------------------

describe("Settings → terrain live sync — visibility", () => {
  it("hiding slot 0 immediately updates getState().slots[0].visible to false", async () => {
    render(<Settings />);
    const row = screen.getByTestId("settings-zone-row-0");
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[0]!.visible).toBe(false);
    });
  });

  it("hiding slot 3 immediately updates getState().slots[3].visible to false", async () => {
    render(<Settings />);
    const row = screen.getByTestId("settings-zone-row-3");
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[3]!.visible).toBe(false);
    });
  });

  it("re-showing a hidden slot immediately updates getState().slots[1].visible to true", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(1, false);
    });
    render(<Settings />);
    const row = screen.getByTestId("settings-zone-row-1");
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(true);
    });
  });

  it("toggling multiple slots updates each slot's getState() entry independently", async () => {
    render(<Settings />);
    fireEvent.click(within(screen.getByTestId("settings-zone-row-0")).getByRole("switch"));
    fireEvent.click(within(screen.getByTestId("settings-zone-row-2")).getByRole("switch"));
    await waitFor(() => {
      const s = useZoneOverlayStore.getState().slots;
      expect(s[0]!.visible).toBe(false);
      expect(s[1]!.visible).toBe(true);
      expect(s[2]!.visible).toBe(false);
      expect(s[3]!.visible).toBe(true);
    });
  });

  it("hiding a slot does not change the slot's colour in getState()", async () => {
    const originalColor = useZoneOverlayStore.getState().slots[2]!.color;
    render(<Settings />);
    fireEvent.click(within(screen.getByTestId("settings-zone-row-2")).getByRole("switch"));
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[2]!.visible).toBe(false);
      expect(useZoneOverlayStore.getState().slots[2]!.color).toBe(originalColor);
    });
  });
});

// ---------------------------------------------------------------------------
// Colour sync (what uZoneTint0..3 uniforms read via getState())
// ---------------------------------------------------------------------------

describe("Settings → terrain live sync — colour", () => {
  it("changing slot 0 colour immediately updates getState().slots[0].color", async () => {
    render(<Settings />);
    const input = screen.getByTestId("settings-zone-colour-input-0") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#112233" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#112233");
    });
  });

  it("changing slot 3 colour immediately updates getState().slots[3].color", async () => {
    render(<Settings />);
    const input = screen.getByTestId("settings-zone-colour-input-3") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#aabbcc" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[3]!.color).toBe("#aabbcc");
    });
  });

  it("colour change does not affect visibility of that slot in getState()", async () => {
    render(<Settings />);
    const input = screen.getByTestId("settings-zone-colour-input-1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#deadbe" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[1]!.color).toBe("#deadbe");
      expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(true);
    });
  });

  it("colour change on a hidden slot is preserved when visibility is re-enabled", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(0, false);
    });
    render(<Settings />);
    const input = screen.getByTestId("settings-zone-colour-input-0") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#ff0099" } });
    const row = screen.getByTestId("settings-zone-row-0");
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => {
      const slot = useZoneOverlayStore.getState().slots[0]!;
      expect(slot.color).toBe("#ff0099");
      expect(slot.visible).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Reset — getState() reflects defaults after reset
// ---------------------------------------------------------------------------

describe("Settings → terrain live sync — reset to defaults", () => {
  it("reset restores all colours to defaults in getState()", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(0, "#111111");
      useZoneOverlayStore.getState().setSlotColor(2, "#222222");
    });
    render(<Settings />);
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    await waitFor(() => {
      const slots = useZoneOverlayStore.getState().slots;
      ZONE_DEFAULT_COLORS.forEach((color, i) => {
        expect(slots[i as 0 | 1 | 2 | 3]!.color.toLowerCase()).toBe(color.toLowerCase());
      });
    });
  });

  it("reset restores all slots to visible in getState()", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(1, false);
      useZoneOverlayStore.getState().setSlotVisible(3, false);
    });
    render(<Settings />);
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    await waitFor(() => {
      const slots = useZoneOverlayStore.getState().slots;
      expect(slots[1]!.visible).toBe(true);
      expect(slots[3]!.visible).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Freshwater mode — changes go to the freshwater palette in getState()
// ---------------------------------------------------------------------------

describe("Settings → terrain live sync — freshwater palette", () => {
  beforeEach(() => {
    act(() => {
      useSettingsStore.setState({ ...useSettingsStore.getState(), waterType: "freshwater" });
      useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    });
  });

  it("hiding slot 0 in freshwater mode updates getState().freshwater[0].visible", async () => {
    render(<Settings />);
    const row = screen.getByTestId("settings-zone-row-0");
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().freshwater[0]!.visible).toBe(false);
    });
  });

  it("freshwater change does not affect saltwater getState().saltwater slots", async () => {
    render(<Settings />);
    const row = screen.getByTestId("settings-zone-row-0");
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().freshwater[0]!.visible).toBe(false);
      expect(useZoneOverlayStore.getState().saltwater[0]!.visible).toBe(true);
    });
  });

  it("freshwater colour change updates getState().freshwater[2].color", async () => {
    render(<Settings />);
    const input = screen.getByTestId("settings-zone-colour-input-2") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#336699" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().freshwater[2]!.color).toBe("#336699");
      expect(useZoneOverlayStore.getState().saltwater[2]!.color).toBe(ZONE_DEFAULT_COLORS[2]);
    });
  });
});

// ---------------------------------------------------------------------------
// Direct store API → terrain frame read path
//
// These tests simulate what TerrainMesh.useFrame does on every tick:
//   const { slots } = useZoneOverlayStore.getState();
// They call the store actions directly (no Settings UI) and assert that
// getState() immediately returns the mutated value — exactly the contract
// TerrainMesh relies on to update uZoneTint*/uZoneVisible uniforms.
// ---------------------------------------------------------------------------

describe("Direct store API → terrain frame read path — saltwater (setSlotColor)", () => {
  it("setSlotColor(0) is immediately visible via getState().slots[0].color", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#aabb11");
    const { slots } = useZoneOverlayStore.getState();
    expect(slots[0]!.color).toBe("#aabb11");
  });

  it("setSlotColor(1) is immediately visible via getState().slots[1].color", () => {
    useZoneOverlayStore.getState().setSlotColor(1, "#aabb22");
    expect(useZoneOverlayStore.getState().slots[1]!.color).toBe("#aabb22");
  });

  it("setSlotColor(2) is immediately visible via getState().slots[2].color", () => {
    useZoneOverlayStore.getState().setSlotColor(2, "#aabb33");
    expect(useZoneOverlayStore.getState().slots[2]!.color).toBe("#aabb33");
  });

  it("setSlotColor(3) is immediately visible via getState().slots[3].color", () => {
    useZoneOverlayStore.getState().setSlotColor(3, "#aabb44");
    expect(useZoneOverlayStore.getState().slots[3]!.color).toBe("#aabb44");
  });

  it("setSlotColor updates only the targeted slot; other slots retain their colours", () => {
    useZoneOverlayStore.getState().setSlotColor(1, "#deadbe");
    const { slots } = useZoneOverlayStore.getState();
    expect(slots[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
    expect(slots[1]!.color).toBe("#deadbe");
    expect(slots[2]!.color).toBe(ZONE_DEFAULT_COLORS[2]);
    expect(slots[3]!.color).toBe(ZONE_DEFAULT_COLORS[3]);
  });

  it("successive setSlotColor calls produce the latest value on each getState() read", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#111111");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#111111");
    useZoneOverlayStore.getState().setSlotColor(0, "#222222");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#222222");
    useZoneOverlayStore.getState().setSlotColor(0, "#333333");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#333333");
  });
});

describe("Direct store API → terrain frame read path — saltwater (setSlotVisible)", () => {
  it("setSlotVisible(0, false) is immediately visible via getState().slots[0].visible", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    expect(useZoneOverlayStore.getState().slots[0]!.visible).toBe(false);
  });

  it("setSlotVisible(3, false) is immediately visible via getState().slots[3].visible", () => {
    useZoneOverlayStore.getState().setSlotVisible(3, false);
    expect(useZoneOverlayStore.getState().slots[3]!.visible).toBe(false);
  });

  it("setSlotVisible(1, false) then setSlotVisible(1, true) reflects true on next read", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(false);
    useZoneOverlayStore.getState().setSlotVisible(1, true);
    expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(true);
  });

  it("hiding multiple slots is reflected independently in a single getState() read", () => {
    useZoneOverlayStore.getState().setSlotVisible(0, false);
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    const { slots } = useZoneOverlayStore.getState();
    expect(slots[0]!.visible).toBe(false);
    expect(slots[1]!.visible).toBe(true);
    expect(slots[2]!.visible).toBe(false);
    expect(slots[3]!.visible).toBe(true);
  });

  it("setSlotVisible does not change the slot's colour in getState()", () => {
    const before = useZoneOverlayStore.getState().slots[2]!.color;
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    expect(useZoneOverlayStore.getState().slots[2]!.color).toBe(before);
  });
});

describe("Direct store API → terrain frame read path — freshwater palette", () => {
  beforeEach(() => {
    act(() => {
      useZoneOverlayStore.getState().setActiveWaterType("freshwater");
    });
  });

  it("setSlotColor in freshwater mode is immediately reflected in getState().slots", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#11ff00");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#11ff00");
  });

  it("freshwater setSlotColor is in getState().freshwater but not getState().saltwater", () => {
    useZoneOverlayStore.getState().setSlotColor(1, "#22ff00");
    const state = useZoneOverlayStore.getState();
    expect(state.freshwater[1]!.color).toBe("#22ff00");
    expect(state.saltwater[1]!.color).toBe(ZONE_DEFAULT_COLORS[1]);
  });

  it("setSlotVisible(2, false) in freshwater mode is in getState().freshwater but not saltwater", () => {
    useZoneOverlayStore.getState().setSlotVisible(2, false);
    const state = useZoneOverlayStore.getState();
    expect(state.freshwater[2]!.visible).toBe(false);
    expect(state.saltwater[2]!.visible).toBe(true);
  });

  it("switching back to saltwater makes getState().slots reflect saltwater palette", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#33ff00");
    useZoneOverlayStore.getState().setActiveWaterType("saltwater");
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe(ZONE_DEFAULT_COLORS[0]);
  });
});

describe("Direct store API → terrain frame read path — reset", () => {
  it("resetToDefaults immediately restores all colours in getState().slots", () => {
    useZoneOverlayStore.getState().setSlotColor(0, "#deadbe");
    useZoneOverlayStore.getState().setSlotColor(3, "#c0ffee");
    useZoneOverlayStore.getState().resetToDefaults();
    const { slots } = useZoneOverlayStore.getState();
    ZONE_DEFAULT_COLORS.forEach((color, i) => {
      expect(slots[i as 0 | 1 | 2 | 3]!.color.toLowerCase()).toBe(color.toLowerCase());
    });
  });

  it("resetToDefaults immediately restores all slots to visible in getState().slots", () => {
    useZoneOverlayStore.getState().setSlotVisible(1, false);
    useZoneOverlayStore.getState().setSlotVisible(3, false);
    useZoneOverlayStore.getState().resetToDefaults();
    const { slots } = useZoneOverlayStore.getState();
    for (let i = 0; i < 4; i++) {
      expect(slots[i as 0 | 1 | 2 | 3]!.visible).toBe(true);
    }
  });
});
