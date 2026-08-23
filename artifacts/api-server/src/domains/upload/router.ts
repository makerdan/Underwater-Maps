import { Router } from "express";
import { uploadIngestionRouter } from "./ingestion.js";
import markersRouter from "../../routes/markers.js";
import catchesRouter from "../../routes/catches.js";
import objectsRouter from "../../routes/objects.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(uploadIngestionRouter);
router.use(markersRouter);
router.use(catchesRouter);
router.use(objectsRouter);

export const uploadDomain: ApiDomain = createDomain("upload", router);
export default uploadDomain;