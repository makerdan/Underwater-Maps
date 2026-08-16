/**
 * DepthColorsCard unit tests.
 *
 * Covers:
 *   - "Apply saved theme" behaviour:
 *       - Themes carrying a valid `colormapTheme` field (saved after task
 *         #3535) restore that colormap on apply.
 *       - Legacy themes without the field fall back to "ocean", log a console
 *         warning, and surface an inline upgrade note.
 *       - Applying flushes server sync.
 *   - `activePresetId` matches only when ALL band colours match the preset
 *     (a customised middle band must not show as an active preset).
 *   - Preset selection and the blend-band toggle flush server sync.
 *   - RESET TO DEFAULTS resets every card-controlled setting (palette store,
 *     nodata colour, contours, contour interval, colormap) and flushes sync.
 *   - The contour interval row receives `disabled` when contours are off.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoisted mock primitives (read by vi.mock factories below)
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const applyTheme = vi.fn();
  const setColormapThemeByUser = vi.fn();
  const setColormapTheme = vi.fn();
  const setNodataColor = vi.fn();
  const setContoursEnabled = vi.fn();
  const setContourInterval = vi.fn();
  const paletteReset = vi.fn();
  const setBandColors = vi.fn();
  const setBlendBands = vi.fn();
  const stateOverrides: Record<string, unknown> = {};
  const paletteOverrides: Record<string, unknown> = {};
  return {
    applyTheme,
    setColormapThemeByUser,
    setColormapTheme,
    setNodataColor,
    setContoursEnabled,
    setContourInterval,
    paletteReset,
    setBandColors,
    setBlendBands,
    stateOverrides,
    paletteOverrides,
  };
});

// ---------------------------------------------------------------------------
// paletteStore mock
// ---------------------------------------------------------------------------
vi.mock("@/lib/paletteStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paletteStore")>();

  // Legacy theme: saved before colormap tracking — no colormapTheme field.
  const savedTheme = {
    id: "theme-1",
    name: "My Theme",
    bandColors: ["#001a33", "#0077cc", "#00bcd4"],
    bandBoundaries: [0, 50, 100],
    blendBands: false,
    shallow: "#001a33",
    deep: "#00bcd4",
  };

  const state = () => ({
    shallow: "#001a33",
    deep: "#00bcd4",
    bandColors: ["#001a33", "#0077cc", "#00bcd4"],
    bandBoundaries: [0, 50, 100],
    blendBands: false,
    savedDepthThemes: [savedTheme],
    reset: h.paletteReset,
    setBandColors: h.setBandColors,
    setBandBoundaries: vi.fn(),
    setBlendBands: h.setBlendBands,
    setShallow: vi.fn(),
    setDeep: vi.fn(),
    saveCurrentTheme: vi.fn(),
    deleteTheme: vi.fn(),
    renameTheme: vi.fn(),
    applyTheme: h.applyTheme,
    ...h.paletteOverrides,
  });

  const usePaletteStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => state(),
      setState: vi.fn(),
      subscribe: () => () => {},
    },
  );

  return { ...actual, usePaletteStore };
});

// ---------------------------------------------------------------------------
// settingsStore mock
// ---------------------------------------------------------------------------
vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    colormapTheme: "ocean" as const,
    setColormapThemeByUser: h.setColormapThemeByUser,
    setColormapTheme: h.setColormapTheme,
    brightDaylight: false,
    colormapUserSet: false,
    nodataColor: "#bfbfbf",
    setNodataColor: h.setNodataColor,
    contoursEnabled: false,
    setContoursEnabled: h.setContoursEnabled,
    contourInterval: 10,
    setContourInterval: h.setContourInterval,
    units: "imperial" as const,
    ...h.stateOverrides,
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => state(),
      setState: vi.fn(),
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

// ---------------------------------------------------------------------------
// Lightweight stubs for heavy sub-components / hooks
// ---------------------------------------------------------------------------
vi.mock("@/lib/colormap", () => ({
  colormapCanvas: () => {
    const c = document.createElement("canvas");
    c.width = 14;
    c.height = 240;
    return c;
  },
}));

vi.mock("@/lib/units", () => ({
  formatDepth: (v: number) => `${v} ft`,
}));

vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: vi.fn().mockResolvedValue(undefined),
}));

// Stub RowWidgets — interaction tests only need prop wiring, not real rows.
vi.mock(
  "@/pages/settings/components/RowWidgets",
  () => ({
    SliderRow: ({ label, disabled }: { label: string; disabled?: boolean }) => (
      <div data-testid={`sliderrow-${label}`} data-disabled={disabled ? "true" : "false"}>
        {label}
      </div>
    ),
    ToggleRow: ({
      label,
      value,
      onChange,
    }: {
      label: string;
      value: boolean;
      onChange: (v: boolean) => void;
    }) => (
      <button type="button" data-testid={`togglerow-${label}`} onClick={() => onChange(!value)}>
        {label}
      </button>
    ),
    ColorRow: ({ label }: { label: string }) => <div>{label}</div>,
    ColormapSelectRow: ({ label }: { label: string }) => <div>{label}</div>,
  }),
);

vi.mock("../styles", () => ({
  S: new Proxy({} as Record<string, React.CSSProperties>, {
    get: () => ({}),
  }),
}));

vi.mock("../constants", () => ({
  defaultContourInterval: (units: string) => (units === "imperial" ? 50 : 10),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks are wired)
// ---------------------------------------------------------------------------
import { DepthColorsCard } from "../components/DepthColorsCard";
import { PALETTE_PRESETS, bandColorsFromPreset } from "@/lib/paletteStore";
import { DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { flushServerSync } from "@/hooks/useServerSettingsSync";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  h.applyTheme.mockClear();
  h.setColormapThemeByUser.mockClear();
  h.setColormapTheme.mockClear();
  h.setNodataColor.mockClear();
  h.setContoursEnabled.mockClear();
  h.setContourInterval.mockClear();
  h.paletteReset.mockClear();
  h.setBandColors.mockClear();
  h.setBlendBands.mockClear();
  vi.mocked(flushServerSync).mockClear();
  for (const k of Object.keys(h.stateOverrides)) delete h.stateOverrides[k];
  for (const k of Object.keys(h.paletteOverrides)) delete h.paletteOverrides[k];
});

describe("DepthColorsCard — Apply saved theme (legacy, no colormapTheme field)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("calls applyTheme when APPLY is clicked", () => {
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.applyTheme).toHaveBeenCalledWith("theme-1");
  });

  it("falls back to setColormapThemeByUser('ocean') when the active colormap is a non-band theme (thermal)", () => {
    h.stateOverrides.colormapTheme = "thermal";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.applyTheme).toHaveBeenCalledWith("theme-1");
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });

  it("falls back to setColormapThemeByUser('ocean') even when the active colormap is already 'ocean'", () => {
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.applyTheme).toHaveBeenCalledWith("theme-1");
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });

  it("falls back to setColormapThemeByUser('ocean') even when the active colormap is 'custom'", () => {
    h.stateOverrides.colormapTheme = "custom";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.applyTheme).toHaveBeenCalledWith("theme-1");
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });

  it("falls back to setColormapThemeByUser('ocean') when the active colormap is 'grayscale'", () => {
    h.stateOverrides.colormapTheme = "grayscale";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });

  it("falls back to setColormapThemeByUser('ocean') when the active colormap is 'viridis'", () => {
    h.stateOverrides.colormapTheme = "viridis";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });

  it("falls back to setColormapThemeByUser('ocean') when the active colormap is 'freshwater'", () => {
    h.stateOverrides.colormapTheme = "freshwater";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });

  it("logs a console warning and shows the upgrade note for a legacy theme", () => {
    render(<DepthColorsCard />);
    expect(screen.queryByTestId("saved-theme-upgrade-note")).toBeNull();
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("colormapTheme"));
    const note = screen.getByTestId("saved-theme-upgrade-note");
    expect(note.textContent).toMatch(/My Theme/);
    expect(note.textContent).toMatch(/Ocean colormap/i);
  });

  it("flushes server sync when a theme is applied", () => {
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(flushServerSync).toHaveBeenCalled();
  });
});

describe("DepthColorsCard — Apply saved theme (with colormapTheme field)", () => {
  const themedTheme = {
    id: "theme-2",
    name: "Custom Bands",
    bandColors: ["#111111", "#222222", "#333333"],
    bandBoundaries: [0, 50, 100],
    blendBands: true,
    shallow: "#111111",
    deep: "#333333",
    colormapTheme: "custom",
  };

  it("restores the theme's stored colormapTheme on apply", () => {
    h.paletteOverrides.savedDepthThemes = [themedTheme];
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-2"));
    expect(h.applyTheme).toHaveBeenCalledWith("theme-2");
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("custom");
  });

  it("does not warn or show the upgrade note when the field is present and valid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.paletteOverrides.savedDepthThemes = [themedTheme];
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-2"));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("colormapTheme"));
    expect(screen.queryByTestId("saved-theme-upgrade-note")).toBeNull();
    warnSpy.mockRestore();
  });

  it("treats an unrecognised colormapTheme value as legacy and falls back to 'ocean'", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.paletteOverrides.savedDepthThemes = [{ ...themedTheme, colormapTheme: "not-a-theme" }];
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-2"));
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
    warnSpy.mockRestore();
  });
});

describe("DepthColorsCard — activePresetId all-band comparison", () => {
  const preset = PALETTE_PRESETS[0]!;

  it("marks a preset active when ALL band colours match", () => {
    h.paletteOverrides.bandColors = bandColorsFromPreset(preset, 3);
    render(<DepthColorsCard />);
    expect(screen.getByTestId(`palette-preset-${preset.id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("does NOT mark a preset active when a middle band is customised (endpoints still match)", () => {
    const colors = [...bandColorsFromPreset(preset, 3)];
    colors[1] = "#123456"; // customise the middle band only
    h.paletteOverrides.bandColors = colors;
    // Endpoints match the preset — the old shallow/deep-only comparison would
    // have falsely reported this preset as active.
    h.paletteOverrides.shallow = preset.shallow;
    h.paletteOverrides.deep = preset.deep;
    render(<DepthColorsCard />);
    for (const p of PALETTE_PRESETS) {
      expect(screen.getByTestId(`palette-preset-${p.id}`)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });
});

describe("DepthColorsCard — server sync on palette mutations", () => {
  it("preset selection writes band colours AND flushes server sync", () => {
    render(<DepthColorsCard />);
    const preset = PALETTE_PRESETS[0]!;
    fireEvent.click(screen.getByTestId(`palette-preset-${preset.id}`));
    expect(h.setBandColors).toHaveBeenCalledWith(bandColorsFromPreset(preset, 3));
    expect(flushServerSync).toHaveBeenCalled();
  });

  it("blend-band toggle writes to the store AND flushes server sync", () => {
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("togglerow-Blend band colors"));
    expect(h.setBlendBands).toHaveBeenCalledWith(true);
    expect(flushServerSync).toHaveBeenCalled();
  });
});

describe("DepthColorsCard — RESET TO DEFAULTS is card-wide", () => {
  it("resets palette store, nodata colour, contours, interval, and colormap, then flushes sync", () => {
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("palette-reset-btn"));
    expect(h.paletteReset).toHaveBeenCalled();
    expect(h.setNodataColor).toHaveBeenCalledWith(DEFAULT_SETTINGS.nodataColor);
    expect(h.setContoursEnabled).toHaveBeenCalledWith(DEFAULT_SETTINGS.contoursEnabled);
    // Mocked settings state uses imperial units → unit-appropriate default 50 ft.
    expect(h.setContourInterval).toHaveBeenCalledWith(50);
    expect(h.setColormapTheme).toHaveBeenCalledWith(DEFAULT_SETTINGS.colormapTheme);
    expect(flushServerSync).toHaveBeenCalled();
  });
});

describe("DepthColorsCard — contour interval disabled semantics", () => {
  it("passes disabled to the contour interval row when contours are off", () => {
    // Default mocked state has contoursEnabled: false.
    render(<DepthColorsCard />);
    expect(screen.getByTestId("sliderrow-Contour Interval")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });

  it("does not disable the contour interval row when contours are on", () => {
    h.stateOverrides.contoursEnabled = true;
    render(<DepthColorsCard />);
    expect(screen.getByTestId("sliderrow-Contour Interval")).toHaveAttribute(
      "data-disabled",
      "false",
    );
  });
});
