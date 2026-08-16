/**
 * Unit tests for the bbox-area offline-pack size estimator.
 *
 * Verifies that estimatePackStorageBytesFromBbox produces deterministic,
 * formula-correct results for known inputs.  The async estimatePackStorageBytes
 * wrapper is smoke-tested to confirm it delegates to the bbox path when hints
 * are present and falls back to the stub when they are absent.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ── Prevent idb-keyval from accessing a real IndexedDB during import ──────────
vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(async () => []),
}));

import {
  estimatePackStorageBytesFromBbox,
  estimatePackStorageBytes,
} from "@/lib/offlinePackStore";

const OVERHEAD = 200 * 1024; // 204 800 bytes

// ── Formula reference ─────────────────────────────────────────────────────────
//   midLat  = (minLat + maxLat) / 2
//   cosLat  = max(0, cos(midLat × π/180))
//   widthM  = dLon × 111 000 × cosLat   ← cosine latitude correction
//   heightM = dLat × 111 000
//   areaM2  = widthM × heightM
//   samples = areaM2 / resolutionM²
//   bytes   = samples × avgBytesPerSample + OVERHEAD
//   avgBytesPerSample: resolutionM ≤ 2 → 4, else → 1
//
//   Note: equatorial tests (minLat=0, maxLat=0.01) have midLat≈0, cos≈1,
//   so expected values are identical to the pre-correction formula.

describe("estimatePackStorageBytesFromBbox", () => {
  it("returns overhead-only for a zero-area bbox", () => {
    const result = estimatePackStorageBytesFromBbox({
      bbox: { minLon: 10, maxLon: 10, minLat: 50, maxLat: 50 },
    });
    // sampleCount = 0 / anything = 0; bytes = 0 × 1 + OVERHEAD
    expect(result).toBe(OVERHEAD);
  });

  it("computes correctly for a 0.01° × 0.01° bbox at default 10 m resolution", () => {
    // widthM  = 0.01 × 111 000 = 1 110
    // heightM = 0.01 × 111 000 = 1 110
    // areaM2  = 1 110 × 1 110 = 1 232 100
    // samples = 1 232 100 / (10 × 10) = 12 321
    // avgBytesPerSample = 1  (10 m > 2 m)
    // bytes   = 12 321 × 1 + 204 800 = 217 121
    const result = estimatePackStorageBytesFromBbox({
      bbox: { minLon: 0, maxLon: 0.01, minLat: 0, maxLat: 0.01 },
    });
    expect(result).toBe(12_321 + OVERHEAD);
  });

  it("uses 4 bytes/sample for fine (≤ 2 m) resolution", () => {
    // Same 0.01° × 0.01° bbox, resolutionM = 1
    // samples = 1 232 100 / (1 × 1) = 1 232 100
    // avgBytesPerSample = 4
    // bytes = 1 232 100 × 4 + 204 800 = 5 133 200
    const result = estimatePackStorageBytesFromBbox({
      bbox: { minLon: 0, maxLon: 0.01, minLat: 0, maxLat: 0.01 },
      resolutionM: 1,
    });
    expect(result).toBe(1_232_100 * 4 + OVERHEAD);
  });

  it("uses 4 bytes/sample for resolutionM = 2 (boundary value)", () => {
    // samples = 1 232 100 / (2 × 2) = 308 025
    // avgBytesPerSample = 4  (2 ≤ 2)
    // bytes = 308 025 × 4 + 204 800 = 1 436 900
    const result = estimatePackStorageBytesFromBbox({
      bbox: { minLon: 0, maxLon: 0.01, minLat: 0, maxLat: 0.01 },
      resolutionM: 2,
    });
    expect(result).toBe(308_025 * 4 + OVERHEAD);
  });

  it("uses 1 byte/sample for resolutionM = 3 (just above boundary)", () => {
    // samples = floor(1 232 100 / 9) = 136 900
    // avgBytesPerSample = 1
    const widthM  = 0.01 * 111_000;
    const areaM2  = widthM * widthM;
    const samples = Math.round(areaM2 / (3 * 3));
    const result = estimatePackStorageBytesFromBbox({
      bbox: { minLon: 0, maxLon: 0.01, minLat: 0, maxLat: 0.01 },
      resolutionM: 3,
    });
    expect(result).toBe(samples * 1 + OVERHEAD);
  });

  it("treats a non-square bbox proportionally", () => {
    // 0.02° wide × 0.01° tall → area = 2× the square case at 10 m
    const square = estimatePackStorageBytesFromBbox({
      bbox: { minLon: 0, maxLon: 0.01, minLat: 0, maxLat: 0.01 },
    });
    const wide = estimatePackStorageBytesFromBbox({
      bbox: { minLon: 0, maxLon: 0.02, minLat: 0, maxLat: 0.01 },
    });
    // terrain bytes should be 2× (overhead is the same)
    const squareTerrain = square - OVERHEAD;
    const wideTerrain   = wide   - OVERHEAD;
    expect(wideTerrain).toBe(squareTerrain * 2);
  });

  it("handles negative coordinate order gracefully (abs diff)", () => {
    const normal   = estimatePackStorageBytesFromBbox({
      bbox: { minLon: 0, maxLon: 0.01, minLat: 0, maxLat: 0.01 },
    });
    const reversed = estimatePackStorageBytesFromBbox({
      bbox: { minLon: 0.01, maxLon: 0, minLat: 0.01, maxLat: 0 },
    });
    expect(reversed).toBe(normal);
  });
});

// ── resolutionM round-trip: dataset metadata → estimator → bytes ──────────────
//
// Verifies that a fine-resolution dataset (1 m multibeam) produces a
// substantially larger estimate than a coarse regional survey (10 m default),
// mirroring the wiring added in OfflinePackModal and BulkOfflinePanel.

describe("resolutionM round-trip from dataset metadata", () => {
  const bbox = { minLon: -135, maxLon: -134.9, minLat: 57, maxLat: 57.1 };

  it("1 m multibeam yields more bytes than 10 m regional survey", () => {
    const fine   = estimatePackStorageBytesFromBbox({ bbox, resolutionM: 1 });
    const coarse = estimatePackStorageBytesFromBbox({ bbox, resolutionM: 10 });
    expect(fine).toBeGreaterThan(coarse);
  });

  it("passing resolutionM through estimatePackStorageBytes honours the hint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const fine   = await estimatePackStorageBytes("ds-fine",   { bbox, resolutionM: 1 });
    const coarse = await estimatePackStorageBytes("ds-coarse", { bbox, resolutionM: 10 });

    // Bbox path never touches the network.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fine).toBeGreaterThan(coarse);
    // Fine estimate should match the direct formula call.
    expect(fine).toBe(estimatePackStorageBytesFromBbox({ bbox, resolutionM: 1 }));
  });

  it("omitting resolutionM behaves identically to passing 10", async () => {
    const withDefault  = await estimatePackStorageBytes("ds-a", { bbox });
    const withExplicit = await estimatePackStorageBytes("ds-b", { bbox, resolutionM: 10 });
    expect(withDefault).toBe(withExplicit);
  });

  it("cosine latitude correction: 57 °N estimate is strictly less than flat-earth", () => {
    // Flat-earth (pre-fix) formula: widthM = dLon × 111 000 (no cos correction)
    const dLon = Math.abs(bbox.maxLon - bbox.minLon); // 0.1
    const dLat = Math.abs(bbox.maxLat - bbox.minLat); // 0.1
    const flatWidthM  = dLon * 111_000;
    const flatHeightM = dLat * 111_000;
    const flatSamples = (flatWidthM * flatHeightM) / (10 * 10);
    const flatEarth   = Math.round(flatSamples * 1 + OVERHEAD);

    const corrected = estimatePackStorageBytesFromBbox({ bbox, resolutionM: 10 });

    expect(corrected).toBeLessThan(flatEarth);
    // At 57 °N, cos ≈ 0.544, so width is roughly halved → estimate ~54 % of flat-earth.
    expect(corrected).toBeLessThan(flatEarth * 0.8);
  });
});

// ── estimatePackStorageBytes (async wrapper) ───────────────────────────────────

describe("estimatePackStorageBytes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the bbox formula result when bbox hints are supplied (no fetch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const bbox = { minLon: 0, maxLon: 0.01, minLat: 0, maxLat: 0.01 };
    const expected = estimatePackStorageBytesFromBbox({ bbox });
    const result = await estimatePackStorageBytes("ds-1", { bbox });
    expect(result).toBe(expected);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to 2.5 MB stub when no hints and fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const result = await estimatePackStorageBytes("ds-2");
    expect(result).toBe(2.5 * 1024 * 1024);
  });

  it("falls back to 2.5 MB stub when no hints and Content-Length is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200, headers: {} }),
    );
    const result = await estimatePackStorageBytes("ds-3");
    expect(result).toBe(2.5 * 1024 * 1024);
  });

  it("uses Content-Length + 200 KB overhead when header is present and no hints", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-length": "1048576" }, // 1 MiB
      }),
    );
    const result = await estimatePackStorageBytes("ds-4");
    expect(result).toBe(1_048_576 + OVERHEAD);
  });
});

// ── resolutionM without bbox: stub is scaled, not silently ignored ─────────────
//
// When only resolutionM is supplied (no bbox), the 2.5 MiB base stub is scaled
// by the same resolution tier used in estimatePackStorageBytesFromBbox:
//   ≤ 2 m → 4 × 2.5 MiB   (fine survey, worse compression)
//   > 2 m → 1 × 2.5 MiB   (regional survey, better compression)
// This prevents a 1 m multibeam survey from receiving the same stub estimate
// as a 10 m regional survey when the dataset has no bbox.

const STUB_BASE = 2.5 * 1024 * 1024;

describe("estimatePackStorageBytes — resolutionM without bbox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scales stub by 4× for fine resolution (1 m) when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const result = await estimatePackStorageBytes("ds-fine", { resolutionM: 1 });
    expect(result).toBe(Math.round(STUB_BASE * 4));
  });

  it("scales stub by 4× for resolutionM = 2 (boundary value) when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const result = await estimatePackStorageBytes("ds-2m", { resolutionM: 2 });
    expect(result).toBe(Math.round(STUB_BASE * 4));
  });

  it("does not scale stub for coarse resolution (3 m, > 2 m threshold) when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const result = await estimatePackStorageBytes("ds-coarse", { resolutionM: 3 });
    expect(result).toBe(Math.round(STUB_BASE * 1));
  });

  it("1 m survey stub exceeds 10 m survey stub when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const fine   = await estimatePackStorageBytes("ds-a", { resolutionM: 1 });
    const coarse = await estimatePackStorageBytes("ds-b", { resolutionM: 10 });
    expect(fine).toBeGreaterThan(coarse);
  });

  it("Content-Length is returned unscaled even for fine resolution (actual size wins)", async () => {
    // When the HEAD response carries a real Content-Length, that value is
    // authoritative — resolution scaling only applies to the blind stub.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-length": "1048576" }, // 1 MiB
      }),
    );
    const result = await estimatePackStorageBytes("ds-cl", { resolutionM: 1 });
    expect(result).toBe(1_048_576 + OVERHEAD);
  });

  it("no hints and no bbox defaults to unscaled 2.5 MiB stub (resolutionM defaults to 10 m)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const withNoHints      = await estimatePackStorageBytes("ds-x");
    const withDefault10m   = await estimatePackStorageBytes("ds-y", { resolutionM: 10 });
    expect(withNoHints).toBe(Math.round(STUB_BASE));
    expect(withDefault10m).toBe(Math.round(STUB_BASE));
  });
});
