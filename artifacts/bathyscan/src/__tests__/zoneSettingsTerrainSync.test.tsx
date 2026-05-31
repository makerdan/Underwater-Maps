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
