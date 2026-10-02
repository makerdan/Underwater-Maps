import { installFileBudgetGuard } from "../../../../tests/timeout-guard/vitest-guard.mjs";

// Layer 3: enforce the configured wall-clock budget for every database test file.
installFileBudgetGuard("libDbUnit");