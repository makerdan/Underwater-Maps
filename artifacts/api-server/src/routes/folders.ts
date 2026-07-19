/**
 * /user/folders — dataset folder CRUD for nested library organization.
 *
 * Folder structure is per-user. Sibling names (case-insensitive) must be
 * unique within the same parent. Moves are validated to prevent cycles.
 * Delete supports two modes: "contents" deletes the folder and everything
 * inside; "promote" moves the folder's children up to its parent before
 * deleting the folder itself.
 */
import { Router } from "express";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  datasetFoldersTable,
  customDatasetsTable,
  userCatalogSavesTable,
  type StoredTerrainJson,
} from "@workspace/db";
import {
  GetUserFoldersResponse,
  PostUserFoldersBody,
  PatchUserFoldersIdRenameBody,
  PatchUserFoldersIdRenameResponse,
  PatchUserFoldersIdMoveBody,
  PatchUserFoldersIdMoveResponse,
  DeleteUserFoldersIdBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
import { logger } from "../lib/logger.js";

const FolderIdParamSchema = z.string().uuid("Folder id must be a valid UUID");

const router = Router();

function folderToJson(row: typeof datasetFoldersTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function listUserFolders(userId: string) {
  return db.select().from(datasetFoldersTable).where(eq(datasetFoldersTable.userId, userId));
}

function trimName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.length > 120) return null;
  return t;
}

/** True if any sibling under the same parent has the same lowercased name. */
export function siblingNameTaken(
  rows: (typeof datasetFoldersTable.$inferSelect)[],
  parentId: string | null,
  name: string,
  exceptId?: string,
): boolean {
  const lower = name.toLowerCase();
  return rows.some(
    (r) =>
      r.id !== exceptId &&
      r.parentId === parentId &&
      r.name.toLowerCase() === lower,
  );
}

/** Build a Set of descendant ids of `rootId` (inclusive) from a flat list. */
export function collectDescendantIds(
  rows: { id: string; parentId: string | null }[],
  rootId: string,
): Set<string> {
  const childrenByParent = new Map<string | null, string[]>();
  for (const r of rows) {
    const arr = childrenByParent.get(r.parentId) ?? [];
    arr.push(r.id);
    childrenByParent.set(r.parentId, arr);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of childrenByParent.get(id) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

// ── GET /user/folders ──────────────────────────────────────────────────────
router.get("/user/folders", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const rows = await listUserFolders(userId);
  res.json(GetUserFoldersResponse.parse(rows.map(folderToJson)));
}));

// ── POST /user/folders ─────────────────────────────────────────────────────
router.post("/user/folders", requireAuth, validateBody(PostUserFoldersBody, "POST /api/user/folders"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { name: rawName, parentId: rawParentId } = res.locals.parsedBody;
  const name = trimName(rawName);
  if (!name) {
    res.status(400).json({ error: "invalid_name", details: "Folder name is required" });
    return;
  }
  const parentId = rawParentId ?? null;

  const existing = await listUserFolders(userId);

  if (parentId !== null && !existing.some((r) => r.id === parentId)) {
    res.status(400).json({ error: "invalid_parent", details: "Parent folder not found" });
    return;
  }
  if (siblingNameTaken(existing, parentId, name)) {
    res.status(400).json({ error: "duplicate_name", details: "A folder with that name already exists here" });
    return;
  }

  const [created] = await db
    .insert(datasetFoldersTable)
    .values({ userId, name, parentId })
    .returning();
  if (!created) {
    res.status(500).json({ error: "db_error", details: "Could not create folder" });
    return;
  }
  res.status(201).json(folderToJson(created));
}));

// ── PATCH /user/folders/:id/rename ─────────────────────────────────────────
router.patch("/user/folders/:id/rename", requireAuth, validateBody(PatchUserFoldersIdRenameBody, "PATCH /api/user/folders/:id/rename"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = FolderIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid folder id" });
    return;
  }
  const id = idParsed.data;
  const { name: rawName } = res.locals.parsedBody;
  const name = trimName(rawName);
  if (!name) {
    res.status(400).json({ error: "invalid_name", details: "Folder name is required" });
    return;
  }

  const rows = await listUserFolders(userId);
  const target = rows.find((r) => r.id === id);
  if (!target) {
    res.status(404).json({ error: "not_found", details: "Folder not found" });
    return;
  }
  if (siblingNameTaken(rows, target.parentId, name, id)) {
    res.status(400).json({ error: "duplicate_name", details: "A folder with that name already exists here" });
    return;
  }

  const [updated] = await db
    .update(datasetFoldersTable)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(datasetFoldersTable.id, id), eq(datasetFoldersTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Folder not found" });
    return;
  }
  res.json(PatchUserFoldersIdRenameResponse.parse(folderToJson(updated)));
}));

