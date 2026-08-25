/**
 * Dataset ingestion protocol routes.
 *
 * This router contains only multipart, raster, resumable chunk, direct-storage,
 * and upload-job endpoints. Upload-domain composition imports this focused
 * router rather than the legacy all-purpose datasets router.
 */
import { datasetIngestionRouter } from "./datasets.js";

export { datasetIngestionRouter };
export default datasetIngestionRouter;