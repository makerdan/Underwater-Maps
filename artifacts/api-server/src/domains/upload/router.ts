import { Router } from "express";
import { uploadIngestionRouter } from "./ingestion.js";
import { fieldDataRouter } from "./field-data.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(uploadIngestionRouter);
router.use(fieldDataRouter);

export const uploadDomain: ApiDomain = createDomain("upload", router);
export default uploadDomain;