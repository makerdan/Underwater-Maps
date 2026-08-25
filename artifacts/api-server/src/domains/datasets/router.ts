import { Router } from "express";
import datasetDiscoveryRouter from "../../routes/datasets-discovery.js";
import datasetTerrainRouter from "../../routes/datasets-terrain.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(datasetDiscoveryRouter);
router.use(datasetTerrainRouter);

export const datasetDomain: ApiDomain = createDomain("datasets", router);
export default datasetDomain;