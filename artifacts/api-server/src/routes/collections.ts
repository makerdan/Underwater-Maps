/**
 * /user/collections — user-defined dataset collections CRUD.
 *
 * Collections are named groups of library datasets that span folders. A
 * member references exactly one of: an uploaded dataset (custom_datasets) or
 * a saved catalog entry (user_catalog_saves). Names are unique per user,
 * case-insensitively (same convention as dataset folders).
 *
 * Deleting a collection removes its membership rows only — never the
 * datasets. Deleting a dataset or catalog save cascades its membership rows
 * away at the DB level (see lib/db/src/schema/dataset-collections.ts).
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";
import {
  db,
  datasetCollectionsTable,
  datasetCollectionMembersTable,
  customDatasetsTable,
  userCatalogSavesTable,
  datasetCatalogTable,
  emptySpecialCollectionMeta,
  type CollectionGeoAnchor,
  type SpecialCollectionMeta,
  type LayoutRevision,
} from "@workspace/db";
import {
  GetUserCollectionsResponse,
  PostUserCollectionsBody,
  PatchUserCollectionsIdRenameBody,
  PatchUserCollectionsIdRenameResponse,
  PostUserCollectionsIdMembersBody,
  PatchUserCollectionsIdMetaBody,
  PostUserCollectionsIdLayoutBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
import { dataMutationRateLimit } from "../middlewares/dataMutationRateLimit.js";

const CollectionIdParamSchema = z.string().uuid("Collection id must be a valid UUID");
const MemberIdParamSchema = z.string().uuid("Member id must be a valid UUID");
const ANCHOR_EPSILON = 1e-9;

/** Max saved layout revisions per special collection — oldest dropped beyond this. */
export const MAX_LAYOUT_REVISIONS = 20;

// ── Background image storage ────────────────────────────────────────────────
// Reference images live on local disk under a flat `collection-bg` directory;
// the storage key recorded in specialMeta is `collection-bg/<collectionId>.<ext>`.
// COLLECTION_BG_DIR overrides the location (used by tests). Resolved lazily so
// the env var can be set before the first upload rather than at import time.
function collectionBgDir(): string {
  return (
    process.env["COLLECTION_BG_DIR"] ??
    path.join(os.tmpdir(), "bathyscan-collection-bg")
  );
}

const BG_MAX_BYTES = 10 * 1024 * 1024;
const BG_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const BG_EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const bgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BG_MAX_BYTES },
  fileFilter(_req, file, cb) {
    if (BG_MIME_TO_EXT[file.mimetype] !== undefined) {
      cb(null, true);
    } else {
      cb(
        Object.assign(new Error("Unsupported image type. Accepted: JPEG, PNG, WebP"), {
          code: "UNSUPPORTED_IMAGE_TYPE",
        }) as unknown as null,
        false,
      );
    }
  },
});

/**
 * Translates background-upload multer errors into structured responses:
 * oversize file → 413, unsupported MIME type → 415.
 */
function bgUploadErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "file_too_large",
        details: `Background image exceeds the ${Math.floor(BG_MAX_BYTES / (1024 * 1024))} MB limit.`,
      });
      return;
    }
    res.status(400).json({ error: "upload_error", details: err.message });
    return;
  }
  if (err instanceof Error && (err as { code?: string }).code === "UNSUPPORTED_IMAGE_TYPE") {
    res.status(415).json({ error: "unsupported_media_type", details: err.message });
    return;
  }
  next(err as Error);
}

const router = Router();

function trimName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.length > 120) return null;
  return t;
}

/** True if another collection owned by the user has the same lowercased name. */
function collectionNameTaken(
  rows: (typeof datasetCollectionsTable.$inferSelect)[],
  name: string,
  exceptId?: string,
): boolean {
  const lower = name.toLowerCase();
  return rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === lower);
}

interface MemberJson {
  id: string;
  kind: "dataset" | "catalogSave";
  refId: string;
  name: string;
  createdAt: string;
}

/**
 * Load membership rows for a set of collections and resolve display names:
 *   - dataset members    → custom_datasets.name
 *   - catalogSave members → display_label ?? dataset_catalog.name ?? catalog_id
 * Rows are scoped to the collection ids passed in (already user-scoped).
 */
