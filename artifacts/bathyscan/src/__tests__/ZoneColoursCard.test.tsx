/**
 * Tests for the ZoneColourSwatches component in the Display & Overlays tab (Settings page).
 * The Visuals tab must NOT render the card (single canonical home).
 *
 * Covers:
 *   - All four slot swatches render with colour inputs
 *   - Colour inputs are bound to the current store values
 *   - Changing a colour input updates zoneOverlayStore
 *   - "Reset" restores the four default colours
 *   - Water-type mode label changes (saltwater vs freshwater slot names)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat();
});

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
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
    useGetSettings: () => ({ data: null }),
  }),
);

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
import { useZoneOverlayStore, DEFAULT_SLOTS, ZONE_DEFAULT_COLORS } from "@/lib/zoneOverlayStore";
import { NAV_TABS, type Tab } from "@/pages/settings/constants";
const tabLabel = (id: Tab) => NAV_TABS.find((t) => t.id === id)!.label;

function resetZoneStore() {
  useZoneOverlayStore.setState({
    saltwater: DEFAULT_SLOTS as [
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
    ],
    freshwater: DEFAULT_SLOTS as [
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
    ],
    activeWaterType: "saltwater",
    slots: DEFAULT_SLOTS as [
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
      { color: string; visible: boolean },
    ],
  });
}

function navigateToMapOverlays() {
  fireEvent.click(screen.getByText(tabLabel("display-overlays")));
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
  resetZoneStore();
});

describe("ZoneColourSwatches — rendering", () => {
  it("does NOT render the ZONE COLOURS heading in the default Visuals tab", () => {
    render(<Settings />);
    expect(screen.queryByText("ZONE COLOURS")).not.toBeInTheDocument();
  });

  it("renders the ZONE COLOURS heading in the DISPLAY & OVERLAYS tab", () => {
    render(<Settings />);
    navigateToMapOverlays();
    expect(screen.getByText("ZONE COLOURS")).toBeInTheDocument();
  });

  it("renders the Reset button in MAP & OVERLAYS tab", () => {
    render(<Settings />);
    navigateToMapOverlays();
    expect(screen.getByTestId("settings-zone-colours-reset")).toBeInTheDocument();
    expect(screen.getByTestId("settings-zone-colours-reset")).toHaveTextContent("Reset");
  });

  it("renders all four slot swatches", () => {
    render(<Settings />);
    navigateToMapOverlays();
    for (let i = 0; i < 4; i++) {
      expect(screen.getByTestId(`settings-zone-swatch-${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("settings-zone-swatch-4")).not.toBeInTheDocument();
  });

  it("renders a colour input for each slot", () => {
    render(<Settings />);
    navigateToMapOverlays();
    for (let i = 0; i < 4; i++) {
      const input = screen.getByTestId(`settings-zone-colour-input-${i}`) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.type).toBe("color");
    }
  });

  it("colour inputs are initialised to the default slot colours", () => {
    render(<Settings />);
    navigateToMapOverlays();
    for (let i = 0; i < 4; i++) {
      const input = screen.getByTestId(`settings-zone-colour-input-${i}`) as HTMLInputElement;
      expect(input.value.toLowerCase()).toBe(ZONE_DEFAULT_COLORS[i]!.toLowerCase());
    }
  });
});

describe("ZoneColourSwatches — colour input interaction", () => {
  it("changing a colour input updates the store for that slot", async () => {
    render(<Settings />);
    navigateToMapOverlays();
    const input = screen.getByTestId("settings-zone-colour-input-1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#aabbcc" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[1]!.color).toBe("#aabbcc");
    });
  });

  it("colour input for slot 0 reflects a store-side colour change", async () => {
    render(<Settings />);
    navigateToMapOverlays();
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(0, "#112233");
    });
    await waitFor(() => {
      const input = screen.getByTestId("settings-zone-colour-input-0") as HTMLInputElement;
      expect(input.value.toLowerCase()).toBe("#112233");
    });
  });
});

describe("ZoneColourSwatches — Reset to Defaults", () => {
  it("resets all four slots to the default colours when clicked", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(0, "#111111");
      useZoneOverlayStore.getState().setSlotColor(2, "#222222");
    });
    render(<Settings />);
    navigateToMapOverlays();
    // Reset now requires a confirming second click
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    await waitFor(() => {
      const { slots } = useZoneOverlayStore.getState();
      for (let i = 0; i < 4; i++) {
        expect(slots[i as 0 | 1 | 2 | 3]!.color.toLowerCase()).toBe(
          ZONE_DEFAULT_COLORS[i]!.toLowerCase(),
        );
      }
    });
  });

  it("after reset, colour inputs display the default hex values", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(3, "#deadbe");
    });
    render(<Settings />);
    navigateToMapOverlays();
    // Reset now requires a confirming second click
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    await waitFor(() => {
      for (let i = 0; i < 4; i++) {
        const input = screen.getByTestId(`settings-zone-colour-input-${i}`) as HTMLInputElement;
        expect(input.value.toLowerCase()).toBe(ZONE_DEFAULT_COLORS[i]!.toLowerCase());
      }
    });
  });

  it("resets visibility to true for all slots if any were hidden", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(1, false);
      useZoneOverlayStore.getState().setSlotVisible(3, false);
    });
    render(<Settings />);
    navigateToMapOverlays();
    // Reset now requires a confirming second click
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    await waitFor(() => {
      const { slots } = useZoneOverlayStore.getState();
      for (let i = 0; i < 4; i++) {
        expect(slots[i as 0 | 1 | 2 | 3]!.visible).toBe(true);
      }
    });
  });
});

describe("ZoneColourSwatches — accessible names", () => {
  const SALTWATER_NAMES = [
    "Sandy Shelf / Reef",
    "Coarse Sediment / Seamount",
    "Silt Plain",
    "Basalt / Volcanic",
  ];

  it("each zone visibility toggle has an accessible name containing the zone name", () => {
    render(<Settings />);
    navigateToMapOverlays();
    for (const name of SALTWATER_NAMES) {
      const toggle = screen.getByLabelText(`Show zone ${name}`);
      expect(toggle).toHaveAttribute("role", "switch");
    }
  });

  it("each colour input has an accessible name containing the zone name", () => {
    render(<Settings />);
    navigateToMapOverlays();
    for (const name of SALTWATER_NAMES) {
      const input = screen.getByLabelText(`Colour for zone ${name}`) as HTMLInputElement;
      expect(input.type).toBe("color");
    }
  });

  it("ZONE COLOURS header is a level-3 heading", () => {
    render(<Settings />);
    navigateToMapOverlays();
    expect(screen.getByRole("heading", { level: 3, name: "ZONE COLOURS" })).toBeInTheDocument();
  });
});

describe("ZoneColourSwatches — reset disabled state & confirmation", () => {
  it("reset button is disabled when the palette is already at defaults", () => {
    render(<Settings />);
    navigateToMapOverlays();
    const btn = screen.getByTestId("settings-zone-colours-reset");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn.getAttribute("title")).toMatch(/already at/i);
  });

  it("reset button is enabled once the palette differs from defaults", () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(0, "#123456");
    });
    render(<Settings />);
    navigateToMapOverlays();
    expect(screen.getByTestId("settings-zone-colours-reset")).toBeEnabled();
  });

  it("a single click arms the confirmation and does NOT wipe the palette", () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(0, "#123456");
    });
    render(<Settings />);
    navigateToMapOverlays();
    const btn = screen.getByTestId("settings-zone-colours-reset");
    fireEvent.click(btn);
    expect(btn).toHaveTextContent(/tap again to reset/i);
    expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#123456");
  });

  it("a second click within the window performs the reset", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(0, "#123456");
    });
    render(<Settings />);
    navigateToMapOverlays();
    const btn = screen.getByTestId("settings-zone-colours-reset");
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[0]!.color.toLowerCase()).toBe(
        ZONE_DEFAULT_COLORS[0]!.toLowerCase(),
      );
    });
    expect(btn).toHaveTextContent(/^reset$/i);
  });

  it("the armed state reverts to idle after the 3-second window elapses", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        useZoneOverlayStore.getState().setSlotColor(0, "#123456");
      });
      render(<Settings />);
      navigateToMapOverlays();
      const btn = screen.getByTestId("settings-zone-colours-reset");
      fireEvent.click(btn);
      expect(btn).toHaveTextContent(/tap again to reset/i);
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(btn).toHaveTextContent(/^reset$/i);
      // Palette untouched
      expect(useZoneOverlayStore.getState().slots[0]!.color).toBe("#123456");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ZoneColourSwatches — freshwater mode", () => {
  it("shows freshwater slot names when waterType is freshwater", () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), waterType: "freshwater" });
    render(<Settings />);
    navigateToMapOverlays();
    expect(screen.getByTitle("Click to change colour — Vegetation / Sandy Bed")).toBeInTheDocument();
    expect(screen.getByTitle("Click to change colour — Gravel / Submerged Wood")).toBeInTheDocument();
    expect(screen.getByTitle("Click to change colour — Silt / Clay")).toBeInTheDocument();
    expect(screen.getByTitle("Click to change colour — Rock / Bedrock")).toBeInTheDocument();
  });

  it("shows saltwater slot names by default", () => {
    render(<Settings />);
    navigateToMapOverlays();
    expect(screen.getByTitle("Click to change colour — Sandy Shelf / Reef")).toBeInTheDocument();
    expect(screen.getByTitle("Click to change colour — Coarse Sediment / Seamount")).toBeInTheDocument();
    expect(screen.getByTitle("Click to change colour — Silt Plain")).toBeInTheDocument();
    expect(screen.getByTitle("Click to change colour — Basalt / Volcanic")).toBeInTheDocument();
  });
});
