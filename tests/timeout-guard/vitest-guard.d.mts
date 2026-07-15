export type VitestBudgetKey =
  | "apiServerUnit"
  | "apiServerValidation"
  | "bathyscanUnit"
  | "bathyscanValidation"
  | "apiZod";

/**
 * Layer 3: install the per-test-file wall-clock budget guard.
 * Call from a Vitest setup file with the package's budget key
 * (see tests/timeout-guard/budgets.json).
 */
export declare function installFileBudgetGuard(key: VitestBudgetKey): void;
