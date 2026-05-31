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

  it("reveals the custom band editor and hides shallow/deep inputs", () => {
    render(<Settings />);
    expect(screen.getByTestId("palette-custom-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("palette-shallow-hex")).not.toBeInTheDocument();
    expect(screen.queryByTestId("palette-deep-hex")).not.toBeInTheDocument();
  });

  it("renders exactly 10 band-colour rows", () => {
    render(<Settings />);
    for (let i = 0; i < 10; i++) {
      expect(screen.getByTestId(`palette-custom-band-${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("palette-custom-band-10")).not.toBeInTheDocument();
  });

  it("each band row shows a colour picker bound to bandColors[i]", () => {
    render(<Settings />);
    const bc = usePaletteStore.getState().bandColors;
    for (let i = 0; i < 10; i++) {
      const picker = screen.getByTestId(`palette-custom-band-${i}-color`) as HTMLInputElement;
      expect(picker.value.toLowerCase()).toBe(bc[i]!.toLowerCase());
    }
  });

  it("editing a band colour picker updates paletteStore.bandColors", async () => {
    render(<Settings />);
    const colorInput = screen.getByTestId("palette-custom-band-0-color") as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: "#ff00aa" } });
    await waitFor(() => {
      expect(usePaletteStore.getState().bandColors[0]).toBe("#ff00aa");
    });
  });

  it("preview image's src is re-assigned after a band colour changes", async () => {
    render(<Settings />);
    const preview = screen.getByTestId("palette-preview") as HTMLImageElement;
    const setSrc = vi.fn();
    Object.defineProperty(preview, "src", {
      configurable: true,
      get: () => "",
      set: setSrc,
    });
    setSrc.mockClear();
    act(() => {
      usePaletteStore.getState().setBandColor(2, "#aabbcc");
    });
    await waitFor(() => {
      expect(setSrc).toHaveBeenCalled();
    });
  });

  it("clicking a preset chip in Custom mode seeds bandColors with interpolated values", async () => {
    render(<Settings />);
    const highContrast = PALETTE_PRESETS.find((p) => p.id === "high-contrast")!;
    fireEvent.click(screen.getByTestId(`palette-preset-${highContrast.id}`));
    const expected = bandColorsFromPreset(highContrast);
    await waitFor(() => {
      const bc = usePaletteStore.getState().bandColors;
      expect(bc).toHaveLength(10);
      expected.forEach((c, i) => {
        expect(bc[i]!.toLowerCase()).toBe(c.toLowerCase());
      });
    });
  });

  it("Reset to defaults restores DEFAULT_BAND_COLORS", async () => {
    render(<Settings />);
    act(() => {
      usePaletteStore.getState().setBandColor(3, "#abcdef");
    });
    fireEvent.click(screen.getByTestId("palette-reset-btn"));
    await waitFor(() => {
      const bc = usePaletteStore.getState().bandColors;
      DEFAULT_BAND_COLORS.forEach((c, i) => {
        expect(bc[i]).toBe(c);
      });
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
