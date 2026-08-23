import { Router } from "express";
import routesRouter from "../../routes/routes.js";

/**
 * User-owned route planning operations.
 *
 * Keep saved-route CRUD behind its own composition boundary so it can evolve
 * independently from the rest of the platform surface.
 */
const router = Router();
router.use(routesRouter);

export const platformUserRoutesRouter = router;
export default platformUserRoutesRouter;