/**
 * catalog-fetch-strategy.test.ts
 *
 * Guard test: every bathymetry catalog preset must resolve to a valid
 * FetchStrategy so POST /api/terrain/bundles never 422s for a seeded entry.
 * A newly added bathymetry entry whose endpoint has no matching fetcher
 * fails here at test-fast time instead of 422-ing in production.
 */

import { describe, it, expect } from "vitest";
import {
  EXTRA_CATALOG_ENTRIES,
  buildPresetCatalogEntries,
} from "../catalogSeeder.js";
import { deriveCatalogFetchStrategy } from "../catalogFetchStrategy.js";
import { getFetcher } from "../fetchers/index.js";
import { ALL_PRESET_DATASETS } from "../terrain.js";
import { computeWcsAvailable } from "../../routes/ncei.js";

const BATHY_ENTRIES = EXTRA_CATALOG_ENTRIES.filter(
  (e) => e.dataType === "bathymetry",
);

describe("catalog fetchStrategy rollout guard", () => {
  it("has a sane number of bathymetry entries to guard", () => {
    expect(BATHY_ENTRIES.length).toBeGreaterThan(50);
  });

  it("every bathymetry EXTRA_CATALOG_ENTRIES entry derives a valid fetchStrategy", () => {
    const missing: string[] = [];
    for (const entry of BATHY_ENTRIES) {
      const strategy = deriveCatalogFetchStrategy(entry);
      if (!strategy) {
        missing.push(entry.id);
        continue;
      }
      // Must resolve to a registered fetcher without throwing.
      expect(() => getFetcher(strategy)).not.toThrow();
    }
    expect(missing, `bathymetry entries without a fetchStrategy: ${missing.join(", ")}`).toEqual([]);
  });

  it("every preset-* catalog entry derives a valid fetchStrategy", () => {
    for (const entry of buildPresetCatalogEntries()) {
      const strategy = deriveCatalogFetchStrategy(entry);
      expect(strategy, `preset entry ${entry.id} has no fetchStrategy`).not.toBeNull();
      expect(() => getFetcher(strategy!)).not.toThrow();
    }
  });

  it("every ALL_PRESET_DATASETS preset carries a fetchStrategy", () => {
    for (const d of ALL_PRESET_DATASETS) {
      expect(d.fetchStrategy, `preset ${d.id} lacks fetchStrategy`).toBeDefined();
    }
  });

  it("returns null for non-bathymetry entries", () => {
    const nonBathy = EXTRA_CATALOG_ENTRIES.filter((e) => e.dataType !== "bathymetry");
    expect(nonBathy.length).toBeGreaterThan(0);
    for (const entry of nonBathy) {
      expect(deriveCatalogFetchStrategy(entry)).toBeNull();
    }
  });

  it("maps known sources to the expected fetcher kinds", () => {
    const byId = new Map(EXTRA_CATALOG_ENTRIES.map((e) => [e.id, e]));
    const kind = (id: string) => deriveCatalogFetchStrategy(byId.get(id)!)?.kind;

    expect(kind("gebco-2024-global")).toBe("gebco-wcs");
    expect(kind("ncei-bag-mosaic-alaska")).toBe("ncei-wcs");
    expect(kind("ncei-dem-global-mosaic")).toBe("ncei-wcs");
    expect(kind("ncei-crm-s-alaska")).toBe("ncei-wcs");
    expect(kind("fw-lake-superior")).toBe("great-lakes-wcs");
    // Lake George has no public bathymetry service (NYSDEC statewide service
    // deleted upstream; Finger Lakes successor has no coverage) — it now
    // falls back honestly to USGS 3DEP.
    expect(kind("fw-lake-george-ny")).toBe("usgs-3dep");
    expect(kind("fw-seneca-lake-ny")).toBe("arcgis-rest");
    expect(kind("fw-lake-minnetonka-mn")).toBe("arcgis-rest");
    expect(kind("fw-lake-mead-nv-az")).toBe("usgs-3dep");
    expect(kind("fw-kentucky-lake-ky-tn")).toBe("usgs-3dep");
    // Pre-built survey bundles win over their remote endpoints.
    expect(kind("fw-lake-tahoe-ca-nv")).toBe("bundled");
    expect(kind("fw-crater-lake-or")).toBe("bundled");
  });

  it("NYSDEC and MN DNR strategies carry the arcgis-rest service params", () => {
    const byId = new Map(EXTRA_CATALOG_ENTRIES.map((e) => [e.id, e]));
    const ny = deriveCatalogFetchStrategy(byId.get("fw-seneca-lake-ny")!);
    expect(ny).toMatchObject({ kind: "arcgis-rest", dataSource: "nysdec" });
    if (ny?.kind === "arcgis-rest") {
      expect(ny.serviceUrl).toContain("arcgis");
      expect(ny.sourceLabel.length).toBeGreaterThan(0);
      expect(ny.creditUrl.length).toBeGreaterThan(0);
    }
    const mn = deriveCatalogFetchStrategy(byId.get("fw-mille-lacs-lake-mn")!);
    expect(mn).toMatchObject({ kind: "arcgis-rest", dataSource: "mn-dnr" });
  });
});

