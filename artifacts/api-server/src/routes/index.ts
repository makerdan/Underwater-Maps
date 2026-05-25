import { Router, type IRouter } from "express";
import healthRouter from "./health";
import poeRouter from "./poe";
import datasetsRouter from "./datasets";
import markersRouter from "./markers";
import userDatasetsRouter from "./user-datasets";
import tidalRouter from "./tidal";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/poe", poeRouter);
router.use(datasetsRouter);
router.use(markersRouter);
router.use(userDatasetsRouter);
router.use(tidalRouter);

export default router;
