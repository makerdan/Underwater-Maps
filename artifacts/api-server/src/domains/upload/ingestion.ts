/**
 * Dataset upload ingestion boundary.
 *
 * The dataset route file still owns the upload protocol implementation, but
 * this module is the upload domain's composition seam for its dataset routes
 * and lifecycle operations. Keeping the boundary here lets the upload domain
 * expose recovery and cleanup without making bootstrap depend on route files.
 */
import datasetsRouter from "../../routes/datasets.js";

export const uploadIngestionRouter = datasetsRouter;
export default uploadIngestionRouter;

export {
  cleanupAbandonedUploadJobs,
  cleanupStaleChunks,
  loadCalibrationFromDb,
  recoverStaleUploadJobs,
  sweepStaleUploadSessions,
} from "../../routes/datasets.js";