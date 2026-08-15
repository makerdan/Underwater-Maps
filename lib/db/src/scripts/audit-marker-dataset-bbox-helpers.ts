/**
 * audit-marker-dataset-bbox-helpers.ts
 *
 * Helpers extracted from audit-marker-dataset-bbox.ts.
 *
 * The pure classification helpers (isInBbox, classifyMarkers, ciExitCode) have
 * no database dependency and can be tested without a real DB connection.
 *
 * The DB helper (resolveBboxes) accepts a Drizzle db instance so it can be
 * exercised in integration tests against a real (test-isolated) schema.
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import type * as schema from "../schema/index.js";
import { datasetCatalogTable } from "../schema/dataset-catalog.js";
import { customDatasetsTable } from "../schema/custom-datasets.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface MarkerRow {
  id: string;
  userId: string | null;
  datasetId: string | null;
  lon: number;
  lat: number;
}

// ---------------------------------------------------------------------------
// Point-in-bbox check (inclusive boundaries)
// ---------------------------------------------------------------------------

export function isInBbox(lon: number, lat: number, bbox: Bbox): boolean {
  return (
    lon >= bbox.minLon &&
    lon <= bbox.maxLon &&
    lat >= bbox.minLat &&
    lat <= bbox.maxLat
  );
}

// ---------------------------------------------------------------------------
// Classify markers into out-of-bounds and unknown-dataset buckets.
//
// bboxMap is expected to have an entry for every unique datasetId:
//   - Bbox object  → dataset exists; check point containment
//   - null         → dataset was deleted / not found in either table
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  outOfBounds: MarkerRow[];
  unknownDataset: MarkerRow[];
}

export function classifyMarkers(
  markers: MarkerRow[],
  bboxMap: Map<string, Bbox | null>,
): ClassifyResult {
  const outOfBounds: MarkerRow[] = [];
  const unknownDataset: MarkerRow[] = [];

  for (const marker of markers) {
    const bbox = bboxMap.get(marker.datasetId as string);
    if (bbox === null) {
      unknownDataset.push(marker);
    } else if (bbox !== undefined && !isInBbox(marker.lon, marker.lat, bbox)) {
      outOfBounds.push(marker);
    }
    // bbox is defined and point is inside → in-bounds, no action
  }

  return { outOfBounds, unknownDataset };
}

// ---------------------------------------------------------------------------
// CI exit-code decision
//
// Returns 1 when ciMode is true and there are problematic entries, 0 otherwise.
// Callers are responsible for setting process.exitCode.
// ---------------------------------------------------------------------------

export function ciExitCode(
  problematicCount: number,
  ciMode: boolean,
): 0 | 1 {
  return ciMode && problematicCount > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// DB helper — resolve bboxes for a set of dataset IDs.
//
// Checks the catalog table first; for IDs not found there it falls back to
// custom_datasets.terrainJson.  Any ID whose stored bbox is missing or has
// the wrong JSON shape (e.g. snake_case keys instead of camelCase) is treated
// as unresolvable and mapped to null — the same outcome as a deleted dataset.
//
// Exported so integration tests can exercise this path against a real DB
// without importing the side-effectful main script.
// ---------------------------------------------------------------------------

export async function resolveBboxes(
  db: NodePgDatabase<typeof schema>,
  datasetIds: string[],
): Promise<Map<string, Bbox | null>> {
  const result = new Map<string, Bbox | null>();
  if (datasetIds.length === 0) return result;

  // --- catalog table ---
  const catalogRows = await db
    .select({
      id: datasetCatalogTable.id,
      coverageBbox: datasetCatalogTable.coverageBbox,
    })
    .from(datasetCatalogTable)
    .where(inArray(datasetCatalogTable.id, datasetIds));

  for (const row of catalogRows) {
    const bbox = row.coverageBbox as unknown as Record<string, unknown> | null;
    if (
      bbox &&
      typeof bbox["minLon"] === "number" &&
      typeof bbox["minLat"] === "number" &&
      typeof bbox["maxLon"] === "number" &&
      typeof bbox["maxLat"] === "number"
    ) {
      result.set(row.id, {
        minLon: bbox["minLon"] as number,
        minLat: bbox["minLat"] as number,
        maxLon: bbox["maxLon"] as number,
        maxLat: bbox["maxLat"] as number,
      });
    }
  }

  // --- custom datasets table (for IDs not found in catalog) ---
  // Only look up IDs that are UUID-shaped — catalog dataset IDs are human-readable
  // slugs (e.g. "thorne-bay") and never appear in custom_datasets, whose `id`
  // column is typed uuid. Passing a non-UUID string causes Postgres to throw
  // "invalid input syntax for type uuid", crashing the audit.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const stillMissing = datasetIds.filter((id) => !result.has(id));
  const uuidMissing = stillMissing.filter((id) => UUID_RE.test(id));
  if (uuidMissing.length > 0) {
    const customRows = await db
      .select({
        id: customDatasetsTable.id,
        terrainJson: customDatasetsTable.terrainJson,
      })
      .from(customDatasetsTable)
      .where(inArray(customDatasetsTable.id, uuidMissing));

    for (const row of customRows) {
      const tj = row.terrainJson as { minLon?: unknown; minLat?: unknown; maxLon?: unknown; maxLat?: unknown } | null;
      if (
        tj &&
        typeof tj.minLon === "number" &&
        typeof tj.minLat === "number" &&
        typeof tj.maxLon === "number" &&
        typeof tj.maxLat === "number"
      ) {
        result.set(row.id, {
          minLon: tj.minLon,
          minLat: tj.minLat,
          maxLon: tj.maxLon,
          maxLat: tj.maxLat,
        });
      }
    }
  }

  // Any ID still not resolved → null (dataset deleted / bbox shape unreadable)
  for (const id of datasetIds) {
    if (!result.has(id)) {
      result.set(id, null);
    }
  }

  return result;
}
