import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

const router = Router();

/**
 * Serve a private object (e.g. a catch photo) with a per-user ACL check.
 * Only the owner (or users granted READ via ACL rules) may download.
 */
router.get("/objects/*objectPath", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const service = new ObjectStorageService();
  try {
    const objectFile = await service.getObjectEntityFile(req.path);
    const canAccess = await service.canAccessObjectEntity({
      userId,
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canAccess) {
      res.status(403).json({ error: "forbidden", details: "You do not have access to this object" });
      return;
    }
    const response = await service.downloadObject(objectFile, 3600);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) {
      res.status(500).json({ error: "internal_error", details: "Empty object body" });
      return;
    }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "not_found", details: "Object not found" });
      return;
    }
    throw err;
  }
}));

export default router;
