/**
 * Unit tests for paletteStore — custom-stop CRUD, normalisation, sanitisation
 * of malformed persisted state, and minimum-stop enforcement.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  usePaletteStore,
  sanitizeCustomStops,
  customStopsFromPreset,
  DEFAULT_CUSTOM_STOPS,
  DEFAULT_SHALLOW,
  DEFAULT_DEEP,
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
