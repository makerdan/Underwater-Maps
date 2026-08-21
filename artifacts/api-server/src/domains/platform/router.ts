import { Router } from "express";
import healthRouter from "../../routes/health.js";
import settingsRouter from "../../routes/settings.js";
import meRouter from "../../routes/me.js";
import routesRouter from "../../routes/routes.js";
import adminRouter from "../../routes/admin.js";
import adminUsersRouter from "../../routes/admin-users.js";
import githubRouter from "../../routes/github.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(healthRouter);
router.use(settingsRouter);
router.use(meRouter);
router.use(routesRouter);
router.use(adminRouter);
router.use(adminUsersRouter);
router.use("/github", githubRouter);

export const platformDomain: ApiDomain = createDomain("platform", router);
export default platformDomain;