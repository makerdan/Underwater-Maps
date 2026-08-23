import { Router } from "express";
import trailsRouter from "../../../routes/trails.js";
import substrateRouter from "../../../routes/substrate.js";
import efhRouter from "../../../routes/efh.js";
import intertidalSpotsRouter from "../../../routes/intertidal-spots.js";

const router = Router();
router.use(trailsRouter);
router.use(substrateRouter);
router.use(efhRouter);
router.use(intertidalSpotsRouter);

export const terrainEnrichmentRouter = router;
export default terrainEnrichmentRouter;