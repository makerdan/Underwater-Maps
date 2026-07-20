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
    expect(kind("fw-lake-george-ny")).toBe("arcgis-rest");
    expect(kind("fw-lake-minnetonka-mn")).toBe("arcgis-rest");
    expect(kind("fw-lake-mead")).toBe("usgs-3dep");
    expect(kind("fw-kentucky-lake-ky-tn")).toBe("usgs-3dep");
    // Pre-built survey bundles win over their remote endpoints.
    expect(kind("fw-lake-tahoe")).toBe("bundled");
    expect(kind("fw-crater-lake-or")).toBe("bundled");
  });

  it("NYSDEC and MN DNR strategies carry the arcgis-rest service params", () => {
    const byId = new Map(EXTRA_CATALOG_ENTRIES.map((e) => [e.id, e]));
    const ny = deriveCatalogFetchStrategy(byId.get("fw-lake-george-ny")!);
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
