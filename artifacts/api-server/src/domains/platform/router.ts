import { Router } from "express";
import platformCoreRouter from "./core-router.js";
import routesRouter from "../../routes/routes.js";
import adminRouter from "../../routes/admin.js";
import adminUsersRouter from "../../routes/admin-users.js";
import githubRouter from "../../routes/github.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(platformCoreRouter);
router.use(routesRouter);
router.use(adminRouter);
router.use(adminUsersRouter);
router.use("/github", githubRouter);

export const platformDomain: ApiDomain = createDomain("platform", router);
export default platformDomain;