async function loadMembersByCollection(
  collectionIds: string[],
): Promise<Map<string, MemberJson[]>> {
  const out = new Map<string, MemberJson[]>();
  if (collectionIds.length === 0) return out;

  const memberRows = await db
    .select()
    .from(datasetCollectionMembersTable)
    .where(inArray(datasetCollectionMembersTable.collectionId, collectionIds));

  const datasetIds = memberRows
    .map((m) => m.datasetId)
    .filter((v): v is string => v !== null);
  const saveIds = memberRows
    .map((m) => m.catalogSaveId)
    .filter((v): v is string => v !== null);

  const datasetNames = new Map<string, string>();
  if (datasetIds.length > 0) {
    const rows = await db
      .select({ id: customDatasetsTable.id, name: customDatasetsTable.name })
      .from(customDatasetsTable)
      .where(inArray(customDatasetsTable.id, datasetIds));
    for (const r of rows) datasetNames.set(r.id, r.name);
  }

  const saveNames = new Map<string, string>();
  if (saveIds.length > 0) {
    const rows = await db
      .select({
        id: userCatalogSavesTable.id,
        displayLabel: userCatalogSavesTable.displayLabel,
        catalogId: userCatalogSavesTable.catalogId,
        catalogName: datasetCatalogTable.name,
      })
      .from(userCatalogSavesTable)
      .leftJoin(datasetCatalogTable, eq(userCatalogSavesTable.catalogId, datasetCatalogTable.id))
      .where(inArray(userCatalogSavesTable.id, saveIds));
    for (const r of rows) saveNames.set(r.id, r.displayLabel ?? r.catalogName ?? r.catalogId);
  }

  for (const m of memberRows) {
    const kind: MemberJson["kind"] = m.datasetId !== null ? "dataset" : "catalogSave";
    const refId = m.datasetId ?? m.catalogSaveId;
    // A membership row always has exactly one reference (DB CHECK); if the
    // referenced row vanished mid-request just skip it — cascade will have
    // removed the member by the next read.
    if (refId === null) continue;
    const name =
      kind === "dataset" ? datasetNames.get(refId) : saveNames.get(refId);
    if (name === undefined) continue;
    const arr = out.get(m.collectionId) ?? [];
    arr.push({
      id: m.id,
      kind,
      refId,
      name,
      createdAt: m.createdAt.toISOString(),
    });
    out.set(m.collectionId, arr);
  }

  // Stable, sensible default order: oldest membership first.
  for (const arr of out.values()) {
    arr.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }
  return out;
}

/**
 * Meta payload for a special collection — falls back to a fresh empty meta
 * object when the JSONB column is somehow NULL (defensive; special rows are
 * always created with meta).
 */
function metaOf(row: typeof datasetCollectionsTable.$inferSelect): SpecialCollectionMeta {
  return row.specialMeta ?? emptySpecialCollectionMeta();
}

/**
 * A two-point registration can only describe a useful similarity transform
 * when both image points and both geographic points are distinct. The schema
 * covers shape/ranges; this protects the semantic invariant before JSONB
 * persistence, including legacy callers that bypass the settings UI.
 */
function hasUsableGeoAnchorPair(anchors: readonly CollectionGeoAnchor[]): boolean {
  if (anchors.length !== 2) return false;
  const [a, b] = anchors;
  if (!a || !b) return false;
  const values = [a.lon, a.lat, a.imgX, a.imgY, b.lon, b.lat, b.imgX, b.imgY];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    a.lon < -180 || a.lon > 180 || b.lon < -180 || b.lon > 180 ||
    a.lat < -90 || a.lat > 90 || b.lat < -90 || b.lat > 90 ||
    a.imgX < 0 || a.imgY < 0 || b.imgX < 0 || b.imgY < 0
  ) {
    return false;
  }
  if (Math.hypot(a.imgX - b.imgX, a.imgY - b.imgY) <= ANCHOR_EPSILON) return false;
  // ±180 is the same meridian, so compare longitudes on a wrapped globe.
  const lonDifference = Math.abs(((a.lon - b.lon + 540) % 360) - 180);
  return lonDifference > ANCHOR_EPSILON || Math.abs(a.lat - b.lat) > ANCHOR_EPSILON;
}

