import { Router } from "express";
import poeRouter from "../../../routes/poe.js";
import queryRouter from "../../../routes/query.js";

/**
 * Terrain query composition boundary.
 *
 * Keep the Poe mount prefix here rather than in the parent terrain router so
 * query-related routes can be extracted as a unit without changing their
 * public URLs or route-local middleware.
 */
const router = Router();
router.use("/poe", poeRouter);
router.use(queryRouter);

export const terrainQueryRouter = router;
export default terrainQueryRouter;