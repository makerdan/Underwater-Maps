import { Router } from "express";
import terrainQueryRouter from "./query/index.js";
import terrainEnrichmentRouter from "./enrichment/index.js";
import terrainBundlesRouter from "../../routes/terrain-bundles.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(terrainQueryRouter);
router.use(terrainEnrichmentRouter);
router.use(terrainBundlesRouter);

export const terrainDomain: ApiDomain = createDomain("terrain-processing", router);
export default terrainDomain;