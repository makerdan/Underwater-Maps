import { describe, expect, it } from "vitest";
import {
  EMPTY_CATALOG_RESULT_FILTERS,
  filterCatalogResults,
  isEssentialFishHabitat,
} from "./catalogResultFilters";

const entries = [
  { id: "noaa-efh-alaska-salmon", name: "Salmon Essential Fish Habitat", description: "EFH", dataType: "habitat", lastUpdated: "2024-01-15" },
  { id: "kelp-habitat", name: "Kelp Habitat", description: "Substrate habitat", dataType: "habitat", lastUpdated: null },
  { id: "bathy", name: "Modern Bathymetry", description: null, dataType: "bathymetry", lastUpdated: "2025-06-01" },
] as never[];

describe("catalog result filters", () => {
  it("filters by name, dates, type, bathymetry, and EFH", () => {
    expect(filterCatalogResults(entries, { ...EMPTY_CATALOG_RESULT_FILTERS, name: "modern" })).toHaveLength(1);
    expect(filterCatalogResults(entries, { ...EMPTY_CATALOG_RESULT_FILTERS, updatedFrom: "2025-01-01" })).toHaveLength(1);
    expect(filterCatalogResults(entries, { ...EMPTY_CATALOG_RESULT_FILTERS, type: "habitat" })).toHaveLength(2);
    expect(filterCatalogResults(entries, { ...EMPTY_CATALOG_RESULT_FILTERS, bathymetryOnly: true })).toHaveLength(1);
    expect(filterCatalogResults(entries, { ...EMPTY_CATALOG_RESULT_FILTERS, efhOnly: true })).toHaveLength(1);
  });

  it("does not classify unrelated habitat as EFH and excludes undated entries for date bounds", () => {
    expect(isEssentialFishHabitat(entries[0])).toBe(true);
    expect(isEssentialFishHabitat(entries[1])).toBe(false);
    expect(filterCatalogResults(entries, { ...EMPTY_CATALOG_RESULT_FILTERS, updatedTo: "2024-12-31" })).toHaveLength(1);
  });
});