/**
 * Unit tests for terrainTile.ts — fetchTerrainTile in-flight deduplication.
 *
 * The `_tileInFlight` map inside terrainTile.ts ensures that concurrent cache
 * misses for the same bbox+size key fire exactly one USGS request. These tests
 * verify that guarantee is not accidentally removed by a future refactor.
 *
 * Strategy: spy on `node:fs` promises to prevent disk-cache hits, then fire
 * two concurrent fetchTerrainTile calls via Promise.all before either can
 * resolve. JavaScript's single-threaded event loop guarantees:
 *   1. Call 1 runs synchronously until `await readTerrainDiskCache()` inside
 *      the inner IIFE, registers its promise in `_tileInFlight`, and returns.
 *   2. Call 2 then runs synchronously, finds the key already in `_tileInFlight`,
 *      and returns the **same** promise.
 * Both therefore resolve to the same Buffer reference — proof of dedup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as nodeFs from "node:fs";
import { fetchTerrainTile } from "./terrainTile.js";
import { clearAllCaches } from "./cacheRegistry.js";

// ---------------------------------------------------------------------------
// Minimal fake PNG payload
// A real PNG starts with an 8-byte signature. fetchTerrainTile accepts any
// buffer returned by fetch as long as the response has an image/* content-type;
// it does not validate PNG structure for non-antimeridian bboxes.
// ---------------------------------------------------------------------------
const FAKE_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x01, // minimal trailing data
]);

function makePngResponse(): Response {
  return new Response(FAKE_PNG_BYTES.buffer.slice(0) as ArrayBuffer, {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchTerrainTile — in-flight deduplication", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Clear memory tile cache so every test starts cold.
    clearAllCaches();

    // Prevent disk-cache reads from returning hits (readTerrainDiskCache catches
    // ENOENT and returns null, so every call falls through to the upstream fetch).
    vi.spyOn(nodeFs.promises, "readFile").mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT",
      }),
    );
    vi.spyOn(nodeFs.promises, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(nodeFs.promises, "writeFile").mockResolvedValue(undefined);
    vi.spyOn(nodeFs.promises, "rename").mockResolvedValue(undefined);

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(makePngResponse()),
    ) as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("two concurrent calls for the same bbox/size issue exactly one USGS fetch", async () => {
    const bbox = { minLon: -122.5, minLat: 37.5, maxLon: -122.0, maxLat: 38.0 };
    const size = 256;

    const [buf1, buf2] = await Promise.all([
      fetchTerrainTile(bbox, size),
      fetchTerrainTile(bbox, size),
    ]);

    expect(buf1).toBeTruthy();
    expect(buf2).toBeTruthy();

    // Same Buffer reference proves both calls resolved from the same in-flight
    // promise rather than running two independent upstream fetches.
    expect(buf1).toBe(buf2);

    // The USGS shaded-relief endpoint must have been called exactly once.
    const usgsCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("basemap.nationalmap.gov"),
    );
    expect(usgsCalls).toHaveLength(1);
  });

  it("a third call after the first two settle returns from memory cache (no additional fetch)", async () => {
    const bbox = { minLon: -73.9, minLat: 40.7, maxLon: -73.7, maxLat: 40.9 };
    const size = 128;

    // Two concurrent calls — both join the same in-flight promise.
    await Promise.all([
      fetchTerrainTile(bbox, size),
      fetchTerrainTile(bbox, size),
    ]);
    const callsAfterFirst = fetchSpy.mock.calls.length;

    // Third sequential call — should hit the memory cache, no new fetch.
    const buf3 = await fetchTerrainTile(bbox, size);
    expect(buf3).toBeTruthy();
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("calls for different bbox keys do NOT share in-flight promises", async () => {
    const bboxA = { minLon: -80.0, minLat: 25.0, maxLon: -79.5, maxLat: 25.5 };
    const bboxB = { minLon: -87.7, minLat: 41.8, maxLon: -87.5, maxLat: 42.0 };
    const size = 256;

    await Promise.all([
      fetchTerrainTile(bboxA, size),
      fetchTerrainTile(bboxB, size),
    ]);

    // Each unique key must have generated its own upstream request.
    const usgsCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("basemap.nationalmap.gov"),
    );
    expect(usgsCalls).toHaveLength(2);
  });
});
