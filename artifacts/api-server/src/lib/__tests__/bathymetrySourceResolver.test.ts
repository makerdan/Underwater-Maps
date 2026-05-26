/**
 * Tests for the ranked bathymetry source resolver (Task #398).
 *
 * All bundled preset datasets were removed in Task #403, so the per-AOI
 * priority map is empty and the resolver falls back to its default
 * gebco-only list for every input. These tests cover:
 *  - Registry shape (every source declares a scope, dataSource, label,
 *    fetch, and credit URL; scopes match the expected vocabulary).
 *  - Ranked-fallback behaviour using a synthetic AOI that exercises the
 *    default priority list.
 */

import { describe, it, expect } from "vitest";
import {
  BATHYMETRY_SOURCES,
  DATASET_SOURCE_PRIORITY,
  NCEI_DATASET_COVERAGES,
  resolveBathymetrySource,
  type BathymetrySourceId,
} from "../terrain.js";

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

describe("BATHYMETRY_SOURCES registry", () => {
  it("declares the four expected sources", () => {
    expect(Object.keys(BATHYMETRY_SOURCES).sort()).toEqual(
      ["bundled-survey", "gebco", "ncei-bag-mosaic", "ncei-dem-global-mosaic"].sort(),
    );
  });

  it("every source declares a scope, dataSource, label, and credit URL", () => {
    for (const src of Object.values(BATHYMETRY_SOURCES)) {
      expect(src.id).toBeTruthy();
      expect(src.label).toBeTruthy();
      expect(src.scope).toMatch(/^(local|regional|state|national|global)$/);
      expect(src.dataSource).toBeTruthy();
      expect(src.creditUrl).toMatch(/^https?:\/\//);
      expect(typeof src.fetch).toBe("function");
    }
  });

  it("ranks bundled-survey as local and gebco as global", () => {
    expect(BATHYMETRY_SOURCES["bundled-survey"].scope).toBe("local");
    expect(BATHYMETRY_SOURCES.gebco.scope).toBe("global");
  });
});

describe("DATASET_SOURCE_PRIORITY", () => {
  it("is empty now that all preset AOIs have been retired", () => {
    expect(Object.keys(DATASET_SOURCE_PRIORITY)).toHaveLength(0);
    expect(Object.keys(NCEI_DATASET_COVERAGES)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Ranked-fallback behaviour — resolver loop semantics
// ---------------------------------------------------------------------------

const FAKE_BBOX = { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };
const FAKE_META = {
  id: "test-aoi",
  name: "Test AOI",
  description: "",
  waterType: "saltwater" as const,
  minDepth: 0,
  maxDepth: 10,
  centerLon: 0.5,
  centerLat: 0.5,
  bbox: FAKE_BBOX,
};

function makeFakeRegistry(behaviours: Record<string, "throw" | "ok">) {
  const calls: string[] = [];
  const orig = { ...BATHYMETRY_SOURCES } as Record<string, (typeof BATHYMETRY_SOURCES)[BathymetrySourceId]>;
  for (const [id, mode] of Object.entries(behaviours)) {
    (BATHYMETRY_SOURCES as Record<string, { fetch: (...args: unknown[]) => Promise<unknown> }>)[id] = {
      ...orig[id]!,
      fetch: async () => {
        calls.push(id);
        if (mode === "throw") throw new Error(`${id} simulated failure`);
        return {
          depths: new Array(16).fill(5),
          minDepth: 0,
          maxDepth: 10,
          hasTopography: false,
        };
      },
    } as (typeof BATHYMETRY_SOURCES)[BathymetrySourceId];
  }
  return {
    calls,
    restore: () => {
      for (const id of Object.keys(behaviours)) {
        (BATHYMETRY_SOURCES as Record<string, unknown>)[id] = orig[id]!;
      }
    },
  };
}

describe("resolveBathymetrySource — ranked fallback", () => {
  it("uses the default gebco-only list for AOIs without an explicit priority entry", async () => {
    const fake = makeFakeRegistry({ gebco: "ok" });
    try {
      const res = await resolveBathymetrySource(FAKE_META, 4);
      expect(res?.source.id).toBe("gebco");
      expect(fake.calls).toEqual(["gebco"]);
    } finally {
      fake.restore();
    }
  });

  it("returns null when the only ranked source throws (synthetic fallback territory)", async () => {
    const fake = makeFakeRegistry({ gebco: "throw" });
    try {
      const res = await resolveBathymetrySource(FAKE_META, 4);
      expect(res).toBeNull();
      expect(fake.calls).toEqual(["gebco"]);
    } finally {
      fake.restore();
    }
  });
});
