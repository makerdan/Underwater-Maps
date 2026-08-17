/**
 * backfill-water-type.test.ts
 *
 * Unit tests for the pure water-type resolution logic used by
 * scripts/backfill-water-type-and-datasource.ts (extracted into
 * backfill-water-type-helpers.ts so no DB connection is needed).
 *
 * Regression guard (Task: Lake Ray Roberts always freshwater): a legacy
 * custom_datasets row linked via user_catalog_saves to
 * `preset-lake-ray-roberts` must be backfilled as freshwater — even when the
 * dataset_catalog row is absent — while genuinely unlinked legacy uploads
 * keep the "saltwater" default.
 */

import { describe, it, expect } from "vitest";
import {
  needsBackfill,
  patchBlob,
  presetRegistryWaterType,
  resolveLegacyWaterType,
  PRESET_REGISTRY_WATER_TYPES,
} from "../scripts/backfill-water-type-helpers.js";

const EMPTY_CATALOG: ReadonlyMap<string, string> = new Map();

describe("resolveLegacyWaterType", () => {
  it("resolves freshwater from a linked catalog row (Ray Roberts)", () => {
    const catalog = new Map([["preset-lake-ray-roberts", "freshwater"]]);
    expect(resolveLegacyWaterType("preset-lake-ray-roberts", catalog)).toBe("freshwater");
  });

  it("resolves freshwater via the preset registry when the catalog row is absent (Ray Roberts)", () => {
    // Seeder reconcile purges & re-creates preset-* rows; the backfill must
    // not depend on the DB row being present at run time.
    expect(resolveLegacyWaterType("preset-lake-ray-roberts", EMPTY_CATALOG)).toBe("freshwater");
  });

  it("resolves freshwater via the preset registry when the catalog row carries an invalid value", () => {
    const catalog = new Map([["preset-lake-ray-roberts", "brackish"]]);
    expect(resolveLegacyWaterType("preset-lake-ray-roberts", catalog)).toBe("freshwater");
  });

  it("defaults an unlinked legacy row (no catalog save) to saltwater", () => {
    expect(resolveLegacyWaterType(undefined, EMPTY_CATALOG)).toBe("saltwater");
    expect(resolveLegacyWaterType(null, EMPTY_CATALOG)).toBe("saltwater");
    expect(resolveLegacyWaterType("", EMPTY_CATALOG)).toBe("saltwater");
  });

  it("defaults an unknown catalog id with no registry match to saltwater", () => {
    expect(resolveLegacyWaterType("gone-entry", EMPTY_CATALOG)).toBe("saltwater");
    expect(resolveLegacyWaterType("preset-unknown-lake", EMPTY_CATALOG)).toBe("saltwater");
  });

  it("resolves non-preset freshwater catalog rows (fw-* entries) from the catalog", () => {
    const catalog = new Map([["fw-lake-tahoe-ca-nv", "freshwater"]]);
    expect(resolveLegacyWaterType("fw-lake-tahoe-ca-nv", catalog)).toBe("freshwater");
  });

  it("resolves saltwater catalog rows from the catalog", () => {
    const catalog = new Map([["preset-ocean", "saltwater"]]);
    expect(resolveLegacyWaterType("preset-ocean", catalog)).toBe("saltwater");
  });
});

describe("presetRegistryWaterType", () => {
  it("strips the preset- prefix before consulting the registry mirror", () => {
    expect(presetRegistryWaterType("preset-lake-ray-roberts")).toBe("freshwater");
  });

  it("accepts a bare preset dataset id", () => {
    expect(presetRegistryWaterType("lake-ray-roberts")).toBe("freshwater");
  });

  it("returns null for ids not in the registry mirror", () => {
    expect(presetRegistryWaterType("preset-nope")).toBeNull();
    expect(presetRegistryWaterType("fw-lake-tahoe-ca-nv")).toBeNull();
  });

  it("registry mirror contains Lake Ray Roberts as freshwater", () => {
    expect(PRESET_REGISTRY_WATER_TYPES["lake-ray-roberts"]).toBe("freshwater");
  });
});

describe("patchBlob", () => {
  it("injects the resolved waterType when missing", () => {
    expect(patchBlob({}, "freshwater")["waterType"]).toBe("freshwater");
    expect(patchBlob({}, "saltwater")["waterType"]).toBe("saltwater");
  });

  it("replaces an invalid stored waterType with the resolved one", () => {
    expect(patchBlob({ waterType: "brackish" }, "freshwater")["waterType"]).toBe("freshwater");
  });

  it("never overwrites an existing valid waterType", () => {
    expect(patchBlob({ waterType: "saltwater" }, "freshwater")["waterType"]).toBe("saltwater");
    expect(patchBlob({ waterType: "freshwater" }, "saltwater")["waterType"]).toBe("freshwater");
  });

  it("strips the removed synthetic dataSource", () => {
    const patched = patchBlob({ waterType: "saltwater", dataSource: "synthetic" }, "saltwater");
    expect(patched).not.toHaveProperty("dataSource");
  });

  it("keeps a valid dataSource", () => {
    expect(patchBlob({ waterType: "freshwater", dataSource: "mn-dnr" }, "freshwater")["dataSource"]).toBe("mn-dnr");
  });
});

describe("needsBackfill", () => {
  it("flags blobs missing waterType", () => {
    expect(needsBackfill({})).toBe(true);
    expect(needsBackfill(null)).toBe(true);
    expect(needsBackfill({ waterType: "brackish" })).toBe(true);
  });

  it("flags blobs carrying dataSource=synthetic", () => {
    expect(needsBackfill({ waterType: "saltwater", dataSource: "synthetic" })).toBe(true);
  });

  it("passes modern blobs untouched", () => {
    expect(needsBackfill({ waterType: "freshwater" })).toBe(false);
    expect(needsBackfill({ waterType: "saltwater", dataSource: "ncei" })).toBe(false);
  });
});