// ── PATCH /user/folders/:id/move ───────────────────────────────────────────
router.patch("/user/folders/:id/move", requireAuth, validateBody(PatchUserFoldersIdMoveBody, "PATCH /api/user/folders/:id/move"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const idParsed = FolderIdParamSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(400).json({ error: "invalid_param", details: idParsed.error.issues[0]?.message ?? "Invalid folder id" });
    return;
  }
  const id = idParsed.data;
  const { parentId: rawParentId } = res.locals.parsedBody;
  const newParentId = rawParentId ?? null;

  const rows = await listUserFolders(userId);
  const target = rows.find((r) => r.id === id);
  if (!target) {
    res.status(404).json({ error: "not_found", details: "Folder not found" });
    return;
  }
  if (newParentId !== null) {
    if (newParentId === id) {
      res.status(400).json({ error: "invalid_target", details: "Cannot move a folder into itself" });
      return;
    }
    if (!rows.some((r) => r.id === newParentId)) {
      res.status(400).json({ error: "invalid_parent", details: "Parent folder not found" });
      return;
    }
    const descendants = collectDescendantIds(rows, id);
    if (descendants.has(newParentId)) {
      res.status(400).json({ error: "cycle", details: "Cannot move a folder into one of its descendants" });
      return;
    }
  }
  if (siblingNameTaken(rows, newParentId, target.name, id)) {
    res.status(400).json({ error: "duplicate_name", details: "A folder with that name already exists in the target" });
    return;
  }

  const [updated] = await db
    .update(datasetFoldersTable)
    .set({ parentId: newParentId, updatedAt: new Date() })
    .where(and(eq(datasetFoldersTable.id, id), eq(datasetFoldersTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Folder not found" });
    return;
  }
  res.json(PatchUserFoldersIdMoveResponse.parse(folderToJson(updated)));
}));

// ── POST /user/folders/:id/duplicate ───────────────────────────────────────
router.post("/user/folders/:id/duplicate", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const rows = await listUserFolders(userId);
  const source = rows.find((r) => r.id === id);
  if (!source) {
    res.status(404).json({ error: "not_found", details: "Folder not found" });
    return;
  }

  // Find a non-colliding name "<name> (copy)" / "<name> (copy 2)" ...
  let copyName = `${source.name} (copy)`;
  let n = 2;
  while (siblingNameTaken(rows, source.parentId, copyName)) {
    copyName = `${source.name} (copy ${n++})`;
    if (n > 100) break;
  }

  // BFS-clone tree — wrapped in a single transaction so a mid-walk failure
  // leaves no partial tree or orphaned dataset copies behind.
  const descendantIds = collectDescendantIds(rows, source.id);

  try {
    const newRoot = await db.transaction(async (tx) => {
      const newIdByOld = new Map<string, string>();

      const [rootRow] = await tx
        .insert(datasetFoldersTable)
        .values({ userId, name: copyName, parentId: source.parentId })
        .returning();
      if (!rootRow) throw new Error("insert_root_failed");
      newIdByOld.set(source.id, rootRow.id);

      // Insert children level by level
      const queue: string[] = [source.id];
      while (queue.length) {
        const oldParentId = queue.shift()!;
        const children = rows.filter(
          (r) => r.parentId === oldParentId && descendantIds.has(r.id),
        );
        for (const child of children) {
          const newParent = newIdByOld.get(oldParentId)!;
          const [inserted] = await tx
            .insert(datasetFoldersTable)
            .values({ userId, name: child.name, parentId: newParent })
            .returning();
          if (!inserted) throw new Error("insert_child_failed");
          newIdByOld.set(child.id, inserted.id);
          queue.push(child.id);
        }
      }

      // Deep copy the datasets inside the duplicated tree.
      // Filter by folderId in SQL so we only load the relevant rows
      // instead of fetching every dataset the user owns.
      const folderIdsArr = Array.from(descendantIds);
      const datasetsInside = await tx
        .select()
        .from(customDatasetsTable)
        .where(
          and(
            eq(customDatasetsTable.userId, userId),
            inArray(customDatasetsTable.folderId, folderIdsArr),
          ),
        );
      for (const ds of datasetsInside) {
        if (ds.folderId && newIdByOld.has(ds.folderId)) {
          const [inserted] = await tx
            .insert(customDatasetsTable)
            .values({
              userId,
              name: ds.name,
              minDepth: ds.minDepth,
              maxDepth: ds.maxDepth,
              terrainJson: ds.terrainJson,
              overviewJson: ds.overviewJson,
              folderId: newIdByOld.get(ds.folderId) ?? null,
            })
            .returning({ id: customDatasetsTable.id });
          if (!inserted) throw new Error("insert_dataset_failed");
          // Rewrite the embedded datasetId so the cloned grids identify as
          // the new row, not the source — otherwise the client's load guard
          // will reject the payload and the scene stays blank.
          const stampedTerrain = {
            ...(ds.terrainJson as unknown as Record<string, unknown>),
            datasetId: inserted.id,
          } as unknown as StoredTerrainJson;
          const stampedOverview = {
            ...(ds.overviewJson as unknown as Record<string, unknown>),
            datasetId: inserted.id,
          } as unknown as StoredTerrainJson;
          await tx
            .update(customDatasetsTable)
            .set({ terrainJson: stampedTerrain, overviewJson: stampedOverview })
            .where(eq(customDatasetsTable.id, inserted.id));
        }
      }

      return rootRow;
    });

    res.status(201).json(folderToJson(newRoot));
  } catch (err) {
    logger.error({ err, folderId: id }, `[folders] duplicate failed for ${id}`);
    res.status(500).json({ error: "db_error", details: "Could not duplicate folder" });
  }
}));

