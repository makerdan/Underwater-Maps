import { Router, type IRouter } from "express";
import healthRouter from "./health";
import poeRouter from "./poe";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/poe", poeRouter);

export default router;
