/**
 * terrainMock.ts — shared vi.mock factory for `lib/terrain.js`.
 *
 * Why this exists: terrain.ts is imported at module init by many transitive
 * dependencies of app.js (e.g. catalogFetchStrategy.ts reads
 * NYSDEC_BATHY_FEATURE_SERVICE / MN_DNR_BATHY_FEATURE_SERVICE /
 * BUNDLED_TERRAIN as top-level consts). When a test file hand-writes a
 * partial vi.mock of terrain.js and terrain.ts later gains a new
 * module-init-consumed export, every such suite fails at COLLECTION time with
 * a confusing "No export is defined on the mock" error.
 *
 * This factory stubs EVERY runtime export of terrain.ts, so any suite using
 * it is immune to new exports breaking collection. The guard test
 * `terrain-mock-guard.test.ts` diffs the real module's exports against this
 * factory's keys and fails with a clear message the moment they drift.
 *
 * Usage (vi.mock factories are hoisted, so import the helper inside an async
 * factory — never at the top level of the test file):
 *
 *   vi.mock("../lib/terrain.js", async () => {
 *     const { createTerrainMock } = await import("./helpers/terrainMock.js");
 *     return createTerrainMock();
 *   });
 *
 * With per-suite overrides (getters and hoisted-var closures are preserved):
 *
 *   vi.mock("../../lib/terrain.js", async () => {
 *     const { createTerrainMock } = await import(
 *       "../../__tests__/helpers/terrainMock.js"
 *     );
 *     return createTerrainMock({
 *       ALL_PRESET_DATASETS: [myPreset],
 *       buildTerrainGrid: async () => myGrid,
 *     });
 *   });
 */
import { vi } from "vitest";

/**
 * Build a full stub of lib/terrain.js's runtime exports.
 *
 * Every value export of the real module must have a key here — the guard
 * test enforces this. Overrides are merged with property descriptors so
 * getters (e.g. `get ALL_PRESET_DATASETS() { ... }`) survive the merge.
 */
export function createTerrainMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    // ── Constants consumed at module init (catalogFetchStrategy.ts etc.) ──
    NYSDEC_BATHY_FEATURE_SERVICE: "https://mock.invalid/nysdec",
    MN_DNR_BATHY_FEATURE_SERVICE: "https://mock.invalid/mndnr",
    BUNDLED_TERRAIN: {},
    ALL_PRESET_DATASETS: [],
    PRESET_DATASETS: [],
    FRESHWATER_PRESET_DATASETS: [],
    NCEI_DATASET_COVERAGES: {},
    BATHYMETRY_SOURCES: {},
    DATASET_SOURCE_PRIORITY: {},
    TERRAIN_CACHE_VERSION: 1,
    // ── Functions ──
    getDatasetSourcePriority: vi.fn().mockReturnValue([]),
    resolveBathymetrySource: vi.fn(),
    resampleBundled: vi.fn(),
    clearPreviewCache: vi.fn(),
    previewDataset: vi.fn(),
    previewBboxForDownload: vi.fn(),
    buildBboxCsvRows: vi.fn(),
    buildTerrainGrid: vi.fn(),
    buildGebcoTerrainForBbox: vi.fn(),
    fetchWcsGeoTiffGrid: vi.fn(),
    buildNceiTerrainForBbox: vi.fn(),
    buildUsgs3depTerrainForBbox: vi.fn(),
    buildGreatLakesTerrainForBbox: vi.fn(),
    smoothSpikes: vi.fn(),
    parseXyzCsv: vi.fn(),
    gridPoints: vi.fn(),
    extractArcGisDepthM: vi.fn(),
  };
  // Descriptor-based merge so getter overrides stay live (a plain spread
  // would snapshot the getter's value once at merge time).
  Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides));
  return base;
}
