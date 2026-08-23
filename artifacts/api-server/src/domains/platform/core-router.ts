import { Router } from "express";
import healthRouter from "../../routes/health.js";
import settingsRouter from "../../routes/settings.js";
import meRouter from "../../routes/me.js";

/**
 * Core platform routes shared by every client:
 * health probes, account identity, and user settings.
 *
 * Keep this as a small composition boundary. Other platform route groups
 * remain mounted by the platform domain so they can move independently.
 */
const router = Router();
router.use(healthRouter);
router.use(settingsRouter);
router.use(meRouter);

export const platformCoreRouter = router;
export default platformCoreRouter;