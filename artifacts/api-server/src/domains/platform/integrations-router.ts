import { Router } from "express";
import githubRouter from "../../routes/github.js";

/**
 * Platform integrations.
 *
 * The GitHub prefix is owned here so the integration can move independently
 * without changing the public /api/github/* endpoint surface.
 */
const router = Router();
router.use("/github", githubRouter);

export const platformIntegrationsRouter = router;
export default platformIntegrationsRouter;