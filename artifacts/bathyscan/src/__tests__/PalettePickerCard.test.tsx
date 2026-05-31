/**
 * Component tests for the Settings palette card (PalettePickerCard +
 * CustomStopsEditor). Verifies that:
 *   - switching the colormap to "custom" reveals the stop editor
 *   - adding / removing stops in the editor updates paletteStore
 *   - the preview <img> re-renders (src changes) when stops change
 *   - clicking a preset chip while in Custom mode seeds the editable stops
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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

import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import {
  usePaletteStore,
  DEFAULT_CUSTOM_STOPS,
  DEFAULT_BAND_COLORS,
  PALETTE_PRESETS,
  bandColorsFromPreset,
} from "@/lib/paletteStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
  usePaletteStore.getState().reset();
});

describe("PalettePickerCard — ocean (default) mode", () => {
  it("shows the shallow/deep hex inputs and hides the custom editor", () => {
    render(<Settings />);
    expect(screen.getByTestId("palette-shallow-hex")).toBeInTheDocument();
    expect(screen.getByTestId("palette-deep-hex")).toBeInTheDocument();
    expect(screen.queryByTestId("palette-custom-editor")).not.toBeInTheDocument();
  });
});

describe("PalettePickerCard — custom mode", () => {
  beforeEach(() => {
    useSettingsStore.getState().setColormapTheme("custom");
  });

  it("reveals the custom stops editor and hides shallow/deep inputs", () => {
    render(<Settings />);
    expect(screen.getByTestId("palette-custom-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("palette-shallow-hex")).not.toBeInTheDocument();
    expect(screen.queryByTestId("palette-deep-hex")).not.toBeInTheDocument();
  });

  it("renders one row per stop matching paletteStore state", () => {
    render(<Settings />);
    const initial = usePaletteStore.getState().customStops.length;
    for (let i = 0; i < initial; i++) {
      expect(screen.getByTestId(`palette-custom-stop-${i}`)).toBeInTheDocument();
    }
    expect(
      screen.queryByTestId(`palette-custom-stop-${initial}`),
    ).not.toBeInTheDocument();
  });

  it("adding a stop adds a new row and grows paletteStore", async () => {
    render(<Settings />);
    const before = usePaletteStore.getState().customStops.length;
    fireEvent.click(screen.getByTestId("palette-custom-add"));
    await waitFor(() => {
      expect(usePaletteStore.getState().customStops.length).toBe(before + 1);
    });
    expect(screen.getByTestId(`palette-custom-stop-${before}`)).toBeInTheDocument();
  });

  it("removing a stop shrinks paletteStore and re-renders the editor", async () => {
    render(<Settings />);
    const before = usePaletteStore.getState().customStops.length;
    expect(before).toBeGreaterThan(2);
    fireEvent.click(screen.getByTestId("palette-custom-stop-1-remove"));
    await waitFor(() => {
      expect(usePaletteStore.getState().customStops.length).toBe(before - 1);
    });
  });

  it("remove buttons are disabled when only 2 stops remain", () => {
    // Reduce to exactly 2 stops before render so all remove buttons are disabled.
    // Done before render() so no mounted component re-renders from this update.
    usePaletteStore.setState({
      customStops: [
        { position: 0, hex: "#aabbcc" },
        { position: 1, hex: "#001122" },
      ],
    });
    render(<Settings />);
    const remove0 = screen.getByTestId("palette-custom-stop-0-remove") as HTMLButtonElement;
    const remove1 = screen.getByTestId("palette-custom-stop-1-remove") as HTMLButtonElement;
    expect(remove0.disabled).toBe(true);
    expect(remove1.disabled).toBe(true);
  });

  it("editing a stop's colour updates paletteStore", async () => {
    render(<Settings />);
    const colorInput = screen.getByTestId("palette-custom-stop-0-color") as HTMLInputElement;
    fireEvent.input(colorInput, { target: { value: "#ff00aa" } });
    await waitFor(() => {
      expect(usePaletteStore.getState().customStops[0]!.hex).toBe("#ff00aa");
    });
  });

  it("editing a stop's position updates paletteStore (and may resort)", async () => {
    render(<Settings />);
    const pct = screen.getByTestId("palette-custom-stop-0-percent") as HTMLInputElement;
    fireEvent.change(pct, { target: { value: "80" } });
    await waitFor(() => {
      const stops = usePaletteStore.getState().customStops;
      // 0.8 must now exist somewhere in the (resorted) list.
      expect(stops.some((s) => Math.abs(s.position - 0.8) < 0.001)).toBe(true);
    });
  });

  it("preview image's src is re-assigned after stops are mutated", async () => {
    render(<Settings />);
    const preview = screen.getByTestId("palette-preview") as HTMLImageElement;
    // The preview effect runs on mount and again on every store change. In
    // jsdom the mocked canvas returns no real data, but we can still verify
    // the effect re-fires by spying on the src setter.
    const setSrc = vi.fn();
    Object.defineProperty(preview, "src", {
      configurable: true,
      get: () => "",
      set: setSrc,
    });
    setSrc.mockClear();
    fireEvent.click(screen.getByTestId("palette-custom-add"));
    await waitFor(() => {
      expect(usePaletteStore.getState().customStops.length).toBeGreaterThan(
        DEFAULT_CUSTOM_STOPS.length - 1,
      );
      expect(setSrc).toHaveBeenCalled();
    });
  });

  it("clicking a preset chip in Custom mode seeds the editable stops", async () => {
    render(<Settings />);
    const highContrast = PALETTE_PRESETS.find((p) => p.id === "high-contrast")!;
    fireEvent.click(screen.getByTestId(`palette-preset-${highContrast.id}`));
    await waitFor(() => {
      const stops = usePaletteStore.getState().customStops;
      expect(stops).toHaveLength(4);
      expect(stops[0]!.hex.toLowerCase()).toBe(highContrast.shallow.toLowerCase());
      expect(stops[stops.length - 1]!.hex.toLowerCase()).toBe(
        highContrast.deep.toLowerCase(),
      );
    });
  });

  it("Reset to defaults restores the default custom stops", async () => {
    render(<Settings />);
    act(() => {
      usePaletteStore.getState().setCustomStops([
        { position: 0, hex: "#abcdef" },
        { position: 1, hex: "#fedcba" },
      ]);
    });
    fireEvent.click(screen.getByTestId("palette-reset-btn"));
    await waitFor(() => {
      expect(usePaletteStore.getState().customStops).toEqual(DEFAULT_CUSTOM_STOPS);
    });
  });
});

describe("PalettePickerCard — ocean mode band colours", () => {
  it("DepthBandColorEditor renders when ocean theme is active (default)", () => {
    render(<Settings />);
    expect(screen.getByTestId("depth-band-color-editor")).toBeInTheDocument();
  });

  it("renders 10 band colour rows", () => {
    render(<Settings />);
    for (let i = 0; i < 10; i++) {
      expect(screen.getByTestId(`band-color-row-${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("band-color-row-10")).not.toBeInTheDocument();
  });

  it("DepthBandColorEditor does not render when custom theme is active", () => {
    useSettingsStore.getState().setColormapTheme("custom");
    render(<Settings />);
    expect(screen.queryByTestId("depth-band-color-editor")).not.toBeInTheDocument();
  });

  it("clicking the native colour picker updates bandColors in the store", async () => {
    render(<Settings />);
    const picker = screen.getByTestId("band-color-picker-3") as HTMLInputElement;
    fireEvent.change(picker, { target: { value: "#123456" } });
    await waitFor(() => {
      expect(usePaletteStore.getState().bandColors[3]).toBe("#123456");
    });
  });

  it("hex input commits to the store after a valid 6-char hex is typed", async () => {
    render(<Settings />);
    const hexInput = screen.getByTestId("band-color-hex-5") as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: "#abcdef" } });
    await waitFor(() => {
      expect(usePaletteStore.getState().bandColors[5]).toBe("#abcdef");
    }, { timeout: 500 });
  });

  it("Reset band colours button restores DEFAULT_BAND_COLORS", async () => {
    act(() => { usePaletteStore.getState().setBandColor(2, "#ff0000"); });
    render(<Settings />);
    fireEvent.click(screen.getByTestId("band-colors-reset-btn"));
    await waitFor(() => {
      const bc = usePaletteStore.getState().bandColors;
      DEFAULT_BAND_COLORS.forEach((c, i) => {
        expect(bc[i]).toBe(c);
      });
    });
  });

  it("clicking a preset chip seeds bandColors with interpolated values", async () => {
    render(<Settings />);
    const warmPreset = PALETTE_PRESETS.find((p) => p.id === "warm")!;
    fireEvent.click(screen.getByTestId(`palette-preset-${warmPreset.id}`));
    const expected = bandColorsFromPreset(warmPreset);
    await waitFor(() => {
      const bc = usePaletteStore.getState().bandColors;
      expect(bc).toHaveLength(10);
      expected.forEach((c, i) => {
        expect(bc[i]!.toLowerCase()).toBe(c.toLowerCase());
      });
    });
  });
});

describe("DepthBandColorEditor — unit label sync", () => {
  it("shows 'ft' in all 10 band labels when units are imperial", () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), units: "imperial" });
    render(<Settings />);
    for (let i = 0; i < 10; i++) {
      const row = screen.getByTestId(`band-color-row-${i}`);
      expect(row.textContent).toMatch(/ft/);
    }
  });

  it("shows 'm' in all 10 band labels when units are metric", () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), units: "metric" });
    render(<Settings />);
    for (let i = 0; i < 10; i++) {
      const row = screen.getByTestId(`band-color-row-${i}`);
      expect(row.textContent).toMatch(/\bm\b/);
    }
  });

  it("updates all 10 band labels when units switch from imperial to metric", async () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), units: "imperial" });
    render(<Settings />);
    for (let i = 0; i < 10; i++) {
      expect(screen.getByTestId(`band-color-row-${i}`).textContent).toMatch(/ft/);
    }
    act(() => {
      useSettingsStore.setState({ ...useSettingsStore.getState(), units: "metric" });
    });
    await waitFor(() => {
      for (let i = 0; i < 10; i++) {
        expect(screen.getByTestId(`band-color-row-${i}`).textContent).toMatch(/\bm\b/);
        expect(screen.getByTestId(`band-color-row-${i}`).textContent).not.toMatch(/ft/);
      }
    });
  });
});