// ---------------------------------------------------------------------------
// computeWcsAvailable — NCEI WCS mosaic coverage footprint checks
// ---------------------------------------------------------------------------

describe("computeWcsAvailable — NCEI WCS mosaic coverage footprint", () => {
  // BAG Mosaic regions
  it("US West Coast bbox is covered by the BAG Mosaic", () => {
    expect(
      computeWcsAvailable({ minLon: -125.5, minLat: 37.0, maxLon: -122.0, maxLat: 40.0 }),
    ).toBe(true);
  });

  it("SE Alaska bbox is covered by the BAG Mosaic", () => {
    expect(
      computeWcsAvailable({ minLon: -137, minLat: 56, maxLon: -130, maxLat: 60 }),
    ).toBe(true);
  });

  it("Hawaii bbox is covered by the BAG Mosaic", () => {
    expect(
      computeWcsAvailable({ minLon: -159, minLat: 19, maxLon: -155, maxLat: 22 }),
    ).toBe(true);
  });

  // DEM Global Mosaic regions
  it("Open North Atlantic bbox is covered by the DEM Global Mosaic", () => {
    expect(
      computeWcsAvailable({ minLon: -50, minLat: 30, maxLon: -30, maxLat: 50 }),
    ).toBe(true);
  });

  it("Indian Ocean bbox is covered by the DEM Global Mosaic", () => {
    expect(
      computeWcsAvailable({ minLon: 55, minLat: -15, maxLon: 75, maxLat: 5 }),
    ).toBe(true);
  });

  // Landlocked / interior regions — outside all mosaics
  it("landlocked Central Asian bbox is NOT covered", () => {
    expect(
      computeWcsAvailable({ minLon: 60, minLat: 40, maxLon: 80, maxLat: 55 }),
    ).toBe(false);
  });

  it("mid-continental US bbox (Kansas) is NOT covered", () => {
    expect(
      computeWcsAvailable({ minLon: -100, minLat: 37, maxLon: -95, maxLat: 40 }),
    ).toBe(false);
  });

  it("Saharan bbox is NOT covered", () => {
    expect(
      computeWcsAvailable({ minLon: 10, minLat: 20, maxLon: 25, maxLat: 28 }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Static guard — every NCEI bathymetry entry has a valid coverageBbox and
// intersects at least one NCEI WCS mosaic coverage region.
//
// This guard fails loudly when a new NCEI catalog entry is added with a bogus
// or landlocked bbox, before that entry ever reaches production.
// ---------------------------------------------------------------------------

// Static guard — only entries with the `ncei-` id prefix are routed through
// the NCEI WCS mosaic fetchers by nceiCoverageForEntry / buildCatalogGrids.
// Freshwater entries that happen to carry sourceAgency "NOAA/NCEI" (e.g.
// fw-lake-*) use a different code path and must not be included here.
describe("static NCEI catalog guard — coverageBbox validity and WCS intersection", () => {
  const nceiEntries = EXTRA_CATALOG_ENTRIES.filter(
    (e) => e.dataType === "bathymetry" && e.id.startsWith("ncei-"),
  );

  it("has at least one ncei-prefix bathymetry entry in EXTRA_CATALOG_ENTRIES", () => {
    expect(nceiEntries.length).toBeGreaterThan(0);
  });

  it("every ncei-prefix bathymetry entry has a non-zero-area coverageBbox with finite coordinates", () => {
    const invalid: string[] = [];
    for (const e of nceiEntries) {
      const { minLon, minLat, maxLon, maxLat } = e.coverageBbox;
      if (
        !isFinite(minLon) ||
        !isFinite(minLat) ||
        !isFinite(maxLon) ||
        !isFinite(maxLat) ||
        maxLon <= minLon ||
        maxLat <= minLat
      ) {
        invalid.push(e.id);
      }
    }
    expect(
      invalid,
      `NCEI entries with invalid coverageBbox: ${invalid.join(", ")}`,
    ).toEqual([]);
  });

  it("every ncei-prefix bathymetry entry's coverageBbox intersects at least one NCEI WCS mosaic coverage region", () => {
    const notCovered: string[] = [];
    for (const e of nceiEntries) {
      if (!computeWcsAvailable(e.coverageBbox)) {
        notCovered.push(e.id);
      }
    }
    expect(
      notCovered,
      `ncei-prefix entries whose coverageBbox doesn't intersect any WCS mosaic — these saves would always fail: ${notCovered.join(", ")}`,
    ).toEqual([]);
  });
});
