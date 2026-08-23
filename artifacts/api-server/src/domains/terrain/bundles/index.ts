import terrainBundlesRouter, {
  recoverStaleTerrainBundleJobs,
} from "../../../routes/terrain-bundles.js";

/**
 * Bundle routes and their durable-job lifecycle live behind this boundary.
 * The route implementation remains independently testable while terrain owns
 * the public composition point.
 */
export async function recoverTerrainJobs(): Promise<number> {
  return recoverStaleTerrainBundleJobs();
}

export { terrainBundlesRouter };
export default terrainBundlesRouter;