/**
 * shoreZoneDataMock.ts — shared vi.mock factory for `lib/shoreZoneData.js`.
 *
 * Same pattern as terrainMock.ts: stubs EVERY runtime export of the real
 * module so suites mocking shoreZoneData.js wholesale don't crash at
 * collection time when the module gains a new export. The guard test in
 * `mock-factory-guards.test.ts` diffs the real module's exports against
 * this factory's keys.
 *
 * Usage:
 *
 *   vi.mock("../../lib/shoreZoneData.js", async () => {
 *     const { createShoreZoneDataMock } = await import(
 *       "../../__tests__/helpers/shoreZoneDataMock.js"
 *     );
 *     return createShoreZoneDataMock({
 *       getSubstrateForDataset: (...args) => mySpy(...args),
 *     });
 *   });
 */
import { vi } from "vitest";

/** Minimal-but-valid stub FeatureCollection bundle used for all bundle constants. */
export function makeStubShoreZoneBundle(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    metadata: {
      sourceName: "Mock ShoreZone bundle",
      sourceLayer: "mock-layer",
      sourceService: "https://mock.invalid/service",
      region: "Mock Region",
      bbox: { minLon: -137, minLat: 55, maxLon: -130, maxLat: 60 },
      creditUrl: "https://mock.invalid/credit",
      fetchedAt: "2024-01-01",
      source: "mock-source",
    },
    features: [],
    ...overrides,
  };
}

/**
 * Build a full stub of lib/shoreZoneData.js's runtime exports.
 * Overrides are merged with property descriptors so getters survive.
 */
export function createShoreZoneDataMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    // ── Bundled FeatureCollections (loaded from JSON at real-module init) ──
    ALASKA_SHOREZONE: makeStubShoreZoneBundle(),
    ENC_SE_ALASKA_SUBSTRATE: makeStubShoreZoneBundle(),
    AOOS_INTERTIDAL_POW: makeStubShoreZoneBundle(),
    ENC_CONUS_SUBSTRATE: makeStubShoreZoneBundle(),
    TX_LAKE_SUBSTRATE: makeStubShoreZoneBundle(),
    // ── Functions ──
    getShoreZoneIntersectingBbox: vi.fn().mockReturnValue([]),
    getEncSubstrateIntersectingBbox: vi.fn().mockReturnValue([]),
    nearestCoverageKm: vi.fn().mockReturnValue(0),
    getSubstrateForDataset: vi.fn(),
    getShoreZoneForDataset: vi.fn(),
  };
  Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides));
  return base;
}
