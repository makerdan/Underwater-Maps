/**
 * Shared manual mock for lib/logger.ts.
 *
 * Any test file that calls `vi.mock("../../lib/logger.js")` (or any relative
 * path to lib/logger) WITHOUT a factory will receive this object automatically.
 *
 * The key invariant: `child()` must return an object that itself has `child()`,
 * recursively. pino-http v10+ calls `logger.child({req})` and then
 * `child.child(customPropBindings)` on every request. A mock that omits `child`
 * (or whose child omits `child`) causes every route handler to return 500
 * instead of the expected status — tests "pass collection" but then fail with
 * confusing assertion errors on the status code.
 *
 * Usage in a test file:
 *
 *   vi.mock("../../lib/logger.js");   // ← no factory; uses this file
 *   import { logger } from "../../lib/logger.js";
 *
 *   // To spy on a specific level:
 *   vi.mocked(logger.warn).mockClear();
 *   expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(...);
 */
import { vi } from "vitest";

const LEVELS = {
  values: { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 },
  labels: {} as Record<number, string>,
};

function makeChildLogger(): Record<string, unknown> {
  const child: Record<string, unknown> = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    levels: LEVELS,
  };
  child["child"] = vi.fn(() => makeChildLogger());
  return child;
}

export const logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(() => makeChildLogger()),
  levels: LEVELS,
};
