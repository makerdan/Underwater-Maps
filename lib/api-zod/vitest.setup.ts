import { installFileBudgetGuard } from "../../tests/timeout-guard/vitest-guard.mjs";

// Layer 3: fail fast when a single test file exceeds its wall-clock budget
// (see tests/timeout-guard/budgets.json → apiZod.fileBudgetMs).
installFileBudgetGuard("apiZod");
