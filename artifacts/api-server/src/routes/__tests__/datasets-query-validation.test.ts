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
