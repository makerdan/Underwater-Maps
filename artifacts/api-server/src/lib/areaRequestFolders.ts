/**
 * areaRequestFolders — auto-folder grouping for multi-dataset area requests.
 *
 * When a user's area search (bbox / point-radius / federated "find data"
 * request) yields several datasets and they save them, each save carries the
 * same client-generated `areaRequestId`. Once MORE THAN TWO saves exist for
 * one request, we auto-create a dataset folder named after the search and
 * route every save from that request into it — including saves that were
 * already in flight (queued/processing) when the folder was created and
 * datasets that were already materialized.
 *
 * Datasets that finish materializing AFTER folder creation land inside the
 * folder because `materializeSave` reads the save row's folderId right before
 * inserting the dataset row and re-syncs it after linking (see
 * catalog-saves.ts).
 *
 * Grouping is strictly best-effort: a failure here must never fail the save
 * request itself, so `applyAreaRequestGrouping` catches and logs internally.
 */
import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  userCatalogSavesTable,
  customDatasetsTable,
  datasetFoldersTable,
} from "@workspace/db";
import { logger } from "./logger.js";
import { placeNameForPoint } from "./reverseGeocode.js";
import { siblingNameTaken } from "../routes/folders.js";

/** Folder is created when the save count for one request EXCEEDS this. */
export const AREA_REQUEST_FOLDER_THRESHOLD = 2;

/** Max folder-name length (mirrors the folders route's trimName cap). */
const MAX_FOLDER_NAME = 120;

/**
 * Zod schema for the optional `areaRequest` save-body field
 * (mirrors the AreaRequestContext OpenAPI schema).
 */
export const AreaRequestContextSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(200),
  center: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    })
    .optional(),
});

export type AreaRequestContext = z.infer<typeof AreaRequestContextSchema>;

/**
 * Derive a folder name from the client-provided search label: collapse
 * whitespace, trim, cap at the folder-name limit, fall back to a generic
 * name when the label is empty after cleanup.
 */
export function deriveAreaFolderName(label: string): string {
  const cleaned = label.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Area search";
  if (cleaned.length <= MAX_FOLDER_NAME) return cleaned;
  return cleaned.slice(0, MAX_FOLDER_NAME - 1).trimEnd() + "…";
}

/**
 * Resolve the label to name an area folder after. Coordinate/viewport
 * searches send a `center` point — try to reverse-geocode it to a nearby
 * place name ("Sitka, Alaska") so the folder is self-explanatory in the
 * tree; fall back to the client's coordinate summary label when no place
 * is found. Text-query searches carry no center and keep the query text.
 */
async function resolveAreaFolderLabel(
  areaRequest: AreaRequestContext,
): Promise<string> {
  if (!areaRequest.center) return areaRequest.label;
  const place = await placeNameForPoint(
    areaRequest.center.lat,
    areaRequest.center.lon,
  );
  return place ?? areaRequest.label;
}

/**
 * Apply auto-folder grouping for one area request after a save was created.
 *
 * - Counts the user's saves stamped with `areaRequestId`; at ≤ threshold it
 *   does nothing (searches yielding ≤2 datasets behave exactly as today).
 * - Above the threshold it reuses the folder already associated with this
 *   request (any save row's folderId) or creates a new root folder named
 *   after `label`, de-duplicated against existing sibling folders.
 * - Stamps the folder onto every save row of this request still at root
 *   (in-flight saves included) and onto every already-materialized dataset
 *   row still at root.
 *
 * Returns the folderId when a folder applies, else null. Never throws.
 */
