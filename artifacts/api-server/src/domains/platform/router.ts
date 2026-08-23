import { Router } from "express";
import platformCoreRouter from "./core-router.js";
import platformGovernanceRouter from "./governance-router.js";
import routesRouter from "../../routes/routes.js";
import githubRouter from "../../routes/github.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(platformCoreRouter);
router.use(platformGovernanceRouter);
router.use(routesRouter);
router.use("/github", githubRouter);

export const platformDomain: ApiDomain = createDomain("platform", router);
export default platformDomain;