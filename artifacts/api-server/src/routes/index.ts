import { Router, type IRouter } from "express";
import { datasetDomain } from "../domains/datasets/index.js";
import { uploadDomain } from "../domains/upload/index.js";
import { terrainDomain } from "../domains/terrain/index.js";
import { catalogSearchDomain } from "../domains/catalog-search/index.js";
import { environmentalDomain } from "../domains/environmental/index.js";
import { platformDomain } from "../domains/platform/index.js";

/**
 * The API composition root.
 *
 * Domain routers own the route groups and are mounted exactly once here.
 * Cross-cutting middleware belongs in app.ts; startup and shutdown lifecycle
 * belongs in index.ts. Keeping those responsibilities separate lets a domain
 * move to a separate service later without changing URL ownership today.
 */
export const API_DOMAINS = [
  platformDomain,
  datasetDomain,
  uploadDomain,
  terrainDomain,
  catalogSearchDomain,
  environmentalDomain,
] as const;

/** Stable source-directory keys used by structural checks and tooling. */
export const API_DOMAIN_KEYS = [
  "platform",
  "datasets",
  "upload",
  "terrain",
  "catalog-search",
  "environmental",
] as const;

const router: IRouter = Router();
for (const domain of API_DOMAINS) {
  router.use(domain.router);
}

export default router;