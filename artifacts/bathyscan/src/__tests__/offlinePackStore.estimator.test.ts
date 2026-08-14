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
//   widthM  = dLon × 111 000
//   heightM = dLat × 111 000
//   areaM2  = widthM × heightM
//   samples = areaM2 / resolutionM²
//   bytes   = samples × avgBytesPerSample + OVERHEAD
//   avgBytesPerSample: resolutionM ≤ 2 → 4, else → 1

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
