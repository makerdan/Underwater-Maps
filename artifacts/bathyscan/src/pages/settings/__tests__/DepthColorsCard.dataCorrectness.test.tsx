/**
 * DepthColorsCard data-correctness regression tests.
 *
 * Covers: ContourIntervalRow's clampSlider guard ensures NaN / out-of-range
 * persisted contourInterval values never reach the range input as invalid state.
 *
 * Units tested: imperial (sliderMin=1, sliderMax=200, default=50).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => {
  const data = {
    contourInterval: 50,
    units: "imperial" as "metric" | "imperial" | "nautical",
    contoursEnabled: true,
  };
  return { data };
});

vi.mock("@/lib/paletteStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paletteStore")>();

  const state = () => ({
    shallow: "#001a33",
    deep: "#00bcd4",
    bandColors: ["#001a33", "#0077cc", "#00bcd4"],
    bandBoundaries: [0, 50, 100],
    blendBands: false,
    savedDepthThemes: [],
    reset: vi.fn(),
    setBandColors: vi.fn(),
    setBandBoundaries: vi.fn(),
    setBlendBands: vi.fn(),
    setShallow: vi.fn(),
    setDeep: vi.fn(),
    saveCurrentTheme: vi.fn(),
    deleteTheme: vi.fn(),
    renameTheme: vi.fn(),
    applyTheme: vi.fn(),
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

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    colormapTheme: "ocean" as const,
    setColormapThemeByUser: vi.fn(),
    setColormapTheme: vi.fn(),
    brightDaylight: false,
    colormapUserSet: false,
    nodataColor: "#bfbfbf",
    setNodataColor: vi.fn(),
    contoursEnabled: h.data.contoursEnabled,
    setContoursEnabled: vi.fn(),
    contourInterval: h.data.contourInterval,
    setContourInterval: vi.fn(),
    units: h.data.units,
    setUnits: vi.fn(),
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

vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: vi.fn(),
}));

vi.mock("@/lib/colormap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/colormap")>();
  return {
    ...actual,
    colormapCanvas: () => document.createElement("canvas"),
    colormapCssGradient: () => "linear-gradient(to right, #000, #fff)",
  };
});

import { DepthColorsCard } from "../components/DepthColorsCard";

beforeEach(() => {
  h.data.contourInterval = 50;
  h.data.units = "imperial";
  h.data.contoursEnabled = true;
});

describe("DepthColorsCard ContourIntervalRow — NaN clamping", () => {
  it("replaces NaN contourInterval with the unit default (50 ft for imperial)", () => {
    h.data.contourInterval = NaN;
    render(<DepthColorsCard />);
    const slider = screen.getByLabelText("Contour Interval") as HTMLInputElement;
    expect(Number(slider.value)).toBe(50);
  });
});

describe("DepthColorsCard ContourIntervalRow — out-of-range clamping", () => {
  it("clamps contourInterval above the imperial max to 200", () => {
    h.data.contourInterval = 9999;
    render(<DepthColorsCard />);
    const slider = screen.getByLabelText("Contour Interval") as HTMLInputElement;
    expect(Number(slider.value)).toBe(200);
  });

  it("clamps contourInterval below the imperial min to 1", () => {
    h.data.contourInterval = 0;
    render(<DepthColorsCard />);
    const slider = screen.getByLabelText("Contour Interval") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1);
  });
});

describe("DepthColorsCard ContourIntervalRow — metric NaN clamping", () => {
  it("replaces NaN contourInterval with the metric default (10 m)", () => {
    h.data.units = "metric";
    h.data.contourInterval = NaN;
    render(<DepthColorsCard />);
    const slider = screen.getByLabelText("Contour Interval") as HTMLInputElement;
    expect(Number(slider.value)).toBe(10);
  });
});