function collectionToJson(
  row: typeof datasetCollectionsTable.$inferSelect,
  members: MemberJson[],
) {
  const kind = row.collectionKind === "special" ? "special" : "standard";
  return {
    id: row.id,
    name: row.name,
    collectionKind: kind,
    ...(kind === "special" ? { specialMeta: metaOf(row) } : {}),
    defaultMemberId: row.defaultMemberId ?? null,
    members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Load a single collection owned by the user, or null. Shared by the
 * special-collection meta/layout/background handlers.
 */
async function loadOwnedCollection(
  userId: string,
  id: string,
): Promise<typeof datasetCollectionsTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(datasetCollectionsTable)
    .where(and(eq(datasetCollectionsTable.id, id), eq(datasetCollectionsTable.userId, userId)));
  return row ?? null;
}

/** Persist a new specialMeta value and bump updatedAt. Returns the updated row. */
async function saveMeta(
  userId: string,
  id: string,
  meta: SpecialCollectionMeta,
): Promise<typeof datasetCollectionsTable.$inferSelect | null> {
  const [updated] = await db
    .update(datasetCollectionsTable)
    .set({ specialMeta: meta, updatedAt: new Date() })
    .where(and(eq(datasetCollectionsTable.id, id), eq(datasetCollectionsTable.userId, userId)))
    .returning();
  return updated ?? null;
}

async function listUserCollections(userId: string) {
  return db
    .select()
    .from(datasetCollectionsTable)
    .where(eq(datasetCollectionsTable.userId, userId));
}

// ── GET /user/collections ──────────────────────────────────────────────────
router.get("/user/collections", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const rows = await listUserCollections(userId);
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const membersByCollection = await loadMembersByCollection(rows.map((r) => r.id));
  res.json(
    GetUserCollectionsResponse.parse(
      rows.map((r) => collectionToJson(r, membersByCollection.get(r.id) ?? [])),
    ),
  );
}));

// ── POST /user/collections ─────────────────────────────────────────────────
router.post("/user/collections", requireAuth, dataMutationRateLimit, validateBody(PostUserCollectionsBody, "POST /api/user/collections"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { name: rawName, collectionKind } = res.locals.parsedBody as {
    name: string;
    collectionKind?: "standard" | "special";
  };
  const name = trimName(rawName);
  if (!name) {
    res.status(400).json({ error: "invalid_name", details: "Collection name is required" });
    return;
  }

  const existing = await listUserCollections(userId);
  if (collectionNameTaken(existing, name)) {
    res.status(400).json({ error: "duplicate_name", details: "A collection with that name already exists" });
    return;
  }

  const kind = collectionKind ?? "standard";
  const [created] = await db
    .insert(datasetCollectionsTable)
    .values({
      userId,
      name,
      collectionKind: kind,
      specialMeta: kind === "special" ? emptySpecialCollectionMeta() : null,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "db_error", details: "Could not create collection" });
    return;
  }
  res.status(201).json(collectionToJson(created, []));
}));

// ── PATCH /user/collections/:id/rename ─────────────────────────────────────
router.patch("/user/collections/:id/rename", requireAuth, dataMutationRateLimit, validateBody(PatchUserCollectionsIdRenameBody, "PATCH /api/user/collections/:id/rename"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid collection id" });
    return;
  }
  const id = idParsed.data;
  const { name: rawName } = res.locals.parsedBody;
  const name = trimName(rawName);
  if (!name) {
    res.status(400).json({ error: "invalid_name", details: "Collection name is required" });
    return;
  }

  const rows = await listUserCollections(userId);
  const target = rows.find((r) => r.id === id);
  if (!target) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  if (collectionNameTaken(rows, name, id)) {
    res.status(400).json({ error: "duplicate_name", details: "A collection with that name already exists" });
    return;
  }

  const [updated] = await db
    .update(datasetCollectionsTable)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(datasetCollectionsTable.id, id), eq(datasetCollectionsTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  const membersByCollection = await loadMembersByCollection([id]);
  res.json(
    PatchUserCollectionsIdRenameResponse.parse(
      collectionToJson(updated, membersByCollection.get(id) ?? []),
    ),
  );
}));

