/**
 * tileClassifyMock.ts — shared vi.mock factory for `lib/tileClassify.js`.
 *
 * Same pattern as terrainMock.ts: stubs EVERY runtime export of the real
 * module so suites that mock tileClassify.js wholesale don't crash at
 * collection time ("No export is defined on the mock") when the module
 * gains a new module-init-consumed export. The guard test in
 * `mock-factory-guards.test.ts` diffs the real module's exports against
 * this factory's keys.
 *
 * Usage (vi.mock factories are hoisted — import inside an async factory):
 *
 *   vi.mock("../lib/tileClassify.js", async () => {
 *     const { createTileClassifyMock } = await import(
 *       "./helpers/tileClassifyMock.js"
 *     );
 *     return createTileClassifyMock({ TILE_CONCURRENCY: 2 });
 *   });
 */
import { vi } from "vitest";

/**
 * Build a full stub of lib/tileClassify.js's runtime exports. Constants
 * default to the real module's values; functions default to bare vi.fn().
 * Overrides are merged with property descriptors so getters survive.
 */
export function createTileClassifyMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    // ── Constants ──
    MAX_TILES_PER_SIDE: 4,
    MAX_CLASSIFY_TILES: 16,
    TILE_CONCURRENCY: 4,
    TILE_SIZE: 32,
    TILE_OVERLAP_SRC: 4,
    // ── Functions ──
    planTiles: vi.fn(),
    extractTileDepths32: vi.fn(),
    tileFingerprint: vi.fn(),
    stitchTileLabels: vi.fn(),
    mapWithConcurrency: vi.fn(),
    tileDepthsToPngDataUrl: vi.fn(),
  };
  Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides));
  return base;
}
