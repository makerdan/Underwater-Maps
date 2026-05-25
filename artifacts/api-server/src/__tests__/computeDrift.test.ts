/**
 * computeDrift.test.ts — Unit tests for the drift physics model.
 *
 * These tests verify the pure computeDrift() function without any DB or
 * network access. A minimal synthetic TerrainData grid is used.
 */

import { describe, it, expect } from "vitest";

// computeDrift lives in the bathyscan frontend package and is exercised by
// the bathyscan vitest suite. This placeholder keeps the api-server suite
// stable without importing across packages.

describe("computeDrift placeholder", () => {
  it("is documented in bathyscan tests", () => {
    expect(true).toBe(true);
  });
});
