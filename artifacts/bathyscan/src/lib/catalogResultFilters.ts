import type { DatasetCatalogSearchResult } from "@workspace/api-client-react";

export interface CatalogResultFilters {
  type: string;
  name: string;
  updatedFrom: string;
  updatedTo: string;
  bathymetryOnly: boolean;
  efhOnly: boolean;
}

export const EMPTY_CATALOG_RESULT_FILTERS: CatalogResultFilters = {
  type: "",
  name: "",
  updatedFrom: "",
  updatedTo: "",
  bathymetryOnly: false,
  efhOnly: false,
};

/** EFH is a specific NOAA catalog family, not every habitat/substrate record. */
export function isEssentialFishHabitat(entry: Pick<DatasetCatalogSearchResult, "id" | "name" | "description">): boolean {
  return /^noaa-efh-/i.test(entry.id)
    || /\bessential fish habitat\b/i.test(`${entry.name} ${entry.description ?? ""}`);
}

function dateValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function boundDate(value: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasCatalogResultFilters(filters: CatalogResultFilters): boolean {
  return Boolean(filters.type || filters.name.trim() || filters.updatedFrom || filters.updatedTo
    || filters.bathymetryOnly || filters.efhOnly);
}

export function filterCatalogResults<T extends DatasetCatalogSearchResult>(
  results: T[],
  filters: CatalogResultFilters,
): T[] {
  const name = filters.name.trim().toLowerCase();
  const from = boundDate(filters.updatedFrom);
  const to = filters.updatedTo
    ? (() => {
      const parsed = Date.parse(`${filters.updatedTo}T23:59:59.999Z`);
      return Number.isFinite(parsed) ? parsed : null;
    })()
    : null;
  return results.filter((entry) => {
    if (filters.type && entry.dataType !== filters.type) return false;
    if (name && !entry.name.toLowerCase().includes(name)) return false;
    if (filters.bathymetryOnly && entry.dataType !== "bathymetry") return false;
    if (filters.efhOnly && !isEssentialFishHabitat(entry)) return false;
    const updated = dateValue(entry.lastUpdated);
    // A missing or invalid catalog date cannot satisfy an explicit date bound.
    if ((from !== null || to !== null) && updated === null) return false;
    if (from !== null && updated! < from) return false;
    if (to !== null && updated! > to) return false;
    return true;
  });
}