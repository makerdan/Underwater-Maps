import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEPTH_BAND_BOUNDARIES_FT, OCEAN_MAX_DEPTH_FT } from "../lib/colormap";

// Shared stub — implementations live in src/__tests__/mocks/three.ts,
// wired via __mocks__/three.ts so no factory is needed here.
vi.mock("three");

import { getColormap } from "../lib/colormap";
import {
  usePaletteStore,
  DEFAULT_SHALLOW,
  DEFAULT_DEEP,
  DEFAULT_BAND_COLORS,
  DEFAULT_BAND_BOUNDARIES,
  sanitizeBandColors,
} from "../lib/paletteStore";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

const EPSILON = 0.01;

describe("getColormap('ocean') — endpoint and boundary colours", () => {
  it("t=0 returns the shallowest stop colour (#00e5ff)", () => {
    const c = getColormap("ocean")(0);
    const expected = hexToRgb("#00e5ff");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("t=1 returns the deepest stop colour (#283593)", () => {
    const c = getColormap("ocean")(1);
    const expected = hexToRgb("#283593");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("t=0.3 (600 ft band boundary) returns the correct stop colour (#1e2b6e)", () => {
    const c = getColormap("ocean")(0.3);
    const expected = hexToRgb("#1e2b6e");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("t=0.5 returns an interpolated colour between the 600 ft stop and the deep endpoint", () => {
    const c = getColormap("ocean")(0.5);
    // t=0.5 lies between the 600 ft stop (t=0.30, #1e2b6e) and the deep endpoint (t=1.0)
    const lo = hexToRgb("#1e2b6e");
    const hi = hexToRgb("#283593"); // default deep
    expect(c.r).toBeGreaterThanOrEqual(Math.min(lo.r, hi.r) - EPSILON);
    expect(c.r).toBeLessThanOrEqual(Math.max(lo.r, hi.r) + EPSILON);
    expect(c.g).toBeGreaterThanOrEqual(Math.min(lo.g, hi.g) - EPSILON);
    expect(c.g).toBeLessThanOrEqual(Math.max(lo.g, hi.g) + EPSILON);
  });

  it("t < 0 clamps to t=0", () => {
    const fn = getColormap("ocean");
    const cNeg = fn(-5);
    const c0 = fn(0);
    expect(cNeg.r).toBeCloseTo(c0.r, 2);
    expect(cNeg.g).toBeCloseTo(c0.g, 2);
  });

  it("t > 1 clamps to t=1", () => {
    const fn = getColormap("ocean");
    const cOver = fn(999);
    const c1 = fn(1);
    expect(cOver.r).toBeCloseTo(c1.r, 2);
    expect(cOver.b).toBeCloseTo(c1.b, 2);
  });
});

describe("getColormap", () => {
  it("returns a function for every supported theme", () => {
    const themes = ["ocean", "thermal", "grayscale", "viridis"] as const;
    for (const theme of themes) {
      const fn = getColormap(theme);
      expect(typeof fn).toBe("function");
    }
  });

  it("thermal t=0 → darkest stop (#0d0221)", () => {
    const fn = getColormap("thermal");
    const c = fn(0);
    const expected = hexToRgb("#0d0221");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("thermal t=1 → lightest stop (white #ffffff)", () => {
    const fn = getColormap("thermal");
    const c = fn(1);
    expect(c.r).toBeCloseTo(1, 2);
    expect(c.g).toBeCloseTo(1, 2);
    expect(c.b).toBeCloseTo(1, 2);
  });

  it("thermal t=0.25 → mid stop (#7b2d8b)", () => {
    const fn = getColormap("thermal");
    const c = fn(0.25);
    const expected = hexToRgb("#7b2d8b");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("thermal t=0.5 → interpolated between purple (#7b2d8b) and orange-red (#e8553e)", () => {
    const fn = getColormap("thermal");
    const c = fn(0.5);
    const lo = hexToRgb("#7b2d8b"); // t=0.25 stop
    const hi = hexToRgb("#e8553e"); // t=0.55 stop
    // t=0.5 lies between stops 0.25 and 0.55; result must be within that range
    expect(c.r).toBeGreaterThan(Math.min(lo.r, hi.r) - EPSILON);
    expect(c.r).toBeLessThan(Math.max(lo.r, hi.r) + EPSILON);
    expect(c.g).toBeGreaterThan(Math.min(lo.g, hi.g) - EPSILON);
    expect(c.g).toBeLessThan(Math.max(lo.g, hi.g) + EPSILON);
    expect(c.b).toBeGreaterThan(Math.min(lo.b, hi.b) - EPSILON);
    expect(c.b).toBeLessThan(Math.max(lo.b, hi.b) + EPSILON);
  });

  it("grayscale t=0 → near black (#050505)", () => {
    const fn = getColormap("grayscale");
    const c = fn(0);
    const expected = hexToRgb("#050505");
    expect(c.r).toBeCloseTo(expected.r, 2);
  });

  it("grayscale t=1 → near white (#e0e0e0)", () => {
    const fn = getColormap("grayscale");
    const c = fn(1);
    const expected = hexToRgb("#e0e0e0");
    expect(c.r).toBeCloseTo(expected.r, 2);
  });

  it("viridis t=0 → deep purple (#440154)", () => {
    const fn = getColormap("viridis");
    const c = fn(0);
    const expected = hexToRgb("#440154");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("viridis t=1 → bright yellow (#fde725)", () => {
    const fn = getColormap("viridis");
    const c = fn(1);
    const expected = hexToRgb("#fde725");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("ocean theme returns consistent colours at all 10-band boundary stops", () => {
    const fn = getColormap("ocean");
    // Normalised t values for the 11 band boundaries (0–2000 ft)
    const stops = DEPTH_BAND_BOUNDARIES_FT.map(
      (ft) => ft / OCEAN_MAX_DEPTH_FT,
    );
    for (const t of stops) {
      const c = fn(t);
      expect(Number.isFinite(c.r)).toBe(true);
      expect(Number.isFinite(c.g)).toBe(true);
      expect(Number.isFinite(c.b)).toBe(true);
      // Colours must be within the valid [0, 1] range
      expect(c.r).toBeGreaterThanOrEqual(0);
      expect(c.g).toBeGreaterThanOrEqual(0);
      expect(c.b).toBeGreaterThanOrEqual(0);
    }
  });

  it("returned function clamps below 0", () => {
    const fn = getColormap("thermal");
    const cNeg = fn(-1);
    const c0 = fn(0);
    expect(cNeg.r).toBeCloseTo(c0.r, 2);
    expect(cNeg.g).toBeCloseTo(c0.g, 2);
  });

  it("returned function clamps above 1", () => {
    const fn = getColormap("viridis");
    const cOver = fn(99);
    const c1 = fn(1);
    expect(cOver.r).toBeCloseTo(c1.r, 2);
    expect(cOver.g).toBeCloseTo(c1.g, 2);
  });
});

describe("getColormap('ocean') / palette sync", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
  });
  afterEach(() => {
    usePaletteStore.getState().reset();
  });

  it("reflects an updated shallow colour from usePaletteStore at t=0", () => {
    usePaletteStore.getState().setShallow("#ff0000");
    const c = getColormap("ocean")(0);
    const expected = hexToRgb("#ff0000");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("reflects an updated deep colour from usePaletteStore at t=1", () => {
    usePaletteStore.getState().setDeep("#00ff00");
    const c = getColormap("ocean")(1);
    const expected = hexToRgb("#00ff00");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("getColormap('ocean') also reflects palette updates", () => {
    usePaletteStore.getState().setShallow("#abcdef");
    usePaletteStore.getState().setDeep("#123456");
    const fn = getColormap("ocean");
    const shallow = fn(0);
    const deep = fn(1);
    const expShallow = hexToRgb("#abcdef");
    const expDeep = hexToRgb("#123456");
    expect(shallow.r).toBeCloseTo(expShallow.r, 2);
    expect(shallow.g).toBeCloseTo(expShallow.g, 2);
    expect(shallow.b).toBeCloseTo(expShallow.b, 2);
    expect(deep.r).toBeCloseTo(expDeep.r, 2);
    expect(deep.g).toBeCloseTo(expDeep.g, 2);
    expect(deep.b).toBeCloseTo(expDeep.b, 2);
  });

  it("reset() restores the default endpoints", () => {
    usePaletteStore.getState().setShallow("#ff0000");
    usePaletteStore.getState().setDeep("#00ff00");
    usePaletteStore.getState().reset();
    const fn = getColormap("ocean");
    const c0 = fn(0);
    const c1 = fn(1);
    const expShallow = hexToRgb(DEFAULT_SHALLOW);
    const expDeep = hexToRgb(DEFAULT_DEEP);
    expect(c0.r).toBeCloseTo(expShallow.r, 2);
    expect(c0.b).toBeCloseTo(expShallow.b, 2);
    expect(c1.r).toBeCloseTo(expDeep.r, 2);
    expect(c1.b).toBeCloseTo(expDeep.b, 2);
  });

  it("custom theme t=0 returns bandColors[0] (same as ocean t=0)", () => {
    usePaletteStore.getState().setBandColor(0, "#ff0000");
    const fn = getColormap("custom");
    const c0 = fn(0);
    expect(c0.r).toBeCloseTo(1, 2);
    expect(c0.g).toBeCloseTo(0, 2);
    expect(c0.b).toBeCloseTo(0, 2);
  });

  it("custom theme t=1 returns deep (same as ocean t=1)", () => {
    usePaletteStore.getState().setDeep("#0000ff");
    const fn = getColormap("custom");
    const c1 = fn(1);
    expect(c1.b).toBeCloseTo(1, 2);
    expect(c1.r).toBeCloseTo(0, 2);
  });

  it("custom theme clamps t < 0 and t > 1 to endpoints", () => {
    usePaletteStore.getState().setBandColor(0, "#ff0000");
    usePaletteStore.getState().setDeep("#0000ff");
    const fn = getColormap("custom");
    const cNeg = fn(-2);
    const cOver = fn(5);
    expect(cNeg.r).toBeCloseTo(1, 2);
    expect(cNeg.b).toBeCloseTo(0, 2);
    expect(cOver.r).toBeCloseTo(0, 2);
    expect(cOver.b).toBeCloseTo(1, 2);
  });

  it("custom theme produces identical output to ocean theme at all t values", () => {
    const customFn = getColormap("custom");
    const oceanFn = getColormap("ocean");
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const cc = customFn(t);
      const co = oceanFn(t);
      expect(cc.r).toBeCloseTo(co.r, 5);
      expect(cc.g).toBeCloseTo(co.g, 5);
      expect(cc.b).toBeCloseTo(co.b, 5);
    }
  });

  it("custom theme picks up live band colour edits to paletteStore", () => {
    usePaletteStore.getState().setBandColor(0, "#111111");
    let fn = getColormap("custom");
    const before = fn(0);
    expect(before.r).toBeCloseTo(hexToRgb("#111111").r, 2);

    usePaletteStore.getState().setBandColor(0, "#ff8800");
    fn = getColormap("custom");
    const after = fn(0);
    const expected = hexToRgb("#ff8800");
    expect(after.r).toBeCloseTo(expected.r, 2);
    expect(after.g).toBeCloseTo(expected.g, 2);
    expect(after.b).toBeCloseTo(expected.b, 2);
  });

  it("custom theme falls back to DEFAULT_BAND_COLORS when store bandColors is degenerate", () => {
    usePaletteStore.setState({ bandColors: [] as unknown as string[] });
    const fn = getColormap("custom");
    const c0 = fn(0);
    const expected = hexToRgb(DEFAULT_BAND_COLORS[0]!);
    expect(c0.r).toBeCloseTo(expected.r, 2);
    expect(c0.g).toBeCloseTo(expected.g, 2);
    expect(c0.b).toBeCloseTo(expected.b, 2);
  });

  it("does not affect fixed (non-ocean) themes", () => {
    usePaletteStore.getState().setShallow("#ff0000");
    usePaletteStore.getState().setDeep("#00ff00");
    const fn = getColormap("thermal");
    const c0 = fn(0);
    const expected = hexToRgb("#0d0221");
    expect(c0.r).toBeCloseTo(expected.r, 2);
    expect(c0.g).toBeCloseTo(expected.g, 2);
    expect(c0.b).toBeCloseTo(expected.b, 2);
  });
});

describe("sanitizeBandColors", () => {
  it("returns null for non-array input", () => {
    expect(sanitizeBandColors(null)).toBeNull();
    expect(sanitizeBandColors("oops")).toBeNull();
    expect(sanitizeBandColors(42)).toBeNull();
  });

  it("returns null when the array has fewer than 10 entries", () => {
    expect(sanitizeBandColors(["#ffffff"])).toBeNull();
  });

  it("returns null when the array has more than 10 entries", () => {
    const tooMany = Array(11).fill("#001122");
    expect(sanitizeBandColors(tooMany)).toBeNull();
  });

  it("accepts a valid 10-entry hex array and lowercases each entry", () => {
    const input = Array(10).fill("#AABBCC");
    const result = sanitizeBandColors(input);
    expect(result).not.toBeNull();
    expect(result!.every((c) => c === "#aabbcc")).toBe(true);
  });

  it("falls back to the default colour for invalid hex entries", () => {
    const input = Array(10).fill("#001122");
    input[3] = "notahex";
    const result = sanitizeBandColors(input);
    expect(result).not.toBeNull();
    expect(result![3]).toBe(DEFAULT_BAND_COLORS[3]);
    expect(result![0]).toBe("#001122");
  });
});

describe("bandColors store integration", () => {
  beforeEach(() => { usePaletteStore.getState().reset(); });
  afterEach(() => { usePaletteStore.getState().reset(); });

  it("DEFAULT_BAND_COLORS has 10 entries", () => {
    expect(DEFAULT_BAND_COLORS).toHaveLength(10);
  });

  it("store bandColors initialises to DEFAULT_BAND_COLORS", () => {
    const { bandColors } = usePaletteStore.getState();
    expect(bandColors).toHaveLength(10);
    DEFAULT_BAND_COLORS.forEach((c, i) => {
      expect(bandColors[i]).toBe(c);
    });
  });

  it("setBandColor(0, hex) updates t=0 in getOceanStops via getColormap('ocean')", () => {
    usePaletteStore.getState().setBandColor(0, "#ff0000");
    const c = getColormap("ocean")(0);
    const expected = hexToRgb("#ff0000");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("setBandColor(0, hex) also syncs the shallow field", () => {
    usePaletteStore.getState().setBandColor(0, "#ab1234");
    expect(usePaletteStore.getState().shallow).toBe("#ab1234");
  });

  it("setBandColors() replaces all band colours and getColormap picks them up", () => {
    const allRed = Array(10).fill("#ff0000") as string[];
    usePaletteStore.getState().setBandColors(allRed);
    const fn = getColormap("ocean");
    const c = fn(0);
    expect(c.r).toBeCloseTo(1, 2);
    expect(c.g).toBeCloseTo(0, 2);
    expect(c.b).toBeCloseTo(0, 2);
  });

  it("resetBandColors() restores DEFAULT_BAND_COLORS and getColormap reverts", () => {
    usePaletteStore.getState().setBandColor(6, "#ff0000");
    usePaletteStore.getState().resetBandColors();
    const fn = getColormap("ocean");
    const t = 300 / 2000;
    const c = fn(t);
    const expected = hexToRgb("#0d47a1");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("getOceanStops falls back per-entry for invalid hex strings inside a valid-length array", () => {
    // Simulate a corrupt entry sneaking past sanitizeBandColors
    const corrupt = [...DEFAULT_BAND_COLORS] as string[];
    corrupt[4] = "notvalid";
    usePaletteStore.setState({ bandColors: corrupt });
    const fn = getColormap("ocean");
    // Band 4 (200 ft) should fall back to DEFAULT_BAND_COLORS[4]
    const t = 200 / 2000;
    const c = fn(t);
    const expected = hexToRgb(DEFAULT_BAND_COLORS[4]!);
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
    // Other bands should still work (not NaN)
    expect(Number.isFinite(fn(0).r)).toBe(true);
    expect(Number.isFinite(fn(1).r)).toBe(true);
  });

  it("persist merge migration: sanitizeBandColors(undefined) returns null (migration path trigger)", () => {
    // Old localStorage payloads written before this feature have shallow/deep but
    // no bandColors. sanitizeBandColors(undefined) must return null so the persist
    // merge falls into the migration guard and seeds bandColors[0] from shallow.
    expect(sanitizeBandColors(undefined)).toBeNull();
    expect(sanitizeBandColors(null)).toBeNull();

    // Verify the store migration guard: after reset(), bandColors[0] matches
    // DEFAULT_BAND_COLORS[0], and a custom shallow would be seeded there on load.
    usePaletteStore.getState().reset();
    expect(usePaletteStore.getState().bandColors[0]).toBe(DEFAULT_BAND_COLORS[0]);

    // Confirm setShallow keeps bandColors[0] in sync (same migration invariant).
    usePaletteStore.getState().setShallow("#ff0000");
    expect(usePaletteStore.getState().bandColors[0]).toBe("#ff0000");
  });

  it("getOceanStops falls back to DEFAULT_BAND_COLORS when store is degenerate", () => {
    usePaletteStore.setState({ bandColors: [] as unknown as string[] });
    const c = getColormap("ocean")(0);
    const expected = hexToRgb(DEFAULT_BAND_COLORS[0]!);
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });
});

describe("DEPTH_BAND_BOUNDARIES_FT", () => {
  it("exports 11 boundary values (10 bands)", () => {
    expect(DEPTH_BAND_BOUNDARIES_FT).toHaveLength(11);
  });

  it("starts at 0 ft and ends at OCEAN_MAX_DEPTH_FT (2000 ft)", () => {
    expect(DEPTH_BAND_BOUNDARIES_FT[0]).toBe(0);
    expect(DEPTH_BAND_BOUNDARIES_FT[DEPTH_BAND_BOUNDARIES_FT.length - 1]).toBe(
      OCEAN_MAX_DEPTH_FT,
    );
  });

  it("boundaries are strictly ascending", () => {
    for (let i = 1; i < DEPTH_BAND_BOUNDARIES_FT.length; i++) {
      expect(DEPTH_BAND_BOUNDARIES_FT[i]).toBeGreaterThan(
        DEPTH_BAND_BOUNDARIES_FT[i - 1]!,
      );
    }
  });

  it("no two adjacent band boundaries share the same colour", () => {
    const fn = getColormap("ocean");
    // Directly compare the colour at each consecutive pair of boundaries.
    // Adjacent stops must differ in at least one RGB channel so no two
    // neighbouring bands collapse to the same hue.
    const bands = DEPTH_BAND_BOUNDARIES_FT;
    for (let i = 0; i < bands.length - 1; i++) {
      const tA = bands[i]! / OCEAN_MAX_DEPTH_FT;
      const tB = bands[i + 1]! / OCEAN_MAX_DEPTH_FT;
      const cA = fn(tA);
      const cB = fn(tB);
      const rDiff = Math.abs(cA.r - cB.r);
      const gDiff = Math.abs(cA.g - cB.g);
      const bDiff = Math.abs(cA.b - cB.b);
      expect(rDiff + gDiff + bDiff).toBeGreaterThan(0.01);
    }
  });

  it("exact colours at key band boundaries (300 ft, 350 ft, 450 ft, 600 ft)", () => {
    const fn = getColormap("ocean");
    const check = (ft: number, hex: string) => {
      const t = ft / OCEAN_MAX_DEPTH_FT;
      const c = fn(t);
      const exp = hexToRgb(hex);
      expect(c.r).toBeCloseTo(exp.r, 2);
      expect(c.g).toBeCloseTo(exp.g, 2);
      expect(c.b).toBeCloseTo(exp.b, 2);
    };
    check(300, "#0d47a1"); // royal blue
    check(350, "#1a237e"); // indigo navy
    check(450, "#283593"); // deep navy
    check(600, "#1e2b6e"); // dark navy
  });

  it("normalised t positions for all boundaries fall within [0, 1]", () => {
    for (const ft of DEPTH_BAND_BOUNDARIES_FT) {
      const t = ft / OCEAN_MAX_DEPTH_FT;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });
});

describe("getOceanStops respects live bandBoundaries from store", () => {
  beforeEach(() => { usePaletteStore.getState().reset(); });
  afterEach(() => { usePaletteStore.getState().reset(); });

  it("by default, each band stop t-position matches DEFAULT_BAND_BOUNDARIES[i] / 2000", () => {
    const fn = getColormap("ocean");
    for (let i = 0; i < 10; i++) {
      const ft = DEFAULT_BAND_BOUNDARIES[i]!;
      const t = ft / OCEAN_MAX_DEPTH_FT;
      const c = fn(t);
      const expected = hexToRgb(DEFAULT_BAND_COLORS[i]!);
      expect(c.r).toBeCloseTo(expected.r, 2);
      expect(c.g).toBeCloseTo(expected.g, 2);
      expect(c.b).toBeCloseTo(expected.b, 2);
    }
  });

  it("after setBandBoundary, the moved stop's colour appears at the new t-position", () => {
    usePaletteStore.getState().setBandBoundary(3, 180);
    const updated = usePaletteStore.getState().bandBoundaries;
    expect(updated[3]).toBe(180);

    const fn = getColormap("ocean");
    const tNew = 180 / OCEAN_MAX_DEPTH_FT;
    const c = fn(tNew);
    const expected = hexToRgb(usePaletteStore.getState().bandColors[3]!);
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("after setBandBoundary, the old t-position yields an interpolated colour (stop has moved)", () => {
    // Move boundary[2] from 100 ft → 120 ft.
    // At the old position (t = 100/2000) the value is now between stop 1
    // (at t = 50/2000) and the moved stop 2 (at t = 120/2000).
    usePaletteStore.getState().setBandBoundary(2, 120);
    const fn = getColormap("ocean");
    const bc = usePaletteStore.getState().bandColors;

    const tOld = 100 / OCEAN_MAX_DEPTH_FT;       // 0.05
    const tStop1 = 50 / OCEAN_MAX_DEPTH_FT;       // 0.025
    const tStop2New = 120 / OCEAN_MAX_DEPTH_FT;   // 0.06

    const stop1Color = hexToRgb(bc[1]!);
    const stop2Color = hexToRgb(bc[2]!);

    // t=0.05 is between stop1 (t=0.025) and stop2 (t=0.06)
    const alpha = (tOld - tStop1) / (tStop2New - tStop1);
    const expectedR = stop1Color.r + (stop2Color.r - stop1Color.r) * alpha;
    const expectedG = stop1Color.g + (stop2Color.g - stop1Color.g) * alpha;
    const expectedB = stop1Color.b + (stop2Color.b - stop1Color.b) * alpha;

    const cAtOld = fn(tOld);
    expect(cAtOld.r).toBeCloseTo(expectedR, 2);
    expect(cAtOld.g).toBeCloseTo(expectedG, 2);
    expect(cAtOld.b).toBeCloseTo(expectedB, 2);
  });

  it("setBandBoundaries with a custom array makes all stop t-values reflect the new boundaries", () => {
    const custom = [0, 60, 110, 160, 210, 260, 310, 360, 460, 620, 2000];
    usePaletteStore.getState().setBandBoundaries(custom);
    const fn = getColormap("ocean");
    const bc = usePaletteStore.getState().bandColors;

    for (let i = 0; i < 10; i++) {
      const t = custom[i]! / OCEAN_MAX_DEPTH_FT;
      const c = fn(t);
      const expected = hexToRgb(bc[i]!);
      expect(c.r).toBeCloseTo(expected.r, 2);
      expect(c.g).toBeCloseTo(expected.g, 2);
      expect(c.b).toBeCloseTo(expected.b, 2);
    }
  });

  it("getOceanStops falls back to DEFAULT_BAND_BOUNDARIES when store has a degenerate boundaries array", () => {
    usePaletteStore.setState({ bandBoundaries: [] as unknown as number[] });
    const fn = getColormap("ocean");

    for (let i = 0; i < 10; i++) {
      const ft = DEFAULT_BAND_BOUNDARIES[i]!;
      const t = ft / OCEAN_MAX_DEPTH_FT;
      const c = fn(t);
      const expected = hexToRgb(DEFAULT_BAND_COLORS[i]!);
      expect(c.r).toBeCloseTo(expected.r, 2);
      expect(c.g).toBeCloseTo(expected.g, 2);
      expect(c.b).toBeCloseTo(expected.b, 2);
    }
  });

  it("resetBandBoundaries() reverts to DEFAULT_BAND_BOUNDARIES in the ocean colormap", () => {
    const custom = [0, 60, 110, 160, 210, 260, 310, 360, 460, 620, 2000];
    usePaletteStore.getState().setBandBoundaries(custom);
    usePaletteStore.getState().resetBandBoundaries();

    const fn = getColormap("ocean");
    for (let i = 0; i < 10; i++) {
      const ft = DEFAULT_BAND_BOUNDARIES[i]!;
      const t = ft / OCEAN_MAX_DEPTH_FT;
      const c = fn(t);
      const expected = hexToRgb(DEFAULT_BAND_COLORS[i]!);
      expect(c.r).toBeCloseTo(expected.r, 2);
      expect(c.g).toBeCloseTo(expected.g, 2);
      expect(c.b).toBeCloseTo(expected.b, 2);
    }
  });
});
