import { Router } from "express";
import terrainQueryRouter from "./query/index.js";
import trailsRouter from "../../routes/trails.js";
import substrateRouter from "../../routes/substrate.js";
import efhRouter from "../../routes/efh.js";
import intertidalSpotsRouter from "../../routes/intertidal-spots.js";
import terrainBundlesRouter from "../../routes/terrain-bundles.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(terrainQueryRouter);
router.use(trailsRouter);
router.use(substrateRouter);
router.use(efhRouter);
router.use(intertidalSpotsRouter);
router.use(terrainBundlesRouter);

export const terrainDomain: ApiDomain = createDomain("terrain-processing", router);
export default terrainDomain;