import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, markersTable, catchEntriesTable } from "@workspace/db";
import {
  GetCatchesQueryParams,
  GetMarkersMarkerIdCatchesParams,
  PostMarkersMarkerIdCatchesParams,
  PostMarkersMarkerIdCatchesBody,
  PatchCatchesIdParams,
  PatchCatchesIdBody,
  DeleteCatchesIdParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "../lib/objectAcl";

const router = Router();

const MAX_PHOTOS = 6;

/** Thrown when a caller references a photo object they are not allowed to claim. */
class PhotoAclError extends Error {
  constructor(
    public readonly status: 403 | 400,
    public readonly details: string,
  ) {
    super(details);
  }
}

/**
 * Validate photo paths: each must be a normalized private-object path.
 * Rejects anything not under /objects/ so arbitrary URLs can't be stored.
 */
function invalidPhotoPath(photos: string[]): string | null {
  for (const p of photos) {
    if (!p.startsWith("/objects/")) return p;
  }
  return null;
}

/**
 * Claim ownership of newly referenced photo objects, with authorization.
 *
 * For each path:
 *  - the object must exist (fresh signed-URL upload), else 400;
 *  - if the object has NO ACL policy yet it is an unclaimed upload — the
 *    caller becomes its owner;
 *  - if it already has a policy, the caller must ALREADY be its owner.
 *    Anything else is an ACL-takeover attempt and is rejected with 403.
 *    Ownership is never reassigned to a different user.
 */
async function applyPhotoAcls(photos: string[], userId: string): Promise<string[]> {
  const service = new ObjectStorageService();
  const normalized: string[] = [];
  for (const p of photos) {
    const path = service.normalizeObjectEntityPath(p);
    if (!path.startsWith("/objects/")) {
      throw new PhotoAclError(400, `Invalid photo path '${p}' — must start with /objects/`);
    }
    let objectFile;
    try {
      objectFile = await service.getObjectEntityFile(path);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        throw new PhotoAclError(400, `Photo object '${path}' does not exist — upload it first`);
      }
      throw err;
    }
    const existing = await getObjectAclPolicy(objectFile);
    if (existing === null) {
      // Unclaimed fresh upload — the caller becomes its owner.
      await setObjectAclPolicy(objectFile, { owner: userId, visibility: "private" });
    } else if (existing.owner !== userId) {
      throw new PhotoAclError(403, `You do not have access to photo object '${path}'`);
    }
    normalized.push(path);
  }
  return normalized;
}

// ─── List all catches across the caller's markers in a dataset ───────────────
router.get("/catches", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = GetCatchesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "datasetId query parameter is required" });
    return;
  }
  const { datasetId } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const markerRows = await db
    .select({ id: markersTable.id })
    .from(markersTable)
    .where(and(eq(markersTable.datasetId, datasetId), eq(markersTable.userId, userId)));

  if (markerRows.length === 0) {
    res.json([]);
    return;
  }

  const rows = await db
    .select()
    .from(catchEntriesTable)
    .where(and(
      inArray(catchEntriesTable.markerId, markerRows.map((m) => m.id)),
      eq(catchEntriesTable.userId, userId),
    ))
    .orderBy(catchEntriesTable.createdAt);

  res.json(rows);
}));

// ─── List catches for one marker ──────────────────────────────────────────────
router.get("/markers/:markerId/catches", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = GetMarkersMarkerIdCatchesParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid marker id" });
    return;
  }
  const { markerId } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const [marker] = await db
    .select({ id: markersTable.id })
    .from(markersTable)
    .where(and(eq(markersTable.id, markerId), eq(markersTable.userId, userId)));
  if (!marker) {
    res.status(404).json({ error: "not_found", details: `Marker '${markerId}' not found` });
    return;
  }

  const rows = await db
    .select()
    .from(catchEntriesTable)
    .where(and(eq(catchEntriesTable.markerId, markerId), eq(catchEntriesTable.userId, userId)))
    .orderBy(catchEntriesTable.createdAt);

  res.json(rows);
}));

