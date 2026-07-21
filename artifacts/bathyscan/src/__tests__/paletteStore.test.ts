/**
 * Unit tests for paletteStore — custom-stop CRUD, normalisation, sanitisation
 * of malformed persisted state, and minimum-stop enforcement.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  usePaletteStore,
  sanitizeCustomStops,
  sanitizeBandBoundaries,
  customStopsFromPreset,
  DEFAULT_CUSTOM_STOPS,
  DEFAULT_SHALLOW,
  DEFAULT_DEEP,
  DEFAULT_BAND_BOUNDARIES,
  MIN_BOUNDARY_GAP_FT,
  PALETTE_PRESETS,
} from "../lib/paletteStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  usePaletteStore.getState().reset();
});

describe("paletteStore.setCustomStops", () => {
  it("sorts stops ascending by position on write", () => {
    usePaletteStore.getState().setCustomStops([
      { position: 1.0, hex: "#111111" },
      { position: 0.0, hex: "#222222" },
      { position: 0.5, hex: "#333333" },
    ]);
    const stops = usePaletteStore.getState().customStops;
    expect(stops.map((s) => s.position)).toEqual([0, 0.5, 1]);
    expect(stops[0]!.hex).toBe("#222222");
    expect(stops[2]!.hex).toBe("#111111");
  });

  it("clamps out-of-range positions into [0, 1]", () => {
    usePaletteStore.getState().setCustomStops([
      { position: -5, hex: "#aaaaaa" },
      { position: 7, hex: "#bbbbbb" },
    ]);
    const stops = usePaletteStore.getState().customStops;
    expect(stops[0]!.position).toBe(0);
    expect(stops[1]!.position).toBe(1);
  });

  it("coerces hex values to lowercase", () => {
    usePaletteStore.getState().setCustomStops([
      { position: 0, hex: "#AABBCC" },
      { position: 1, hex: "#DDEEFF" },
    ]);
    const stops = usePaletteStore.getState().customStops;
    expect(stops[0]!.hex).toBe("#aabbcc");
    expect(stops[1]!.hex).toBe("#ddeeff");
  });

  it("falls back to defaults when fewer than 2 valid stops remain", () => {
    usePaletteStore.getState().setCustomStops([
      { position: 0.3, hex: "not-a-hex" },
      { position: Number.NaN, hex: "#abcdef" },
    ]);
    const stops = usePaletteStore.getState().customStops;
    expect(stops).toEqual(DEFAULT_CUSTOM_STOPS);
  });
});

describe("paletteStore.addCustomStop", () => {
  it("inserts a stop into the largest gap with a midpoint colour", () => {
    usePaletteStore.getState().setCustomStops([
      { position: 0, hex: "#000000" },
      { position: 1, hex: "#ffffff" },
    ]);
    usePaletteStore.getState().addCustomStop();
    const stops = usePaletteStore.getState().customStops;
    expect(stops).toHaveLength(3);
    expect(stops[1]!.position).toBeCloseTo(0.5, 5);
    // Midpoint of black/white should be mid-grey.
    expect(stops[1]!.hex).toBe("#808080");
  });

  it("keeps the list sorted after insertion", () => {
    usePaletteStore.getState().setCustomStops([
      { position: 0, hex: "#000000" },
      { position: 0.2, hex: "#222222" },
      { position: 1, hex: "#ffffff" },
    ]);
    usePaletteStore.getState().addCustomStop();
    const positions = usePaletteStore.getState().customStops.map((s) => s.position);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });
});

describe("paletteStore.removeCustomStop", () => {
  it("removes the stop at the given index", () => {
    usePaletteStore.getState().setCustomStops([
      { position: 0, hex: "#111111" },
      { position: 0.5, hex: "#222222" },
      { position: 1, hex: "#333333" },
    ]);
    usePaletteStore.getState().removeCustomStop(1);
    const stops = usePaletteStore.getState().customStops;
    expect(stops).toHaveLength(2);
    expect(stops.map((s) => s.hex)).toEqual(["#111111", "#333333"]);
  });

  it("refuses to remove when only 2 stops remain (min-2 enforcement)", () => {
    usePaletteStore.getState().setCustomStops([
      { position: 0, hex: "#111111" },
      { position: 1, hex: "#222222" },
    ]);
    usePaletteStore.getState().removeCustomStop(0);
    const stops = usePaletteStore.getState().customStops;
    expect(stops).toHaveLength(2);
    expect(stops[0]!.hex).toBe("#111111");
    expect(stops[1]!.hex).toBe("#222222");
  });
});

describe("paletteStore.updateCustomStop", () => {
  beforeEach(() => {
    usePaletteStore.getState().setCustomStops([
      { position: 0, hex: "#111111" },
      { position: 0.5, hex: "#222222" },
      { position: 1, hex: "#333333" },
    ]);
  });

  it("patches only the targeted stop", () => {
    usePaletteStore.getState().updateCustomStop(1, { hex: "#abcdef" });
    const stops = usePaletteStore.getState().customStops;
    expect(stops[1]!.hex).toBe("#abcdef");
    expect(stops[0]!.hex).toBe("#111111");
    expect(stops[2]!.hex).toBe("#333333");
  });

  it("re-sorts after a position change crosses a neighbour", () => {
    usePaletteStore.getState().updateCustomStop(0, { position: 0.9 });
    const stops = usePaletteStore.getState().customStops;
    expect(stops.map((s) => s.position)).toEqual([0.5, 0.9, 1]);
  });

  it("clamps the new position to [0, 1]", () => {
    usePaletteStore.getState().updateCustomStop(1, { position: 5 });
    const stops = usePaletteStore.getState().customStops;
    expect(stops.every((s) => s.position >= 0 && s.position <= 1)).toBe(true);
  });

  it("ignores out-of-range indices", () => {
    const before = usePaletteStore.getState().customStops;
    usePaletteStore.getState().updateCustomStop(-1, { hex: "#000000" });
    usePaletteStore.getState().updateCustomStop(99, { hex: "#000000" });
    expect(usePaletteStore.getState().customStops).toEqual(before);
  });
});

describe("paletteStore.resetCustomStops", () => {
  it("restores the default 4-stop custom palette", () => {
    usePaletteStore.getState().setCustomStops([
      { position: 0, hex: "#abcdef" },
      { position: 1, hex: "#fedcba" },
    ]);
    usePaletteStore.getState().resetCustomStops();
    expect(usePaletteStore.getState().customStops).toEqual(DEFAULT_CUSTOM_STOPS);
  });
});

describe("paletteStore.reset", () => {
  it("restores shallow, deep, and customStops to defaults", () => {
    const s = usePaletteStore.getState();
    s.setShallow("#ff0000");
    s.setDeep("#00ff00");
    s.setCustomStops([
      { position: 0, hex: "#abcdef" },
      { position: 1, hex: "#fedcba" },
    ]);
    s.reset();
    const after = usePaletteStore.getState();
    expect(after.shallow).toBe(DEFAULT_SHALLOW);
    expect(after.deep).toBe(DEFAULT_DEEP);
    expect(after.customStops).toEqual(DEFAULT_CUSTOM_STOPS);
  });
});

describe("sanitizeCustomStops", () => {
  it("returns null for non-arrays", () => {
    expect(sanitizeCustomStops(null)).toBeNull();
    expect(sanitizeCustomStops(undefined)).toBeNull();
    expect(sanitizeCustomStops("nope")).toBeNull();
    expect(sanitizeCustomStops({})).toBeNull();
  });

  it("drops entries with bad hex or non-finite positions", () => {
    const result = sanitizeCustomStops([
      { position: 0, hex: "#aabbcc" },
      { position: "x", hex: "#ddeeff" },
      { position: 0.5, hex: "red" },
      { position: 1, hex: "#001122" },
      null,
      42,
    ]);
    expect(result).toEqual([
      { position: 0, hex: "#aabbcc" },
      { position: 1, hex: "#001122" },
    ]);
  });

  it("returns null when fewer than 2 valid stops remain", () => {
    expect(
      sanitizeCustomStops([{ position: 0, hex: "#aabbcc" }]),
    ).toBeNull();
    expect(
      sanitizeCustomStops([
        { position: 0, hex: "bad" },
        { position: 1, hex: "#aabbcc" },
      ]),
    ).toBeNull();
  });

  it("clamps positions and lowercases hex", () => {
    const result = sanitizeCustomStops([
      { position: -1, hex: "#AABBCC" },
      { position: 2, hex: "#DDEEFF" },
    ]);
    expect(result).toEqual([
      { position: 0, hex: "#aabbcc" },
      { position: 1, hex: "#ddeeff" },
    ]);
  });

  it("sorts ascending by position", () => {
    const result = sanitizeCustomStops([
      { position: 0.8, hex: "#111111" },
      { position: 0.1, hex: "#222222" },
      { position: 0.5, hex: "#333333" },
    ]);
    expect(result?.map((s) => s.position)).toEqual([0.1, 0.5, 0.8]);
  });
});

describe("persist merge hook", () => {
  it("falls back to default custom stops when persisted state is malformed", () => {
    localStorage.setItem(
      "bathyscan:palette",
      JSON.stringify({
        state: {
          shallow: DEFAULT_SHALLOW,
          deep: DEFAULT_DEEP,
          customStops: "this is not an array",
        },
        version: 0,
      }),
    );
    usePaletteStore.persist.rehydrate();
    expect(usePaletteStore.getState().customStops).toEqual(DEFAULT_CUSTOM_STOPS);
  });

  it("falls back to default custom stops when array has fewer than 2 valid entries", () => {
    localStorage.setItem(
      "bathyscan:palette",
      JSON.stringify({
        state: {
          shallow: DEFAULT_SHALLOW,
          deep: DEFAULT_DEEP,
          customStops: [{ position: 0, hex: "not-hex" }],
        },
        version: 0,
      }),
    );
    usePaletteStore.persist.rehydrate();
    expect(usePaletteStore.getState().customStops).toEqual(DEFAULT_CUSTOM_STOPS);
  });

  it("keeps a well-formed persisted custom palette through rehydration", () => {
    const good = [
      { position: 0, hex: "#abcdef" },
      { position: 0.7, hex: "#123456" },
      { position: 1, hex: "#fedcba" },
    ];
    localStorage.setItem(
      "bathyscan:palette",
      JSON.stringify({
        state: { shallow: DEFAULT_SHALLOW, deep: DEFAULT_DEEP, customStops: good },
        version: 0,
      }),
    );
    usePaletteStore.persist.rehydrate();
    expect(usePaletteStore.getState().customStops).toEqual(good);
  });

  it("keeps well-formed bandBoundaries through rehydration", () => {
    const good = [0, 40, 90, 140, 190, 240, 290, 340, 440, 590, 2000];
    localStorage.setItem(
      "bathyscan:palette",
      JSON.stringify({
        state: { shallow: DEFAULT_SHALLOW, deep: DEFAULT_DEEP, bandBoundaries: good },
        version: 0,
      }),
    );
    usePaletteStore.persist.rehydrate();
    expect(usePaletteStore.getState().bandBoundaries).toEqual(good);
  });

  it("falls back to DEFAULT_BAND_BOUNDARIES when persisted bandBoundaries is malformed", () => {
    localStorage.setItem(
      "bathyscan:palette",
      JSON.stringify({
        state: {
          shallow: DEFAULT_SHALLOW,
          deep: DEFAULT_DEEP,
          bandBoundaries: [0, 50, 50, 150, 200, 250, 300, 350, 450, 600, 2000],
        },
        version: 0,
      }),
    );
    usePaletteStore.persist.rehydrate();
    expect(usePaletteStore.getState().bandBoundaries).toEqual([...DEFAULT_BAND_BOUNDARIES]);
  });

  it("falls back to DEFAULT_BAND_BOUNDARIES when persisted bandBoundaries is absent (legacy row)", () => {
    localStorage.setItem(
      "bathyscan:palette",
      JSON.stringify({
        state: { shallow: DEFAULT_SHALLOW, deep: DEFAULT_DEEP, customStops: DEFAULT_CUSTOM_STOPS },
        version: 0,
      }),
    );
    usePaletteStore.persist.rehydrate();
    expect(usePaletteStore.getState().bandBoundaries).toEqual([...DEFAULT_BAND_BOUNDARIES]);
  });

  it("falls back to DEFAULT_BAND_BOUNDARIES when persisted bandBoundaries is not an array", () => {
    localStorage.setItem(
      "bathyscan:palette",
      JSON.stringify({
        state: { shallow: DEFAULT_SHALLOW, deep: DEFAULT_DEEP, bandBoundaries: "corrupt" },
        version: 0,
      }),
    );
    usePaletteStore.persist.rehydrate();
    expect(usePaletteStore.getState().bandBoundaries).toEqual([...DEFAULT_BAND_BOUNDARIES]);
  });
});

describe("paletteStore.hydrateFromServer", () => {
  it("applies valid shallow / deep hex from the server", () => {
    usePaletteStore.getState().hydrateFromServer({
      paletteShallow: "#AABBCC",
      paletteDeep: "#112233",
    });
    const st = usePaletteStore.getState();
    expect(st.shallow).toBe("#aabbcc");
    expect(st.deep).toBe("#112233");
  });

  it("leaves shallow / deep untouched when the server hex is malformed", () => {
    const before = usePaletteStore.getState();
    usePaletteStore.getState().hydrateFromServer({
      paletteShallow: "not-a-hex",
      paletteDeep: "#xyz123",
    });
    const after = usePaletteStore.getState();
    expect(after.shallow).toBe(before.shallow);
    expect(after.deep).toBe(before.deep);
  });

  it("leaves shallow / deep untouched when the server fields are missing or non-string", () => {
    const before = usePaletteStore.getState();
    usePaletteStore.getState().hydrateFromServer({
      paletteShallow: 12345 as unknown as string,
      paletteDeep: undefined,
    });
    const after = usePaletteStore.getState();
    expect(after.shallow).toBe(before.shallow);
    expect(after.deep).toBe(before.deep);
  });

  it("applies a well-formed customStops payload from the server", () => {
    const incoming = [
      { position: 0, hex: "#abcdef" },
      { position: 0.4, hex: "#123456" },
      { position: 1, hex: "#fedcba" },
    ];
    usePaletteStore.getState().hydrateFromServer({ customStops: incoming });
    expect(usePaletteStore.getState().customStops).toEqual(incoming);
  });

  it("clamps out-of-range positions in incoming customStops to [0, 1]", () => {
    usePaletteStore.getState().hydrateFromServer({
      customStops: [
        { position: -2, hex: "#aabbcc" },
        { position: 0.5, hex: "#445566" },
        { position: 5, hex: "#ddeeff" },
      ],
    });
    const stops = usePaletteStore.getState().customStops;
    expect(stops.map((s) => s.position)).toEqual([0, 0.5, 1]);
  });

  it("leaves customStops untouched when the payload has fewer than 2 valid stops", () => {
    // First seed a known non-default palette so we can prove it survived.
    const seeded = [
      { position: 0, hex: "#abcdef" },
      { position: 1, hex: "#fedcba" },
    ];
    usePaletteStore.getState().setCustomStops(seeded);

    usePaletteStore.getState().hydrateFromServer({
      customStops: [{ position: 0.5, hex: "#aabbcc" }],
    });
    expect(usePaletteStore.getState().customStops).toEqual(seeded);

    usePaletteStore.getState().hydrateFromServer({
      customStops: [
        { position: 0, hex: "not-hex" },
        { position: 1, hex: "also-not-hex" },
      ],
    });
    expect(usePaletteStore.getState().customStops).toEqual(seeded);
  });

  it("leaves customStops untouched when the payload is not an array", () => {
    const seeded = [
      { position: 0, hex: "#abcdef" },
      { position: 1, hex: "#fedcba" },
    ];
    usePaletteStore.getState().setCustomStops(seeded);
    usePaletteStore.getState().hydrateFromServer({
      customStops: "definitely not an array" as unknown,
    });
    expect(usePaletteStore.getState().customStops).toEqual(seeded);
  });

  it("drops only the malformed entries when some stops are bad", () => {
    usePaletteStore.getState().hydrateFromServer({
      customStops: [
        { position: 0, hex: "#aabbcc" },
        { position: 0.5, hex: "garbage" },
        { position: "x" as unknown as number, hex: "#112233" },
        { position: 1, hex: "#001122" },
      ] as unknown,
    });
    expect(usePaletteStore.getState().customStops).toEqual([
      { position: 0, hex: "#aabbcc" },
      { position: 1, hex: "#001122" },
    ]);
  });

  it("applies a partial payload independently per field", () => {
    // Pre-seed a non-default palette so we can tell which fields moved.
    const seededStops = [
      { position: 0, hex: "#abcdef" },
      { position: 1, hex: "#fedcba" },
    ];
    usePaletteStore.getState().setShallow("#010203");
    usePaletteStore.getState().setDeep("#040506");
    usePaletteStore.getState().setCustomStops(seededStops);

    // Only paletteDeep present — shallow and customStops must survive.
    usePaletteStore.getState().hydrateFromServer({ paletteDeep: "#aabbcc" });
    const st = usePaletteStore.getState();
    expect(st.shallow).toBe("#010203");
    expect(st.deep).toBe("#aabbcc");
    expect(st.customStops).toEqual(seededStops);
  });

  it("applies a valid bandBoundaries payload from the server", () => {
    const incoming = [0, 40, 90, 140, 190, 240, 290, 340, 440, 590, 2000];
    usePaletteStore.getState().hydrateFromServer({ bandBoundaries: incoming });
    expect(usePaletteStore.getState().bandBoundaries).toEqual(incoming);
  });

  it("leaves bandBoundaries untouched when the payload is not an array", () => {
    const before = [...usePaletteStore.getState().bandBoundaries];
    usePaletteStore.getState().hydrateFromServer({
      bandBoundaries: "not an array" as unknown,
    });
    expect(usePaletteStore.getState().bandBoundaries).toEqual(before);
  });

  it("leaves bandBoundaries untouched when the payload has wrong length", () => {
    const before = [...usePaletteStore.getState().bandBoundaries];
    usePaletteStore.getState().hydrateFromServer({
      bandBoundaries: [0, 50, 100, 150, 200, 250, 300, 350, 450, 2000],
    });
    expect(usePaletteStore.getState().bandBoundaries).toEqual(before);
  });

  it("leaves bandBoundaries untouched when the payload is not strictly increasing", () => {
    const before = [...usePaletteStore.getState().bandBoundaries];
    usePaletteStore.getState().hydrateFromServer({
      bandBoundaries: [0, 50, 50, 150, 200, 250, 300, 350, 450, 600, 2000],
    });
    expect(usePaletteStore.getState().bandBoundaries).toEqual(before);
  });

  it("leaves bandBoundaries untouched when the payload does not start at 0", () => {
    const before = [...usePaletteStore.getState().bandBoundaries];
    usePaletteStore.getState().hydrateFromServer({
      bandBoundaries: [10, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000],
    });
    expect(usePaletteStore.getState().bandBoundaries).toEqual(before);
  });

  it("accepts a payload ending at a value other than 2000 (last boundary is editable)", () => {
    const custom = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 1999];
    usePaletteStore.getState().hydrateFromServer({ bandBoundaries: custom });
    expect(usePaletteStore.getState().bandBoundaries).toEqual(custom);
  });

  it("applies only bandBoundaries when it is the sole field present; other fields survive", () => {
    const seededBoundaries = [0, 60, 110, 160, 210, 260, 310, 360, 460, 610, 2000];
    usePaletteStore.getState().setBandBoundaries(seededBoundaries);
    usePaletteStore.getState().setShallow("#aabbcc");
    usePaletteStore.getState().setDeep("#112233");

    const newBoundaries = [0, 40, 90, 140, 190, 240, 290, 340, 440, 590, 2000];
    usePaletteStore.getState().hydrateFromServer({ bandBoundaries: newBoundaries });

    const st = usePaletteStore.getState();
    expect(st.bandBoundaries).toEqual(newBoundaries);
    expect(st.shallow).toBe("#aabbcc");
    expect(st.deep).toBe("#112233");
  });
});

describe("customStopsFromPreset", () => {
  it("uses the preset's shallow and deep endpoints", () => {
    for (const preset of PALETTE_PRESETS) {
      const stops = customStopsFromPreset(preset);
      expect(stops).toHaveLength(4);
      expect(stops[0]!.hex).toBe(preset.shallow);
      expect(stops[3]!.hex).toBe(preset.deep);
      expect(stops[0]!.position).toBe(0);
      expect(stops[3]!.position).toBe(1);
    }
  });
});

describe("sanitizeBandBoundaries", () => {
  it("returns null for non-array input", () => {
    expect(sanitizeBandBoundaries(null)).toBeNull();
    expect(sanitizeBandBoundaries(undefined)).toBeNull();
    expect(sanitizeBandBoundaries("string")).toBeNull();
    expect(sanitizeBandBoundaries(42)).toBeNull();
    expect(sanitizeBandBoundaries({})).toBeNull();
  });

  it("returns null when the array has fewer than 3 entries (min 2 bands)", () => {
    expect(sanitizeBandBoundaries([0, 2000])).toBeNull();
    expect(sanitizeBandBoundaries([0])).toBeNull();
    expect(sanitizeBandBoundaries([])).toBeNull();
  });

  it("returns null when the array has more than 17 entries (max 16 bands)", () => {
    const long = Array.from({ length: 18 }, (_, i) => i * 100);
    expect(long).toHaveLength(18);
    expect(sanitizeBandBoundaries(long)).toBeNull();
  });

  it("accepts variable-length arrays between 3 and 17 entries", () => {
    expect(sanitizeBandBoundaries([0, 100, 500])).toEqual([0, 100, 500]);
    const seventeen = Array.from({ length: 17 }, (_, i) => i * 50);
    expect(sanitizeBandBoundaries(seventeen)).toEqual(seventeen);
  });

  it("returns null when the first value is not 0", () => {
    const wrong = [1, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000];
    expect(sanitizeBandBoundaries(wrong)).toBeNull();
  });

  it("accepts a last value other than 2000 (editable up to 36000)", () => {
    const custom = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 1999];
    expect(sanitizeBandBoundaries(custom)).toEqual(custom);
    const deepScale = [0, 5000, 36000];
    expect(sanitizeBandBoundaries(deepScale)).toEqual(deepScale);
  });

  it("returns null when the last value exceeds 36000", () => {
    expect(sanitizeBandBoundaries([0, 100, 36001])).toBeNull();
  });

  it("returns null when the array contains a non-number entry", () => {
    const withString = [0, 50, 100, 150, 200, 250, 300, 350, 450, "600", 2000];
    expect(sanitizeBandBoundaries(withString)).toBeNull();
  });

  it("returns null when the array contains Infinity or NaN", () => {
    const withInfinity = [0, 50, 100, 150, 200, 250, 300, 350, 450, Infinity, 2000];
    const withNaN = [0, 50, 100, 150, 200, 250, 300, 350, 450, NaN, 2000];
    expect(sanitizeBandBoundaries(withInfinity)).toBeNull();
    expect(sanitizeBandBoundaries(withNaN)).toBeNull();
  });

  it("returns null when values are non-monotonic (a value does not exceed its predecessor)", () => {
    const flat = [0, 50, 100, 100, 200, 250, 300, 350, 450, 600, 2000];
    const decreasing = [0, 50, 100, 80, 200, 250, 300, 350, 450, 600, 2000];
    expect(sanitizeBandBoundaries(flat)).toBeNull();
    expect(sanitizeBandBoundaries(decreasing)).toBeNull();
  });

  it("rounds float values to integers and accepts the result", () => {
    const withFloats = [0, 50.4, 100.7, 150, 200, 250, 300, 350, 450, 600, 2000];
    const result = sanitizeBandBoundaries(withFloats);
    expect(result).not.toBeNull();
    expect(result![1]).toBe(50);
    expect(result![2]).toBe(101);
  });

  it("returns null when rounding makes values non-monotonic", () => {
    const borderline = [0, 50, 100, 100.4, 200, 250, 300, 350, 450, 600, 2000];
    expect(sanitizeBandBoundaries(borderline)).toBeNull();
  });

  it("accepts a valid 11-entry strictly-increasing array", () => {
    const valid = [...DEFAULT_BAND_BOUNDARIES];
    const result = sanitizeBandBoundaries(valid);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(11);
    expect(result![0]).toBe(0);
    expect(result![10]).toBe(2000);
    for (let i = 1; i < result!.length; i++) {
      expect(result![i]).toBeGreaterThan(result![i - 1]!);
    }
  });
});

describe("paletteStore.setBandBoundary", () => {
  beforeEach(() => { usePaletteStore.getState().reset(); });
  afterEach(() => { usePaletteStore.getState().reset(); });

  it("ignores index 0 (fixed lower endpoint)", () => {
    const before = [...usePaletteStore.getState().bandBoundaries];
    usePaletteStore.getState().setBandBoundary(0, 100);
    expect(usePaletteStore.getState().bandBoundaries[0]).toBe(before[0]);
  });

  it("updates index 10 (last boundary is now editable)", () => {
    usePaletteStore.getState().setBandBoundary(10, 1000);
    expect(usePaletteStore.getState().bandBoundaries[10]).toBe(1000);
  });

  it("clamps the last boundary to MAX_BOUNDARY_FT", () => {
    usePaletteStore.getState().setBandBoundary(10, 99999);
    expect(usePaletteStore.getState().bandBoundaries[10]).toBe(36000);
  });

  it("updates an interior boundary to a valid value", () => {
    usePaletteStore.getState().setBandBoundary(3, 160);
    expect(usePaletteStore.getState().bandBoundaries[3]).toBe(160);
  });

  it("clamps the new value to at least prev + MIN_BOUNDARY_GAP_FT", () => {
    const bb = usePaletteStore.getState().bandBoundaries;
    const prev = bb[1]!;
    usePaletteStore.getState().setBandBoundary(2, prev - 1);
    const updated = usePaletteStore.getState().bandBoundaries[2]!;
    expect(updated).toBeGreaterThanOrEqual(prev + MIN_BOUNDARY_GAP_FT);
  });

  it("clamps the new value to at most next - MIN_BOUNDARY_GAP_FT", () => {
    const bb = usePaletteStore.getState().bandBoundaries;
    const next = bb[3]!;
    usePaletteStore.getState().setBandBoundary(2, next + 100);
    const updated = usePaletteStore.getState().bandBoundaries[2]!;
    expect(updated).toBeLessThanOrEqual(next - MIN_BOUNDARY_GAP_FT);
  });

  it("rounds the incoming value to the nearest integer", () => {
    usePaletteStore.getState().setBandBoundary(5, 255.7);
    expect(usePaletteStore.getState().bandBoundaries[5]).toBe(256);
  });

  it("reflects the updated boundary immediately in the store", () => {
    usePaletteStore.getState().setBandBoundary(4, 220);
    const bb = usePaletteStore.getState().bandBoundaries;
    expect(bb[4]).toBe(220);
    expect(bb[0]).toBe(0);
    expect(bb[10]).toBe(2000);
  });

  it("leaves all other boundaries unchanged", () => {
    const before = [...usePaletteStore.getState().bandBoundaries];
    usePaletteStore.getState().setBandBoundary(6, 310);
    const after = usePaletteStore.getState().bandBoundaries;
    for (let i = 0; i < 11; i++) {
      if (i !== 6) expect(after[i]).toBe(before[i]);
    }
    expect(after[6]).toBe(310);
  });
});

describe("paletteStore.setBandBoundaries / resetBandBoundaries", () => {
  beforeEach(() => { usePaletteStore.getState().reset(); });
  afterEach(() => { usePaletteStore.getState().reset(); });

  it("replaces all boundaries with a valid array", () => {
    const custom = [0, 60, 110, 160, 210, 260, 310, 360, 460, 610, 2000];
    usePaletteStore.getState().setBandBoundaries(custom);
    expect(usePaletteStore.getState().bandBoundaries).toEqual(custom);
  });

  it("falls back to defaults when the input is invalid", () => {
    usePaletteStore.getState().setBandBoundaries([1, 2, 3]);
    expect(usePaletteStore.getState().bandBoundaries).toEqual([...DEFAULT_BAND_BOUNDARIES]);
  });

  it("resetBandBoundaries() restores DEFAULT_BAND_BOUNDARIES", () => {
    const custom = [0, 60, 110, 160, 210, 260, 310, 360, 460, 610, 2000];
    usePaletteStore.getState().setBandBoundaries(custom);
    usePaletteStore.getState().resetBandBoundaries();
    expect(usePaletteStore.getState().bandBoundaries).toEqual([...DEFAULT_BAND_BOUNDARIES]);
  });

  it("reset() also restores bandBoundaries to defaults", () => {
    const custom = [0, 60, 110, 160, 210, 260, 310, 360, 460, 610, 2000];
    usePaletteStore.getState().setBandBoundaries(custom);
    usePaletteStore.getState().reset();
    expect(usePaletteStore.getState().bandBoundaries).toEqual([...DEFAULT_BAND_BOUNDARIES]);
  });
});