// ── DELETE /user/collections/:id ───────────────────────────────────────────
router.delete("/user/collections/:id", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid collection id" });
    return;
  }
  const id = idParsed.data;

  // Membership rows cascade with the collection; datasets are never touched.
  const deleted = await db
    .delete(datasetCollectionsTable)
    .where(and(eq(datasetCollectionsTable.id, id), eq(datasetCollectionsTable.userId, userId)))
    .returning({ id: datasetCollectionsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  res.status(204).send();
}));

// ── POST /user/collections/:id/members ─────────────────────────────────────
router.post("/user/collections/:id/members", requireAuth, dataMutationRateLimit, validateBody(PostUserCollectionsIdMembersBody, "POST /api/user/collections/:id/members"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid collection id" });
    return;
  }
  const collectionId = idParsed.data;
  const { datasetId, catalogSaveId } = res.locals.parsedBody as {
    datasetId?: string;
    catalogSaveId?: string;
  };

  // Exactly one reference must be provided.
  if ((datasetId === undefined) === (catalogSaveId === undefined)) {
    res.status(400).json({
      error: "invalid_member_ref",
      details: "Provide exactly one of datasetId or catalogSaveId",
    });
    return;
  }

  const [collection] = await db
    .select()
    .from(datasetCollectionsTable)
    .where(and(eq(datasetCollectionsTable.id, collectionId), eq(datasetCollectionsTable.userId, userId)));
  if (!collection) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }

  let name: string;
  if (datasetId !== undefined) {
    const refParsed = z.string().uuid().safeParse(datasetId);
    if (!refParsed.success) {
      res.status(400).json({ error: "invalid_param", details: "datasetId must be a valid UUID" });
      return;
    }
    const [ds] = await db
      .select({ id: customDatasetsTable.id, name: customDatasetsTable.name })
      .from(customDatasetsTable)
      .where(and(eq(customDatasetsTable.id, datasetId), eq(customDatasetsTable.userId, userId)));
    if (!ds) {
      res.status(404).json({ error: "not_found", details: "Dataset not found" });
      return;
    }
    name = ds.name;
  } else {
    const refParsed = z.string().uuid().safeParse(catalogSaveId);
    if (!refParsed.success) {
      res.status(400).json({ error: "invalid_param", details: "catalogSaveId must be a valid UUID" });
      return;
    }
    const [save] = await db
      .select({
        id: userCatalogSavesTable.id,
        displayLabel: userCatalogSavesTable.displayLabel,
        catalogId: userCatalogSavesTable.catalogId,
        catalogName: datasetCatalogTable.name,
      })
      .from(userCatalogSavesTable)
      .leftJoin(datasetCatalogTable, eq(userCatalogSavesTable.catalogId, datasetCatalogTable.id))
      .where(and(eq(userCatalogSavesTable.id, catalogSaveId!), eq(userCatalogSavesTable.userId, userId)));
    if (!save) {
      res.status(404).json({ error: "not_found", details: "Catalog save not found" });
      return;
    }
    name = save.displayLabel ?? save.catalogName ?? save.catalogId;
  }

  // Idempotent add: the partial unique indexes make duplicates impossible;
  // onConflictDoNothing means a re-add returns the existing row.
  const inserted = await db
    .insert(datasetCollectionMembersTable)
    .values({ collectionId, datasetId: datasetId ?? null, catalogSaveId: catalogSaveId ?? null })
    .onConflictDoNothing()
    .returning();

  let member = inserted[0];
  if (!member) {
    const ref = datasetId !== undefined
      ? eq(datasetCollectionMembersTable.datasetId, datasetId)
      : eq(datasetCollectionMembersTable.catalogSaveId, catalogSaveId!);
    const [existing] = await db
      .select()
      .from(datasetCollectionMembersTable)
      .where(and(eq(datasetCollectionMembersTable.collectionId, collectionId), ref));
    if (!existing) {
      res.status(500).json({ error: "db_error", details: "Could not add member" });
      return;
    }
    member = existing;
  }

  // 201 responses have no orval-generated zod schema (same as POST
  // /user/folders) — shape matches DatasetCollectionMember in openapi.yaml.
  res.status(201).json({
    id: member.id,
    kind: datasetId !== undefined ? "dataset" : "catalogSave",
    refId: (member.datasetId ?? member.catalogSaveId)!,
    name,
    createdAt: member.createdAt.toISOString(),
  });
}));

