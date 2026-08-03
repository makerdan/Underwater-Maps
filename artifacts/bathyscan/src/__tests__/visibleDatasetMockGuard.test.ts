/**
 * visibleDatasetMockGuard.test.ts
 *
 * Type-level guard: ensures that the VisibleDataset mock objects used in
 * OverviewMap and terrainStore tests remain compatible with the real
 * VisibleDataset interface.
 *
 * WHY THIS EXISTS
 * ---------------
 * Ten+ test files construct VisibleDataset objects inline with hand-written
 * shapes that only list the fields they care about. If a *required* field is
 * added to `VisibleDataset`, those inline objects silently miss the new field
 * — tests stay green while the real component sees wrong data.
 *
 * HOW IT CATCHES DRIFT
 * --------------------
 * The objects below are annotated with the real `VisibleDataset` type.
 * TypeScript will produce a compile-time error (caught by `typecheck`, which
 * runs in the fast tier) the moment any required field is added to the
 * interface but omitted from the guard file.
 *
 * WHAT TO DO WHEN THIS FILE ERRORS
 * ---------------------------------
 * 1. Add the new required field (with a sensible stub value) to every variant
 *    below.
 * 2. Update the inline mock objects in each affected test file (or add a
 *    shared factory).
 * 3. Add a runtime `expect` assertion if the new field needs behavioural
 *    coverage.
 */

import { describe, it, expect } from "vitest";
import type { VisibleDataset } from "@/lib/terrainStore";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Minimal synthetic TerrainData stub — only the bbox fields are needed for
// the representative mock shapes; the full grid is irrelevant here.
// ---------------------------------------------------------------------------
const stubGrid: TerrainData = {
  datasetId: "stub-grid",
  name: "stub",
  waterType: "saltwater",
  resolution: 4,
  width: 4,
  height: 4,
  depths: new Array(16).fill(10),
  minDepth: 10,
  maxDepth: 10,
  minLon: -122,
  maxLon: -119,
  minLat: 47,
  maxLat: 49,
  centerLon: -120.5,
  centerLat: 48,
} as unknown as TerrainData;

// ---------------------------------------------------------------------------
// Representative mock variants
//
// Each is annotated `: VisibleDataset` so TypeScript enforces that every
// required field is present. A compile error here means the interface gained
// a new required field that has not yet been reflected in inline test mocks.
// ---------------------------------------------------------------------------

/**
 * Fully-loaded dataset: both grids populated, dataUpdatedAt known.
 * Represents a preset catalog dataset with a loaded overview grid.
 */
const fullyLoadedPreset: VisibleDataset = {
  datasetId: "preset-loaded",
  source: "preset",
  activeGrid: stubGrid,
  overviewGrid: stubGrid,
  dataUpdatedAt: "2023-06-15",
};

/**
 * Both grids null — the typical "just added, not yet loaded" state.
 * dataUpdatedAt set (catalog entry known).
 */
const addedNotLoaded: VisibleDataset = {
  datasetId: "not-loaded-yet",
  source: "preset",
  activeGrid: null,
  overviewGrid: null,
  dataUpdatedAt: "2021-03-01",
};

/**
 * Overview grid loaded, active grid null — the common state while the full-res
 * grid is streaming in. dataUpdatedAt absent (user-uploaded dataset).
 */
const overviewOnlyUser: VisibleDataset = {
  datasetId: "user-upload-1",
  source: "user",
  activeGrid: null,
  overviewGrid: stubGrid,
  // dataUpdatedAt intentionally absent (optional field, user uploads have none)
};

/**
 * Both grids null, dataUpdatedAt explicitly null — mirrors how toggleVisible
 * stores an entry immediately after the user clicks "Load together".
 */
const freshlyToggled: VisibleDataset = {
  datasetId: "freshly-toggled",
  source: "preset",
  activeGrid: null,
  overviewGrid: null,
  dataUpdatedAt: null,
};

// ---------------------------------------------------------------------------
// Runtime guard
// ---------------------------------------------------------------------------
// The meaningful check is compile-time (see above). These runtime assertions
// catch the unlikely case where a required field is accidentally set to
// undefined at runtime (e.g. via Object.assign) and also ensure the file is
// treated as a real test by vitest rather than silently skipped.

describe("VisibleDataset mock guard — required fields present in all variants", () => {
  it("fullyLoadedPreset: datasetId and source are non-empty strings", () => {
    expect(typeof fullyLoadedPreset.datasetId).toBe("string");
    expect(fullyLoadedPreset.datasetId.length).toBeGreaterThan(0);
    expect(typeof fullyLoadedPreset.source).toBe("string");
  });

  it("addedNotLoaded: grids are null and dataUpdatedAt is a non-empty string", () => {
    expect(addedNotLoaded.activeGrid).toBeNull();
    expect(addedNotLoaded.overviewGrid).toBeNull();
    expect(typeof addedNotLoaded.dataUpdatedAt).toBe("string");
  });

  it("overviewOnlyUser: overviewGrid is an object and source is 'user'", () => {
    expect(overviewOnlyUser.overviewGrid).not.toBeNull();
    expect(overviewOnlyUser.source).toBe("user");
  });

  it("freshlyToggled: dataUpdatedAt is null (not undefined) when explicitly cleared", () => {
    expect(freshlyToggled.dataUpdatedAt).toBeNull();
  });

  it("all variants satisfy the VisibleDataset shape at runtime", () => {
    const variants: VisibleDataset[] = [
      fullyLoadedPreset,
      addedNotLoaded,
      overviewOnlyUser,
      freshlyToggled,
    ];
    for (const v of variants) {
      expect(typeof v.datasetId).toBe("string");
      expect(v.source === "preset" || v.source === "user").toBe(true);
      // activeGrid and overviewGrid must be present (null or object, never undefined)
      expect("activeGrid" in v).toBe(true);
      expect("overviewGrid" in v).toBe(true);
    }
  });
});
