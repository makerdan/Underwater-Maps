import { Router } from "express";
import markersRouter from "../../routes/markers.js";
import catchesRouter from "../../routes/catches.js";
import objectsRouter from "../../routes/objects.js";

/**
 * Field data and private assets owned by upload-domain users.
 *
 * These routers remain independently testable route modules, while this
 * composition boundary keeps marker/catch/object access separate from the
 * resumable dataset-ingestion pipeline.
 */
const fieldDataRouter = Router();
fieldDataRouter.use(markersRouter);
fieldDataRouter.use(catchesRouter);
fieldDataRouter.use(objectsRouter);

export { fieldDataRouter };
export default fieldDataRouter;