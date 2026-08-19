/**
 * paletteStore — 12-band depth layout default + reset (Task 4219 / #4177).
 *
 * Pins the literal band count so a future default-palette change cannot
 * silently ship a different depth-band layout:
 *   - a fresh session (store defaults) uses 12 bands (13 boundaries), and
 *   - Reset to Defaults restores the 12-band layout after customisation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  usePaletteStore,
  DEFAULT_BAND_BOUNDARIES,
  DEFAULT_BAND_COLORS,
} from "@/lib/paletteStore";

beforeEach(() => {
  usePaletteStore.getState().reset();
});

afterEach(() => {
  usePaletteStore.getState().reset();
});

describe("paletteStore — 12-band depth layout", () => {
  it("ships 12 default band colors and 13 boundaries (12 bands)", () => {
    expect(DEFAULT_BAND_COLORS).toHaveLength(12);
    expect(DEFAULT_BAND_BOUNDARIES).toHaveLength(13);
  });

  it("a fresh session renders the 12-band layout by default", () => {
    const s = usePaletteStore.getState();
    expect(s.bandColors).toHaveLength(12);
    expect(s.bandBoundaries).toHaveLength(13);
    expect(s.bandColors).toEqual([...DEFAULT_BAND_COLORS]);
    expect(s.bandBoundaries).toEqual([...DEFAULT_BAND_BOUNDARIES]);
  });

  it("Reset to Defaults restores the 12-band layout after a custom band count", () => {
    // Customise to a non-default band count (6 bands / 7 boundaries).
    usePaletteStore.getState().setBandBoundaries([0, 50, 100, 200, 400, 800, 2000]);
    usePaletteStore
      .getState()
      .setBandColors(["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"]);
    expect(usePaletteStore.getState().bandColors).toHaveLength(6);

    usePaletteStore.getState().reset();

    const s = usePaletteStore.getState();
    expect(s.bandColors).toHaveLength(12);
    expect(s.bandBoundaries).toHaveLength(13);
    expect(s.bandColors).toEqual([...DEFAULT_BAND_COLORS]);
    expect(s.bandBoundaries).toEqual([...DEFAULT_BAND_BOUNDARIES]);
  });

  it("resetBandColors/resetBandBoundaries individually restore the 12-band defaults", () => {
    usePaletteStore.getState().setBandBoundaries([0, 50, 100, 200, 400, 800, 2000]);
    usePaletteStore
      .getState()
      .setBandColors(["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"]);

    usePaletteStore.getState().resetBandColors();
    usePaletteStore.getState().resetBandBoundaries();

    expect(usePaletteStore.getState().bandColors).toHaveLength(12);
    expect(usePaletteStore.getState().bandBoundaries).toHaveLength(13);
  });
});
