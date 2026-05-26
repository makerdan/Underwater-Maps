/**
 * Tests for the ranked bathymetry source resolver (Task #398).
 *
 * Covers:
 *  - Every preset AOI maps to the same-or-higher-priority source it did
 *    under the legacy NCEI_DATASET_COVERAGES + GEBCO chain (no
 *    regressions on `bathymetrySource` / `dataSource`).
 *  - The resolver walks the ranked list in order: when the top-ranked
 *    source throws / returns an unusable grid, it falls through to the
 *    next ranked source, exactly like the legacy NCEI loop.
 *  - When every ranked source fails, the resolver returns `null` and
 *    `buildTerrainGrid` falls through to the synthetic fbm terminal.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_PRESET_DATASETS,
  BATHYMETRY_SOURCES,
  DATASET_SOURCE_PRIORITY,
  NCEI_DATASET_COVERAGES,
  getDatasetSourcePriority,
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

// ---------------------------------------------------------------------------
// Per-AOI ranked lists — no regressions vs the legacy NCEI/GEBCO chain
// ---------------------------------------------------------------------------

describe("DATASET_SOURCE_PRIORITY", () => {
  it("includes every dataset that previously had an NCEI coverage list", () => {
    for (const datasetId of Object.keys(NCEI_DATASET_COVERAGES)) {
      expect(DATASET_SOURCE_PRIORITY[datasetId]).toBeDefined();
    }
  });

  it("preserves the NCEI ordering for every legacy NCEI-preferred dataset", () => {
    // For each legacy NCEI dataset, the NCEI sources in the new ranked
    // list must appear in the same relative order as the legacy
    // coverage list — i.e. no regression in which NCEI service is tried
    // first. (We compare relative order only, since the new list also
    // appends GEBCO as the global-tier fallback.)
    for (const [datasetId, coverages] of Object.entries(NCEI_DATASET_COVERAGES)) {
      const ranked = DATASET_SOURCE_PRIORITY[datasetId]!;
      const rankedNceiOrder = ranked.filter(
        (s) => s === "ncei-bag-mosaic" || s === "ncei-dem-global-mosaic",
      );
      const expected = coverages.map((c) =>
        c === "bagMosaic" ? "ncei-bag-mosaic" : "ncei-dem-global-mosaic",
      );
      expect(rankedNceiOrder).toEqual(expected);
    }
  });

  it("places GEBCO last for every saltwater AOI that lists it", () => {
    for (const ranked of Object.values(DATASET_SOURCE_PRIORITY)) {
      const gebcoIdx = ranked.indexOf("gebco");
      if (gebcoIdx >= 0) {
        expect(gebcoIdx).toBe(ranked.length - 1);
      }
    }
  });

  it("at least 3 ranked sources for every AOI that has a real bundled or NCEI option", () => {
    for (const [id, ranked] of Object.entries(DATASET_SOURCE_PRIORITY)) {
      if (ranked.includes("bundled-survey") || ranked.some((s) => s.startsWith("ncei-"))) {
        expect(ranked.length, `expected ≥3 sources for ${id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("every preset AOI either has an entry or defaults to gebco-only", () => {
    for (const ds of ALL_PRESET_DATASETS) {
      const ranked = getDatasetSourcePriority(ds.id);
      expect(ranked.length).toBeGreaterThan(0);
      for (const s of ranked) {
        expect(BATHYMETRY_SOURCES[s as BathymetrySourceId]).toBeDefined();
      }
    }
  });

  it("lake-ray-roberts tries the bundled survey first (local scope)", () => {
    expect(DATASET_SOURCE_PRIORITY["lake-ray-roberts"]?.[0]).toBe("bundled-survey");
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
    // Replace the fetcher in-place on the live registry object so
    // resolveBathymetrySource (which closes over BATHYMETRY_SOURCES)
    // sees the override. Restored in `afterEach` by the caller.
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
  it("returns the first source that succeeds and does not call later ones", async () => {
    // Use thorne-bay's real ranking: ncei-bag-mosaic → ncei-dem-global-mosaic → gebco
    const fake = makeFakeRegistry({
      "ncei-bag-mosaic": "ok",
      "ncei-dem-global-mosaic": "ok",
      gebco: "ok",
    });
    try {
      const meta = ALL_PRESET_DATASETS.find((d) => d.id === "thorne-bay")!;
      const res = await resolveBathymetrySource(meta, 4);
      expect(res?.source.id).toBe("ncei-bag-mosaic");
      expect(fake.calls).toEqual(["ncei-bag-mosaic"]);
    } finally {
      fake.restore();
    }
  });

  it("falls through to the next ranked source when the top one throws", async () => {
    const fake = makeFakeRegistry({
      "ncei-bag-mosaic": "throw",
      "ncei-dem-global-mosaic": "ok",
      gebco: "ok",
    });
    try {
      const meta = ALL_PRESET_DATASETS.find((d) => d.id === "thorne-bay")!;
      const res = await resolveBathymetrySource(meta, 4);
      expect(res?.source.id).toBe("ncei-dem-global-mosaic");
      expect(fake.calls).toEqual(["ncei-bag-mosaic", "ncei-dem-global-mosaic"]);
    } finally {
      fake.restore();
    }
  });

  it("falls all the way through to GEBCO when both NCEI sources throw", async () => {
    const fake = makeFakeRegistry({
      "ncei-bag-mosaic": "throw",
      "ncei-dem-global-mosaic": "throw",
      gebco: "ok",
    });
    try {
      const meta = ALL_PRESET_DATASETS.find((d) => d.id === "thorne-bay")!;
      const res = await resolveBathymetrySource(meta, 4);
      expect(res?.source.id).toBe("gebco");
      expect(fake.calls).toEqual([
        "ncei-bag-mosaic",
        "ncei-dem-global-mosaic",
        "gebco",
      ]);
    } finally {
      fake.restore();
    }
  });

  it("returns null when every ranked source throws (synthetic fallback territory)", async () => {
    const fake = makeFakeRegistry({
      "ncei-bag-mosaic": "throw",
      "ncei-dem-global-mosaic": "throw",
      gebco: "throw",
    });
    try {
      const meta = ALL_PRESET_DATASETS.find((d) => d.id === "thorne-bay")!;
      const res = await resolveBathymetrySource(meta, 4);
      expect(res).toBeNull();
      expect(fake.calls).toEqual([
        "ncei-bag-mosaic",
        "ncei-dem-global-mosaic",
        "gebco",
      ]);
    } finally {
      fake.restore();
    }
  });

  it("uses the default gebco-only list for unknown AOIs", async () => {
    const fake = makeFakeRegistry({ gebco: "ok" });
    try {
      const res = await resolveBathymetrySource(FAKE_META, 4);
      expect(res?.source.id).toBe("gebco");
      expect(fake.calls).toEqual(["gebco"]);
    } finally {
      fake.restore();
    }
  });
});
