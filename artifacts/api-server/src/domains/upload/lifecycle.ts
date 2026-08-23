import {
  cleanupStaleChunks,
  loadCalibrationFromDb,
  recoverStaleUploadJobs,
} from "./ingestion.js";
import { startUploadCleanupJob } from "../../lib/uploadCleanupJob.js";

/**
 * Upload recovery is intentionally exposed as a domain lifecycle adapter.
 * Bootstrap coordinates when it runs; it does not know which route module
 * owns the durable upload state.
 */
export async function recoverUploads(): Promise<boolean> {
  return recoverStaleUploadJobs();
}

export async function cleanupRecoveredUploads(): Promise<void> {
  await cleanupStaleChunks();
}

export async function loadUploadCalibration(): Promise<void> {
  await loadCalibrationFromDb();
}

export function startUploadCleanup(): () => void {
  return startUploadCleanupJob();
}