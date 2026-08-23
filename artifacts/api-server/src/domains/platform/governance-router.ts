import { Router } from "express";
import adminRouter from "../../routes/admin.js";
import adminUsersRouter from "../../routes/admin-users.js";

/**
 * Privileged platform operations:
 * administration and user-approval management.
 *
 * Keep these routes behind their own composition boundary so privileged
 * concerns can evolve independently from routine identity and settings work.
 */
const router = Router();
router.use(adminRouter);
router.use(adminUsersRouter);

export const platformGovernanceRouter = router;
export default platformGovernanceRouter;