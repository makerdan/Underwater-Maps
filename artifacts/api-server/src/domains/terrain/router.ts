import { Router } from "express";
import poeRouter from "../../routes/poe.js";
import queryRouter from "../../routes/query.js";
import trailsRouter from "../../routes/trails.js";
import substrateRouter from "../../routes/substrate.js";
import efhRouter from "../../routes/efh.js";
import intertidalSpotsRouter from "../../routes/intertidal-spots.js";
import terrainBundlesRouter from "../../routes/terrain-bundles.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use("/poe", poeRouter);
router.use(queryRouter);
router.use(trailsRouter);
router.use(substrateRouter);
router.use(efhRouter);
router.use(intertidalSpotsRouter);
router.use(terrainBundlesRouter);

export const terrainDomain: ApiDomain = createDomain("terrain-processing", router);
export default terrainDomain;