/**
 * catchJournal.test.ts — pure-function tests for the catch-journal feature.
 *
 * Covers:
 *  - searchCatchSymbols / catchSymbolName (emoji catalog search)
 *  - validatePhotoFile (type/size gate before upload)
 *  - layoutCatchSymbols (non-overlapping 3D symbol layout)
 *  - groupCatchSymbolsByMarker (one symbol per entry, duplicates kept)
 *  - buildMarkerDescription + GPX/KML export inclusion of catch symbols
 */
import { describe, it, expect } from "vitest";
import {
  CATCH_SYMBOLS,
  searchCatchSymbols,
  catchSymbolName,
} from "../catchSymbols";
import { validatePhotoFile } from "@/components/CatchJournalPanel";
import {
  layoutCatchSymbols,
  CATCH_SYMBOLS_PER_ROW,
  CATCH_SYMBOL_SPACING,
  CATCH_ROW_SPACING,
} from "@/components/MarkerSprite";
import { groupCatchSymbolsByMarker } from "@/components/MarkerLayer";
import type { CatchEntry } from "@workspace/api-client-react";
import {
  buildMarkerDescription,
  serializeGpx,
  serializeKml,
} from "../gpsExport";

describe("searchCatchSymbols", () => {
  it("returns the full catalog for an empty query", () => {
    expect(searchCatchSymbols("")).toHaveLength(CATCH_SYMBOLS.length);
    expect(searchCatchSymbols("   ")).toHaveLength(CATCH_SYMBOLS.length);
  });

  it("matches by name, case-insensitive", () => {
    const results = searchCatchSymbols("SHARK");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((s) =>
      s.name.toLowerCase().includes("shark") ||
      s.keywords.some((k) => k.includes("shark")),
    )).toBe(true);
  });

  it("matches by keyword", () => {
    const results = searchCatchSymbols("crab");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns [] for a nonsense query", () => {
    expect(searchCatchSymbols("zzzznotafish")).toEqual([]);
  });
});

describe("catchSymbolName", () => {
  it("returns the catalog name for a known symbol", () => {
    const first = CATCH_SYMBOLS[0]!;
    expect(catchSymbolName(first.symbol)).toBe(first.name);
  });

  it("returns an empty string for a symbol not in the catalog", () => {
    expect(catchSymbolName("🚗")).toBe("");
  });
});

describe("validatePhotoFile", () => {
  it("accepts jpeg/png/webp/gif under 10MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(validatePhotoFile({ type, size: 5 * 1024 * 1024 })).toBeNull();
    }
  });

  it("rejects unsupported types", () => {
    expect(validatePhotoFile({ type: "application/pdf", size: 100 })).toBeTruthy();
    expect(validatePhotoFile({ type: "image/svg+xml", size: 100 })).toBeTruthy();
  });

  it("rejects files over 10MB", () => {
    expect(validatePhotoFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toBeTruthy();
  });
});

describe("layoutCatchSymbols", () => {
  it("returns one offset per symbol", () => {
    expect(layoutCatchSymbols(0)).toEqual([]);
    expect(layoutCatchSymbols(3)).toHaveLength(3);
    expect(layoutCatchSymbols(12)).toHaveLength(12);
  });

  it("centres a single symbol at the origin", () => {
    expect(layoutCatchSymbols(1)).toEqual([[0, 0]]);
  });

  it("spaces symbols in a row so none overlap", () => {
    const offsets = layoutCatchSymbols(4);
    const xs = offsets.map(([x]) => x);
    const sorted = [...xs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeCloseTo(CATCH_SYMBOL_SPACING);
    }
    // Centred: mean x is 0
    expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
  });

  it("wraps to a new row after CATCH_SYMBOLS_PER_ROW and never overlaps", () => {
    const count = CATCH_SYMBOLS_PER_ROW + 2;
    const offsets = layoutCatchSymbols(count);
    // First row at y=0, second row above
    expect(offsets[0]![1]).toBe(0);
    expect(offsets[CATCH_SYMBOLS_PER_ROW]![1]).toBeCloseTo(CATCH_ROW_SPACING);
    // No two symbols share the same position
    const keys = new Set(offsets.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`));
    expect(keys.size).toBe(count);
  });
});

const entry = (markerId: string, symbol: string): CatchEntry => ({
  id: `${markerId}-${symbol}`,
  markerId,
  userId: "u1",
  symbol,
  symbolName: "",
  notes: null,
  photos: [],
  createdAt: "2026-07-18T00:00:00Z",
  updatedAt: "2026-07-18T00:00:00Z",
});

describe("groupCatchSymbolsByMarker", () => {
  it("groups one symbol per entry, duplicates kept, insertion order", () => {
    const map = groupCatchSymbolsByMarker([
      entry("m1", "🐟"),
      entry("m1", "🦀"),
      entry("m1", "🐟"),
      entry("m2", "🦑"),
    ]);
    expect(map.get("m1")).toEqual(["🐟", "🦀", "🐟"]);
    expect(map.get("m2")).toEqual(["🦑"]);
    expect(map.has("m3")).toBe(false);
  });

  it("returns an empty map for no entries", () => {
    expect(groupCatchSymbolsByMarker([]).size).toBe(0);
  });
});

describe("catch symbols in GPS export", () => {
  const marker = {
    lon: -136.1,
    lat: 58.4,
    depth: 42,
    label: "Halibut Hole",
    type: "fishing_spot",
    notes: "Slack tide best",
    catchSymbols: ["🐟", "🦀"],
  };

  it("buildMarkerDescription combines notes and catches", () => {
    expect(buildMarkerDescription(marker)).toBe("Slack tide best | Catches: 🐟 🦀");
    expect(buildMarkerDescription({ ...marker, notes: null })).toBe("Catches: 🐟 🦀");
    expect(buildMarkerDescription({ ...marker, notes: null, catchSymbols: [] })).toBe("");
  });

  it("includes catch symbols in the GPX <desc>", () => {
    const gpx = serializeGpx({ datasetName: "Test", markers: [marker], routes: [] });
    expect(gpx).toContain("Catches: 🐟 🦀");
    expect(gpx).toContain("<desc>");
  });

  it("includes catch symbols in the KML <description>", () => {
    const kml = serializeKml({ datasetName: "Test", markers: [marker], routes: [] });
    expect(kml).toContain("Catches: 🐟 🦀");
    expect(kml).toContain("<description>");
  });

  it("omits desc entirely when there are no notes and no catches", () => {
    const bare = { ...marker, notes: null, catchSymbols: undefined };
    const gpx = serializeGpx({ datasetName: "Test", markers: [bare], routes: [] });
    expect(gpx).not.toContain("<desc>");
  });
});
