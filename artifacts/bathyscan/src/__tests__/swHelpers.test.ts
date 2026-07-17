/**
 * Unit tests for swHelpers.ts — the runtime guards used by the service worker
 * message handler.
 *
 * These tests verify that `isCachePackMessage` rejects every non-CACHE_PACK
 * input so the handler never proceeds to call caches.open on unexpected data.
 */

import { describe, it, expect } from "vitest";
import { isCachePackMessage } from "@/lib/swHelpers";

describe("isCachePackMessage", () => {
  it("returns true for a well-formed CACHE_PACK message", () => {
    expect(
      isCachePackMessage({
        type: "CACHE_PACK",
        terrainUrl: "/api/datasets/123/terrain",
        overviewUrl: "/api/datasets/123/overview",
      }),
    ).toBe(true);
  });

  it("returns false for null data", () => {
    expect(isCachePackMessage(null)).toBe(false);
  });

  it("returns false for undefined data", () => {
    expect(isCachePackMessage(undefined)).toBe(false);
  });

  it("returns false for an object with an unknown type", () => {
    expect(isCachePackMessage({ type: "UNKNOWN" })).toBe(false);
  });

  it("returns false for an object with no type field", () => {
    expect(isCachePackMessage({ terrainUrl: "/x", overviewUrl: "/y" })).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isCachePackMessage("CACHE_PACK")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isCachePackMessage(42)).toBe(false);
  });

  it("returns false for an array", () => {
    expect(isCachePackMessage([{ type: "CACHE_PACK" }])).toBe(false);
  });

  it("returns false when type is CACHE_PACK but value is not an object (boolean)", () => {
    expect(isCachePackMessage(true)).toBe(false);
  });

  it("returns false for an object whose type is close but not exact", () => {
    expect(isCachePackMessage({ type: "cache_pack" })).toBe(false);
    expect(isCachePackMessage({ type: "CACHE-PACK" })).toBe(false);
  });
});
