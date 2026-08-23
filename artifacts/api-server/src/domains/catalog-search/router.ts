import { Router } from "express";
import catalogDiscoveryRouter from "../../routes/catalog-discovery.js";
import catalogOrganizationRouter from "../catalog-organization/index.js";
import { createDomain, type ApiDomain } from "../domain.js";

const router = Router();
router.use(catalogDiscoveryRouter);
router.use(catalogOrganizationRouter);

export const catalogSearchDomain: ApiDomain = createDomain("catalog-search", router);
export default catalogSearchDomain;