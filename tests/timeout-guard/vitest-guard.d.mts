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
 *
 * Also installs an RSS high-water-mark reporter (Layer 3.5): after every
 * test file completes, peak and current RSS are printed to stdout. When the
 * budget entry defines an `rssWarnMb` threshold and peak RSS exceeds it, a
 * prominent warning is emitted and a JSON report written to
 * .local/test-timeout-reports/ so memory growth is visible in CI before the
 * heap limit is reached.
 */
export declare function installFileBudgetGuard(key: VitestBudgetKey): void;