// ─── Create a catch entry on a marker ─────────────────────────────────────────
router.post("/markers/:markerId/catches", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const params = PostMarkersMarkerIdCatchesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid marker id" });
    return;
  }
  const body = PostMarkersMarkerIdCatchesBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid_request", details: body.error.message, issues: body.error.issues });
    return;
  }

  const { markerId } = params.data;
  const { symbol, symbolName = "", notes, photos = [] } = body.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  if (photos.length > MAX_PHOTOS) {
    res.status(400).json({ error: "invalid_request", details: `At most ${MAX_PHOTOS} photos per catch` });
    return;
  }
  const badPath = invalidPhotoPath(photos);
  if (badPath !== null) {
    res.status(400).json({ error: "invalid_request", details: `Invalid photo path '${badPath}' — must start with /objects/` });
    return;
  }

  const [marker] = await db
    .select({ id: markersTable.id })
    .from(markersTable)
    .where(and(eq(markersTable.id, markerId), eq(markersTable.userId, userId)));
  if (!marker) {
    res.status(404).json({ error: "not_found", details: `Marker '${markerId}' not found` });
    return;
  }

  let aclPhotos: string[];
  try {
    aclPhotos = await applyPhotoAcls(photos, userId);
  } catch (err) {
    if (err instanceof PhotoAclError) {
      res.status(err.status).json({ error: err.status === 403 ? "forbidden" : "invalid_request", details: err.details });
      return;
    }
    throw err;
  }

  const [created] = await db
    .insert(catchEntriesTable)
    .values({ markerId, userId, symbol, symbolName, notes: notes ?? null, photos: aclPhotos })
    .returning();

  res.status(201).json(created);
}));

// ─── Edit a catch entry ───────────────────────────────────────────────────────
router.patch("/catches/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const params = PatchCatchesIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid catch id" });
    return;
  }
  const body = PatchCatchesIdBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid_request", details: body.error.message, issues: body.error.issues });
    return;
  }

  const { id } = params.data;
  const updateData = body.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "invalid_request", details: "No fields to update" });
    return;
  }

  if (updateData.photos !== undefined) {
    if (updateData.photos.length > MAX_PHOTOS) {
      res.status(400).json({ error: "invalid_request", details: `At most ${MAX_PHOTOS} photos per catch` });
      return;
    }
    const badPath = invalidPhotoPath(updateData.photos);
    if (badPath !== null) {
      res.status(400).json({ error: "invalid_request", details: `Invalid photo path '${badPath}' — must start with /objects/` });
      return;
    }
    try {
      updateData.photos = await applyPhotoAcls(updateData.photos, userId);
    } catch (err) {
      if (err instanceof PhotoAclError) {
        res.status(err.status).json({ error: err.status === 403 ? "forbidden" : "invalid_request", details: err.details });
        return;
      }
      throw err;
    }
  }

  const [updated] = await db
    .update(catchEntriesTable)
    .set({ ...updateData, updatedAt: new Date() })
    .where(and(eq(catchEntriesTable.id, id), eq(catchEntriesTable.userId, userId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "not_found", details: `Catch entry '${id}' not found` });
    return;
  }

  res.json(updated);
}));

// ─── Delete a catch entry ─────────────────────────────────────────────────────
router.delete("/catches/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = DeleteCatchesIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid catch id" });
    return;
  }
  const { id } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const deleted = await db
    .delete(catchEntriesTable)
    .where(and(eq(catchEntriesTable.id, id), eq(catchEntriesTable.userId, userId)))
    .returning({ id: catchEntriesTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `Catch entry '${id}' not found` });
    return;
  }

  res.status(204).send();
}));

// ─── Signed upload URL for one catch photo ────────────────────────────────────
router.post("/catch-photos/upload-url", requireAuth, asyncHandler(async (_req, res): Promise<void> => {
  const service = new ObjectStorageService();
  const uploadURL = await service.getObjectEntityUploadURL();
  const objectPath = service.normalizeObjectEntityPath(uploadURL);
  res.json({ uploadURL, objectPath });
}));

export default router;
