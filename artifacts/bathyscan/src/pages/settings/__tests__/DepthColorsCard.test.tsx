/**
 * DepthColorsCard unit tests.
 *
 * Covers the "Apply saved theme" behaviour:
 *   - When the active colormap is a non-band theme (e.g. "thermal"), clicking
 *     APPLY must call setColormapThemeByUser("ocean") so the band palette
 *     actually drives the renderer.
 *   - When the active colormap is already a band theme ("ocean" | "custom"),
 *     clicking APPLY must NOT call setColormapThemeByUser — no unnecessary write.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoisted mock primitives (read by vi.mock factories below)
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const applyTheme = vi.fn();
  const setColormapThemeByUser = vi.fn();
  const stateOverrides: Record<string, unknown> = {};
  return { applyTheme, setColormapThemeByUser, stateOverrides };
});

// ---------------------------------------------------------------------------
// paletteStore mock
// ---------------------------------------------------------------------------
vi.mock("@/lib/paletteStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paletteStore")>();

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
    reset: vi.fn(),
    setBandColors: vi.fn(),
    setBandBoundaries: vi.fn(),
    setBlendBands: vi.fn(),
    setShallow: vi.fn(),
    setDeep: vi.fn(),
    saveCurrentTheme: vi.fn(),
    deleteTheme: vi.fn(),
    renameTheme: vi.fn(),
    applyTheme: h.applyTheme,
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
    brightDaylight: false,
    colormapUserSet: false,
    nodataColor: "#bfbfbf",
    setNodataColor: vi.fn(),
    contoursEnabled: false,
    setContoursEnabled: vi.fn(),
    contourInterval: 10,
    setContourInterval: vi.fn(),
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

// Stub RowWidgets — the interaction tests don't need real row rendering
vi.mock(
  "@/pages/settings/components/RowWidgets",
  () => ({
    SliderRow: ({ label }: { label: string }) => <div>{label}</div>,
    ToggleRow: ({ label }: { label: string }) => <div>{label}</div>,
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
  defaultContourInterval: 10,
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks are wired)
// ---------------------------------------------------------------------------
import { DepthColorsCard } from "../components/DepthColorsCard";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DepthColorsCard — Apply saved theme", () => {
  beforeEach(() => {
    h.applyTheme.mockClear();
    h.setColormapThemeByUser.mockClear();
    for (const k of Object.keys(h.stateOverrides)) delete h.stateOverrides[k];
  });

  it("calls applyTheme when APPLY is clicked", () => {
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.applyTheme).toHaveBeenCalledWith("theme-1");
  });

  it("calls setColormapThemeByUser('ocean') when the active colormap is a non-band theme (thermal)", () => {
    // Override the colormapTheme to a non-band value
    h.stateOverrides.colormapTheme = "thermal";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.applyTheme).toHaveBeenCalledWith("theme-1");
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });

  it("does NOT call setColormapThemeByUser when the active colormap is already 'ocean'", () => {
    // Default mock state has colormapTheme: "ocean"
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.applyTheme).toHaveBeenCalledWith("theme-1");
    expect(h.setColormapThemeByUser).not.toHaveBeenCalled();
  });

  it("does NOT call setColormapThemeByUser when the active colormap is 'custom'", () => {
    h.stateOverrides.colormapTheme = "custom";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.applyTheme).toHaveBeenCalledWith("theme-1");
    expect(h.setColormapThemeByUser).not.toHaveBeenCalled();
  });

  it("calls setColormapThemeByUser('ocean') when the active colormap is 'grayscale'", () => {
    h.stateOverrides.colormapTheme = "grayscale";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });

  it("calls setColormapThemeByUser('ocean') when the active colormap is 'viridis'", () => {
    h.stateOverrides.colormapTheme = "viridis";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });

  it("calls setColormapThemeByUser('ocean') when the active colormap is 'freshwater'", () => {
    h.stateOverrides.colormapTheme = "freshwater";
    render(<DepthColorsCard />);
    fireEvent.click(screen.getByTestId("apply-theme-theme-1"));
    expect(h.setColormapThemeByUser).toHaveBeenCalledWith("ocean");
  });
});
