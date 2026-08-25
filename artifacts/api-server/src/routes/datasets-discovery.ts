/**
 * Dataset discovery and preset administration routes.
 *
 * The handlers remain in datasets.ts while the HTTP composition is kept
 * capability-specific. This module is the only route entry point for the
 * public dataset catalog and preset suppression endpoint.
 */
import { datasetDiscoveryRouter } from "./datasets.js";

export { datasetDiscoveryRouter };
export default datasetDiscoveryRouter;