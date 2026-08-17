/**
 * markers-bbox-validation.test.ts
 *
 * Unit tests for the marker ↔ dataset bbox validation hardening:
 *
 *  - isValidBbox / isInsideBbox (pure helpers in lib/bbox.ts): partial,
 *    non-finite, and inverted bboxes must be rejected / fail closed.
 *  - resolveDatasetBbox (routes/markers.ts, mocked DB): a stored catalog or
 *    terrainJson bbox that fails validation must resolve to null (→ the
 *    route returns 404) instead of being passed to isInsideBbox where NaN
 *    comparisons silently accept or reject the wrong markers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock state — controls what each table's select resolves to.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  catalogRows: [] as unknown[],
  customRows: [] as unknown[],
  catalogQueried: false,
  customQueried: false,
  customError: null as Error | null,
}));

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockImplementation((table: Record<string, unknown>) => ({
          where: vi.fn().mockImplementation(() => {
            if (table && "coverageBbox" in table) {
              state.catalogQueried = true;
              return Promise.resolve(state.catalogRows);
            }
            state.customQueried = true;
            if (state.customError) return Promise.reject(state.customError);
            return Promise.resolve(state.customRows);
          }),
        })),
      }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
  isNull: vi.fn(() => "isnull-condition"),
  gte: vi.fn(() => "gte-condition"),
  lte: vi.fn(() => "lte-condition"),
  sql: vi.fn(() => "sql-fragment"),
}));

import { isValidBbox, isInsideBbox, type NormalisedBbox } from "../lib/bbox.js";
import { resolveDatasetBbox } from "../routes/markers.js";

const VALID_BBOX: NormalisedBbox = { minLon: -133, minLat: 55, maxLon: -132, maxLat: 56 };
const CUSTOM_UUID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  state.catalogRows = [];
  state.customRows = [];
  state.catalogQueried = false;
  state.customQueried = false;
  state.customError = null;
});

// ---------------------------------------------------------------------------
// isValidBbox
// ---------------------------------------------------------------------------

describe("isValidBbox", () => {
  it("accepts a well-formed bbox", () => {
    expect(isValidBbox(VALID_BBOX)).toBe(true);
  });

  it("rejects null, undefined, and non-object values", () => {
    expect(isValidBbox(null)).toBe(false);
    expect(isValidBbox(undefined)).toBe(false);
    expect(isValidBbox("bbox")).toBe(false);
    expect(isValidBbox(42)).toBe(false);
  });

  it.each(["minLon", "minLat", "maxLon", "maxLat"] as const)(
    "rejects a bbox with %s missing",
    (field) => {
      const bbox: Record<string, unknown> = { ...VALID_BBOX };
      delete bbox[field];
      expect(isValidBbox(bbox)).toBe(false);
    },
  );

  it.each(["minLon", "minLat", "maxLon", "maxLat"] as const)(
    "rejects a bbox with %s set to null",
    (field) => {
      expect(isValidBbox({ ...VALID_BBOX, [field]: null })).toBe(false);
    },
  );

  it.each(["minLon", "minLat", "maxLon", "maxLat"] as const)(
    "rejects a bbox with %s set to NaN",
    (field) => {
      expect(isValidBbox({ ...VALID_BBOX, [field]: Number.NaN })).toBe(false);
    },
  );

  it("rejects a bbox with an Infinity field", () => {
    expect(isValidBbox({ ...VALID_BBOX, maxLon: Infinity })).toBe(false);
    expect(isValidBbox({ ...VALID_BBOX, minLat: -Infinity })).toBe(false);
  });

  it("rejects a bbox with a string-typed field", () => {
    expect(isValidBbox({ ...VALID_BBOX, minLon: "-133" })).toBe(false);
  });

  it("rejects inverted longitude bounds (minLon > maxLon)", () => {
    expect(isValidBbox({ minLon: -132, minLat: 55, maxLon: -133, maxLat: 56 })).toBe(false);
  });

  it("rejects inverted latitude bounds (minLat > maxLat)", () => {
    expect(isValidBbox({ minLon: -133, minLat: 56, maxLon: -132, maxLat: 55 })).toBe(false);
  });

  it("rejects zero-area bounds (min == max)", () => {
    expect(isValidBbox({ minLon: -133, minLat: 55, maxLon: -133, maxLat: 56 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInsideBbox — fails closed on non-finite bbox fields
// ---------------------------------------------------------------------------

describe("isInsideBbox", () => {
  it("returns true for a point inside a valid bbox", () => {
    expect(isInsideBbox(-132.5, 55.5, VALID_BBOX)).toBe(true);
  });

  it("returns false for a point outside a valid bbox", () => {
    expect(isInsideBbox(-90, 25, VALID_BBOX)).toBe(false);
  });

  it("is inclusive at the bbox boundaries", () => {
    expect(isInsideBbox(VALID_BBOX.minLon, VALID_BBOX.minLat, VALID_BBOX)).toBe(true);
    expect(isInsideBbox(VALID_BBOX.maxLon, VALID_BBOX.maxLat, VALID_BBOX)).toBe(true);
  });

  it("returns false (fails closed) when a bbox field is NaN — even for a point that would otherwise match", () => {
    const bbox = { ...VALID_BBOX, maxLat: Number.NaN };
    expect(isInsideBbox(-132.5, 55.5, bbox)).toBe(false);
  });

  it("returns false (fails closed) when a bbox field is Infinity", () => {
    const bbox = { ...VALID_BBOX, maxLon: Infinity };
    expect(isInsideBbox(-132.5, 55.5, bbox)).toBe(false);
  });

  it("returns false (fails closed) when a bbox field is undefined (partial JSONB blob)", () => {
    const bbox = { minLon: -133, minLat: 55, maxLon: -132 } as unknown as NormalisedBbox;
    expect(isInsideBbox(-132.5, 55.5, bbox)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveDatasetBbox — mocked DB
// ---------------------------------------------------------------------------

describe("resolveDatasetBbox — catalog datasets", () => {
  it("returns the bbox when the stored coverageBbox is fully valid", async () => {
    state.catalogRows = [{ coverageBbox: { ...VALID_BBOX } }];
    await expect(resolveDatasetBbox("thorne-bay")).resolves.toEqual(VALID_BBOX);
  });

  it("returns null when a coverageBbox field is missing", async () => {
    const { maxLat: _dropped, ...partial } = VALID_BBOX;
    state.catalogRows = [{ coverageBbox: partial }];
    await expect(resolveDatasetBbox("thorne-bay")).resolves.toBeNull();
  });

  it("returns null when a coverageBbox field is null", async () => {
    state.catalogRows = [{ coverageBbox: { ...VALID_BBOX, maxLat: null } }];
    await expect(resolveDatasetBbox("thorne-bay")).resolves.toBeNull();
  });

  it("returns null when a coverageBbox field is NaN", async () => {
    state.catalogRows = [{ coverageBbox: { ...VALID_BBOX, minLat: Number.NaN } }];
    await expect(resolveDatasetBbox("thorne-bay")).resolves.toBeNull();
  });

  it("returns null when a coverageBbox field is Infinity", async () => {
    state.catalogRows = [{ coverageBbox: { ...VALID_BBOX, maxLon: Infinity } }];
    await expect(resolveDatasetBbox("thorne-bay")).resolves.toBeNull();
  });

  it("returns null when longitude bounds are inverted", async () => {
    state.catalogRows = [{ coverageBbox: { minLon: -132, minLat: 55, maxLon: -133, maxLat: 56 } }];
    await expect(resolveDatasetBbox("thorne-bay")).resolves.toBeNull();
  });

  it("does NOT fall through to custom_datasets when a catalog row exists with an invalid bbox (slug ids would crash a uuid-typed query)", async () => {
    state.catalogRows = [{ coverageBbox: { ...VALID_BBOX, maxLat: null } }];
    await resolveDatasetBbox("thorne-bay");
    expect(state.customQueried).toBe(false);
  });
});

describe("resolveDatasetBbox — custom (user-uploaded) datasets", () => {
  it("returns the bbox from terrainJson when valid and the id is uuid-shaped", async () => {
    state.customRows = [{ terrainJson: { ...VALID_BBOX, depths: [] } }];
    await expect(resolveDatasetBbox(CUSTOM_UUID)).resolves.toEqual(VALID_BBOX);
  });

  it("returns null when terrainJson has a missing bbox field", async () => {
    state.customRows = [{ terrainJson: { minLon: -133, minLat: 55, maxLon: -132 } }];
    await expect(resolveDatasetBbox(CUSTOM_UUID)).resolves.toBeNull();
  });

  it("returns null when terrainJson has inverted latitude bounds", async () => {
    state.customRows = [{ terrainJson: { minLon: -133, minLat: 56, maxLon: -132, maxLat: 55 } }];
    await expect(resolveDatasetBbox(CUSTOM_UUID)).resolves.toBeNull();
  });

  it("returns null when the dataset is in neither table", async () => {
    await expect(resolveDatasetBbox(CUSTOM_UUID)).resolves.toBeNull();
  });

  it("returns null when the id is unknown to both tables", async () => {
    await expect(resolveDatasetBbox("not-a-real-slug")).resolves.toBeNull();
    expect(state.catalogQueried).toBe(true);
    expect(state.customQueried).toBe(true);
  });

  it("maps a Postgres invalid-uuid error (22P02) from custom_datasets to null (→ 404, not 500)", async () => {
    state.customError = Object.assign(new Error("invalid input syntax for type uuid"), { code: "22P02" });
    await expect(resolveDatasetBbox("catalog-style-slug")).resolves.toBeNull();
  });

  it("re-throws non-uuid database errors from the custom_datasets query", async () => {
    state.customError = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    await expect(resolveDatasetBbox("catalog-style-slug")).rejects.toThrow("connection refused");
  });
});
