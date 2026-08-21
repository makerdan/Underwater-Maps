/**
 * Provider-neutral catalog use cases.
 *
 * Routes and other domains should use this facade instead of coupling
 * themselves to the catalog seeder's storage and indexing implementation.
 * The seeder remains the source of truth for static entries and DB-backed
 * catalog reconciliation.
 */

import {
  getCatalogEntries,
  invalidateCatalogCache,
  searchCatalog,
  type CatalogSearchParams,
  type CatalogSearchResult,
  type CatalogSeedEntry,
} from "../../lib/catalogSeeder.js";

export type { CatalogSearchParams, CatalogSearchResult, CatalogSeedEntry };

export const catalogService = Object.freeze({
  getEntries: getCatalogEntries,
  search: (params: CatalogSearchParams): Promise<CatalogSearchResult[]> =>
    searchCatalog(params),
  invalidate: invalidateCatalogCache,
});
