/**
 * Shared logger mock helper for API server unit tests.
 *
 * Usage:
 *
 *   import { loggerMockFactory, getMockLogger } from "./helpers/mockLogger.js";
 *
 *   // Standard form — must remain in each test file so Vitest hoists it.
 *   // Use the wrapper lambda `() => loggerMockFactory()` rather than passing
 *   // loggerMockFactory directly.  The wrapper defers evaluation until after
 *   // imports are initialized, which is required when another import in the
 *   // same test file transitively depends on logger at module-load time
 *   // (e.g. noaaTarRouter → logger).  Passing the reference directly causes a
 *   // "Cannot access before initialization" ReferenceError in that case.
 *   vi.mock("../lib/logger.js", () => loggerMockFactory());
 *
 *   // If you need to assert on logger calls, obtain typed refs after imports:
 *   import { logger } from "../lib/logger.js";
 *   const { info, warn, error, debug } = getMockLogger(logger);
 *
 * For tests that only need to silence logger output (no assertions), simply
 * call vi.mock with the factory and skip getMockLogger entirely.
 *
 * Special case — if a module imported by the test ITSELF transitively imports
 * logger at module load time, the lazy wrapper `() => loggerMockFactory()` may
 * still fail because loggerMockFactory (imported from this helper) is not yet
 * initialized when Vitest resolves the transitive dependency.  In that case,
 * keep the vi.mock factory fully inline and use only getMockLogger() here for
 * the type-safe cast:
 */

import { vi, type MockInstance } from "vitest";

export type MockLogger = {
  info: MockInstance;
  warn: MockInstance;
  error: MockInstance;
  debug: MockInstance;
};

/** Factory for vi.mock("../lib/logger.js", loggerMockFactory). */
export function loggerMockFactory() {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
}

/**
 * Cast an already-mocked logger import to a typed shape so tests can assert
 * on individual method calls without unsafe manual casts.
 *
 * @param logger - The `logger` named export from `../lib/logger.js` after
 *                 vi.mock has replaced it with loggerMockFactory output.
 */
export function getMockLogger(logger: unknown): MockLogger {
  return logger as MockLogger;
}
