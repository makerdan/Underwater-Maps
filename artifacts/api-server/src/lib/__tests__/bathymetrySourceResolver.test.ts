/**
 * Tests for the ranked bathymetry source resolver (Task #398).
 *
 * Covers:
 *  - Registry shape (every source declares a scope, dataSource, label,
 *    fetch, and credit URL; scopes match the expected vocabulary).
 *  - The per-AOI priority map has entries for inland TX freshwater preset
 *    and SE Alaska legacy resolver targets, references only known source ids.
 *  - Inland TX reservoirs (Ray Roberts, Texoma) lead with `bundled-survey`.
 *  - Ranked-fallback behaviour using a synthetic AOI that exercises the
 *    default priority list.
 */

import { describe, it, expect } from "vitest";
import {
  BATHYMETRY_SOURCES,
  BUNDLED_TERRAIN,
  DATASET_SOURCE_PRIORITY,
  NCEI_DATASET_COVERAGES,
  resampleBundled,
  resolveBathymetrySource,
  type BathymetrySourceId,
} from "../terrain.js";

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

describe("BATHYMETRY_SOURCES registry", () => {
  it("declares the expected sources", () => {
    expect(Object.keys(BATHYMETRY_SOURCES).sort()).toEqual(
      [
        "bundled-survey",
        "gebco",
        "mn-dnr-bathy",
        "ncei-bag-mosaic",
        "ncei-crm-s-alaska",
        "ncei-dem-global-mosaic",
        "noaa-great-lakes-dem",
        "nysdec-bathy",
        "usgs-3dep",
      ].sort(),
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
  it("has ranked priority entries for inland TX preset and SE Alaska resolver targets", () => {
    expect(Object.keys(DATASET_SOURCE_PRIORITY).length).toBeGreaterThan(0);
    expect(DATASET_SOURCE_PRIORITY["thorne-bay"]).toBeDefined();
    expect(DATASET_SOURCE_PRIORITY["lake-ray-roberts"]).toBeDefined();
  });

  it("registers the inland TX reservoir with bundled-survey first", () => {
    expect(DATASET_SOURCE_PRIORITY["lake-ray-roberts"]?.[0]).toBe("bundled-survey");
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
    (BATHYMETRY_SOURCES as Record<string, unknown>)[id] = {
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

// ---------------------------------------------------------------------------
// Bundled surveyed-bathymetry bundles — presence and resample integrity
// ---------------------------------------------------------------------------

describe("BUNDLED_TERRAIN — bundle file presence and resample integrity", () => {
  it("registers exactly the expected bundled dataset ids", () => {
    expect(Object.keys(BUNDLED_TERRAIN).sort()).toEqual(
      ["fw-crater-lake-or", "fw-lake-tahoe", "lake-ray-roberts"].sort(),
    );
  });

  it("every registered bundle loaded successfully (non-null)", () => {
    for (const [id, bundle] of Object.entries(BUNDLED_TERRAIN)) {
      expect(
        bundle,
        `BUNDLED_TERRAIN["${id}"] is null — the bundle file is missing or unparseable`,
      ).not.toBeNull();
    }
  });

  it("every bundle has a valid bbox, positive width and height", () => {
    for (const [id, bundle] of Object.entries(BUNDLED_TERRAIN)) {
      if (!bundle) continue;
      expect(bundle.width, `${id}: width must be > 0`).toBeGreaterThan(0);
      expect(bundle.height, `${id}: height must be > 0`).toBeGreaterThan(0);
      expect(bundle.bbox.minLon, `${id}: minLon`).toBeLessThan(bundle.bbox.maxLon);
      expect(bundle.bbox.minLat, `${id}: minLat`).toBeLessThan(bundle.bbox.maxLat);
    }
  });

  it("resampleBundled round-trips at native resolution without throwing", () => {
    for (const [id, bundle] of Object.entries(BUNDLED_TERRAIN)) {
      if (!bundle) continue;
      const rs = resampleBundled(bundle, bundle.width);
      expect(rs.depths.length, `${id}: depths.length at native res`).toBe(
        bundle.width * bundle.height,
      );
      expect(rs.topography.length, `${id}: topography.length at native res`).toBe(
        bundle.width * bundle.height,
      );
      expect(Number.isFinite(rs.minDepth), `${id}: minDepth must be finite`).toBe(true);
      expect(Number.isFinite(rs.maxDepth), `${id}: maxDepth must be finite`).toBe(true);
      expect(rs.maxDepth, `${id}: maxDepth >= minDepth`).toBeGreaterThanOrEqual(rs.minDepth);
    }
  });

  it("resampleBundled round-trips at a downsampled resolution without throwing", () => {
    const N = 16;
    for (const [id, bundle] of Object.entries(BUNDLED_TERRAIN)) {
      if (!bundle) continue;
      const rs = resampleBundled(bundle, N);
      expect(rs.depths.length, `${id}: depths.length at N=${N}`).toBe(N * N);
      expect(rs.topography.length, `${id}: topography.length at N=${N}`).toBe(N * N);
      expect(Number.isFinite(rs.minDepth), `${id}: minDepth must be finite`).toBe(true);
      expect(Number.isFinite(rs.maxDepth), `${id}: maxDepth must be finite`).toBe(true);
    }
  });

  it("bundled-survey source in DATASET_SOURCE_PRIORITY covers every BUNDLED_TERRAIN key", () => {
    for (const id of Object.keys(BUNDLED_TERRAIN)) {
      const priority = DATASET_SOURCE_PRIORITY[id];
      expect(
        priority,
        `DATASET_SOURCE_PRIORITY["${id}"] is missing — add it so bundled-survey is reachable`,
      ).toBeDefined();
      expect(
        priority?.[0],
        `DATASET_SOURCE_PRIORITY["${id}"] must lead with 'bundled-survey'`,
      ).toBe("bundled-survey");
    }
  });
});

// ---------------------------------------------------------------------------
// NCEI Southern Alaska CRM source (Task #987)
// ---------------------------------------------------------------------------

describe("ncei-crm-s-alaska source", () => {
  it("is registered in BATHYMETRY_SOURCES with expected shape", () => {
    const src = BATHYMETRY_SOURCES["ncei-crm-s-alaska"];
    expect(src).toBeDefined();
    expect(src.id).toBe("ncei-crm-s-alaska");
    expect(src.scope).toBe("regional");
    expect(src.dataSource).toBe("ncei");
    expect(src.creditUrl).toMatch(/^https?:\/\//);
    expect(typeof src.fetch).toBe("function");
  });

  it("is the top-ranked source for kodiak-island", () => {
    expect(DATASET_SOURCE_PRIORITY["kodiak-island"]?.[0]).toBe("ncei-crm-s-alaska");
  });

  it("is the top-ranked source for kachemak-bay", () => {
    expect(DATASET_SOURCE_PRIORITY["kachemak-bay"]?.[0]).toBe("ncei-crm-s-alaska");
  });

  it("is the top-ranked source for resurrection-bay", () => {
    expect(DATASET_SOURCE_PRIORITY["resurrection-bay"]?.[0]).toBe("ncei-crm-s-alaska");
  });

  it("is the top-ranked source for prince-william-sound", () => {
    expect(DATASET_SOURCE_PRIORITY["prince-william-sound"]?.[0]).toBe("ncei-crm-s-alaska");
  });

  it("does NOT appear in the lake-ray-roberts (freshwater) priority list", () => {
    const lrrPriority = DATASET_SOURCE_PRIORITY["lake-ray-roberts"] ?? [];
    expect(lrrPriority).not.toContain("ncei-crm-s-alaska");
  });

  it("all four Southern Alaska AOIs include ncei-bag-mosaic after ncei-crm-s-alaska", () => {
    const southAlaskaAois = [
      "kodiak-island",
      "kachemak-bay",
      "resurrection-bay",
      "prince-william-sound",
    ] as const;
    for (const aoi of southAlaskaAois) {
      const priority = DATASET_SOURCE_PRIORITY[aoi] ?? [];
      const crmIdx = priority.indexOf("ncei-crm-s-alaska");
      const bagIdx = priority.indexOf("ncei-bag-mosaic");
      expect(crmIdx, `${aoi}: ncei-crm-s-alaska must be present`).toBeGreaterThanOrEqual(0);
      expect(bagIdx, `${aoi}: ncei-bag-mosaic must be present`).toBeGreaterThanOrEqual(0);
      expect(crmIdx, `${aoi}: CRM must rank above BAG`).toBeLessThan(bagIdx);
    }
  });

  it("all four Southern Alaska AOIs end with gebco as final upstream fallback", () => {
    const southAlaskaAois = [
      "kodiak-island",
      "kachemak-bay",
      "resurrection-bay",
      "prince-william-sound",
    ] as const;
    for (const aoi of southAlaskaAois) {
      const priority = DATASET_SOURCE_PRIORITY[aoi] ?? [];
      expect(
        priority[priority.length - 1],
        `${aoi}: last ranked source must be gebco`,
      ).toBe("gebco");
    }
  });
});

// ---------------------------------------------------------------------------
// NYSDEC bathymetry source (Task #2737)
// ---------------------------------------------------------------------------

describe("nysdec-bathy source", () => {
  it("is registered in BATHYMETRY_SOURCES with expected shape", () => {
    const src = BATHYMETRY_SOURCES["nysdec-bathy"];
    expect(src).toBeDefined();
    expect(src.id).toBe("nysdec-bathy");
    expect(src.scope).toBe("state");
    expect(src.dataSource).toBe("nysdec");
    expect(src.creditUrl).toMatch(/^https?:\/\//);
    expect(typeof src.fetch).toBe("function");
  });

  it("is the top-ranked source for fw-lake-george-ny", () => {
    expect(DATASET_SOURCE_PRIORITY["fw-lake-george-ny"]?.[0]).toBe("nysdec-bathy");
  });

  it("is the top-ranked source for fw-seneca-lake-ny", () => {
    expect(DATASET_SOURCE_PRIORITY["fw-seneca-lake-ny"]?.[0]).toBe("nysdec-bathy");
  });

  it("is the top-ranked source for fw-cayuga-lake-ny", () => {
    expect(DATASET_SOURCE_PRIORITY["fw-cayuga-lake-ny"]?.[0]).toBe("nysdec-bathy");
  });

  it("fw-lake-george-ny falls back to usgs-3dep then gebco", () => {
    const priority = DATASET_SOURCE_PRIORITY["fw-lake-george-ny"] ?? [];
    expect(priority).toContain("usgs-3dep");
    expect(priority).toContain("gebco");
    const nysdecIdx = priority.indexOf("nysdec-bathy");
    const depIdx = priority.indexOf("usgs-3dep");
    const gebcoIdx = priority.indexOf("gebco");
    expect(nysdecIdx).toBeLessThan(depIdx);
    expect(depIdx).toBeLessThan(gebcoIdx);
  });

  it("does NOT appear in the thorne-bay (saltwater) priority list", () => {
    const priority = DATASET_SOURCE_PRIORITY["thorne-bay"] ?? [];
    expect(priority).not.toContain("nysdec-bathy");
  });
});

// ---------------------------------------------------------------------------
// MN DNR bathymetry source (Task #2737)
// ---------------------------------------------------------------------------

describe("mn-dnr-bathy source", () => {
  it("is registered in BATHYMETRY_SOURCES with expected shape", () => {
    const src = BATHYMETRY_SOURCES["mn-dnr-bathy"];
    expect(src).toBeDefined();
    expect(src.id).toBe("mn-dnr-bathy");
    expect(src.scope).toBe("state");
    expect(src.dataSource).toBe("mn-dnr");
    expect(src.creditUrl).toMatch(/^https?:\/\//);
    expect(typeof src.fetch).toBe("function");
  });

  it("is the top-ranked source for fw-lake-minnetonka-mn", () => {
    expect(DATASET_SOURCE_PRIORITY["fw-lake-minnetonka-mn"]?.[0]).toBe("mn-dnr-bathy");
  });

  it("is the top-ranked source for fw-mille-lacs-lake-mn", () => {
    expect(DATASET_SOURCE_PRIORITY["fw-mille-lacs-lake-mn"]?.[0]).toBe("mn-dnr-bathy");
  });

  it("fw-lake-minnetonka-mn falls back to usgs-3dep then gebco", () => {
    const priority = DATASET_SOURCE_PRIORITY["fw-lake-minnetonka-mn"] ?? [];
    expect(priority).toContain("usgs-3dep");
    expect(priority).toContain("gebco");
    const dnrIdx = priority.indexOf("mn-dnr-bathy");
    const depIdx = priority.indexOf("usgs-3dep");
    const gebcoIdx = priority.indexOf("gebco");
    expect(dnrIdx).toBeLessThan(depIdx);
    expect(depIdx).toBeLessThan(gebcoIdx);
  });

  it("does NOT appear in the fw-lake-george-ny (NY lake) priority list", () => {
    const priority = DATASET_SOURCE_PRIORITY["fw-lake-george-ny"] ?? [];
    expect(priority).not.toContain("mn-dnr-bathy");
  });
});
