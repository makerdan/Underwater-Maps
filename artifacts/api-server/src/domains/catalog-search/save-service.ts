/**
 * Catalog-save domain service.
 *
 * The materialization pipeline currently has a substantial implementation
 * history in the catalog-saves route. This facade is the domain boundary used
 * by every provider-specific save route; the route remains the compatibility
 * owner for the implementation and its existing unit-test surface.
 */

import { userCatalogSavesTable } from "@workspace/db";
import type { CatalogSeedEntry } from "./catalog-service.js";
import type { NormalisedBbox } from "../../lib/bbox.js";

/**
 * Keep the legacy materializer behind this domain boundary while its
 * implementation is migrated out of the HTTP route. A dynamic import is
 * intentional: mounting NCEI or federated routes must not eagerly mount or
 * initialize the catalog-saves router.
 */
async function materializeSave(
  saveId: string,
  userId: string,
  entry: CatalogSeedEntry,
): Promise<void> {
  const { materializeSave } = await import("../../routes/catalog-saves.js");
  return materializeSave(saveId, userId, entry);
}

function entryCreatedAtIso(entry: CatalogSeedEntry): string | undefined {
  const raw = (entry as CatalogSeedEntry & { createdAt?: Date | string }).createdAt;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "string") return raw;
  return undefined;
}

function toCatalogResponse(entry: CatalogSeedEntry, createdAt?: string) {
  return {
    id: entry.id,
    name: entry.name,
    sourceAgency: entry.sourceAgency,
    dataType: entry.dataType,
    resolutionMMin: entry.resolutionMMin ?? null,
    resolutionMMax: entry.resolutionMMax ?? null,
    coverageBbox: entry.coverageBbox,
    endpointUrl: entry.endpointUrl ?? null,
    accessNotes: entry.accessNotes ?? null,
    description: entry.description ?? null,
    keywords: entry.keywords ?? null,
    lastUpdated: entry.lastUpdated ?? null,
    waterType: entry.waterType,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

function formatSaveRow(
  row: typeof userCatalogSavesTable.$inferSelect,
  entry: CatalogSeedEntry | null,
  terrainBbox: NormalisedBbox | null = null,
) {
  return {
    id: row.id,
    catalogId: row.catalogId,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    readyAt: row.readyAt?.toISOString() ?? null,
    cacheKey: row.cacheKey ?? null,
    errorMessage: row.errorMessage ?? null,
    displayLabel: row.displayLabel ?? null,
    folderId: row.folderId ?? null,
    datasetId: row.datasetId ?? null,
    catalog: entry ? toCatalogResponse(entry, entryCreatedAtIso(entry)) : null,
    terrainBbox,
  };
}

export const catalogSaveService = Object.freeze({
  materializeSave,
  formatSaveRow,
});

export type CatalogSaveService = typeof catalogSaveService;