// ── DELETE /user/collections/:id/members/:memberId ─────────────────────────
router.delete("/user/collections/:id/members/:memberId", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  const memberParsed = MemberIdParamSchema.safeParse(req.params["memberId"]);
  if (!idParsed.success || !memberParsed.success) {
    res.status(400).json({ error: "invalid_param", details: "Invalid collection or member id" });
    return;
  }
  const collectionId = idParsed.data;
  const memberId = memberParsed.data;

  // Scope through the collection's owner — a user can only remove members
  // from their own collections.
  const [collection] = await db
    .select({ id: datasetCollectionsTable.id })
    .from(datasetCollectionsTable)
    .where(and(eq(datasetCollectionsTable.id, collectionId), eq(datasetCollectionsTable.userId, userId)));
  if (!collection) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }

  const deleted = await db
    .delete(datasetCollectionMembersTable)
    .where(and(
      eq(datasetCollectionMembersTable.id, memberId),
      eq(datasetCollectionMembersTable.collectionId, collectionId),
    ))
    .returning({ id: datasetCollectionMembersTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "not_found", details: "Member not found" });
    return;
  }
  res.status(204).send();
}));

// ── PATCH /user/collections/:id/meta ───────────────────────────────────────
router.patch("/user/collections/:id/meta", requireAuth, dataMutationRateLimit, validateBody(PatchUserCollectionsIdMetaBody, "PATCH /api/user/collections/:id/meta"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid collection id" });
    return;
  }
  const id = idParsed.data;
  const body = res.locals.parsedBody as {
    defaultMemberId?: string | null;
    bgOpacity?: number;
    bgGeoAnchors?: SpecialCollectionMeta["bgGeoAnchors"];
    activeRevisionId?: string | null;
  };

  if (
    body.defaultMemberId === undefined &&
    body.bgOpacity === undefined &&
    body.bgGeoAnchors === undefined &&
    body.activeRevisionId === undefined
  ) {
    res.status(400).json({ error: "empty_patch", details: "Provide at least one collection metadata field" });
    return;
  }

  const collection = await loadOwnedCollection(userId, id);
  if (!collection) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  const hasSpecialFields =
    body.bgOpacity !== undefined ||
    body.bgGeoAnchors !== undefined ||
    body.activeRevisionId !== undefined;
  if (hasSpecialFields && collection.collectionKind !== "special") {
    res.status(400).json({ error: "not_special", details: "Only special collections carry puzzle metadata" });
    return;
  }

  if (body.defaultMemberId !== undefined && body.defaultMemberId !== null) {
    const memberParsed = MemberIdParamSchema.safeParse(body.defaultMemberId);
    if (!memberParsed.success) {
      res.status(400).json({
        error: "invalid_default_member",
        details: "defaultMemberId must be a valid membership-row UUID belonging to this collection",
      });
      return;
    }
    const [member] = await db
      .select({ id: datasetCollectionMembersTable.id })
      .from(datasetCollectionMembersTable)
      .where(and(
        eq(datasetCollectionMembersTable.id, memberParsed.data),
        eq(datasetCollectionMembersTable.collectionId, id),
      ));
    if (!member) {
      res.status(400).json({
        error: "invalid_default_member",
        details: "defaultMemberId must reference a member of this collection",
      });
      return;
    }
  }

  if (body.bgGeoAnchors !== undefined && body.bgGeoAnchors !== null) {
    if (!hasUsableGeoAnchorPair(body.bgGeoAnchors)) {
      res.status(400).json({
        error: "invalid_geo_anchors",
        details: "Geo anchors must use two distinct finite image points and GPS coordinates.",
      });
      return;
    }
  }

  const meta = metaOf(collection);
  if (body.activeRevisionId !== undefined && body.activeRevisionId !== null) {
    const exists = meta.layoutRevisions.some((r) => r.id === body.activeRevisionId);
    if (!exists) {
      res.status(400).json({ error: "unknown_revision", details: "activeRevisionId does not reference a saved layout revision" });
      return;
    }
  }

  const next: SpecialCollectionMeta = {
    ...meta,
    ...(body.bgOpacity !== undefined ? { bgOpacity: body.bgOpacity } : {}),
    ...(body.bgGeoAnchors !== undefined ? { bgGeoAnchors: body.bgGeoAnchors } : {}),
    ...(body.activeRevisionId !== undefined ? { activeRevisionId: body.activeRevisionId } : {}),
  };
  const [updated] = await db
    .update(datasetCollectionsTable)
    .set({
      ...(hasSpecialFields ? { specialMeta: next } : {}),
      ...(body.defaultMemberId !== undefined ? { defaultMemberId: body.defaultMemberId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(datasetCollectionsTable.id, id), eq(datasetCollectionsTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  const membersByCollection = await loadMembersByCollection([id]);
  res.json(collectionToJson(updated, membersByCollection.get(id) ?? []));
}));

// ── POST /user/collections/:id/layout ──────────────────────────────────────
router.post("/user/collections/:id/layout", requireAuth, dataMutationRateLimit, validateBody(PostUserCollectionsIdLayoutBody, "POST /api/user/collections/:id/layout"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid collection id" });
    return;
  }
  const id = idParsed.data;
  const body = res.locals.parsedBody as {
    name: string;
    tiles: LayoutRevision["tiles"];
    groups: LayoutRevision["groups"];
    pixelDensity?: number;
  };
  const name = trimName(body.name);
  if (!name) {
    res.status(400).json({ error: "invalid_name", details: "Layout revision name is required" });
    return;
  }

  const collection = await loadOwnedCollection(userId, id);
  if (!collection) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  if (collection.collectionKind !== "special") {
    res.status(400).json({ error: "not_special", details: "Only special collections carry puzzle layouts" });
    return;
  }

  const meta = metaOf(collection);
  const savedAt = new Date().toISOString();
  const existingIdx = meta.layoutRevisions.findIndex(
    (r) => r.name.toLowerCase() === name.toLowerCase(),
  );

  let revision: LayoutRevision;
  let revisions: LayoutRevision[];
  if (existingIdx >= 0) {
    // Replace in place — the revision id stays stable so external references
    // (e.g. activeRevisionId on another device) keep working.
    revision = {
      ...meta.layoutRevisions[existingIdx]!,
      savedAt,
      tiles: body.tiles,
      groups: body.groups,
      ...(body.pixelDensity !== undefined ? { pixelDensity: body.pixelDensity } : {}),
    };
    revisions = meta.layoutRevisions.map((r, i) => (i === existingIdx ? revision : r));
  } else {
    revision = {
      id: randomUUID(),
      name,
      savedAt,
      tiles: body.tiles,
      groups: body.groups,
      ...(body.pixelDensity !== undefined ? { pixelDensity: body.pixelDensity } : {}),
    };
    revisions = [...meta.layoutRevisions, revision];
    // Cap: drop oldest first (revisions are stored in append order).
    while (revisions.length > MAX_LAYOUT_REVISIONS) revisions.shift();
  }

  const updated = await saveMeta(userId, id, {
    ...meta,
    layoutRevisions: revisions,
    activeRevisionId: revision.id,
  });
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  res.status(201).json(revision);
}));

// ── DELETE /user/collections/:id/layout/:revisionId ────────────────────────
router.delete("/user/collections/:id/layout/:revisionId", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  const revParsed = z.string().uuid().safeParse(req.params["revisionId"]);
  if (!idParsed.success || !revParsed.success) {
    res.status(400).json({ error: "invalid_param", details: "Invalid collection or revision id" });
    return;
  }
  const id = idParsed.data;
  const revisionId = revParsed.data;

  const collection = await loadOwnedCollection(userId, id);
  if (!collection) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  if (collection.collectionKind !== "special") {
    res.status(400).json({ error: "not_special", details: "Only special collections carry puzzle layouts" });
    return;
  }

  const meta = metaOf(collection);
  const remaining = meta.layoutRevisions.filter((r) => r.id !== revisionId);
  if (remaining.length === meta.layoutRevisions.length) {
    res.status(404).json({ error: "not_found", details: "Layout revision not found" });
    return;
  }

  // If the active revision was deleted, fall back to the most recently saved
  // remaining revision (or null when none remain).
  let activeRevisionId = meta.activeRevisionId;
  if (activeRevisionId === revisionId) {
    activeRevisionId = remaining.length > 0 ? remaining[remaining.length - 1]!.id : null;
  }

  await saveMeta(userId, id, { ...meta, layoutRevisions: remaining, activeRevisionId });
  res.status(204).send();
}));