// ── DELETE /user/folders/:id ───────────────────────────────────────────────
router.delete("/user/folders/:id", requireAuth, validateBody(DeleteUserFoldersIdBody, "DELETE /api/user/folders/:id"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");
  const { mode } = res.locals.parsedBody;

  const rows = await listUserFolders(userId);
  const target = rows.find((r) => r.id === id);
  if (!target) {
    res.status(404).json({ error: "not_found", details: "Folder not found" });
    return;
  }

  // Both delete modes touch multiple rows across multiple tables — wrap each
  // in a single transaction so a mid-walk failure rolls back to a consistent
  // state instead of leaving orphaned datasets or half-promoted children.
  try {
    if (mode === "promote") {
      await db.transaction(async (tx) => {
        // Re-parent children + datasets to the target's parent, then delete only this folder.
        await tx
          .update(datasetFoldersTable)
          .set({ parentId: target.parentId, updatedAt: new Date() })
          .where(
            and(eq(datasetFoldersTable.parentId, id), eq(datasetFoldersTable.userId, userId)),
          );
        await tx
          .update(customDatasetsTable)
          .set({ folderId: target.parentId })
          .where(
            and(eq(customDatasetsTable.folderId, id), eq(customDatasetsTable.userId, userId)),
          );
        await tx
          .update(userCatalogSavesTable)
          .set({ folderId: target.parentId })
          .where(
            and(eq(userCatalogSavesTable.folderId, id), eq(userCatalogSavesTable.userId, userId)),
          );
        await tx
          .delete(datasetFoldersTable)
          .where(and(eq(datasetFoldersTable.id, id), eq(datasetFoldersTable.userId, userId)));
      });
    } else {
      // "contents" — cascade-delete folder subtree + delete datasets inside.
      const descendants = collectDescendantIds(rows, id);
      const idsArr = Array.from(descendants);
      await db.transaction(async (tx) => {
        // Delete custom datasets and catalog saves that live in any descendant folder
        await tx
          .delete(customDatasetsTable)
          .where(
            and(
              inArray(customDatasetsTable.folderId, idsArr),
              eq(customDatasetsTable.userId, userId),
            ),
          );
        await tx
          .delete(userCatalogSavesTable)
          .where(
            and(
              inArray(userCatalogSavesTable.folderId, idsArr),
              eq(userCatalogSavesTable.userId, userId),
            ),
          );
        // Cascade FK deletes the descendant folders when we delete the root
        await tx
          .delete(datasetFoldersTable)
          .where(and(eq(datasetFoldersTable.id, id), eq(datasetFoldersTable.userId, userId)));
      });
    }
  } catch (err) {
    logger.error({ err, folderId: id, mode }, `[folders] delete (${mode}) failed for ${id}`);
    res.status(500).json({ error: "db_error", details: "Could not delete folder" });
    return;
  }

  res.status(204).send();
}));

// Re-export for potential testing
export { isNull };
export default router;
