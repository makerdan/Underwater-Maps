/**
 * datasets-query-validation.test.ts
 *
 * Regression tests for Zod query-string validation on:
 *   GET /datasets                — DatasetsQuerySchema (waterType)
 *   GET /datasets/catalog/search — CatalogSearchQuerySchema (q)
 *
 * Tests validate the schemas directly (no HTTP server needed) to cover all
 * injection and invalid-value cases.
 */

import { describe, it, expect } from "vitest";
import { CatalogSearchQuerySchema, DatasetsQuerySchema } from "../schemas.js";

// ---------------------------------------------------------------------------
// CatalogSearchQuerySchema — dataType
// ---------------------------------------------------------------------------

describe("CatalogSearchQuerySchema — dataType filter", () => {
  const valid = ["bathymetry", "substrate", "habitat", "lidar", "chart"] as const;

  for (const v of valid) {
    it(`accepts dataType=${v}`, () => {
      const result = CatalogSearchQuerySchema.safeParse({ dataType: v });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.dataType).toBe(v);
    });
  }

  it("accepts missing dataType (optional)", () => {
    const result = CatalogSearchQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dataType).toBeUndefined();
  });

  it("rejects unknown dataType value 'sonar'", () => {
    const result = CatalogSearchQuerySchema.safeParse({ dataType: "sonar" });
    expect(result.success).toBe(false);
  });

  it("rejects empty string for dataType", () => {
    const result = CatalogSearchQuerySchema.safeParse({ dataType: "" });
    expect(result.success).toBe(false);
  });

  it("rejects array injection for dataType", () => {
    const result = CatalogSearchQuerySchema.safeParse({ dataType: ["bathymetry", "lidar"] });
    expect(result.success).toBe(false);
  });

  it("rejects single-element array injection for dataType", () => {
    const result = CatalogSearchQuerySchema.safeParse({ dataType: ["bathymetry"] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CatalogSearchQuerySchema — waterType
// ---------------------------------------------------------------------------

describe("CatalogSearchQuerySchema — waterType filter", () => {
  it("accepts waterType=saltwater", () => {
    const result = CatalogSearchQuerySchema.safeParse({ waterType: "saltwater" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.waterType).toBe("saltwater");
  });

  it("accepts waterType=freshwater", () => {
    const result = CatalogSearchQuerySchema.safeParse({ waterType: "freshwater" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.waterType).toBe("freshwater");
  });

  it("accepts missing waterType (optional)", () => {
    const result = CatalogSearchQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.waterType).toBeUndefined();
  });

  it("rejects unknown waterType value 'brackish'", () => {
    const result = CatalogSearchQuerySchema.safeParse({ waterType: "brackish" });
    expect(result.success).toBe(false);
  });

  it("rejects array injection for waterType", () => {
    const result = CatalogSearchQuerySchema.safeParse({ waterType: ["saltwater", "freshwater"] });
    expect(result.success).toBe(false);
  });

  it("rejects single-element array injection for waterType", () => {
    const result = CatalogSearchQuerySchema.safeParse({ waterType: ["saltwater"] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CatalogSearchQuerySchema — bbox coordinates
// ---------------------------------------------------------------------------

describe("CatalogSearchQuerySchema — bbox coordinates", () => {
  const validBbox = { minLon: "-120", minLat: "30", maxLon: "-110", maxLat: "40" };

  it("accepts valid bbox string coordinates (coerced from query strings)", () => {
    const result = CatalogSearchQuerySchema.safeParse(validBbox);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minLon).toBe(-120);
      expect(result.data.minLat).toBe(30);
      expect(result.data.maxLon).toBe(-110);
      expect(result.data.maxLat).toBe(40);
    }
  });

  it("accepts numeric bbox values directly", () => {
    const result = CatalogSearchQuerySchema.safeParse({ minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 });
    expect(result.success).toBe(true);
  });

  it("accepts bbox at boundary extremes (±180 lon, ±90 lat)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ minLon: "-180", minLat: "-90", maxLon: "180", maxLat: "90" });
    expect(result.success).toBe(true);
  });

  it("accepts missing all bbox params (all optional)", () => {
    const result = CatalogSearchQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minLon).toBeUndefined();
      expect(result.data.minLat).toBeUndefined();
      expect(result.data.maxLon).toBeUndefined();
      expect(result.data.maxLat).toBeUndefined();
    }
  });

  it("rejects minLon out of range (< -180)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, minLon: "-181" });
    expect(result.success).toBe(false);
  });

  it("rejects maxLon out of range (> 180)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, maxLon: "181" });
    expect(result.success).toBe(false);
  });

  it("rejects minLat out of range (< -90)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, minLat: "-91" });
    expect(result.success).toBe(false);
  });

  it("rejects maxLat out of range (> 90)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, maxLat: "91" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric string for minLon", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, minLon: "abc" });
    expect(result.success).toBe(false);
  });

  it("rejects Infinity for maxLat", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, maxLat: Infinity });
    expect(result.success).toBe(false);
  });

  it("rejects NaN for minLat", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, minLat: NaN });
    expect(result.success).toBe(false);
  });

  it("rejects array injection for minLon", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, minLon: ["-120", "-130"] });
    expect(result.success).toBe(false);
  });

  it("rejects array injection for maxLat", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, maxLat: ["40", "50"] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CatalogSearchQuerySchema — bbox ordering refinements
// ---------------------------------------------------------------------------

describe("CatalogSearchQuerySchema — bbox ordering refinements", () => {
  const validBbox = { minLon: "-120", minLat: "30", maxLon: "-110", maxLat: "40" };

  it("rejects inverted longitude (minLon > maxLon)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, minLon: "-100", maxLon: "-110" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /minLon.*maxLon/i.test(m))).toBe(true);
    }
  });

  it("rejects inverted latitude (minLat > maxLat)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, minLat: "50", maxLat: "40" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /minLat.*maxLat/i.test(m))).toBe(true);
    }
  });

  it("accepts equal minLon and maxLon (degenerate vertical slice)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, minLon: "-110", maxLon: "-110" });
    expect(result.success).toBe(true);
  });

  it("accepts equal minLat and maxLat (degenerate horizontal slice)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ ...validBbox, minLat: "35", maxLat: "35" });
    expect(result.success).toBe(true);
  });

  it("accepts only minLon without maxLon (no ordering check needed)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ minLon: "-120" });
    expect(result.success).toBe(true);
  });

  it("accepts only maxLon without minLon (no ordering check needed)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ maxLon: "-110" });
    expect(result.success).toBe(true);
  });

  it("accepts only minLat without maxLat (no ordering check needed)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ minLat: "30" });
    expect(result.success).toBe(true);
  });

  it("accepts only maxLat without minLat (no ordering check needed)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ maxLat: "40" });
    expect(result.success).toBe(true);
  });

  it("rejects both inverted longitude and inverted latitude simultaneously", () => {
    const result = CatalogSearchQuerySchema.safeParse({
      minLon: "10", maxLon: "-10",
      minLat: "50", maxLat: "30",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => /minLon.*maxLon/i.test(m))).toBe(true);
      expect(messages.some((m) => /minLat.*maxLat/i.test(m))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// CatalogSearchQuerySchema
// ---------------------------------------------------------------------------

describe("CatalogSearchQuerySchema — GET /datasets/catalog/search", () => {
  it("accepts a valid q string", () => {
    const result = CatalogSearchQuerySchema.safeParse({ q: "gulf of mexico" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.q).toBe("gulf of mexico");
  });

  it("accepts q at the max length boundary (500 chars)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ q: "a".repeat(500) });
    expect(result.success).toBe(true);
  });

  it("accepts missing q (q is optional)", () => {
    const result = CatalogSearchQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.q).toBeUndefined();
  });

  it("rejects empty q string", () => {
    const result = CatalogSearchQuerySchema.safeParse({ q: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/empty/i);
    }
  });

  it("rejects q exceeding 500 characters", () => {
    const result = CatalogSearchQuerySchema.safeParse({ q: "x".repeat(501) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/500/);
    }
  });

  it("rejects array injection for q (?q[]=a&q[]=b)", () => {
    const result = CatalogSearchQuerySchema.safeParse({ q: ["a", "b"] });
    expect(result.success).toBe(false);
  });

  it("rejects object injection for q", () => {
    const result = CatalogSearchQuerySchema.safeParse({ q: { toString: () => "evil" } });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DatasetsQuerySchema
// ---------------------------------------------------------------------------

describe("DatasetsQuerySchema — GET /datasets", () => {
  it("accepts waterType=saltwater", () => {
    const result = DatasetsQuerySchema.safeParse({ waterType: "saltwater" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.waterType).toBe("saltwater");
  });

  it("accepts waterType=freshwater", () => {
    const result = DatasetsQuerySchema.safeParse({ waterType: "freshwater" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.waterType).toBe("freshwater");
  });

  it("accepts missing waterType (waterType is optional)", () => {
    const result = DatasetsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.waterType).toBeUndefined();
  });

  it("rejects unknown waterType value 'brackish'", () => {
    const result = DatasetsQuerySchema.safeParse({ waterType: "brackish" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown waterType value 'marine'", () => {
    const result = DatasetsQuerySchema.safeParse({ waterType: "marine" });
    expect(result.success).toBe(false);
  });

  it("rejects array injection for waterType (?waterType[]=saltwater&waterType[]=freshwater)", () => {
    const result = DatasetsQuerySchema.safeParse({ waterType: ["saltwater", "freshwater"] });
    expect(result.success).toBe(false);
  });

  it("rejects single-element array injection for waterType", () => {
    const result = DatasetsQuerySchema.safeParse({ waterType: ["saltwater"] });
    expect(result.success).toBe(false);
  });

  it("rejects empty string for waterType", () => {
    const result = DatasetsQuerySchema.safeParse({ waterType: "" });
    expect(result.success).toBe(false);
  });
});
