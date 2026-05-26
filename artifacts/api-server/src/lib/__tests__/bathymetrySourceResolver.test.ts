/**
 * Tests for the ranked bathymetry source resolver (Task #398).
 *
 * Covers:
 *  - Registry shape (every source declares a scope, dataSource, label,
 *    fetch, and credit URL; scopes match the expected vocabulary).
 *  - The per-AOI priority map has entries for all bundled presets (SE Alaska
 *    saltwater and inland TX freshwater) and references only known source ids.
 *  - Inland TX reservoirs (Ray Roberts, Texoma) lead with `bundled-survey`.
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
  it("has ranked priority entries for SE Alaska and inland TX presets", () => {
    expect(Object.keys(DATASET_SOURCE_PRIORITY).length).toBeGreaterThan(0);
    expect(DATASET_SOURCE_PRIORITY["thorne-bay"]).toBeDefined();
    expect(DATASET_SOURCE_PRIORITY["lake-ray-roberts"]).toBeDefined();
    expect(DATASET_SOURCE_PRIORITY["lake-texoma"]).toBeDefined();
  });

  it("registers the inland TX reservoirs with bundled-survey first", () => {
    expect(DATASET_SOURCE_PRIORITY["lake-ray-roberts"]?.[0]).toBe("bundled-survey");
    expect(DATASET_SOURCE_PRIORITY["lake-texoma"]?.[0]).toBe("bundled-survey");
  });

  it("only references source ids that exist in BATHYMETRY_SOURCES", () => {
    const known = new Set(Object.keys(BATHYMETRY_SOURCES));
    for (const [aoi, sources] of Object.entries(DATASET_SOURCE_PRIORITY)) {
      for (const id of sources) {
        expect(known.has(id), `${aoi} references unknown source '${id}'`).toBe(true);
      }
    }
  });

  it("derives NCEI_DATASET_COVERAGES from any AOI with NCEI sources", () => {
    const nceiCoverageAois = Object.entries(DATASET_SOURCE_PRIORITY)
      .filter(([, sources]) =>
        sources.some((s) => s === "ncei-bag-mosaic" || s === "ncei-dem-global-mosaic"),
      )
      .map(([id]) => id);
    expect(Object.keys(NCEI_DATASET_COVERAGES).sort()).toEqual(nceiCoverageAois.sort());
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
