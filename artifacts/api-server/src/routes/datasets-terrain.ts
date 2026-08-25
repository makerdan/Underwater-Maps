/**
 * Dataset terrain reads, previews, zones, and downloads.
 *
 * The handlers remain in datasets.ts while the HTTP composition is kept
 * capability-specific and independent from upload protocol routes.
 */
import { datasetTerrainRouter } from "./datasets.js";

export { datasetTerrainRouter };
export default datasetTerrainRouter;