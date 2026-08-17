/**
 * backfill-preset-registry-sync.test.ts
 *
 * Drift guards for the water-type in-code fallbacks used by the backfill
 * script and the read-path resolver.
 *
 * Guard 1 — preset registry mirror:
 *   @workspace/db's backfill script cannot import api-server code (circular
 *   workspace dependency), so it carries a mirrored copy of the preset
 *   registry's water types (PRESET_REGISTRY_WATER_TYPES in
 *   lib/db/src/scripts/backfill-water-type-helpers.ts).
 *
 *   This test compares the mirror against the live in-code registry
 *   (ALL_PRESET_DATASETS) and fails the moment they drift — e.g. when a new
 *   freshwater preset is added to terrain.ts without updating the mirror.
 *
 * Guard 2 — fw-* prefix convention:
 *   The backfill helper uses `catalogId.startsWith("fw-") → "freshwater"` as
 *   a fallback for fw-* ids rather than mirroring the full EXTRA_CATALOG_ENTRIES
 *   list.  This guard verifies that every fw-* entry in EXTRA_CATALOG_ENTRIES
 *   is indeed freshwater, so the prefix convention is always safe.  If a future
 *   developer accidentally creates a fw-* entry with waterType: "saltwater", this
 *   test fails and forces them to revisit the convention before merging.
 */

import { describe, it, expect } from "vitest";
import { ALL_PRESET_DATASETS } from "../terrain.js";
import { EXTRA_CATALOG_ENTRIES } from "../catalogSeeder.js";
import {
  PRESET_REGISTRY_WATER_TYPES,
  fwCatalogWaterType,
} from "@workspace/db/scripts/backfill-water-type-helpers";

describe("backfill preset-registry mirror stays in sync with terrain.ts", () => {
  it("PRESET_REGISTRY_WATER_TYPES matches ALL_PRESET_DATASETS exactly", () => {
    const live = Object.fromEntries(
      ALL_PRESET_DATASETS.map((d) => [d.id, d.waterType]),
    );
    expect(
      { ...PRESET_REGISTRY_WATER_TYPES },
      "lib/db/src/scripts/backfill-water-type-helpers.ts PRESET_REGISTRY_WATER_TYPES " +
        "must mirror ALL_PRESET_DATASETS (terrain.ts) — update both in the same commit",
    ).toEqual(live);
  });

  it("Lake Ray Roberts is registered freshwater in both places", () => {
    expect(ALL_PRESET_DATASETS.find((d) => d.id === "lake-ray-roberts")?.waterType).toBe("freshwater");
    expect(PRESET_REGISTRY_WATER_TYPES["lake-ray-roberts"]).toBe("freshwater");
  });
});

describe("fw-* prefix convention — all fw- entries in EXTRA_CATALOG_ENTRIES are freshwater", () => {
  const fwEntries = EXTRA_CATALOG_ENTRIES.filter((e) => e.id.startsWith("fw-"));

  it("there is at least one fw-* entry (sanity check)", () => {
    expect(fwEntries.length).toBeGreaterThan(0);
  });

  it("every fw-* entry has waterType='freshwater'", () => {
    const nonFreshwater = fwEntries.filter((e) => e.waterType !== "freshwater");
    expect(
      nonFreshwater.map((e) => e.id),
      "The following fw-* catalog entries are NOT freshwater — " +
        "the backfill helper uses startsWith('fw-') to infer freshwater; " +
        "fix their waterType or rename them before merging",
    ).toEqual([]);
  });

  it("fwCatalogWaterType returns 'freshwater' for known fw-* ids", () => {
    for (const entry of fwEntries) {
      expect(
        fwCatalogWaterType(entry.id),
        `fwCatalogWaterType("${entry.id}") should be 'freshwater'`,
      ).toBe("freshwater");
    }
  });

  it("fwCatalogWaterType returns null for non-fw-* ids", () => {
    expect(fwCatalogWaterType("preset-lake-ray-roberts")).toBeNull();
    expect(fwCatalogWaterType("gebco-2024-global")).toBeNull();
    expect(fwCatalogWaterType("")).toBeNull();
  });
});
