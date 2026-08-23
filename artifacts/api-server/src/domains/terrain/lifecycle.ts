import { recoverTerrainJobs as recoverBundleJobs } from "./bundles/index.js";

export async function recoverTerrainJobs(): Promise<number> {
  return recoverBundleJobs();
}