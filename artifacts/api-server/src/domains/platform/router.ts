import { Router } from "express";
import platformCoreRouter from "./core-router.js";
import platformGovernanceRouter from "./governance-router.js";
import platformUserRoutesRouter from "./user-routes-router.js";
import platformIntegrationsRouter from "./integrations-router.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(platformCoreRouter);
router.use(platformGovernanceRouter);
router.use(platformUserRoutesRouter);
router.use(platformIntegrationsRouter);

export const platformDomain: ApiDomain = createDomain("platform", router);
export default platformDomain;