// ── POST /user/collections/:id/background ──────────────────────────────────
router.post("/user/collections/:id/background", requireAuth, dataMutationRateLimit, bgUpload.single("file"), bgUploadErrorHandler, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid collection id" });
    return;
  }
  const id = idParsed.data;
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "missing_file", details: "Attach the image as multipart field 'file'" });
    return;
  }

  const collection = await loadOwnedCollection(userId, id);
  if (!collection) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  if (collection.collectionKind !== "special") {
    res.status(400).json({ error: "not_special", details: "Only special collections carry a background image" });
    return;
  }

  const ext = BG_MIME_TO_EXT[file.mimetype];
  if (!ext) {
    // fileFilter already rejects these; defensive double-check.
    res.status(415).json({ error: "unsupported_media_type", details: "Unsupported image type. Accepted: JPEG, PNG, WebP" });
    return;
  }

  const dir = collectionBgDir();
  await fs.promises.mkdir(dir, { recursive: true });

  const meta = metaOf(collection);
  // A re-upload may change the extension — remove the old file first.
  if (meta.bgImageKey !== null) {
    const oldPath = path.join(dir, path.basename(meta.bgImageKey));
    await fs.promises.unlink(oldPath).catch(() => undefined);
  }

  const fileName = `${id}${ext}`;
  await fs.promises.writeFile(path.join(dir, fileName), file.buffer);
  await saveMeta(userId, id, { ...meta, bgImageKey: `collection-bg/${fileName}` });

  res.json({ url: `/api/user/collections/${id}/background` });
}));

