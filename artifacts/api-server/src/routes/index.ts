import { Router, type IRouter } from "express";
import healthRouter from "./health";
import poeRouter from "./poe";
import datasetsRouter from "./datasets";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/poe", poeRouter);
router.use(datasetsRouter);

export default router;
