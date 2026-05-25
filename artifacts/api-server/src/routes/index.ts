import { Router, type IRouter } from "express";
import healthRouter from "./health";
import poeRouter from "./poe";
import datasetsRouter from "./datasets";
import markersRouter from "./markers";
import settingsRouter from "./settings";
import userDatasetsRouter from "./user-datasets";
import tidalRouter from "./tidal";
import queryRouter from "./query";
import trailsRouter from "./trails";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/poe", poeRouter);
router.use(datasetsRouter);
router.use(markersRouter);
router.use(settingsRouter);
router.use(userDatasetsRouter);
router.use(tidalRouter);
router.use(queryRouter);
router.use(trailsRouter);

export default router;