// ── GET /user/collections/:id/background ───────────────────────────────────
router.get("/user/collections/:id/background", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid collection id" });
    return;
  }
  const id = idParsed.data;

  const collection = await loadOwnedCollection(userId, id);
  if (!collection) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  const meta = collection.specialMeta;
  if (collection.collectionKind !== "special" || !meta || meta.bgImageKey === null) {
    res.status(404).json({ error: "not_found", details: "No background image for this collection" });
    return;
  }

  const fileName = path.basename(meta.bgImageKey);
  const filePath = path.join(collectionBgDir(), fileName);
  let data: Buffer;
  try {
    data = await fs.promises.readFile(filePath);
  } catch {
    res.status(404).json({ error: "not_found", details: "Background image file is missing" });
    return;
  }
  const mime = BG_EXT_TO_MIME[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.send(data);
}));

// ── DELETE /user/collections/:id/background ────────────────────────────────
router.delete("/user/collections/:id/background", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = CollectionIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid collection id" });
    return;
  }
  const id = idParsed.data;

  const collection = await loadOwnedCollection(userId, id);
  if (!collection) {
    res.status(404).json({ error: "not_found", details: "Collection not found" });
    return;
  }
  if (collection.collectionKind !== "special") {
    res.status(400).json({ error: "not_special", details: "Only special collections carry a background image" });
    return;
  }

  const meta = metaOf(collection);
  if (meta.bgImageKey !== null) {
    const filePath = path.join(collectionBgDir(), path.basename(meta.bgImageKey));
    await fs.promises.unlink(filePath).catch(() => undefined);
    await saveMeta(userId, id, { ...meta, bgImageKey: null });
  }
  res.status(204).send();
}));

export default router;
