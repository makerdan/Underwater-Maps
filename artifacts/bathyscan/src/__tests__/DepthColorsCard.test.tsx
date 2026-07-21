/**
 * Component tests for the merged Settings "Depth Colors" card
 * (DepthColorsCard + DepthBandEditor). Verifies that:
 *   - the merged card renders (theme select, presets, preview, band editor)
 *   - the variable-length band editor renders one row per band
 *   - add/remove band buttons update paletteStore within the 2–16 limits
 *   - colour pickers / hex inputs / boundary sliders update paletteStore
 *   - the blend-vs-discrete toggle updates paletteStore.blendBands
 *   - the preview <img> re-renders when band state changes
 *   - preset chips seed bandColors preserving the current band count
 *   - unit labels track the units setting
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

import { Settings } from "@/pages/Settings";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import {
  usePaletteStore,
  DEFAULT_BAND_COLORS,
  DEFAULT_BAND_BOUNDARIES,
  PALETTE_PRESETS,
  bandColorsFromPreset,
  MIN_BANDS,
  MAX_BANDS,
} from "@/lib/paletteStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
  });
  usePaletteStore.getState().reset();
});

describe("DepthColorsCard — merged card structure", () => {
  it("renders the merged card with presets, preview, and the band editor", () => {
    render(<Settings />);
    expect(screen.getByTestId("depth-colors-card")).toBeInTheDocument();
    expect(screen.getByTestId("palette-presets")).toBeInTheDocument();
    expect(screen.getByTestId("palette-preview")).toBeInTheDocument();
    expect(screen.getByTestId("depth-band-color-editor")).toBeInTheDocument();
  });

  it("no separate PalettePickerCard shallow/deep hex inputs exist any more", () => {
    render(<Settings />);
    expect(screen.queryByTestId("palette-shallow-hex")).not.toBeInTheDocument();
    expect(screen.queryByTestId("palette-deep-hex")).not.toBeInTheDocument();
    expect(screen.queryByTestId("palette-custom-editor")).not.toBeInTheDocument();
  });

  it("band editor renders for the custom theme too", () => {
    useSettingsStore.getState().setColormapTheme("custom");
    render(<Settings />);
    expect(screen.getByTestId("depth-band-color-editor")).toBeInTheDocument();
  });

  it("band editor is hidden for fixed themes (viridis)", () => {
    useSettingsStore.getState().setColormapTheme("viridis");
    render(<Settings />);
    expect(screen.queryByTestId("depth-band-color-editor")).not.toBeInTheDocument();
  });
});

describe("DepthBandEditor — variable-length rows", () => {
  it("renders one row per band (default 10)", () => {
    render(<Settings />);
    const n = usePaletteStore.getState().bandColors.length;
    expect(n).toBe(DEFAULT_BAND_COLORS.length);
    for (let i = 0; i < n; i++) {
      expect(screen.getByTestId(`band-color-row-${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId(`band-color-row-${n}`)).not.toBeInTheDocument();
  });

  it("add band button appends a band and renders a new row", async () => {
    render(<Settings />);
    const before = usePaletteStore.getState().bandColors.length;
    fireEvent.click(screen.getByTestId("band-add-btn"));
    await waitFor(() => {
      expect(usePaletteStore.getState().bandColors.length).toBe(before + 1);
      expect(screen.getByTestId(`band-color-row-${before}`)).toBeInTheDocument();
    });
  });

  it("remove band button removes a band and its row", async () => {
    render(<Settings />);
    const before = usePaletteStore.getState().bandColors.length;
    fireEvent.click(screen.getByTestId("band-remove-btn-0"));
    await waitFor(() => {
      expect(usePaletteStore.getState().bandColors.length).toBe(before - 1);
      expect(screen.queryByTestId(`band-color-row-${before - 1}`)).not.toBeInTheDocument();
    });
  });

  it("add button is disabled at MAX_BANDS", async () => {
    render(<Settings />);
    act(() => {
      const st = usePaletteStore.getState();
      while (usePaletteStore.getState().bandColors.length < MAX_BANDS) st.addBand();
    });
    await waitFor(() => {
      expect(usePaletteStore.getState().bandColors.length).toBe(MAX_BANDS);
      expect(screen.getByTestId("band-add-btn")).toBeDisabled();
    });
  });

  it("remove buttons are disabled at MIN_BANDS", async () => {
    render(<Settings />);
    act(() => {
      const st = usePaletteStore.getState();
      while (usePaletteStore.getState().bandColors.length > MIN_BANDS) st.removeBand(0);
    });
    await waitFor(() => {
      expect(usePaletteStore.getState().bandColors.length).toBe(MIN_BANDS);
      expect(screen.getByTestId("band-remove-btn-0")).toBeDisabled();
    });
  });
});

describe("DepthBandEditor — colour editing", () => {
  it("each band row shows a colour picker bound to bandColors[i]", () => {
    render(<Settings />);
    const bc = usePaletteStore.getState().bandColors;
    for (let i = 0; i < bc.length; i++) {
      const picker = screen.getByTestId(`band-color-picker-${i}`) as HTMLInputElement;
      expect(picker.value.toLowerCase()).toBe(bc[i]!.toLowerCase());
    }
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

  it("Reset colours button restores DEFAULT_BAND_COLORS", async () => {
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
});

describe("DepthBandEditor — boundary editing", () => {
  it("dragging band-boundary-slider-3 (imperial) updates bandBoundaries[3]", async () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), units: "imperial" });
    render(<Settings />);
    const slider = screen.getByTestId("band-boundary-slider-3") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "180" } });
    await waitFor(() => {
      expect(usePaletteStore.getState().bandBoundaries[3]).toBe(180);
    });
  });

  it("the LAST boundary is editable via its typed input (no 2000 ft cap)", async () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), units: "imperial" });
    render(<Settings />);
    const lastIdx = usePaletteStore.getState().bandBoundaries.length - 1;
    const input = screen.getByTestId(`band-boundary-input-${lastIdx}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3500" } });
    await waitFor(() => {
      expect(usePaletteStore.getState().bandBoundaries[lastIdx]).toBe(3500);
    });
  });

  it("reset boundaries button restores DEFAULT_BAND_BOUNDARIES", async () => {
    act(() => { usePaletteStore.getState().setBandBoundary(4, 220); });
    render(<Settings />);
    fireEvent.click(screen.getByTestId("band-boundaries-reset-btn"));
    await waitFor(() => {
      const bb = usePaletteStore.getState().bandBoundaries;
      DEFAULT_BAND_BOUNDARIES.forEach((v, i) => {
        expect(bb[i]).toBe(v);
      });
    });
  });
});

describe("DepthBandEditor — blend toggle", () => {
  it("renders the blend toggle and it reflects/updates blendBands", async () => {
    render(<Settings />);
    const wrap = screen.getByTestId("blend-bands-toggle");
    expect(wrap).toBeInTheDocument();
    expect(usePaletteStore.getState().blendBands).toBe(true);
    const toggle = wrap.querySelector("input[type=checkbox], button, [role=switch]");
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);
    await waitFor(() => {
      expect(usePaletteStore.getState().blendBands).toBe(false);
    });
  });
});

describe("DepthColorsCard — presets and preview", () => {
  it("clicking a preset chip seeds bandColors with interpolated values", async () => {
    render(<Settings />);
    const warmPreset = PALETTE_PRESETS.find((p) => p.id === "warm")!;
    fireEvent.click(screen.getByTestId(`palette-preset-${warmPreset.id}`));
    const expected = bandColorsFromPreset(warmPreset);
    await waitFor(() => {
      const bc = usePaletteStore.getState().bandColors;
      expect(bc).toHaveLength(DEFAULT_BAND_COLORS.length);
      expected.forEach((c, i) => {
        expect(bc[i]!.toLowerCase()).toBe(c.toLowerCase());
      });
    });
  });

  it("preset chips preserve the current band count", async () => {
    render(<Settings />);
    act(() => { usePaletteStore.getState().addBand(); });
    const count = usePaletteStore.getState().bandColors.length;
    const highContrast = PALETTE_PRESETS.find((p) => p.id === "high-contrast")!;
    fireEvent.click(screen.getByTestId(`palette-preset-${highContrast.id}`));
    await waitFor(() => {
      expect(usePaletteStore.getState().bandColors).toHaveLength(count);
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

  it("preview image's src is re-assigned after a band boundary changes", async () => {
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
      usePaletteStore.getState().setBandBoundary(3, 180);
    });
    await waitFor(() => {
      expect(setSrc).toHaveBeenCalled();
    });
  });

  it("preview image's src is re-assigned when blendBands toggles", async () => {
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
      usePaletteStore.getState().setBlendBands(false);
    });
    await waitFor(() => {
      expect(setSrc).toHaveBeenCalled();
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

describe("DepthBandEditor — unit label sync", () => {
  it("shows 'ft' in all band labels when units are imperial", () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), units: "imperial" });
    render(<Settings />);
    const n = usePaletteStore.getState().bandColors.length;
    for (let i = 0; i < n; i++) {
      const row = screen.getByTestId(`band-color-row-${i}`);
      expect(row.textContent).toMatch(/ft/);
    }
  });

  it("shows 'm' in all band labels when units are metric", () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), units: "metric" });
    render(<Settings />);
    const n = usePaletteStore.getState().bandColors.length;
    for (let i = 0; i < n; i++) {
      const row = screen.getByTestId(`band-color-row-${i}`);
      expect(row.textContent).toMatch(/\bm\b/);
    }
  });

  it("updates all band labels when units switch from imperial to metric", async () => {
    useSettingsStore.setState({ ...useSettingsStore.getState(), units: "imperial" });
    render(<Settings />);
    const n = usePaletteStore.getState().bandColors.length;
    for (let i = 0; i < n; i++) {
      expect(screen.getByTestId(`band-color-row-${i}`).textContent).toMatch(/ft/);
    }
    act(() => {
      useSettingsStore.setState({ ...useSettingsStore.getState(), units: "metric" });
    });
    await waitFor(() => {
      for (let i = 0; i < n; i++) {
        expect(screen.getByTestId(`band-color-row-${i}`).textContent).toMatch(/\bm\b/);
        expect(screen.getByTestId(`band-color-row-${i}`).textContent).not.toMatch(/ft/);
      }
    });
  });
});
