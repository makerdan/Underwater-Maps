import { recoverStaleTerrainBundleJobs } from "../../routes/terrain-bundles.js";

export async function recoverTerrainJobs(): Promise<number> {
  return recoverStaleTerrainBundleJobs();
}