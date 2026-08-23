/**
 * Catalog-save domain service.
 *
 * The materialization pipeline currently has a substantial implementation
 * history in the catalog-saves route. This facade is the domain boundary used
 * by every provider-specific save route; the route remains the compatibility
 * owner for the implementation and its existing unit-test surface.
 */

import {
  db,
  userCatalogSavesTable,
  customDatasetsTable,
  type StoredTerrainJson,
} from "@workspace/db";
import {
  and,
  eq,
} from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import type { CatalogSeedEntry } from "./catalog-service.js";
import type { NormalisedBbox } from "../../lib/bbox.js";

type MaterializedGrids = Awaited<
  ReturnType<typeof import("../../routes/catalog-saves.js")["buildCatalogGrids"]>
>;

/**
 * Load the provider-specific grid builder lazily. The builder remains exported
 * by the route module for compatibility with its focused routing tests, but
 * the save job itself belongs to this domain service and owns persistence,
 * cancellation, cleanup, and failure handling.
 */
async function buildCatalogGrids(
  entry: CatalogSeedEntry,
  requestBbox: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null,
): Promise<MaterializedGrids> {
  const routeModule = await import("../../routes/catalog-saves.js");
  return routeModule.buildCatalogGrids(entry, requestBbox);
}

function parseRequestBbox(
  json: string | null | undefined,
): { minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "minLon" in parsed &&
      "minLat" in parsed &&
      "maxLon" in parsed &&
      "maxLat" in parsed
    ) {
      const bbox = parsed as {
        minLon: number;
        minLat: number;
        maxLon: number;
        maxLat: number;
      };
      if (
        [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].every(
          (value) => typeof value === "number" && isFinite(value),
        )
      ) {
        return bbox;
      }
    }
  } catch {
    // Malformed legacy values are treated as an omitted request bbox.
  }
  return null;
}

function humanizeErrorMessage(raw: string): string {
  if (raw.includes("near-flat grid")) {
    return "No multibeam surveys found in this area. Try loading a terrain near Ketchikan or Thorne Bay first, then re-save.";
  }
  return raw;
}

export async function materializeSave(
  saveId: string,
  userId: string,
  entry: CatalogSeedEntry,
): Promise<void> {
  try {
    try {
      const [saveRowForBbox] = await db
        .select({
          requestBboxJson: userCatalogSavesTable.requestBboxJson,
          userId: userCatalogSavesTable.userId,
          status: userCatalogSavesTable.status,
        })
        .from(userCatalogSavesTable)
        .where(eq(userCatalogSavesTable.id, saveId));

      if (
        !saveRowForBbox ||
        saveRowForBbox.userId !== userId ||
        saveRowForBbox.status !== "processing"
      ) {
        logger.info(
          {
            saveId,
            entryId: entry.id,
            found: Boolean(saveRowForBbox),
            status: saveRowForBbox?.status ?? null,
          },
          `[catalog-saves] materialize ${saveId} aborted before grid build: save row missing, owned by another user, or no longer processing`,
        );
        return;
      }

      const materialized = await buildCatalogGrids(
        entry,
        parseRequestBbox(saveRowForBbox.requestBboxJson),
      );
      if (!materialized) {
        throw new Error(
          `Materialization is not yet implemented for catalog entries of type '${entry.dataType}' ` +
            `from source '${entry.sourceAgency}'. preset-* entries are supported today.`,
        );
      }

      const { terrain, overview } = materialized;
      const [saveRow] = await db
        .select({
          folderId: userCatalogSavesTable.folderId,
          userId: userCatalogSavesTable.userId,
          status: userCatalogSavesTable.status,
        })
        .from(userCatalogSavesTable)
        .where(eq(userCatalogSavesTable.id, saveId));

      if (!saveRow || saveRow.userId !== userId || saveRow.status !== "processing") {
        logger.info(
          {
            saveId,
            entryId: entry.id,
            found: Boolean(saveRow),
            status: saveRow?.status ?? null,
          },
          `[catalog-saves] materialize ${saveId} aborted after grid build (before insert): save row missing, owned by another user, or no longer processing`,
        );
        return;
      }

      const [created] = await db
        .insert(customDatasetsTable)
        .values({
          userId,
          folderId: saveRow.folderId ?? null,
          name: entry.name,
          minDepth: terrain.minDepth,
          maxDepth: terrain.maxDepth,
          terrainJson: terrain as unknown as StoredTerrainJson,
          overviewJson: overview as unknown as StoredTerrainJson,
        })
        .returning({ id: customDatasetsTable.id });

      if (!created) throw new Error("custom_datasets insert returned no row");

      const stamped = await db
        .update(userCatalogSavesTable)
        .set({ datasetId: created.id })
        .where(
          and(
            eq(userCatalogSavesTable.id, saveId),
            eq(userCatalogSavesTable.userId, userId),
          ),
        )
        .returning({ id: userCatalogSavesTable.id });

      if (stamped.length === 0) {
        logger.warn(
          { saveId, entryId: entry.id, datasetId: created.id },
          `[catalog-saves] materialize ${saveId}: save row disappeared between insert and link — rolling back custom_datasets row ${created.id}`,
        );
        await db
          .delete(customDatasetsTable)
          .where(
            and(
              eq(customDatasetsTable.id, created.id),
              eq(customDatasetsTable.userId, userId),
            ),
          );
        return;
      }

      await db
        .update(customDatasetsTable)
        .set({
          terrainJson: { ...terrain, datasetId: created.id } as unknown as StoredTerrainJson,
          overviewJson: { ...overview, datasetId: created.id } as unknown as StoredTerrainJson,
        })
        .where(eq(customDatasetsTable.id, created.id));

      await db
        .update(userCatalogSavesTable)
        .set({
          status: "ready",
          readyAt: new Date(),
          cacheKey: `catalog:${entry.id}`,
          datasetId: created.id,
          errorMessage: null,
        })
        .where(eq(userCatalogSavesTable.id, saveId));

      const [postRow] = await db
        .select({ folderId: userCatalogSavesTable.folderId })
        .from(userCatalogSavesTable)
        .where(eq(userCatalogSavesTable.id, saveId));
      const finalFolderId = postRow?.folderId ?? null;
      if (finalFolderId !== (saveRow.folderId ?? null)) {
        await db
          .update(customDatasetsTable)
          .set({ folderId: finalFolderId })
          .where(eq(customDatasetsTable.id, created.id));
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Materialization failed";
      logger.warn(
        { saveId, entryId: entry.id, rawMessage },
        `[catalog-saves] materialize ${saveId} (${entry.id}) failed: ${rawMessage}`,
      );
      await db
        .update(userCatalogSavesTable)
        .set({ status: "failed", errorMessage: humanizeErrorMessage(rawMessage) })
        .where(eq(userCatalogSavesTable.id, saveId));
    }
  } catch (outerErr) {
    logger.error(
      { err: outerErr, saveId },
      `[catalog-saves] materialize ${saveId} outer-catch (status update may have failed)`,
    );
    try {
      await db
        .update(userCatalogSavesTable)
        .set({ status: "failed", errorMessage: "Unexpected internal error; please retry." })
        .where(eq(userCatalogSavesTable.id, saveId));
    } catch {
      // There is no safe recovery if the final status update also fails.
    }
  }
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