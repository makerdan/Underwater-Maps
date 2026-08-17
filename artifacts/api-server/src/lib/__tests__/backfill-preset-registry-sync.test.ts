/**
 * backfill-preset-registry-sync.test.ts
 *
 * Drift guard: @workspace/db's backfill script cannot import api-server code
 * (circular workspace dependency), so it carries a mirrored copy of the
 * preset registry's water types (PRESET_REGISTRY_WATER_TYPES in
 * lib/db/src/scripts/backfill-water-type-helpers.ts).
 *
 * This test compares the mirror against the live in-code registry
 * (ALL_PRESET_DATASETS) and fails the moment they drift — e.g. when a new
 * freshwater preset is added to terrain.ts without updating the mirror, which
 * would make the backfill script silently default that preset's legacy saves
 * to saltwater whenever the catalog DB row is absent.
 */

import { describe, it, expect } from "vitest";
import { ALL_PRESET_DATASETS } from "../terrain.js";
import { PRESET_REGISTRY_WATER_TYPES } from "@workspace/db/scripts/backfill-water-type-helpers";

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
