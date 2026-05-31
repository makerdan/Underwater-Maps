/**
 * Tests for the ZoneColoursCard component in the Visuals tab (Settings page).
 *
 * Covers:
 *   - All four slot rows render with colour inputs and visibility toggles
 *   - Colour inputs are bound to the current store values
 *   - Changing a colour input updates zoneOverlayStore
 *   - "RESET TO DEFAULTS" restores the four default colours
 *   - Toggling visibility dims the swatch (opacity) and label for that slot
 *   - Re-enabling visibility restores full opacity
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
import { useZoneOverlayStore, ZONE_DEFAULT_COLORS } from "@/lib/zoneOverlayStore";

function resetZoneStore() {
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
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
  resetZoneStore();
});

describe("ZoneColoursCard — rendering", () => {
  it("renders the ZONE COLOURS heading in the Visuals tab", () => {
    render(<Settings />);
    expect(screen.getByText("ZONE COLOURS")).toBeInTheDocument();
  });

  it("renders the RESET TO DEFAULTS button", () => {
    render(<Settings />);
    expect(screen.getByTestId("settings-zone-colours-reset")).toBeInTheDocument();
    expect(screen.getByTestId("settings-zone-colours-reset")).toHaveTextContent(
      "RESET TO DEFAULTS",
    );
  });

  it("renders all four slot rows", () => {
    render(<Settings />);
    for (let i = 0; i < 4; i++) {
      expect(screen.getByTestId(`settings-zone-row-${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("settings-zone-row-4")).not.toBeInTheDocument();
  });

  it("renders a colour input for each slot", () => {
    render(<Settings />);
    for (let i = 0; i < 4; i++) {
      const input = screen.getByTestId(`settings-zone-colour-input-${i}`) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.type).toBe("color");
    }
  });

  it("renders a visibility toggle for each slot", () => {
    render(<Settings />);
    for (let i = 0; i < 4; i++) {
      const row = screen.getByTestId(`settings-zone-row-${i}`);
      const toggle = within(row).getByRole("switch");
      expect(toggle).toBeInTheDocument();
    }
  });

  it("colour inputs are initialised to the default slot colours", () => {
    render(<Settings />);
    for (let i = 0; i < 4; i++) {
      const input = screen.getByTestId(`settings-zone-colour-input-${i}`) as HTMLInputElement;
      expect(input.value.toLowerCase()).toBe(ZONE_DEFAULT_COLORS[i]!.toLowerCase());
    }
  });

  it("all visibility toggles are ON (aria-checked=true) by default", () => {
    render(<Settings />);
    for (let i = 0; i < 4; i++) {
      const row = screen.getByTestId(`settings-zone-row-${i}`);
      const toggle = within(row).getByRole("switch");
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    }
  });
});

describe("ZoneColoursCard — colour input interaction", () => {
  it("changing a colour input updates the store for that slot", async () => {
    render(<Settings />);
    const input = screen.getByTestId("settings-zone-colour-input-1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#aabbcc" } });
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[1]!.color).toBe("#aabbcc");
    });
  });

  it("colour input for slot 0 reflects a store-side colour change", async () => {
    render(<Settings />);
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(0, "#112233");
    });
    await waitFor(() => {
      const input = screen.getByTestId("settings-zone-colour-input-0") as HTMLInputElement;
      expect(input.value.toLowerCase()).toBe("#112233");
    });
  });
});

describe("ZoneColoursCard — Reset to Defaults", () => {
  it("resets all four slots to the default colours when clicked", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotColor(0, "#111111");
      useZoneOverlayStore.getState().setSlotColor(2, "#222222");
    });
    render(<Settings />);
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
    fireEvent.click(screen.getByTestId("settings-zone-colours-reset"));
    await waitFor(() => {
      const { slots } = useZoneOverlayStore.getState();
      for (let i = 0; i < 4; i++) {
        expect(slots[i as 0 | 1 | 2 | 3]!.visible).toBe(true);
      }
    });
  });
});

describe("ZoneColoursCard — visibility toggle", () => {
  it("toggling a slot OFF sets visible=false in the store", async () => {
    render(<Settings />);
    const row = screen.getByTestId("settings-zone-row-2");
    const toggle = within(row).getByRole("switch");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(useZoneOverlayStore.getState().slots[2]!.visible).toBe(false);
    });
  });

  it("toggle aria-checked becomes false after turning a slot OFF", async () => {
    render(<Settings />);
    const row = screen.getByTestId("settings-zone-row-0");
    const toggle = within(row).getByRole("switch");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("swatch opacity is 0.35 when slot is hidden and 1 when visible", async () => {
    render(<Settings />);
    const row2 = screen.getByTestId("settings-zone-row-2");
    const toggle = within(row2).getByRole("switch");

    const swatch = row2.querySelector("span[style*='border-radius']") as HTMLElement;
    expect(swatch).toBeTruthy();
    expect(swatch.style.opacity).toBe("1");

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(swatch.style.opacity).toBe("0.35");
    });
  });

  it("re-enabling a hidden slot restores opacity to 1", async () => {
    act(() => {
      useZoneOverlayStore.getState().setSlotVisible(0, false);
    });
    render(<Settings />);
    const row = screen.getByTestId("settings-zone-row-0");
    const toggle = within(row).getByRole("switch");

    const swatch = row.querySelector("span[style*='border-radius']") as HTMLElement;
    expect(swatch.style.opacity).toBe("0.35");

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(swatch.style.opacity).toBe("1");
    });
    expect(useZoneOverlayStore.getState().slots[0]!.visible).toBe(true);
  });

  it("toggling OFF and back ON leaves the store visible=true", async () => {
    render(<Settings />);
    const row = screen.getByTestId("settings-zone-row-1");
    const toggle = within(row).getByRole("switch");
    fireEvent.click(toggle);
    await waitFor(() => expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() => expect(useZoneOverlayStore.getState().slots[1]!.visible).toBe(true));
  });
});

describe("ZoneColoursCard — freshwater mode", () => {
  it("shows freshwater slot names when waterType is freshwater", () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), waterType: "freshwater" });
    render(<Settings />);
    expect(screen.getByText("Vegetation / Sandy Bed")).toBeInTheDocument();
    expect(screen.getByText("Gravel / Submerged Wood")).toBeInTheDocument();
    expect(screen.getByText("Silt / Clay")).toBeInTheDocument();
    expect(screen.getByText("Rock / Bedrock")).toBeInTheDocument();
  });

  it("shows saltwater slot names by default", () => {
    render(<Settings />);
    expect(screen.getByText("Sandy Shelf / Reef")).toBeInTheDocument();
    expect(screen.getByText("Coarse Sediment / Seamount")).toBeInTheDocument();
    expect(screen.getByText("Silt Plain")).toBeInTheDocument();
    expect(screen.getByText("Basalt / Volcanic")).toBeInTheDocument();
  });
});
