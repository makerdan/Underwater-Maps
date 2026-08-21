import { Router } from "express";
import userDatasetsRouter from "../../routes/user-datasets.js";
import foldersRouter from "../../routes/folders.js";
import collectionsRouter from "../../routes/collections.js";
import catalogSavesRouter from "../../routes/catalog-saves.js";
import searchFederatedRouter from "../../routes/search-federated.js";
import nceiRouter from "../../routes/ncei.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(userDatasetsRouter);
router.use(foldersRouter);
router.use(collectionsRouter);
router.use(catalogSavesRouter);
router.use(searchFederatedRouter);
router.use(nceiRouter);

export const catalogSearchDomain: ApiDomain = createDomain("catalog-search", router);
export default catalogSearchDomain;