export async function applyAreaRequestGrouping(
  userId: string,
  areaRequest: AreaRequestContext,
): Promise<string | null> {
  try {
    const requestCond = and(
      eq(userCatalogSavesTable.userId, userId),
      eq(userCatalogSavesTable.areaRequestId, areaRequest.id),
    );
    const saves = await db.select().from(userCatalogSavesTable).where(requestCond);
    if (saves.length <= AREA_REQUEST_FOLDER_THRESHOLD) return null;

    // Reuse the folder already auto-created for this request, if any. The
    // folder row itself carries the areaRequestId, so a save the user
    // manually filed into some other folder can never be mistaken for the
    // request's auto-folder.
    let folderId = await findRequestFolder(userId, areaRequest.id);

    if (!folderId) {
      folderId = await createAreaFolder(userId, areaRequest);
      if (!folderId) {
        // Unique-name race: a concurrent save for this request may have
        // created the folder between our select and insert. Re-check.
        folderId = await findRequestFolder(userId, areaRequest.id);
      }
      if (!folderId) return null;
    }

    // Move every save of this request that is still at root into the folder.
    // Saves the user has already filed elsewhere are left alone.
    await db
      .update(userCatalogSavesTable)
      .set({ folderId })
      .where(and(requestCond, isNull(userCatalogSavesTable.folderId)));

    // Move already-materialized datasets of this request that are still at
    // root. (Datasets that materialize later inherit the folder from the
    // save row — see materializeSave.)
    const linked = await db
      .select({ datasetId: userCatalogSavesTable.datasetId })
      .from(userCatalogSavesTable)
      .where(and(requestCond, isNotNull(userCatalogSavesTable.datasetId)));
    const datasetIds = linked
      .map((r) => r.datasetId)
      .filter((id): id is string => typeof id === "string");
    if (datasetIds.length > 0) {
      await db
        .update(customDatasetsTable)
        .set({ folderId })
        .where(
          and(
            eq(customDatasetsTable.userId, userId),
            inArray(customDatasetsTable.id, datasetIds),
            isNull(customDatasetsTable.folderId),
          ),
        );
    }

    return folderId;
  } catch (err) {
    logger.warn(
      { err, userId, areaRequestId: areaRequest.id },
      "[area-request] auto-folder grouping failed (save unaffected)",
    );
    return null;
  }
}

/** Find the folder already auto-created for this area request, if any. */
async function findRequestFolder(
  userId: string,
  areaRequestId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: datasetFoldersTable.id })
    .from(datasetFoldersTable)
    .where(
      and(
        eq(datasetFoldersTable.userId, userId),
        eq(datasetFoldersTable.areaRequestId, areaRequestId),
      ),
    );
  return rows[0]?.id ?? null;
}

/**
 * Create a root folder for an area request, de-duplicating the name against
 * the user's existing root folders ("Name", "Name 2", "Name 3", …). Returns
 * null when the insert loses a unique-constraint race on every attempt.
 */
async function createAreaFolder(
  userId: string,
  areaRequest: AreaRequestContext,
): Promise<string | null> {
  const base = deriveAreaFolderName(await resolveAreaFolderLabel(areaRequest));
  const existing = await db
    .select()
    .from(datasetFoldersTable)
    .where(eq(datasetFoldersTable.userId, userId));

  let name = base;
  let suffix = 2;
  while (siblingNameTaken(existing, null, name)) {
    // Keep the suffix within the length cap.
    const tail = ` ${suffix}`;
    const head = base.length + tail.length > MAX_FOLDER_NAME
      ? base.slice(0, MAX_FOLDER_NAME - tail.length).trimEnd()
      : base;
    name = `${head}${tail}`;
    suffix += 1;
    if (suffix > 500) return null; // pathological; bail out
  }

  try {
    const [created] = await db
      .insert(datasetFoldersTable)
      .values({ userId, parentId: null, name, areaRequestId: areaRequest.id })
      .returning({ id: datasetFoldersTable.id });
    return created?.id ?? null;
  } catch (err) {
    // Most likely the (user_id, lower(name)) unique index firing on a
    // concurrent create — the caller re-checks the request's rows.
    logger.warn({ err, userId, name }, "[area-request] folder insert failed");
    return null;
  }
}
