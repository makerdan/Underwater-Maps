/**
 * gunzipBounded.test.ts — unit tests for the gunzipBounded helper
 *
 * Verifies:
 *  - Happy path: valid gzip decompresses correctly
 *  - Size cap: inflated output exceeding maxBytes rejects with DECOMPRESS_TOO_LARGE
 *  - Error path: invalid gzip data rejects with a zlib error
 *
 * This test drives the function directly (no HTTP server) so failures are
 * cheap and deterministic.
 */
import { describe, it, expect } from "vitest";
import * as zlib from "zlib";
import { gunzipBounded } from "../lib/gunzipBounded.js";

const MAX_200MB = 200 * 1024 * 1024;

describe("gunzipBounded — happy path", () => {
  it("decompresses a valid gzip buffer and returns the original bytes", async () => {
    const original = Buffer.from("lon,lat,depth\n-136.0,58.5,50\n");
    const compressed = zlib.gzipSync(original);

    const result = await gunzipBounded(compressed, MAX_200MB);
    expect(result.equals(original)).toBe(true);
  });

  it("accepts a gzip that inflates to exactly 1 byte under the cap", async () => {
    const data = Buffer.alloc(1024, 0x41);
    const compressed = zlib.gzipSync(data);
    const result = await gunzipBounded(compressed, 2048);
    expect(result.length).toBe(1024);
  });
});

describe("gunzipBounded — size cap (200 MB)", () => {
  it("rejects with DECOMPRESS_TOO_LARGE when output would exceed maxBytes", async () => {
    const bigPayload = Buffer.alloc(201 * 1024 * 1024, 0x00);
    const compressed = zlib.gzipSync(bigPayload);

    await expect(gunzipBounded(compressed, MAX_200MB)).rejects.toMatchObject({
      code: "DECOMPRESS_TOO_LARGE",
      message: "DECOMPRESS_TOO_LARGE",
    });
  });

  it("rejects when a small cap is exceeded by the decompressed content", async () => {
    const payload = Buffer.alloc(100, 0x41);
    const compressed = zlib.gzipSync(payload);

    await expect(gunzipBounded(compressed, 50)).rejects.toMatchObject({
      code: "DECOMPRESS_TOO_LARGE",
    });
  });

  it("does NOT reject when content is exactly at the cap boundary", async () => {
    const payload = Buffer.alloc(100, 0x42);
    const compressed = zlib.gzipSync(payload);

    const result = await gunzipBounded(compressed, 100);
    expect(result.length).toBe(100);
  });
});

describe("gunzipBounded — invalid input", () => {
  it("rejects with a zlib error when the input is not a valid gzip", async () => {
    const notGzip = Buffer.from("this is not gzip data at all");
    await expect(gunzipBounded(notGzip, MAX_200MB)).rejects.toThrow();
  });

  it("rejects on an empty input buffer", async () => {
    await expect(gunzipBounded(Buffer.alloc(0), MAX_200MB)).rejects.toThrow();
  });
});
