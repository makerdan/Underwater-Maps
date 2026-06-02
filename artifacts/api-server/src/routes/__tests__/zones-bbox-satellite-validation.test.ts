/**
 * zones-bbox-satellite-validation.test.ts
 *
 * Regression tests for Zod query-string validation on:
 *   GET /datasets/:id/zones          — ZonesQuerySchema (h, w)
 *   GET /terrain/land                — TerrainLandQuerySchema (bbox, size)
 *   GET /terrain/satellite-tile      — TerrainSatelliteQuerySchema (bbox, size)
 *   GET /terrain/download/info       — TerrainDownloadInfoQuerySchema (north/south/east/west)
 *
 * Tests validate schemas directly (no HTTP server) to keep them fast and
 * focused. Each suite covers the happy path, missing/invalid values, and
 * array-injection attacks.
 */

import { describe, it, expect } from "vitest";
import {
  ZonesQuerySchema,
  TerrainLandQuerySchema,
  TerrainSatelliteQuerySchema,
  TerrainDownloadInfoQuerySchema,
} from "../schemas.js";

// ---------------------------------------------------------------------------
// ZonesQuerySchema — GET /datasets/:id/zones
// ---------------------------------------------------------------------------

describe("ZonesQuerySchema — GET /datasets/:id/zones", () => {
  const VALID_SHA256 = "a".repeat(64);
  const VALID_FNV    = "deadbeef";

  it("accepts a valid 64-char SHA-256 hash with saltwater", () => {
    const result = ZonesQuerySchema.safeParse({ h: VALID_SHA256, w: "saltwater" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.h).toBe(VALID_SHA256);
      expect(result.data.w).toBe("saltwater");
    }
  });

  it("accepts a valid 8-char FNV-1a hash with freshwater", () => {
    const result = ZonesQuerySchema.safeParse({ h: VALID_FNV, w: "freshwater" });
    expect(result.success).toBe(true);
  });

  it("rejects a hash of wrong length (16 chars)", () => {
    const result = ZonesQuerySchema.safeParse({ h: "a".repeat(16), w: "saltwater" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/hex string/i);
    }
  });

  it("rejects an uppercase hex hash", () => {
    const result = ZonesQuerySchema.safeParse({ h: "A".repeat(64), w: "saltwater" });
    expect(result.success).toBe(false);
  });

  it("rejects a hash containing non-hex characters", () => {
    const result = ZonesQuerySchema.safeParse({ h: "z".repeat(64), w: "saltwater" });
    expect(result.success).toBe(false);
  });

  it("rejects missing h", () => {
    const result = ZonesQuerySchema.safeParse({ w: "saltwater" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown waterType value", () => {
    const result = ZonesQuerySchema.safeParse({ h: VALID_SHA256, w: "brackish" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/saltwater.*freshwater|freshwater.*saltwater/i);
    }
  });

  it("rejects missing w", () => {
    const result = ZonesQuerySchema.safeParse({ h: VALID_SHA256 });
    expect(result.success).toBe(false);
  });

  it("rejects array injection on h (?h[]=...&h[]=...)", () => {
    const result = ZonesQuerySchema.safeParse({ h: [VALID_SHA256, VALID_SHA256], w: "saltwater" });
    expect(result.success).toBe(false);
  });

  it("rejects array injection on w (?w[]=saltwater&w[]=freshwater)", () => {
    const result = ZonesQuerySchema.safeParse({ h: VALID_SHA256, w: ["saltwater", "freshwater"] });
    expect(result.success).toBe(false);
  });

  it("rejects single-element array injection on w", () => {
    const result = ZonesQuerySchema.safeParse({ h: VALID_SHA256, w: ["saltwater"] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TerrainLandQuerySchema — GET /terrain/land
// ---------------------------------------------------------------------------

describe("TerrainLandQuerySchema — GET /terrain/land", () => {
  const VALID_BBOX = "-122.5,37.5,-121.5,38.5";

  it("accepts a valid bbox string with no size", () => {
    const result = TerrainLandQuerySchema.safeParse({ bbox: VALID_BBOX });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bbox).toEqual([-122.5, 37.5, -121.5, 38.5]);
      expect(result.data.size).toBe(128);
    }
  });

  it("accepts a valid bbox with an explicit size", () => {
    const result = TerrainLandQuerySchema.safeParse({ bbox: VALID_BBOX, size: "64" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.size).toBe(64);
  });

  it("rejects a bbox string with only 3 values", () => {
    const result = TerrainLandQuerySchema.safeParse({ bbox: "-122.5,37.5,-121.5" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/bbox/i);
    }
  });

  it("rejects a bbox string containing Infinity", () => {
    const result = TerrainLandQuerySchema.safeParse({ bbox: "Infinity,37.5,-121.5,38.5" });
    expect(result.success).toBe(false);
  });

  it("rejects a bbox string containing NaN", () => {
    const result = TerrainLandQuerySchema.safeParse({ bbox: "NaN,37.5,-121.5,38.5" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing bbox", () => {
    const result = TerrainLandQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects array injection on bbox (?bbox[]=...&bbox[]=...)", () => {
    const result = TerrainLandQuerySchema.safeParse({ bbox: [VALID_BBOX, VALID_BBOX] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/string/i);
    }
  });

  it("rejects array injection on size (?size[]=64&size[]=128)", () => {
    const result = TerrainLandQuerySchema.safeParse({ bbox: VALID_BBOX, size: ["64", "128"] });
    expect(result.success).toBe(false);
  });

  it("rejects single-element array injection on size", () => {
    const result = TerrainLandQuerySchema.safeParse({ bbox: VALID_BBOX, size: ["256"] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TerrainSatelliteQuerySchema — GET /terrain/satellite-tile
// ---------------------------------------------------------------------------

describe("TerrainSatelliteQuerySchema — GET /terrain/satellite-tile", () => {
  const VALID_BBOX = "-122.5,37.5,-121.5,38.5";

  it("accepts a valid bbox string with no size (defaults to 512)", () => {
    const result = TerrainSatelliteQuerySchema.safeParse({ bbox: VALID_BBOX });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bbox).toEqual([-122.5, 37.5, -121.5, 38.5]);
      expect(result.data.size).toBe(512);
    }
  });

  it("accepts a valid bbox with an explicit size", () => {
    const result = TerrainSatelliteQuerySchema.safeParse({ bbox: VALID_BBOX, size: "256" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.size).toBe(256);
  });

  it("rejects a bbox string with 5 values", () => {
    const result = TerrainSatelliteQuerySchema.safeParse({ bbox: "-122.5,37.5,-121.5,38.5,0" });
    expect(result.success).toBe(false);
  });

  it("rejects a bbox with a non-finite value (Infinity)", () => {
    const result = TerrainSatelliteQuerySchema.safeParse({ bbox: "-122.5,Infinity,-121.5,38.5" });
    expect(result.success).toBe(false);
  });

  it("rejects array injection on bbox", () => {
    const result = TerrainSatelliteQuerySchema.safeParse({ bbox: [VALID_BBOX, VALID_BBOX] });
    expect(result.success).toBe(false);
  });

  it("rejects array injection on size", () => {
    const result = TerrainSatelliteQuerySchema.safeParse({ bbox: VALID_BBOX, size: ["512", "1024"] });
    expect(result.success).toBe(false);
  });

  it("rejects single-element array injection on size", () => {
    const result = TerrainSatelliteQuerySchema.safeParse({ bbox: VALID_BBOX, size: ["512"] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TerrainDownloadInfoQuerySchema — GET /terrain/download/info
// ---------------------------------------------------------------------------

describe("TerrainDownloadInfoQuerySchema — GET /terrain/download/info", () => {
  const VALID = { north: "48", south: "47", east: "-122", west: "-123" };

  it("accepts valid north/south/east/west strings", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.north).toBe(48);
      expect(result.data.south).toBe(47);
      expect(result.data.east).toBe(-122);
      expect(result.data.west).toBe(-123);
    }
  });

  it("rejects missing north", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, north: undefined });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric north value", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, north: "not-a-number" });
    expect(result.success).toBe(false);
  });

  it("rejects north > 90", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, north: "91" });
    expect(result.success).toBe(false);
  });

  it("rejects south < -90", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, south: "-91" });
    expect(result.success).toBe(false);
  });

  it("rejects east > 180", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, east: "181" });
    expect(result.success).toBe(false);
  });

  it("rejects west < -180", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, west: "-181" });
    expect(result.success).toBe(false);
  });

  it("rejects when north <= south (inverted bbox)", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, north: "47", south: "48" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.match(/north.*south/i))).toBe(true);
    }
  });

  it("rejects when east <= west (inverted bbox)", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, east: "-123", west: "-122" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.match(/east.*west/i))).toBe(true);
    }
  });

  it("rejects a bbox wider than 10° longitude", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, east: "-112", west: "-123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.match(/10°/i))).toBe(true);
    }
  });

  it("rejects a bbox taller than 10° latitude", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, north: "58", south: "47" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.match(/10°/i))).toBe(true);
    }
  });

  it("rejects array injection on north (?north[]=45&north[]=50)", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, north: ["48", "49"] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/string/i);
    }
  });

  it("rejects single-element array injection on south", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, south: ["47"] });
    expect(result.success).toBe(false);
  });

  it("rejects array injection on east", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, east: ["-122", "-121"] });
    expect(result.success).toBe(false);
  });

  it("rejects array injection on west", () => {
    const result = TerrainDownloadInfoQuerySchema.safeParse({ ...VALID, west: ["-123", "-124"] });
    expect(result.success).toBe(false);
  });
});
