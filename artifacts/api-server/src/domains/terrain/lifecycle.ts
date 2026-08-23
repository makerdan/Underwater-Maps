import {
  recoverTerrainJobs as recoverBundleJobs,
  startTerrainJobMonitor as startBundleJobMonitor,
} from "./bundles/index.js";

export async function recoverTerrainJobs(): Promise<number> {
  return recoverBundleJobs();
}

export function startTerrainJobMonitor(): () => void {
  return startBundleJobMonitor();
}
