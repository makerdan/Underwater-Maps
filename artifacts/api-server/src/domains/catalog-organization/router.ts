import { Router } from "express";
import userDatasetsRouter from "../../routes/user-datasets.js";
import foldersRouter from "../../routes/folders.js";
import collectionsRouter from "../../routes/collections.js";
import catalogSavesRouter from "../../routes/catalog-saves.js";

/**
 * Authenticated catalog organization surfaces.
 *
 * Discovery remains owned by catalog-search; this composer owns the
 * user-scoped library and save lifecycle without changing any route paths.
 */
const router = Router();

router.use(userDatasetsRouter);
router.use(foldersRouter);
router.use(collectionsRouter);
router.use(catalogSavesRouter);

export default router;